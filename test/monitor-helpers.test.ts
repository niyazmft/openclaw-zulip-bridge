import assert from "node:assert";
import { test, describe } from "node:test";
import { formatInboundFromLabel } from "../src/zulip/monitor-helpers.ts";

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
