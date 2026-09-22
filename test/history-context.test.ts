import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_HISTORY_MAX_CHARS,
  DEFAULT_HISTORY_MAX_MESSAGES,
  DEFAULT_HISTORY_WINDOW_HOURS,
  formatHistoryContext,
  harvestTopicHistory,
  resolveHistoryContextConfig,
  shouldHarvestHistory,
  type HistoryContextConfig,
} from "../src/zulip/history-context.js";
import type { ZulipMessage } from "../src/zulip/client.js";

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0); // 2026-09-22T12:00:00Z

function config(overrides: Partial<HistoryContextConfig> = {}): HistoryContextConfig {
  return { mode: "on-demand", maxMessages: 8, windowHours: 72, maxChars: 4000, ...overrides };
}

function msg(overrides: Partial<ZulipMessage> & { id: string }): ZulipMessage {
  return {
    content: `message ${overrides.id}`,
    timestamp: Math.floor(NOW / 1000),
    sender_full_name: "Niyaz",
    sender_email: "niyaz@example.com",
    ...overrides,
  };
}

// ── Config ──────────────────────────────────────────────────────────────────

test("resolveHistoryContextConfig: defaults and clamping", () => {
  const defaults = resolveHistoryContextConfig();
  assert.equal(defaults.mode, "off");
  assert.equal(defaults.maxMessages, DEFAULT_HISTORY_MAX_MESSAGES);
  assert.equal(defaults.windowHours, DEFAULT_HISTORY_WINDOW_HOURS);
  assert.equal(defaults.maxChars, DEFAULT_HISTORY_MAX_CHARS);

  assert.equal(resolveHistoryContextConfig({ historyContext: "always" }).mode, "always");
  assert.equal(resolveHistoryContextConfig({ historyContext: "on-demand" }).mode, "on-demand");
  assert.equal(resolveHistoryContextConfig({ historyContext: "nonsense" }).mode, "off");
  assert.equal(resolveHistoryContextConfig({ historyMaxMessages: 0 }).maxMessages, 1);
  assert.equal(resolveHistoryContextConfig({ historyMaxMessages: 999 }).maxMessages, 50);
  assert.equal(resolveHistoryContextConfig({ historyWindowHours: 0 }).windowHours, 1);
  assert.equal(resolveHistoryContextConfig({ historyWindowHours: 99999 }).windowHours, 8760);
  assert.equal(resolveHistoryContextConfig({ historyMaxChars: 1 }).maxChars, 200);
  assert.equal(resolveHistoryContextConfig({ historyMaxChars: 999999 }).maxChars, 20_000);
});

// ── Trigger ─────────────────────────────────────────────────────────────────

test("shouldHarvestHistory: off never harvests, always always does", () => {
  assert.equal(shouldHarvestHistory("off", "have we seen this before?"), false);
  assert.equal(shouldHarvestHistory("always", "just saying hi"), true);
});

test("shouldHarvestHistory: on-demand matches 'do we know this?' intent", () => {
  for (const text of [
    "have we seen this error before?",
    "Have we hit this in prod?",
    "did we already fix this?",
    "any prior discussion on this?",
    "what's the root cause here?",
    "is this a known issue?",
    "looks like a duplicate of #123",
    "what happened with the deploy?",
    "last time we touched auth it broke",
    "context on the retry logic?",
    "this is a regression",
    "when did we change this?",
  ]) {
    assert.equal(shouldHarvestHistory("on-demand", text), true, `expected match: ${text}`);
  }
});

test("shouldHarvestHistory: on-demand ignores ordinary chat", () => {
  for (const text of [
    "please deploy the fix",
    "thanks!",
    "can you add a test?",
    "the build is green",
    "",
  ]) {
    assert.equal(shouldHarvestHistory("on-demand", text), false, `expected no match: ${text}`);
  }
});

// ── Formatting ──────────────────────────────────────────────────────────────

