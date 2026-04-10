import assert from "node:assert";
import { test, describe } from "node:test";
import { formatInboundFromLabel, maskPII } from "../src/zulip/monitor-helpers.ts";

describe("maskPII", () => {
  test("returns empty string for null, undefined, or empty", () => {
    assert.strictEqual(maskPII(null), "");
    assert.strictEqual(maskPII(undefined), "");
    assert.strictEqual(maskPII(""), "");
    assert.strictEqual(maskPII("   "), "");
  });

  test("masks emails correctly", () => {
    assert.strictEqual(maskPII("alice@example.com"), "a***@example.com");
    assert.strictEqual(maskPII("a@b.com"), "***@b.com");
  });

  test("masks numeric IDs correctly", () => {
    assert.strictEqual(maskPII("1"), "**");
    assert.strictEqual(maskPII("12"), "**");
    assert.strictEqual(maskPII("123"), "1***3");
    assert.strictEqual(maskPII("12345"), "1***5");
    assert.strictEqual(maskPII("123456"), "12***56");
  });

  test("masks user: prefixed strings", () => {
    assert.strictEqual(maskPII("user:alice@example.com"), "user:a***@example.com");
    assert.strictEqual(maskPII("user:12345"), "user:1***5");
  });

  test("masks stream: prefixed strings", () => {
    assert.strictEqual(maskPII("stream:general"), "stream:ge***");
    assert.strictEqual(maskPII("stream:my"), "stream:***");
    assert.strictEqual(maskPII("stream:general:topic"), "stream:ge***:to***ic");
  });

  test("masks generic strings", () => {
    assert.strictEqual(maskPII("ab"), "**");
    assert.strictEqual(maskPII("abcde"), "ab***de");
  });
});

describe("formatInboundFromLabel", () => {
  describe("when isGroup is true", () => {
    test("uses groupLabel and groupId when provided", () => {
      const result = formatInboundFromLabel({
        isGroup: true,
        groupLabel: "My Group",
        groupId: "123",
        directLabel: "Ignored"
      });
      assert.equal(result, "My Group id:123");
    });

    test("trims whitespace from groupLabel and groupId", () => {
      const result = formatInboundFromLabel({
        isGroup: true,
        groupLabel: "  My Group  ",
        groupId: "  123  ",
        directLabel: "Ignored"
      });
      assert.equal(result, "My Group id:123");
    });

    test("falls back to groupFallback if groupLabel is missing or blank", () => {
      const result = formatInboundFromLabel({
        isGroup: true,
        groupLabel: "   ",
        groupId: "123",
        groupFallback: "Fallback Group",
        directLabel: "Ignored"
      });
      assert.equal(result, "Fallback Group id:123");
    });

    test("falls back to 'Group' if groupLabel and groupFallback are missing or blank", () => {
      const result = formatInboundFromLabel({
        isGroup: true,
        groupLabel: "   ",
        groupId: "123",
        directLabel: "Ignored"
      });
      assert.equal(result, "Group id:123");
    });

    test("omits id section if groupId is absent or blank", () => {
      const result = formatInboundFromLabel({
        isGroup: true,
        groupLabel: "My Group",
        groupId: "   ",
        directLabel: "Ignored"
      });
      assert.equal(result, "My Group");
    });

    test("handles only groupFallback", () => {
      const result = formatInboundFromLabel({
        isGroup: true,
        groupFallback: "Fallback",
        directLabel: "Ignored"
      });
      assert.equal(result, "Fallback");
    });
  });

  describe("when isGroup is false", () => {
    test("returns directLabel if directId is absent", () => {
      const result = formatInboundFromLabel({
        isGroup: false,
        directLabel: "Alice"
      });
      assert.equal(result, "Alice");
    });

    test("trims whitespace from directLabel", () => {
      const result = formatInboundFromLabel({
        isGroup: false,
        directLabel: "  Alice  "
      });
      assert.equal(result, "Alice");
    });

    test("returns only directLabel if directId matches directLabel", () => {
      const result = formatInboundFromLabel({
        isGroup: false,
        directLabel: "Alice",
        directId: "Alice"
      });
      assert.equal(result, "Alice");
    });

    test("trims whitespace before comparing directId and directLabel", () => {
      const result = formatInboundFromLabel({
        isGroup: false,
        directLabel: " Alice ",
        directId: "  Alice  "
      });
      assert.equal(result, "Alice");
    });

    test("appends directId if it differs from directLabel", () => {
      const result = formatInboundFromLabel({
        isGroup: false,
        directLabel: "Alice",
        directId: "alice@example.com"
      });
      assert.equal(result, "Alice id:alice@example.com");
    });

    test("omits id section if directId is only whitespace", () => {
      const result = formatInboundFromLabel({
        isGroup: false,
        directLabel: "Alice",
        directId: "   "
      });
      assert.equal(result, "Alice");
    });
  });
});
