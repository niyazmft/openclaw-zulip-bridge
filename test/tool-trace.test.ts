import test from "node:test";
import assert from "node:assert/strict";

import {
  createToolCallTraceHandler,
  describeExecTraceStep,
  isToolTraceHooksRegistered,
  registerToolCallTraceHooks,
  resetToolTraceHooksRegistration,
  TOOL_TRACE_MATCHER,
  TOOL_TRACE_REGISTRATION_ID,
} from "../src/zulip/tool-trace.js";
import { createZulipTraceIo } from "../src/zulip/activity-trace.js";

// ── Step description ────────────────────────────────────────────────────────

test("describeExecTraceStep: exec command becomes a single labeled step", () => {
  const step = describeExecTraceStep(
    { toolName: "exec", params: { command: "git status --short" }, toolCallId: "tc-1", durationMs: 120 },
    "fallback",
  );
  assert.deepEqual(step, {
    id: "exec:tc-1",
    label: "$ git status --short",
    status: "done",
    detail: undefined,
  });
});

test("describeExecTraceStep: failure flips the step to failed with a short reason", () => {
  const step = describeExecTraceStep(
    { toolName: "exec", params: { command: "npm test" }, toolCallId: "tc-2", error: "Exit code 1" },
    "fallback",
  );
  assert.equal(step?.status, "failed");
  assert.equal(step?.detail, "Exit code 1");
  assert.equal(step?.label, "$ npm test");
});

test("describeExecTraceStep: multiline commands collapse and truncate", () => {
  const step = describeExecTraceStep(
    { toolName: "exec", params: { command: `git log\n${"x".repeat(200)}` } },
    "fallback",
  );
  assert.equal(step?.label.length, 80);
  assert.ok(step?.label.startsWith("$ git log"));
  assert.doesNotMatch(step?.label ?? "", /\n/);
});

test("describeExecTraceStep: argv and tool-name fallbacks", () => {
  assert.equal(
    describeExecTraceStep({ toolName: "exec", params: { argv: ["git", "push"] } }, "f")?.label,
    "$ git push",
  );
  assert.equal(describeExecTraceStep({ toolName: "exec", params: {} }, "f")?.label, "$ exec");
  assert.equal(describeExecTraceStep({ toolName: "exec" }, "f")?.id, "f");
  assert.equal(describeExecTraceStep(undefined, "f"), undefined);
});

// ── Handler ─────────────────────────────────────────────────────────────────

function makeTraceStub() {
  const steps: Array<{ id: string; label: string; opts: unknown }> = [];
  const attached: Array<string | undefined> = [];
  const trace = {
    step(id: string, label: string, opts: unknown) {
      steps.push({ id, label, opts });
      return trace;
    },
    attachRunId(runId: string | undefined) {
      attached.push(runId);
      return trace;
    },
  };
  return { trace, steps, attached };
}

test("handler: attributes a hook to the run's trace via session key", () => {
  const { trace, steps, attached } = makeTraceStub();
  const lookups: Array<[string | undefined, string | undefined]> = [];
  const handler = createToolCallTraceHandler({
    findTrace: (sessionKey, runId) => {
      lookups.push([sessionKey, runId]);
      return trace as any;
    },
  });

  handler(
    { toolName: "exec", params: { command: "git push" }, toolCallId: "tc-9", durationMs: 42 },
    { sessionKey: "zulip:default:stream:1:general", runId: "run-1" },
  );

  assert.deepEqual(lookups, [["zulip:default:stream:1:general", "run-1"]]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].id, "exec:tc-9");
  assert.equal(steps[0].label, "$ git push");
  assert.deepEqual(steps[0].opts, { status: "done", detail: undefined, durationMs: 42 });
  assert.deepEqual(attached, ["run-1"]);
});

test("handler: drops unattributable hooks instead of guessing a topic", () => {
  const { trace, steps } = makeTraceStub();
  const handler = createToolCallTraceHandler({ findTrace: () => undefined });
  handler({ toolName: "exec", params: { command: "git push" }, toolCallId: "tc-9" }, {});
  assert.equal(steps.length, 0);
  void trace;
});

test("handler: a throwing lookup is swallowed and logged, never thrown into the host", () => {
  const warnings: string[] = [];
  const handler = createToolCallTraceHandler({
    findTrace: () => {
      throw new Error("registry exploded");
    },
    log: { warn: (message) => warnings.push(message) },
  });

  assert.doesNotThrow(() => handler({ toolName: "exec" }, { sessionKey: "s" }));
  assert.deepEqual(warnings, ["zulip tool-trace hook failed"]);
});

test("handler: a throwing trace step never reaches the host", () => {
  const warnings: string[] = [];
  const trace = {
    step: () => {
      throw new Error("step exploded");
    },
    attachRunId: () => trace,
  };
  const handler = createToolCallTraceHandler({
    findTrace: () => trace as any,
    log: { warn: (message) => warnings.push(message) },
  });

  assert.doesNotThrow(() =>
    handler({ toolName: "exec", params: { command: "git push" }, toolCallId: "t" }, { sessionKey: "s" }),
  );
  assert.deepEqual(warnings, ["zulip tool-trace hook failed"]);
});

