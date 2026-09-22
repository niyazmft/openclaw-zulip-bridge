/**
 * Mode A: plugin-driven trace checkpoints from agent tool calls (#302, epic #293).
 *
 * Verified by the #299 spike:
 * - `after_tool_call` is an **Observe** hook, so it never gates the agent. We
 *   deliberately never register `before_tool_call`: that hook is *fail-closed*
 *   (a slow handler blocks the run), the exact inverse of "never block agent
 *   work".
 * - The payload identifies the *agent run* (`runId` / `sessionKey`), never the
 *   Zulip room. Attribution is therefore ours: look the trace up by session key
 *   or run id, and **drop** unattributable hooks rather than guess a topic.
 * - Hooks may be awaited by the emitter with no default timeout, so the handler
 *   is synchronous, does no I/O, and hands off to the #300 coalescer via
 *   `trace.step(...)`. Registration also passes an explicit `timeoutMs`.
 * - Duplicate registration is a documented N-fold-delivery hazard upstream, so
 *   registration is idempotent and uses a stable `registrationId` (the host
 *   dedupes by identity across hot reloads).
 *
 * Harness variance is real and out of our control: the hook catalog is the
 * registration API, not a promise that every runtime emits every hook (Codex
 * lacked post-tool hooks until openclaw#70307; openclaw#76201 reports native
 * `exec` not firing on the Anthropic harness). That is why the #301
 * run-boundary trace is the guaranteed floor, and mode A is best-effort on top.
 */

import {
  findActivityTrace,
  type ActivityTrace,
  type TraceLogger,
  type TraceStepStatus,
} from "./activity-trace.js";

export const TOOL_TRACE_HOOK_NAME = "after_tool_call";
/** Relevance filter as a registration option — never mirror the whole tool log. */
export const TOOL_TRACE_MATCHER = ["exec"];
export const TOOL_TRACE_TIMEOUT_MS = 2000;
export const TOOL_TRACE_REGISTRATION_ID = "zulip-activity-trace-exec";

const MAX_LABEL = 80;
const MAX_DETAIL = 160;

export type ToolTraceHookEvent = {
  toolName?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
  toolCallId?: string;
  runId?: string;
};

export type ToolTraceHookContext = {
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  agentId?: string;
};

export type ToolTraceDeps = {
  /** Injected for tests; defaults to the per-account registry lookup. */
  findTrace?: (sessionKey?: string, runId?: string) => ActivityTrace | undefined;
  log?: TraceLogger;
};

