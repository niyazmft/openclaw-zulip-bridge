import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveThreadSessionKeys,
  extractShortModelName,
  formatInboundFromLabel,
  maskPII,
  createDedupeCache,
  rawDataToString,
  formatZulipLog,
} from "../src/zulip/monitor-helpers.ts";

test("resolveThreadSessionKeys: returns base session key when threadId is missing", () => {
  const params = { baseSessionKey: "base-key" };
  const result = resolveThreadSessionKeys(params);
  assert.strictEqual(result.sessionKey, "base-key");
  assert.strictEqual(result.parentSessionKey, undefined);
});

test("resolveThreadSessionKeys: returns base session key when threadId is empty or whitespace", () => {
  assert.strictEqual(resolveThreadSessionKeys({ baseSessionKey: "k", threadId: "" }).sessionKey, "k");
  assert.strictEqual(resolveThreadSessionKeys({ baseSessionKey: "k", threadId: "  " }).sessionKey, "k");
  assert.strictEqual(resolveThreadSessionKeys({ baseSessionKey: "k", threadId: null }).sessionKey, "k");
});

test("resolveThreadSessionKeys: appends thread suffix by default", () => {
  const result = resolveThreadSessionKeys({ baseSessionKey: "base", threadId: "123" });
  assert.strictEqual(result.sessionKey, "base:thread:123");
});

test("resolveThreadSessionKeys: respects useSuffix=false", () => {
  const result = resolveThreadSessionKeys({ baseSessionKey: "base", threadId: "123", useSuffix: false });
  assert.strictEqual(result.sessionKey, "base");
});

test("resolveThreadSessionKeys: preserves parentSessionKey", () => {
  const result = resolveThreadSessionKeys({
    baseSessionKey: "base",
    threadId: "123",
    parentSessionKey: "parent",
  });
  assert.strictEqual(result.parentSessionKey, "parent");
});

test("extractShortModelName: extracts model name and removes suffixes", () => {
  assert.strictEqual(extractShortModelName("anthropic/claude-3-5-sonnet-20240620"), "claude-3-5-sonnet");
  assert.strictEqual(extractShortModelName("openai/gpt-4o-latest"), "gpt-4o");
  assert.strictEqual(extractShortModelName("gpt-4"), "gpt-4");
});

test("formatInboundFromLabel: group message formatting", () => {
  assert.strictEqual(
    formatInboundFromLabel({ isGroup: true, groupLabel: "Stream", groupId: "1", directLabel: "User" }),
    "Stream id:1"
  );
  assert.strictEqual(
    formatInboundFromLabel({ isGroup: true, groupFallback: "Group", directLabel: "User" }),
    "Group"
  );
});

test("formatInboundFromLabel: direct message formatting", () => {
  assert.strictEqual(
    formatInboundFromLabel({ isGroup: false, directLabel: "Alice", directId: "alice@example.com" }),
    "Alice id:alice@example.com"
  );
  assert.strictEqual(
    formatInboundFromLabel({ isGroup: false, directLabel: "Alice", directId: "Alice" }),
    "Alice"
  );
});

test("maskPII: masks emails", () => {
  assert.strictEqual(maskPII("user@example.com"), "u***@example.com");
  assert.strictEqual(maskPII("a@b.com"), "***@b.com");
});

test("maskPII: masks numeric IDs", () => {
  assert.strictEqual(maskPII("123456"), "12***56");
  assert.strictEqual(maskPII("123"), "1***3");
  assert.strictEqual(maskPII("12"), "**");
});

test("maskPII: masks prefixed targets", () => {
  assert.strictEqual(maskPII("user:secret@example.com"), "user:s***@example.com");
  assert.strictEqual(maskPII("stream:General Channel"), "stream:Ge***");
});

test("maskPII: handles null/undefined/empty", () => {
  assert.strictEqual(maskPII(null), "");
  assert.strictEqual(maskPII(undefined), "");
  assert.strictEqual(maskPII(""), "");
});

test("createDedupeCache: dedupes keys within TTL", () => {
  const cache = createDedupeCache({ ttlMs: 100, maxSize: 10 });
  const now = Date.now();
  assert.strictEqual(cache.check("key1", now), false, "First check should be false");
  assert.strictEqual(cache.check("key1", now + 50), true, "Second check within TTL should be true");
  assert.strictEqual(cache.check("key1", now + 150), false, "Check after TTL should be false");
});

test("createDedupeCache: respects maxSize", () => {
  const cache = createDedupeCache({ ttlMs: 1000, maxSize: 2 });
  cache.check("key1");
  cache.check("key2");
  assert.strictEqual(cache.check("key1"), true);
  cache.check("key3"); // Should evict key2 (oldest)
  assert.strictEqual(cache.check("key2"), false, "key2 should have been evicted");
});

test("rawDataToString: converts various formats to string", () => {
  assert.strictEqual(rawDataToString("hello"), "hello");
  assert.strictEqual(rawDataToString(Buffer.from("world")), "world");
  assert.strictEqual(rawDataToString([Buffer.from("a"), Buffer.from("b")]), "ab");
  const ab = new TextEncoder().encode("buf").buffer;
  assert.strictEqual(rawDataToString(ab), "buf");
});

test("formatZulipLog: formats message with fields", () => {
  const result = formatZulipLog("msg", { a: 1, b: "2", c: null, d: undefined, e: "" });
  assert.strictEqual(result, "msg [a=1 b=2]");
});
