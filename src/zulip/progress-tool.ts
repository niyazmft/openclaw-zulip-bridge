/**
 * Mode B: agent-driven trace narration (#303, epic #293).
 *
 * Mode A (#302) watches tool calls; it cannot see *intent* — "I'm about to ask
 * a clarifying question", "switching approach". This tool lets the agent
 * narrate that into the current work item's trace.
 *
 * Surface choice (recorded because #303 originally preferred the channel action
 * adapter): the `message` tool's action vocabulary is a deliberately **closed,
 * core-owned** list (`src/channels/plugins/message-action-names.ts` — "Plugins
 * add names through a core PR; runtime registration is intentionally
 * unsupported") and the tool schema is built from that list, so a plugin cannot
 * add a `progress` action. `api.registerTool` is the supported plugin surface
 * for a plugin-owned verb; it requires `contracts.tools` in the manifest.
 *
 * Correlation: the tool factory receives the per-run `OpenClawPluginToolContext`
 * (`sessionKey`), which is exactly the key #301 stored on the trace. An execute
 * call that resolves to no active trace is a **no-op**, not an error — the
 * agent must never be punished for narrating outside a traced run.
 */

import { Type } from "typebox";
import { jsonResult } from "../actions-utils.js";
import {
  findActivityTrace,
  type ActivityTrace,
  type TraceLogger,
} from "./activity-trace.js";

export const ZULIP_PROGRESS_TOOL_NAME = "zulip_progress";

export type ZulipProgressToolDeps = {
  /** Per-run session key from the plugin tool context. */
  sessionKey?: string;
  /** Optional run id, when the host supplies one. */
  runId?: string;
  log?: TraceLogger;
  /** Injected for tests; defaults to the per-account registry lookup. */
  findTrace?: (sessionKey?: string, runId?: string) => ActivityTrace | undefined;
};

/**
 * Builds the `zulip_progress` tool for one run context.
 *
 * The factory is invoked with the run's tool context, so the session key is
 * captured here and used to resolve the trace at execute time.
 */
export function createZulipProgressTool(deps: ZulipProgressToolDeps = {}) {
  const findTrace = deps.findTrace ?? findActivityTrace;

  return {
    name: ZULIP_PROGRESS_TOOL_NAME,
    label: "Zulip progress",
    description:
      "Record a short intent/status line in the current Zulip activity trace (the bot's live status message in the topic). " +
      "Use this for things the channel cannot infer from your work — for example that you are about to ask a clarifying question, or that you are switching approach. " +
      "It is not a chat reply and will not notify anyone. If no activity trace is active for this run, the call is a harmless no-op.",
    parameters: Type.Object(
      {
        message: Type.String({
          description: "One short status line, e.g. \"switching to a rebase instead of a merge\".",
        }),
      },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const message =
        typeof rawParams?.message === "string" ? rawParams.message.trim().replace(/\s+/g, " ") : "";
      if (!message) {
        return jsonResult({ ok: true, recorded: false, reason: "empty message" });
      }
      try {
        const trace = findTrace(deps.sessionKey, deps.runId);
        if (!trace) {
          return jsonResult({ ok: true, recorded: false, reason: "no active activity trace" });
        }
        trace.note(message);
        return jsonResult({ ok: true, recorded: true });
      } catch (err) {
        // Narration is best-effort: never surface a trace failure to the agent.
        deps.log?.warn?.("zulip progress tool failed", { error: String(err) });
        return jsonResult({ ok: true, recorded: false, reason: "trace unavailable" });
      }
    },
  };
}

let progressToolRegistered = false;

export function isProgressToolRegistered(): boolean {
  return progressToolRegistered;
}

/** Test/hot-reload helper. */
export function resetProgressToolRegistration(): void {
  progressToolRegistered = false;
}

export type RegisterProgressToolOpts = {
  log?: TraceLogger;
};

/**
 * Registers `zulip_progress` on the plugin API.
 *
 * Idempotent (the host calls `registerFull` twice and in tool-discovery mode)
 * and feature-detected: a host without `api.registerTool` degrades to mode A +
 * run-boundary traces instead of failing plugin load.
 */
export function registerZulipProgressTool(
  api: unknown,
  opts: RegisterProgressToolOpts = {},
): boolean {
  if (progressToolRegistered) return false;

  const log = opts.log;
  const candidate = api as { registerTool?: unknown } | undefined;
  if (!candidate || typeof candidate.registerTool !== "function") {
    log?.warn?.("zulip progress tool unavailable: api.registerTool is not a function", {});
    return false;
  }
  const registerTool = candidate.registerTool as (
    factory: (ctx: unknown) => unknown,
    options?: { name?: string },
  ) => void;

  try {
    registerTool(
      (ctx: unknown) => {
        const context = (ctx ?? {}) as { sessionKey?: string; runId?: string };
        return createZulipProgressTool({
          sessionKey: context.sessionKey,
          runId: context.runId,
          log,
        });
      },
      { name: ZULIP_PROGRESS_TOOL_NAME },
    );
    progressToolRegistered = true;
    log?.info?.("zulip progress tool registered", { tool: ZULIP_PROGRESS_TOOL_NAME });
    return true;
  } catch (err) {
    log?.warn?.("zulip progress tool registration failed", { error: String(err) });
    return false;
  }
}