function firstLine(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, Math.max(0, max - 1))}…`;
}

function readCommand(params: Record<string, unknown> | undefined): string | undefined {
  if (!params) return undefined;
  for (const key of ["command", "cmd"]) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  const argv = params.argv;
  if (Array.isArray(argv)) {
    const parts = argv.filter((part): part is string => typeof part === "string");
    if (parts.length > 0) return parts.join(" ");
  }
  return undefined;
}

/**
 * Turns one completed `exec` call into a single trace step.
 *
 * Only the command itself is shown — not stdout, which is both noise and a
 * potential credential carrier (the trace io redacts as well, belt and braces).
 */
export function describeExecTraceStep(
  event: ToolTraceHookEvent | undefined,
  fallbackId: string,
): { id: string; label: string; status: TraceStepStatus; detail?: string } | undefined {
  if (!event) return undefined;
  const command = readCommand(event.params);
  const source = command ?? event.toolName ?? "exec";
  const label = firstLine(`$ ${source}`, MAX_LABEL);
  if (!label) return undefined;
  const failed = Boolean(event.error);
  return {
    id: event.toolCallId ? `exec:${event.toolCallId}` : fallbackId,
    label,
    status: failed ? "failed" : "done",
    detail: failed && event.error ? firstLine(event.error, MAX_DETAIL) : undefined,
  };
}

/**
 * Builds the `after_tool_call` handler.
 *
 * Synchronous by construction: no `await`, no Zulip write, nothing that can be
 * awaited on the agent's critical path. Every failure is swallowed (logged and
 * dropped) so a hook can never throw into the host.
 */
export function createToolCallTraceHandler(
  deps: ToolTraceDeps = {},
): (event?: ToolTraceHookEvent, ctx?: ToolTraceHookContext) => void {
  const findTrace = deps.findTrace ?? findActivityTrace;
  let fallbackCounter = 0;

  return (event, ctx) => {
    try {
      const runId = ctx?.runId ?? event?.runId;
      const sessionKey = ctx?.sessionKey ?? ctx?.sessionId;
      // Fail closed on attribution: an unattributable hook produces nothing.
      const trace = findTrace(sessionKey, runId);
      if (!trace) return;

      fallbackCounter += 1;
      const step = describeExecTraceStep(event, `exec:local-${fallbackCounter}`);
      if (!step) return;

      // Remember the run id so later hooks (and other call sites) can resolve
      // this trace even if a payload omits the session key.
      if (runId) trace.attachRunId(runId);

      trace.step(step.id, step.label, {
        status: step.status,
        detail: step.detail,
        durationMs: event?.durationMs,
      });
    } catch (err) {
      deps.log?.warn?.("zulip tool-trace hook failed", { error: String(err) });
    }
  };
}

let toolTraceHooksRegistered = false;

export function isToolTraceHooksRegistered(): boolean {
  return toolTraceHooksRegistered;
}

/** Test/hot-reload helper. */
export function resetToolTraceHooksRegistration(): void {
  toolTraceHooksRegistered = false;
}

export type RegisterToolTraceOpts = {
  handler?: (event?: ToolTraceHookEvent, ctx?: ToolTraceHookContext) => void;
  log?: TraceLogger;
};

/**
 * Registers the tool-call trace hook, degrading silently where the surface or
 * the registration options are unavailable.
 *
 * Returns `true` when a registration was made by this call. A second call is a
 * no-op, which matters because the host calls `registerFull` twice and may also
 * call it in tool-discovery mode.
 */
export function registerToolCallTraceHooks(
  api: unknown,
  opts: RegisterToolTraceOpts = {},
): boolean {
  if (toolTraceHooksRegistered) return false;

  const log = opts.log;
  const candidate = api as { on?: unknown } | undefined;
  if (!candidate || typeof candidate.on !== "function") {
    log?.warn?.("zulip tool-trace hooks unavailable: api.on is not a function", {});
    return false;
  }
  const on = candidate.on as (
    name: string,
    handler: (...args: unknown[]) => void,
    options?: Record<string, unknown>,
  ) => void;

  const handler = opts.handler ?? createToolCallTraceHandler({ log });
  // The relevance filter is mandatory: registering without it would mirror the
  // entire tool log into the topic, which is exactly what this epic avoids.
  const attempts: Array<Record<string, unknown>> = [
    {
      matcher: TOOL_TRACE_MATCHER,
      timeoutMs: TOOL_TRACE_TIMEOUT_MS,
      registrationId: TOOL_TRACE_REGISTRATION_ID,
    },
    { matcher: TOOL_TRACE_MATCHER, timeoutMs: TOOL_TRACE_TIMEOUT_MS },
    { matcher: TOOL_TRACE_MATCHER },
  ];

  let lastError: unknown;
  for (const options of attempts) {
    try {
      on(TOOL_TRACE_HOOK_NAME, handler, options);
      toolTraceHooksRegistered = true;
      log?.info?.("zulip tool-trace hooks registered", {
        hook: TOOL_TRACE_HOOK_NAME,
        matcher: TOOL_TRACE_MATCHER,
      });
      return true;
    } catch (err) {
      lastError = err;
    }
  }

  log?.warn?.("zulip tool-trace hook registration failed; falling back to run-boundary traces", {
    hook: TOOL_TRACE_HOOK_NAME,
    error: String(lastError),
  });
  return false;
}
