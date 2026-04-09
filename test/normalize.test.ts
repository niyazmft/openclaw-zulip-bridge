import test from "node:test";
import assert from "node:assert/strict";
import { normalizeZulipMessagingTarget, looksLikeZulipTargetId } from "../src/normalize.js";

test("looksLikeZulipTargetId checks", async (t) => {
  await t.test("empty strings", () => {
    assert.equal(looksLikeZulipTargetId(""), false);
    assert.equal(looksLikeZulipTargetId("   "), false);
  });

  await t.test("valid prefixes", () => {
    assert.equal(looksLikeZulipTargetId("user:123"), true);
    assert.equal(looksLikeZulipTargetId("dm:123"), true);
    assert.equal(looksLikeZulipTargetId("stream:general"), true);
    assert.equal(looksLikeZulipTargetId("zulip:test"), true);
    assert.equal(looksLikeZulipTargetId("USER:123"), true); // case insensitive
  });

  await t.test("valid symbols", () => {
    assert.equal(looksLikeZulipTargetId("@alice"), true);
    assert.equal(looksLikeZulipTargetId("#general"), true);
  });

  await t.test("valid email format", () => {
    assert.equal(looksLikeZulipTargetId("alice@example.com"), true);
    assert.equal(looksLikeZulipTargetId("bob@zulip"), true);
  });

  await t.test("valid plain text targets", () => {
    assert.equal(looksLikeZulipTargetId("general"), true);
    assert.equal(looksLikeZulipTargetId("design-team"), true);
    assert.equal(looksLikeZulipTargetId("a.b_c-d"), true);
  });

  await t.test("invalid plain text targets", () => {
    assert.equal(looksLikeZulipTargetId("a"), false); // too short
    assert.equal(looksLikeZulipTargetId("a!b"), false); // invalid character
    assert.equal(looksLikeZulipTargetId("  a  "), false); // too short after trim
  });
});

test("normalizeZulipMessagingTarget checks", async (t) => {
  await t.test("empty strings", () => {
    assert.equal(normalizeZulipMessagingTarget(""), undefined);
    assert.equal(normalizeZulipMessagingTarget("   "), undefined);
  });

  await t.test("stream prefix", () => {
    assert.equal(normalizeZulipMessagingTarget("stream:general"), "stream:general");
    assert.equal(normalizeZulipMessagingTarget("STREAM:general"), "stream:general");
    assert.equal(normalizeZulipMessagingTarget("stream:  "), undefined);
  });

  await t.test("user/dm/zulip prefix", () => {
    assert.equal(normalizeZulipMessagingTarget("user:123"), "user:123");
    assert.equal(normalizeZulipMessagingTarget("dm:123"), "user:123");
    assert.equal(normalizeZulipMessagingTarget("zulip:123"), "user:123");
    assert.equal(normalizeZulipMessagingTarget("USER:123"), "user:123");
    assert.equal(normalizeZulipMessagingTarget("DM:123"), "user:123");
    assert.equal(normalizeZulipMessagingTarget("ZULIP:123"), "user:123");
    assert.equal(normalizeZulipMessagingTarget("user:  "), undefined);
  });

  await t.test("at symbol", () => {
    assert.equal(normalizeZulipMessagingTarget("@alice"), "user:alice");
    assert.equal(normalizeZulipMessagingTarget(" @alice "), "user:alice");
    assert.equal(normalizeZulipMessagingTarget("@"), undefined);
  });

  await t.test("hash symbol", () => {
    assert.equal(normalizeZulipMessagingTarget("#general"), "stream:general");
    assert.equal(normalizeZulipMessagingTarget(" #general "), "stream:general");
    assert.equal(normalizeZulipMessagingTarget("#"), undefined);
  });

  await t.test("email format", () => {
    assert.equal(normalizeZulipMessagingTarget("alice@example.com"), "user:alice@example.com");
  });

  await t.test("plain text fallback", () => {
    assert.equal(normalizeZulipMessagingTarget("general"), "stream:general");
    assert.equal(normalizeZulipMessagingTarget("design-team"), "stream:design-team");
  });
});
