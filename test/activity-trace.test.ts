import test from "node:test";
import assert from "node:assert/strict";

import {
  ActivityTraceManager,
  DEFAULT_TRACE_COALESCE_MS,
  DEFAULT_TRACE_MAX_RATE,
  formatTraceDuration,
  renderTraceContent,
  resolveActivityTraceConfig,
  resolveTraceTiming,
  type TraceIo,
  type TraceStep,
  type TraceTarget,
} from "../src/zulip/activity-trace.js";

type PostRecord = { target: TraceTarget; content: string };
type EditRecord = { messageId: string; content: string; at: number };

function makeIo(options?: {
  postResult?: string | undefined;
  postError?: unknown;
  editError?: unknown;
  failFirstEdits?: number;
}): {
  io: TraceIo;
  posts: PostRecord[];
  edits: EditRecord[];
  attempts: () => number;
  setEditError: (err: unknown) => void;
} {
  const posts: PostRecord[] = [];
  const edits: EditRecord[] = [];
  let attempts = 0;
  let remainingFailures = options?.failFirstEdits ?? 0;
  let forcedEditError: unknown = options?.editError;

  const io: TraceIo = {
    post: async (target, content) => {
      if (options?.postError) throw options.postError;
      posts.push({ target, content });
      if (options && "postResult" in options) return options.postResult;
      return `msg-${posts.length}`;
    },
    edit: async (messageId, content) => {
      attempts += 1;
      if (forcedEditError) throw forcedEditError;
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error("simulated edit failure");
      }
      edits.push({ messageId, content, at: Date.now() });
    },
  };

  return {
    io,
    posts,
    edits,
    attempts: () => attempts,
    setEditError: (err: unknown) => {
      forcedEditError = err;
    },
  };
}

const TARGET: TraceTarget = { to: "stream:main:general", topic: "general", accountId: "default" };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Rendering ───────────────────────────────────────────────────────────────

