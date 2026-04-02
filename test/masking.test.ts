import test from "node:test";
import assert from "node:assert/strict";
import { maskPII } from "../src/zulip/monitor-helpers.js";

test("maskPII handles email variations correctly", () => {
  assert.strictEqual(maskPII("bot-zulip@example.com"), "b***@example.com");
  assert.strictEqual(maskPII("a@b.com"), "***@b.com");
  assert.strictEqual(maskPII("long.email.address@domain.org"), "l***@domain.org");
  assert.strictEqual(maskPII("simple@email"), "s***@email");
});

test("maskPII handles numeric IDs safely", () => {
  assert.strictEqual(maskPII("12345678"), "12***78");
  assert.strictEqual(maskPII(12345), "1***5");
  assert.strictEqual(maskPII("12"), "**");
  assert.strictEqual(maskPII("1"), "**");
});

test("maskPII handles nullish and empty values", () => {
  assert.strictEqual(maskPII(null), "");
  assert.strictEqual(maskPII(undefined), "");
  assert.strictEqual(maskPII(""), "");
  assert.strictEqual(maskPII("   "), "");
});

test("maskPII handles prefixed targets correctly", () => {
  assert.strictEqual(maskPII("user:bot@example.com"), "user:b***@example.com");
  assert.strictEqual(maskPII("dm:bot@example.com"), "dm:b***@example.com");
  assert.strictEqual(maskPII("stream:announcements"), "stream:an***");
  assert.strictEqual(maskPII("stream:general:topic"), "stream:ge***:topic");
  assert.strictEqual(maskPII("stream:hi"), "stream:***");
});

test("maskPII handles miscellaneous strings with generic masking", () => {
  assert.strictEqual(maskPII("abc"), "ab***bc");
  assert.strictEqual(maskPII("xy"), "**");
});