test("handler: a missing toolCallId still produces a unique step id per call", () => {
  const { trace, steps } = makeTraceStub();
  const handler = createToolCallTraceHandler({ findTrace: () => trace as any });
  handler({ toolName: "exec", params: { command: "a" } }, { sessionKey: "s" });
  handler({ toolName: "exec", params: { command: "b" } }, { sessionKey: "s" });
  assert.equal(steps.length, 2);
  assert.notEqual(steps[0].id, steps[1].id);
});

// ── Registration ────────────────────────────────────────────────────────────

type OnCall = { name: string; handler: unknown; options?: Record<string, unknown> };

function makeApi(options?: { failFor?: (options?: Record<string, unknown>) => boolean }) {
  const calls: OnCall[] = [];
  const api = {
    on: (name: string, handler: unknown, opts?: Record<string, unknown>) => {
      if (options?.failFor?.(opts)) throw new Error("unsupported registration options");
      calls.push({ name, handler, options: opts });
    },
  };
  return { api, calls };
}

test("registration: registers after_tool_call with matcher, timeout and a stable registration id", (t) => {
  t.after(() => resetToolTraceHooksRegistration());
  resetToolTraceHooksRegistration();
  const { api, calls } = makeApi();

  assert.equal(registerToolCallTraceHooks(api), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "after_tool_call");
  assert.deepEqual(calls[0].options?.matcher, TOOL_TRACE_MATCHER);
  assert.equal(calls[0].options?.timeoutMs, 2000);
  assert.equal(calls[0].options?.registrationId, TOOL_TRACE_REGISTRATION_ID);
  assert.equal(typeof calls[0].handler, "function");
});

test("registration: is idempotent across repeated registerFull calls", (t) => {
  t.after(() => resetToolTraceHooksRegistration());
  resetToolTraceHooksRegistration();
  const { api, calls } = makeApi();

  assert.equal(registerToolCallTraceHooks(api), true);
  assert.equal(registerToolCallTraceHooks(api), false);
  assert.equal(registerToolCallTraceHooks(api), false);
  assert.equal(calls.length, 1);
  assert.equal(isToolTraceHooksRegistered(), true);
});

test("registration: degrades silently when api.on is unavailable", (t) => {
  t.after(() => resetToolTraceHooksRegistration());
  resetToolTraceHooksRegistration();
  const warnings: string[] = [];
  assert.equal(registerToolCallTraceHooks({}, { log: { warn: (m) => warnings.push(m) } }), false);
  assert.equal(isToolTraceHooksRegistered(), false);
  assert.equal(warnings.length, 1);
});

test("registration: falls back to simpler options, never registering without a matcher", (t) => {
  t.after(() => resetToolTraceHooksRegistration());
  resetToolTraceHooksRegistration();
  // Reject anything carrying a registrationId or a timeout.
  const { api, calls } = makeApi({
    failFor: (opts) => Boolean(opts?.registrationId) || opts?.timeoutMs !== undefined,
  });

  assert.equal(registerToolCallTraceHooks(api), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options, { matcher: TOOL_TRACE_MATCHER });
  assert.ok(calls[0].options && "matcher" in calls[0].options);
});

test("registration: gives up and logs when no matcher-bearing variant is accepted", (t) => {
  t.after(() => resetToolTraceHooksRegistration());
  resetToolTraceHooksRegistration();
  const { api, calls } = makeApi({ failFor: () => true });
  const warnings: string[] = [];

  assert.equal(registerToolCallTraceHooks(api, { log: { warn: (m) => warnings.push(m) } }), false);
  assert.equal(calls.length, 0);
  assert.equal(isToolTraceHooksRegistered(), false);
  assert.deepEqual(warnings, [
    "zulip tool-trace hook registration failed; falling back to run-boundary traces",
  ]);
});

// ── Trace edits are secret-guarded ──────────────────────────────────────────

test("trace edits redact known host credentials before they reach Zulip", async () => {
  const requests: Array<{ path: string; body: string }> = [];
  const client = {
    request: async (path: string, init?: { body?: string }) => {
      requests.push({ path, body: init?.body ?? "" });
      return { result: "success" };
    },
  };
  const cfg = { channels: { zulip: { apiKey: "super-secret-value-12345" } } };
  const warnings: string[] = [];

  const io = createZulipTraceIo(client as any, {
    cfg,
    log: { warn: (message) => warnings.push(message) },
  });
  await io.edit("7", "command used super-secret-value-12345 and failed");

  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/messages/7");
  assert.doesNotMatch(requests[0].body, /super-secret-value-12345/);
  assert.match(requests[0].body, /redacted/);
  assert.deepEqual(warnings, ["zulip activity trace redacted credentials"]);
});