test("render: running trace shows a header and one line per stable step id", () => {
  const manager = new ActivityTraceManager({ io: makeIo().io, config: { traceCoalesceMs: 0 } });
  const trace = manager.start({ title: "issue #42", target: TARGET, id: "t1" });
  trace.step("clone", "cloned repo", { status: "done", durationMs: 1200 });
  trace.step("test", "running tests");
  trace.note("switching to rebase", "n1");

  const state = manager.state("t1");
  assert.ok(state);
  const content = renderTraceContent(state);
  assert.match(content, /^\*\*Working\*\* — issue #42/);
  assert.match(content, /- ✅ cloned repo \(1\.2s\)/);
  assert.match(content, /- ⏳ running tests/);
  assert.match(content, /- 💬 switching to rebase/);
  manager.stop();
});

test("render: finished trace collapses to a single summary line", () => {
  const manager = new ActivityTraceManager({ io: makeIo().io, config: { traceCoalesceMs: 0 } });
  const trace = manager.start({ title: "issue #42", target: TARGET, id: "t1" });
  trace.step("clone", "cloned repo", { status: "done" });
  trace.finish({ status: "done", summary: "PR #128 opened, 47 tests pass" });
  const content = renderTraceContent(manager.state("t1")!);
  assert.equal(content, "✅ **Done** — PR #128 opened, 47 tests pass");
  assert.doesNotMatch(content, /cloned repo/);
  manager.stop();
});

test("render: sanitizes whitespace/newlines and truncates over-long detail", () => {
  const manager = new ActivityTraceManager({ io: makeIo().io, config: { traceCoalesceMs: 0 } });
  const trace = manager.start({ title: "line\nbreak", target: TARGET, id: "t1" });
  trace.step("s", "step\nlabel", { detail: `bad\ndetail ${"x".repeat(400)}` });
  const content = renderTraceContent(manager.state("t1")!);
  assert.match(content, /line break/);
  assert.match(content, /- ⏳ step label — bad detail/);
  assert.doesNotMatch(content, /\n- .*bad\ndetail/);
  assert.ok(content.includes("…"));
  manager.stop();
});

test("render: enforces a hard max length", () => {
  const manager = new ActivityTraceManager({ io: makeIo().io, config: { traceCoalesceMs: 0 } });
  const trace = manager.start({ title: "t", target: TARGET, id: "t1" });
  for (let i = 0; i < 20; i++) trace.step(`s${i}`, `step ${i} ${"y".repeat(80)}`);
  const content = renderTraceContent(manager.state("t1")!, { maxLength: 400 });
  assert.equal(content.length, 400);
  assert.ok(content.endsWith("…"));
  manager.stop();
});

test("formatTraceDuration: ms, seconds and minutes", () => {
  assert.equal(formatTraceDuration(850), "850ms");
  assert.equal(formatTraceDuration(1200), "1.2s");
  assert.equal(formatTraceDuration(12_345), "12s");
  assert.equal(formatTraceDuration(65_000), "1m05s");
  assert.equal(formatTraceDuration(undefined), undefined);
  assert.equal(formatTraceDuration(-5), undefined);
});

// ── Timing config ───────────────────────────────────────────────────────────

test("resolveTraceTiming: defaults and clamping", () => {
  const defaults = resolveTraceTiming();
  assert.equal(defaults.coalesceMs, DEFAULT_TRACE_COALESCE_MS);
  assert.equal(defaults.maxRatePerSec, DEFAULT_TRACE_MAX_RATE);
  assert.equal(defaults.minIntervalMs, 500);

  assert.equal(resolveTraceTiming({ traceCoalesceMs: 0 }).coalesceMs, 0);
  assert.equal(resolveTraceTiming({ traceCoalesceMs: -10 }).coalesceMs, 0);
  assert.equal(resolveTraceTiming({ traceCoalesceMs: 999_999 }).coalesceMs, 60_000);
  assert.equal(resolveTraceTiming({ traceMaxRate: 0 }).maxRatePerSec, 0.1);
  assert.equal(resolveTraceTiming({ traceMaxRate: 1000 }).maxRatePerSec, 50);
  assert.equal(resolveTraceTiming({ traceMaxRate: 4 }).minIntervalMs, 250);
});

test("resolveActivityTraceConfig: feature is opt-in", () => {
  assert.equal(resolveActivityTraceConfig().enabled, false);
  assert.equal(resolveActivityTraceConfig({ activityTrace: false }).enabled, false);
  assert.equal(resolveActivityTraceConfig({ activityTrace: true }).enabled, true);
});

// ── Lifecycle / writes ──────────────────────────────────────────────────────

test("start: posts exactly one bot-owned message and holds off editing until a step lands", async () => {
  const { io, posts, edits } = makeIo();
  const manager = new ActivityTraceManager({ io, config: { traceCoalesceMs: 5 } });
  const trace = manager.start({ title: "issue #42", target: TARGET, id: "t1" });
  await trace.settle();

  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].target, TARGET);
  assert.match(posts[0].content, /^\*\*Working\*\* — issue #42/);
  assert.equal(edits.length, 0);
  assert.equal(trace.messageId, "msg-1");

  trace.step("s1", "cloned repo", { status: "done" });
  await trace.settle();
  assert.equal(edits.length, 1);
  assert.equal(edits[0].messageId, "msg-1");
  manager.stop();
});

test("coalescing: bursty updates produce a single edit within the window", async () => {
  const { io, edits } = makeIo();
  const manager = new ActivityTraceManager({ io, config: { traceCoalesceMs: 50, traceMaxRate: 50 } });
  const trace = manager.start({ title: "burst", target: TARGET, id: "t1" });
  await trace.settle();

  trace.step("a", "step a");
  trace.step("b", "step b");
  trace.step("c", "step c");
  await trace.settle();

  assert.equal(edits.length, 1);
  assert.match(edits[0].content, /step a/);
  assert.match(edits[0].content, /step b/);
  assert.match(edits[0].content, /step c/);
  manager.stop();
});

test("rate ceiling: never exceeds traceMaxRate edits per second", async () => {
  const { io, edits } = makeIo();
  // 10 edits/sec → one edit per 100ms; no coalescing window.
  const manager = new ActivityTraceManager({ io, config: { traceCoalesceMs: 0, traceMaxRate: 10 } });
  const trace = manager.start({ title: "rate", target: TARGET, id: "t1" });
  await trace.settle();

  for (let i = 0; i < 4; i++) {
    trace.step("s", `attempt ${i}`);
    await trace.settle();
  }

  assert.equal(edits.length, 4);
  for (let i = 1; i < edits.length; i++) {
    const gap = edits[i].at - edits[i - 1].at;
    assert.ok(gap >= 80, `expected >=80ms between edits, got ${gap}ms`);
  }
  manager.stop();
});

