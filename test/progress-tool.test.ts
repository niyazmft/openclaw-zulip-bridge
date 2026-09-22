import test from "node:test";
import assert from "node:assert/strict";

import {
  createZulipProgressTool,
  isProgressToolRegistered,
  registerZulipProgressTool,
  resetProgressToolRegistration,
  ZULIP_PROGRESS_TOOL_NAME,
} from "../src/zulip/progress-tool.js";
import {
  ActivityTraceManager,
  clearActivityTraceManagers,
  registerActivityTraceManager,
  type TraceIo,
  type TraceTarget,
} from "../src/zulip/activity-trace.js";

const TARGET: TraceTarget = { to: "stream:main:general", topic: "general", accountId: "default" };
const SESSION_KEY = "zulip:default:stream:1:general";

function makeTraceIo(): { io: TraceIo; edits: Array<{ messageId: string; content: string }> } {
  const edits: Array<{ messageId: string; content: string }> = [];
  return {
    io: {
      post: async () => "trace-msg-1",
      edit: async (messageId, content) => {
        edits.push({ messageId, content });
      },
    },
    edits,
  };
}

function makeTraceStub() {
  const notes: string[] = [];
  const trace = {
    note(text: string) {
      notes.push(text);
      return trace;
    },
  };
  return { trace, notes };
}

// ── Tool definition ─────────────────────────────────────────────────────────

test("tool definition: exposes zulip_progress with a required message string", () => {
  const tool = createZulipProgressTool({ findTrace: () => undefined });
  assert.equal(tool.name, ZULIP_PROGRESS_TOOL_NAME);
  assert.match(tool.description, /activity trace/i);
  const schema = tool.parameters as any;
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties?.message?.type, "string");
  assert.deepEqual(schema.required, ["message"]);
});

// ── Execute ─────────────────────────────────────────────────────────────────

test("execute: records narration on the run's trace", async () => {
  const { trace, notes } = makeTraceStub();
  const lookups: Array<[string | undefined, string | undefined]> = [];
  const tool = createZulipProgressTool({
    sessionKey: SESSION_KEY,
    findTrace: (sessionKey, runId) => {
      lookups.push([sessionKey, runId]);
      return trace as any;
    },
  });

  const result = (await tool.execute("tc-1", { message: "  about to   ask a clarifying question " })) as any;
  assert.deepEqual(result, { ok: true, recorded: true });
  assert.deepEqual(lookups, [[SESSION_KEY, undefined]]);
  assert.deepEqual(notes, ["about to ask a clarifying question"]);
});

test("execute: an active trace from the registry receives the note (real correlation path)", async () => {
  const { io, edits } = makeTraceIo();
  const manager = new ActivityTraceManager({ io, config: { traceCoalesceMs: 5, traceMaxRate: 50 } });
  registerActivityTraceManager("default", manager);
  const trace = manager.start({ title: "issue #42", target: TARGET, sessionKey: SESSION_KEY });
  await trace.settle();

  const tool = createZulipProgressTool({ sessionKey: SESSION_KEY });
  const result = (await tool.execute("tc-1", { message: "switching approach" })) as any;
  assert.equal(result.recorded, true);

  await trace.settle();
  assert.match(edits[edits.length - 1].content, /- 💬 switching approach/);
  clearActivityTraceManagers();
});

test("execute: no active trace is a no-op, not an error", async () => {
  const tool = createZulipProgressTool({ sessionKey: "unknown-session", findTrace: () => undefined });
  const result = (await tool.execute("tc-1", { message: "hello" })) as any;
  assert.deepEqual(result, { ok: true, recorded: false, reason: "no active activity trace" });
});

test("execute: an empty message is a no-op", async () => {
  const { trace, notes } = makeTraceStub();
  const tool = createZulipProgressTool({ sessionKey: SESSION_KEY, findTrace: () => trace as any });
  const result = (await tool.execute("tc-1", { message: "   " })) as any;
  assert.deepEqual(result, { ok: true, recorded: false, reason: "empty message" });
  assert.deepEqual(notes, []);
});

test("execute: a resolve failure is logged and swallowed, never surfaced to the agent", async () => {
  const warnings: string[] = [];
  const tool = createZulipProgressTool({
    sessionKey: SESSION_KEY,
    findTrace: () => {
      throw new Error("registry exploded");
    },
    log: { warn: (message) => warnings.push(message) },
  });
  const result = (await tool.execute("tc-1", { message: "hello" })) as any;
  assert.deepEqual(result, { ok: true, recorded: false, reason: "trace unavailable" });
  assert.deepEqual(warnings, ["zulip progress tool failed"]);
});

// ── Registration ────────────────────────────────────────────────────────────

test("registration: registers the tool by name and is idempotent", (t) => {
  t.after(() => resetProgressToolRegistration());
  resetProgressToolRegistration();
  const registered: Array<{ factory: (ctx: unknown) => any; options?: { name?: string } }> = [];
  const api = { registerTool: (factory: any, options?: any) => registered.push({ factory, options }) };

  assert.equal(registerZulipProgressTool(api), true);
  assert.equal(registerZulipProgressTool(api), false);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].options?.name, ZULIP_PROGRESS_TOOL_NAME);
  assert.equal(isProgressToolRegistered(), true);

  // The factory builds a per-run tool carrying that run's session key.
  const tool = registered[0].factory({ sessionKey: SESSION_KEY });
  assert.equal(typeof tool.execute, "function");
  assert.equal(tool.name, ZULIP_PROGRESS_TOOL_NAME);
});

test("registration: degrades silently when api.registerTool is unavailable", (t) => {
  t.after(() => resetProgressToolRegistration());
  resetProgressToolRegistration();
  const warnings: string[] = [];
  assert.equal(registerZulipProgressTool({}, { log: { warn: (m) => warnings.push(m) } }), false);
  assert.equal(isProgressToolRegistered(), false);
  assert.equal(warnings.length, 1);
});

test("registration: a throwing registerTool is caught and reported", (t) => {
  t.after(() => resetProgressToolRegistration());
  resetProgressToolRegistration();
  const warnings: string[] = [];
  const api = {
    registerTool: () => {
      throw new Error("tool name not declared in contracts.tools");
    },
  };
  assert.equal(registerZulipProgressTool(api, { log: { warn: (m) => warnings.push(m) } }), false);
  assert.equal(isProgressToolRegistered(), false);
  assert.deepEqual(warnings, ["zulip progress tool registration failed"]);
});