test("formatHistoryContext: renders oldest → newest with sender and age", () => {
  const block = formatHistoryContext({
    messages: [
      msg({ id: "1", content: "oldest", timestamp: Math.floor(NOW / 1000) - 7200 }),
      msg({ id: "2", content: "middle", timestamp: Math.floor(NOW / 1000) - 3600 }),
      msg({ id: "3", content: "newest", timestamp: Math.floor(NOW / 1000) - 60 }),
    ],
    stream: "main",
    topic: "deploys",
    config: config(),
    nowMs: NOW,
  });
  assert.ok(block);
  const lines = block!.split("\n");
  assert.match(lines[0], /^\[Zulip history — 3 earlier message\(s\) in #main \/ deploys\]$/);
  assert.equal(lines[4], "[end history]");
  // oldest first
  assert.match(lines[1], /^\- Niyaz \(2h ago\): oldest$/);
  assert.match(lines[2], /^\- Niyaz \(1h ago\): middle$/);
  assert.match(lines[3], /newest/);
  assert.ok(block!.indexOf("oldest") < block!.indexOf("newest"));
});

test("formatHistoryContext: excludes the current message and status noise", () => {
  const block = formatHistoryContext({
    messages: [
      msg({ id: "10", content: "real history" }),
      msg({ id: "11", content: "🤔 Thinking..." }),
      msg({ id: "12", content: "**Working** — fix the test" }),
      msg({ id: "13", content: "✅ **Done** — run finished in 12s" }),
      msg({ id: "14", content: "the current inbound message" }),
    ],
    stream: "main",
    topic: "t",
    config: config(),
    currentMessageId: "14",
    nowMs: NOW,
  });
  assert.ok(block);
  assert.match(block!, /real history/);
  assert.doesNotMatch(block!, /Thinking/);
  assert.doesNotMatch(block!, /Working/);
  assert.doesNotMatch(block!, /Done/);
  assert.doesNotMatch(block!, /current inbound/);
  assert.match(block!, /1 earlier message/);
});

test("formatHistoryContext: drops messages outside the window", () => {
  const block = formatHistoryContext({
    messages: [
      msg({ id: "1", content: "too old", timestamp: Math.floor(NOW / 1000) - 100 * 3600 }),
      msg({ id: "2", content: "recent", timestamp: Math.floor(NOW / 1000) - 3600 }),
    ],
    stream: "main",
    topic: "t",
    config: config({ windowHours: 24 }),
    nowMs: NOW,
  });
  assert.ok(block);
  assert.doesNotMatch(block!, /too old/);
  assert.match(block!, /recent/);
});

test("formatHistoryContext: keeps the newest messages when over the message budget", () => {
  const messages = Array.from({ length: 10 }, (_, i) =>
    msg({ id: String(i + 1), content: `m${i + 1}`, timestamp: Math.floor(NOW / 1000) - (10 - i) * 60 }),
  );
  const block = formatHistoryContext({
    messages,
    stream: "main",
    topic: "t",
    config: config({ maxMessages: 3 }),
    nowMs: NOW,
  });
  assert.ok(block);
  assert.match(block!, /3 earlier message/);
  assert.match(block!, /m8/);
  assert.match(block!, /m9/);
  assert.match(block!, /m10/);
  assert.doesNotMatch(block!, /m7/);
});

test("formatHistoryContext: respects the character budget", () => {
  const messages = Array.from({ length: 6 }, (_, i) =>
    msg({ id: String(i + 1), content: `x${i + 1} ${"y".repeat(120)}` }),
  );
  const block = formatHistoryContext({
    messages,
    stream: "main",
    topic: "t",
    config: config({ maxChars: 300 }),
    nowMs: NOW,
  });
  assert.ok(block);
  assert.ok(block!.length <= 300 + 60, `block too long: ${block!.length}`);
});

test("formatHistoryContext: strips HTML and truncates long lines", () => {
  const block = formatHistoryContext({
    messages: [
      msg({ id: "1", content: "<p>Hello <strong>world</strong></p>" }),
      msg({ id: "2", content: "z".repeat(500) }),
    ],
    stream: "main",
    topic: "t",
    config: config(),
    nowMs: NOW,
  });
  assert.ok(block);
  assert.match(block!, /Hello world/);
  assert.doesNotMatch(block!, /<p>|<strong>/);
  const longLine = block!.split("\n").find((line) => line.includes("zzz"));
  assert.ok(longLine);
  assert.ok(longLine!.length <= 320, `line too long: ${longLine!.length}`);
});

test("formatHistoryContext: returns undefined when there is nothing usable", () => {
  assert.equal(
    formatHistoryContext({ messages: [], stream: "main", topic: "t", config: config(), nowMs: NOW }),
    undefined,
  );
  assert.equal(
    formatHistoryContext({
      messages: [msg({ id: "1", content: "   " }), msg({ id: "2", content: "🤔 Thinking..." })],
      stream: "main",
      topic: "t",
      config: config(),
      nowMs: NOW,
    }),
    undefined,
  );
});

test("formatHistoryContext: omits the topic when there is none", () => {
  const block = formatHistoryContext({
    messages: [msg({ id: "1", content: "hi" })],
    stream: "main",
    config: config(),
    nowMs: NOW,
  });
  assert.match(block!, /in #main\]/);
});

// ── Harvest ─────────────────────────────────────────────────────────────────

test("harvestTopicHistory: mode off performs no fetch", async () => {
  let called = false;
  const result = await harvestTopicHistory({
    client: {} as any,
    stream: "main",
    topic: "t",
    config: config({ mode: "off" }),
    fetchMessages: async () => {
      called = true;
      return [];
    },
  });
  assert.equal(result, undefined);
  assert.equal(called, false);
});

test("harvestTopicHistory: returns a bounded block from fetched messages", async () => {
  const seenLimits: number[] = [];
  const result = await harvestTopicHistory({
    client: {} as any,
    stream: "main",
    topic: "t",
    config: config({ maxMessages: 2 }),
    currentMessageId: "9",
    nowMs: NOW,
    fetchMessages: async (_client, params) => {
      seenLimits.push(params.limit ?? 0);
      return [
        msg({ id: "9", content: "the current message" }),
        msg({ id: "8", content: "prior answer", sender_full_name: "Bot" }),
        msg({ id: "7", content: "original report" }),
      ];
    },
  });
  assert.ok(result);
  assert.match(result!, /prior answer/);
  assert.match(result!, /original report/);
  assert.doesNotMatch(result!, /the current message/);
  assert.equal(seenLimits.length, 1);
  assert.ok(seenLimits[0] >= 2);
});

test("harvestTopicHistory: a failing fetch is logged and dropped", async () => {
  const logs: string[] = [];
  const result = await harvestTopicHistory({
    client: {} as any,
    stream: "main",
    topic: "t",
    config: config(),
    nowMs: NOW,
    log: (m) => logs.push(m),
    fetchMessages: async () => {
      throw new Error("zulip 500");
    },
  });
  assert.equal(result, undefined);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /history harvest failed/);
});

test("harvestTopicHistory: a slow fetch times out instead of stalling the reply", async () => {
  const logs: string[] = [];
  const started = Date.now();
  const result = await harvestTopicHistory({
    client: {} as any,
    stream: "main",
    topic: "t",
    config: config(),
    nowMs: NOW,
    timeoutMs: 30,
    log: (m) => logs.push(m),
    fetchMessages: () => new Promise<ZulipMessage[]>(() => {}),
  });
  assert.equal(result, undefined);
  assert.ok(Date.now() - started < 2000, "should return promptly on timeout");
  assert.match(logs.join(" "), /timed out/);
});
