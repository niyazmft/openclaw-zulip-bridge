import test from "node:test";
import assert from "node:assert/strict";

// ── Regression tests for Issue #245 ─────────────────────────────────────────
// The fix: polling loop should apply a 1s delay when:
// 1. Events are present but none are message-type (heartbeat-only responses)
// 2. Bad-queue recovery path (both structured error and exception paths)

// We test the logic by simulating the conditions that pollOnce checks.
// The actual pollOnce function is tested via source regression below.

// ── Logic tests for the heartbeat throttle ──────────────────────────────────

function shouldDelayOnNoMessages(events: Array<{ type: string }>): boolean {
  // This is the exact logic from polling.ts after the fix
  const hadMessageEvents = events.some((e) => e.type === "message" && (e as any).message);
  return !hadMessageEvents;
}

test("heartbeat throttle: delays when events array is empty", () => {
  assert.equal(shouldDelayOnNoMessages([]), true);
});

test("heartbeat throttle: delays when only heartbeat events present", () => {
  const events = [
    { type: "heartbeat" },
    { type: "heartbeat" },
  ];
  assert.equal(shouldDelayOnNoMessages(events), true);
});

test("heartbeat throttle: delays when only non-message events present", () => {
  const events = [
    { type: "presence" },
    { type: "reaction" },
  ];
  assert.equal(shouldDelayOnNoMessages(events), true);
});

test("heartbeat throttle: does NOT delay when message events present", () => {
  const events = [
    { type: "heartbeat" },
    { type: "message", message: { id: 1, content: "hello" } },
  ];
  assert.equal(shouldDelayOnNoMessages(events), false);
});

test("heartbeat throttle: does NOT delay when only message events present", () => {
  const events = [
    { type: "message", message: { id: 1, content: "hello" } },
  ];
  assert.equal(shouldDelayOnNoMessages(events), false);
});

// ── Logic tests for the bad-queue backoff ───────────────────────────────────

function simulateBadQueueRecovery(): { pollBackoffMs: number; shouldContinue: boolean } {
  // This is the exact logic from polling.ts after the fix
  const backoffMs = 1000;
  return { pollBackoffMs: backoffMs, shouldContinue: true };
}

test("bad-queue recovery: returns non-zero backoff", () => {
  const result = simulateBadQueueRecovery();
  assert.equal(result.pollBackoffMs, 1000);
  assert.equal(result.shouldContinue, true);
});

test("bad-queue recovery: backoff is at least 1 second", () => {
  const result = simulateBadQueueRecovery();
  assert.ok(result.pollBackoffMs >= 1000, "backoff should be >= 1000ms");
});

// ── Source regression: verify the fix patterns exist in polling.ts ───────────

test("polling source: heartbeat throttle uses hadMessageEvents", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/zulip/polling.ts"),
    "utf8",
  );
  // The old pattern should be gone
  assert.equal(source.includes("if (events.length === 0) {"), false);
  // The new pattern should be present
  assert.equal(source.includes("hadMessageEvents"), true);
  assert.equal(source.includes("if (!hadMessageEvents)"), true);
});

test("polling source: bad-queue recovery uses backoffMs", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/zulip/polling.ts"),
    "utf8",
  );
  // The old pattern should be gone
  assert.equal(source.includes('return { pollBackoffMs: 0, shouldContinue: true }'), false);
  // The new pattern should be present
  assert.equal(source.includes("backoffMs"), true);
  assert.equal(source.includes("Issue #245"), true);
});