test("step ids are stable: re-using an id updates it in place", async () => {
  const { io, edits } = makeIo();
  const manager = new ActivityTraceManager({ io, config: { traceCoalesceMs: 5 } });
  const trace = manager.start({ title: "upsert", target: TARGET, id: "t1" });
  await trace.settle();

  trace.step("tests", "running tests");
  await trace.settle();
  trace.complete("tests", { durationMs: 12_300 });
  await trace.settle();

  const state = manager.state("t1")!;
  assert.equal(state.steps.length, 1);
  assert.equal(state.steps[0].status, "done");
  assert.equal(state.steps[0].durationMs, 12_300);
  assert.match(edits[edits.length - 1].content, /- ✅ running tests \(12s\)/);
  manager.stop();
});

test("failStep marks ❌ in place", async () => {
  const { io, edits } = makeIo();
  const manager = new ActivityTraceManager({ io, config: { traceCoalesceMs: 5 } });
  const trace = manager.start({ title: "fail", target: TARGET, id: "t1" });
  await trace.settle();

  trace.step("push", "pushing");
  await trace.settle();
  trace.failStep("push", { label: "push failed", detail: "rejected: non-fast-forward" });
  await trace.settle();

  const state = manager.state("t1")!;
  assert.equal(state.steps.length, 1);
  assert.equal(state.steps[0].status, "failed");
  assert.match(edits[edits.length - 1].content, /- ❌ push failed — rejected: non-fast-forward/);
  manager.stop();
});

test("finish: final edit collapses the block and ignores later mutations", async () => {
  const { io, edits } = makeIo();
  const manager = new ActivityTraceManager({ io, config: { traceCoalesceMs: 5 } });
  const trace = manager.start({ title: "issue #42", target: TARGET, id: "t1" });
  trace.step("a", "step a");
  trace.finish({ status: "done", summary: "all good" });
  await trace.settle();

  assert.equal(edits.length, 1);
  assert.equal(edits[0].content, "✅ **Done** — all good");
  assert.equal(trace.isFinished(), true);

  trace.step("b", "step b after finish");
  await trace.settle();
  assert.equal(edits.length, 1);
  assert.equal(manager.state("t1")!.steps.length, 1);
  manager.stop();
});

test("finish: failures render ❌ and cancellations render ⚪", async () => {
  const { io } = makeIo();
  const manager = new ActivityTraceManager({ io, config: { traceCoalesceMs: 5 } });

  const failed = manager.start({ title: "a", target: TARGET, id: "fail" });
  failed.finish({ status: "failed", summary: "tests red" });
  await failed.settle();
  assert.equal(renderTraceContent(manager.state("fail")!), "❌ **Failed** — tests red");

  const cancelled = manager.start({ title: "b", target: TARGET, id: "cancel" });
  cancelled.finish({ status: "cancelled" });
  await cancelled.settle();
  assert.equal(renderTraceContent(manager.state("cancel")!), "⚪ **Cancelled** — b");
  manager.stop();
});

// ── Failure policy: log-and-drop ────────────────────────────────────────────

test("edit failure is logged and dropped, never retried in a storm, never thrown", async () => {
  const { io, edits, attempts } = makeIo({ failFirstEdits: 1 });
  const warnings: string[] = [];
  const manager = new ActivityTraceManager({
    io,
    config: { traceCoalesceMs: 5, traceMaxRate: 50 },
    log: { warn: (message) => warnings.push(message) },
  });
  const trace = manager.start({ title: "flaky", target: TARGET, id: "t1" });
  await trace.settle();

  trace.step("s", "will fail to edit");
  await trace.settle();
  assert.equal(attempts(), 1);
  assert.equal(edits.length, 0);
  assert.deepEqual(warnings, ["zulip activity trace edit failed"]);

  // A later mutation still gets through; the dropped edit was not retried.
  trace.step("s", "recovered");
  await trace.settle();
  assert.equal(edits.length, 1);
  assert.match(edits[0].content, /recovered/);
  assert.equal(attempts(), 2);
  manager.stop();
});

