import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { maskPII } from "../src/zulip/monitor-helpers.js";

describe("maskPII", () => {
  test("handles empty and nullish values", () => {
    assert.equal(maskPII(""), "");
    assert.equal(maskPII(undefined), "");
    assert.equal(maskPII(null), "");
    assert.equal(maskPII("   "), "");
  });

  test("masks emails correctly", () => {
    assert.equal(maskPII("user@example.com"), "u***@example.com");
    assert.equal(maskPII("a@example.com"), "***@example.com");
    assert.equal(maskPII("firstname.lastname@company.co.uk"), "f***@company.co.uk");
  });

  test("masks numeric IDs correctly", () => {
    assert.equal(maskPII(1), "**");
    assert.equal(maskPII(12), "**");
    assert.equal(maskPII("1"), "**");
    assert.equal(maskPII("12"), "**");
    assert.equal(maskPII("123"), "1***3");
    assert.equal(maskPII("12345"), "1***5");
    assert.equal(maskPII("123456"), "12***56");
    assert.equal(maskPII("1234567890"), "12***90");
    assert.equal(maskPII(123456), "12***56");
  });

  test("masks prefixed targets correctly", () => {
    // user: prefix
    assert.equal(maskPII("user:someone@example.com"), "user:s***@example.com");
    assert.equal(maskPII("user:123456"), "user:12***56");

    // stream: prefix
    assert.equal(maskPII("stream:general"), "stream:ge***");
    assert.equal(maskPII("stream:ab"), "stream:***");
    assert.equal(maskPII("stream:general:123"), "stream:ge***:123");
    assert.equal(maskPII("stream:general/topic"), "stream:ge***:topic");
    assert.equal(maskPII("stream:general#topic"), "stream:ge***:topic");
  });

  test("masks fallback strings correctly", () => {
    assert.equal(maskPII("ab"), "**");
    assert.equal(maskPII("a"), "**");
    assert.equal(maskPII("abc"), "ab***bc"); // The fallback does str.slice(0, 2) + "***" + str.slice(-2). If length is 3, 0-2 is 'ab', -2 is 'bc'. So 'ab***bc'.
    assert.equal(maskPII("abcd"), "ab***cd");
    assert.equal(maskPII("hello-world"), "he***ld");
  });
});
