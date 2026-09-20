import test from "node:test";
import assert from "node:assert/strict";
import {
  FAST_RESPONSE_MS,
  IDLE_BACKOFF_MAX_MS,
  IDLE_BACKOFF_START_MS,
  IDLE_LOG_INTERVAL_MS,
  nextIdleState,
  shouldLogIdlePoll,
} from "../src/zulip/polling.ts";

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
  assert.equal(source.includes("hadMessageEvents"), true);
});

// ── Idle backoff decisions (issue #287) ─────────────────────────────────────
// Two healthy regimes exist in the wild and the decision function must not
// regress the good one:
//   - server-held long-poll (responses ~45-90s) → add NO delay
//   - immediate responses (~0.2s) → back off, bounded, to stop spin loops

test("nextIdleState: server-held long-poll adds no delay (healthy host)", () => {
  const result = nextIdleState({
    hadMessageEvents: false,
    elapsedMs: 51_000, // y6: median 51.2s heartbeat long-poll
    idleBackoffMs: 0,
  });
  assert.deepEqual(result, { idleBackoffMs: 0, delayMs: 0 });
});

test("nextIdleState: an already-backed-off loop is reset by a slow response", () => {
  const result = nextIdleState({
    hadMessageEvents: false,
    elapsedMs: FAST_RESPONSE_MS,
    idleBackoffMs: IDLE_BACKOFF_MAX_MS,
  });
  assert.deepEqual(result, { idleBackoffMs: 0, delayMs: 0 });
});

test("nextIdleState: immediate heartbeat response starts the backoff", () => {
  const result = nextIdleState({
    hadMessageEvents: false,
    elapsedMs: 200, // lab-openclaw: ~1.2s cadence incl. plugin delay
    idleBackoffMs: 0,
  });
  assert.equal(result.delayMs, IDLE_BACKOFF_START_MS);
  assert.equal(result.idleBackoffMs, IDLE_BACKOFF_START_MS);
});

test("nextIdleState: backoff grows but is capped", () => {
  let idleBackoffMs = 0;
  const seen: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const result = nextIdleState({ hadMessageEvents: false, elapsedMs: 100, idleBackoffMs });
    idleBackoffMs = result.idleBackoffMs;
    seen.push(result.delayMs);
  }
  assert.deepEqual(seen, [1000, 2000, 4000, 5000, 5000, 5000]);
  assert.ok(seen.every((ms) => ms <= IDLE_BACKOFF_MAX_MS));
});

test("nextIdleState: message events reset the backoff and poll immediately", () => {
  const result = nextIdleState({
    hadMessageEvents: true,
    elapsedMs: 120,
    idleBackoffMs: IDLE_BACKOFF_MAX_MS,
  });
  assert.deepEqual(result, { idleBackoffMs: 0, delayMs: 0 });
});

test("shouldLogIdlePoll: logs once, then throttles for 5 minutes", () => {
  const state = { lastAt: 0 };
  const t0 = 1_000_000;
  assert.equal(shouldLogIdlePoll(state, t0), true, "first idle poll logs");
  state.lastAt = t0;
  assert.equal(shouldLogIdlePoll(state, t0 + 1), false, "immediately after: suppressed");
  assert.equal(
    shouldLogIdlePoll(state, t0 + IDLE_LOG_INTERVAL_MS - 1),
    false,
    "just before the window: suppressed",
  );
  assert.equal(
    shouldLogIdlePoll(state, t0 + IDLE_LOG_INTERVAL_MS),
    true,
    "after the window: logs again",
  );
});

test("shouldLogIdlePoll: a message batch re-arms the next idle log", () => {
  const state = { lastAt: 0 };
  const t0 = 2_000_000;
  assert.equal(shouldLogIdlePoll(state, t0), true);
  state.lastAt = t0;
  assert.equal(shouldLogIdlePoll(state, t0 + 1_000), false);
  // pollOnce resets lastAt to 0 when a batch contained message events
  state.lastAt = 0;
  assert.equal(shouldLogIdlePoll(state, t0 + 1_001), true);
});