test("post failure drops the trace: no edits, no throw, no stuck waiters", async () => {
  const { io, edits } = makeIo({ postError: new Error("zulip unreachable") });
  const dropped: string[] = [];
  const manager = new ActivityTraceManager({
    io,
    config: { traceCoalesceMs: 5 },
    onDrop: (state) => dropped.push(state.id),
  });
  const trace = manager.start({ title: "doomed", target: TARGET, id: "t1" });
  trace.step("s", "this cannot land");
  await trace.settle();

  assert.deepEqual(dropped, ["t1"]);
  assert.equal(edits.length, 0);
  assert.equal(trace.messageId, undefined);
  assert.equal(trace.isFinished(), true);
  assert.equal(manager.state("t1")!.steps.length, 1); // recorded, just never written
  manager.stop();
});

test("post returning no message id also drops the trace", async () => {
  const { io, edits } = makeIo({ postResult: undefined });
  const manager = new ActivityTraceManager({ io, config: { traceCoalesceMs: 5 } });
  const trace = manager.start({ title: "no id", target: TARGET, id: "t1" });
  trace.step("s", "nope");
  await trace.settle();
  assert.equal(edits.length, 0);
  assert.equal(trace.messageId, undefined);
  manager.stop();
});

// ── Correlation & isolation (#302 groundwork) ───────────────────────────────

test("findBySessionKey / findByRunId / attachRunId attribute a trace to a room", async () => {
  const { io } = makeIo();
  const manager = new ActivityTraceManager({ io, config: { traceCoalesceMs: 5 } });
  const trace = manager.start({
    title: "run",
    target: TARGET,
    id: "t1",
    sessionKey: "zulip:default:stream:1:general",
  });
  await trace.settle();

  assert.equal(manager.findBySessionKey("zulip:default:stream:1:general")?.id, "t1");
  assert.equal(manager.findBySessionKey("nope"), undefined);
  assert.equal(manager.findByRunId("run-7"), undefined);

  trace.attachRunId("run-7");
  assert.equal(manager.findByRunId("run-7")?.id, "t1");
  assert.equal(manager.findBySessionKey("zulip:default:stream:1:general")?.id, "t1");
  manager.stop();
});

test("two concurrent traces in the same topic keep separate messages and blocks", async () => {
  const { io, posts, edits } = makeIo();
  const manager = new ActivityTraceManager({ io, config: { traceCoalesceMs: 5 } });
  const first = manager.start({ title: "run A", target: TARGET, id: "a" });
  const second = manager.start({ title: "run B", target: TARGET, id: "b" });
  await Promise.all([first.settle(), second.settle()]);

  assert.equal(posts.length, 2);
  const firstId = first.messageId!;
  const secondId = second.messageId!;
  assert.notEqual(firstId, secondId);

  first.step("s", "A step");
  await first.settle();
  assert.equal(edits.length, 1);
  assert.equal(edits[0].messageId, firstId);
  assert.doesNotMatch(edits[0].content, /run B/);
  manager.stop();
});

test("stop() clears pending timers and forgets traces", async () => {
  const { io, edits } = makeIo();
  const manager = new ActivityTraceManager({ io, config: { traceCoalesceMs: 1000 } });
  const trace = manager.start({ title: "x", target: TARGET, id: "t1" });
  await manager.settle("t1");
  trace.step("s", "pending");
  manager.stop();
  await delay(30);
  assert.equal(edits.length, 0);
  assert.equal(manager.size(), 0);
  assert.equal(manager.state("t1"), undefined);
});

test("clearFinished() removes settled traces but keeps running ones", async () => {
  const { io } = makeIo();
  const manager = new ActivityTraceManager({ io, config: { traceCoalesceMs: 5 } });
  const running = manager.start({ title: "running", target: TARGET, id: "r" });
  const finished = manager.start({ title: "finished", target: TARGET, id: "f" });
  finished.finish({ status: "done", summary: "done" });
  await running.settle();
  await finished.settle();
  manager.clearFinished();
  assert.equal(manager.size(), 1);
  assert.ok(manager.state("r"));
  manager.stop();
});

test("steps are capped so a chatty run cannot grow the block unbounded", async () => {
  const { io } = makeIo();
  const manager = new ActivityTraceManager({ io, config: { traceCoalesceMs: 5 } });
  const trace = manager.start({ title: "many", target: TARGET, id: "t1" });
  for (let i = 0; i < 40; i++) {
    trace.step(`s${i}`, `step ${i}`, { status: i % 2 === 0 ? "done" : "running" });
  }
  const steps: TraceStep[] = manager.state("t1")!.steps;
  assert.ok(steps.length <= 20, `expected <=20 steps, got ${steps.length}`);
  assert.equal(steps[steps.length - 1].id, "s39");
  manager.stop();
});
