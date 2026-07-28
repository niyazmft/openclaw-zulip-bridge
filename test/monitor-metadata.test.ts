import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { trackConversationMetadata } from "../src/zulip/monitor-helpers.js";

const monitorPath = path.resolve(process.cwd(), "src/zulip/monitor.ts");

// ── Unit tests for trackConversationMetadata ────────────────────────────────

test("trackConversationMetadata: first message has turn 1, gap 0, no topic change", () => {
  const messageCounts = new Map<string, number>();
  const lastMessageTimes = new Map<string, number>();
  const lastTopicCache = new Map<string, string>();

  const result = trackConversationMetadata({
    sessionKey: "sess:1",
    channelId: "stream:42",
    topic: "general",
    isDM: false,
    now: 1000,
    messageCounts,
    lastMessageTimes,
    lastTopicCache,
  });

  assert.equal(result.conversationTurn, 1);
  assert.equal(result.sessionGapSeconds, 0);
  assert.equal(result.topicChanged, false);
});

test("trackConversationMetadata: second message increments turn and tracks gap", () => {
  const messageCounts = new Map<string, number>();
  const lastMessageTimes = new Map<string, number>();
  const lastTopicCache = new Map<string, string>();

  // First message
  trackConversationMetadata({
    sessionKey: "sess:1",
    channelId: "stream:42",
    topic: "general",
    isDM: false,
    now: 1000,
    messageCounts,
    lastMessageTimes,
    lastTopicCache,
  });

  // Second message 5 seconds later
  const result = trackConversationMetadata({
    sessionKey: "sess:1",
    channelId: "stream:42",
    topic: "general",
    isDM: false,
    now: 6000,
    messageCounts,
    lastMessageTimes,
    lastTopicCache,
  });

  assert.equal(result.conversationTurn, 2);
  assert.equal(result.sessionGapSeconds, 5);
  assert.equal(result.topicChanged, false);
});

test("trackConversationMetadata: detects topic change in streams", () => {
  const messageCounts = new Map<string, number>();
  const lastMessageTimes = new Map<string, number>();
  const lastTopicCache = new Map<string, string>();

  // First message in topic "general"
  trackConversationMetadata({
    sessionKey: "sess:1",
    channelId: "stream:42",
    topic: "general",
    isDM: false,
    now: 1000,
    messageCounts,
    lastMessageTimes,
    lastTopicCache,
  });

  // Second message in topic "updates"
  const result = trackConversationMetadata({
    sessionKey: "sess:1",
    channelId: "stream:42",
    topic: "updates",
    isDM: false,
    now: 2000,
    messageCounts,
    lastMessageTimes,
    lastTopicCache,
  });

  assert.equal(result.topicChanged, true);
});

test("trackConversationMetadata: separate sessions track independently", () => {
  const messageCounts = new Map<string, number>();
  const lastMessageTimes = new Map<string, number>();
  const lastTopicCache = new Map<string, string>();

  const r1 = trackConversationMetadata({
    sessionKey: "sess:A",
    channelId: "stream:1",
    topic: "t1",
    isDM: false,
    now: 1000,
    messageCounts,
    lastMessageTimes,
    lastTopicCache,
  });

  const r2 = trackConversationMetadata({
    sessionKey: "sess:B",
    channelId: "stream:2",
    topic: "t2",
    isDM: false,
    now: 2000,
    messageCounts,
    lastMessageTimes,
    lastTopicCache,
  });

  assert.equal(r1.conversationTurn, 1);
  assert.equal(r2.conversationTurn, 1);
});

test("trackConversationMetadata: DMs do not track topic changes", () => {
  const messageCounts = new Map<string, number>();
  const lastMessageTimes = new Map<string, number>();
  const lastTopicCache = new Map<string, string>();

  const result = trackConversationMetadata({
    sessionKey: "dm:alice",
    channelId: "user:alice",
    topic: undefined,
    isDM: true,
    now: 1000,
    messageCounts,
    lastMessageTimes,
    lastTopicCache,
  });

  assert.equal(result.topicChanged, false);
});

test("trackConversationMetadata: first topic in stream does not count as changed", () => {
  const messageCounts = new Map<string, number>();
  const lastMessageTimes = new Map<string, number>();
  const lastTopicCache = new Map<string, string>();

  const result = trackConversationMetadata({
    sessionKey: "sess:1",
    channelId: "stream:42",
    topic: "new-topic",
    isDM: false,
    now: 1000,
    messageCounts,
    lastMessageTimes,
    lastTopicCache,
  });

  // First time seeing this stream — no previous topic to compare
  assert.equal(result.topicChanged, false);
  assert.equal(lastTopicCache.get("stream:42"), "new-topic");
});

// ── Source regression tests for monitor.ts ──────────────────────────────────

test("monitor source: context metadata tracking variables are present", async () => {
  const source = await fs.readFile(monitorPath, "utf8");
  assert.equal(source.includes("messageCounts"), true);
  assert.equal(source.includes("lastMessageTimes"), true);
  assert.equal(source.includes("lastTopicCache"), true);
});

test("monitor source: context metadata fields are added to ctxPayload", async () => {
  const source = await fs.readFile(monitorPath, "utf8");
  assert.equal(source.includes("ConversationTurn"), true);
  assert.equal(source.includes("SessionGapSeconds"), true);
  assert.equal(source.includes("TopicChanged"), true);
});

test("monitor source: error placeholder cleanup is present", async () => {
  const source = await fs.readFile(monitorPath, "utf8");
  assert.equal(source.includes("editZulipMessage"), true);
  assert.equal(source.includes("❌ Error — could not generate response"), true);
});

test("monitor source: showThinkingPlaceholder is configurable and defaults off", async () => {
  const source = await fs.readFile(monitorPath, "utf8");
  assert.equal(source.includes("showThinkingPlaceholder"), true);
  assert.equal(source.includes("Promise.resolve(undefined)"), true);
});

test("monitor source: DM session rotation is present", async () => {
  const source = await fs.readFile(monitorPath, "utf8");
  assert.equal(source.includes("dmSessionTurnLimit"), true);
  assert.equal(source.includes("dmBaseMessageCounts"), true);
  assert.equal(source.includes(":session:"), true);
});

test("reply-handler source: typing indicator stops on first chunk delivery", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/zulip/reply-handler.ts"),
    "utf8",
  );
  assert.equal(source.includes("typingStopped"), true);
  assert.equal(source.includes("typingCallbacks.onIdle"), true);
  assert.equal(source.includes("onError: (err: unknown)"), true);
});

test("monitor source: start reaction is fire-and-forget", async () => {
  const source = await fs.readFile(monitorPath, "utf8");
  assert.equal(source.includes("Issue #224"), true);
  assert.equal(source.includes("void addReactionSafe({"), true);
});
