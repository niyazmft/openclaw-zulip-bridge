import test from "node:test";
import assert from "node:assert/strict";
import { normalizeZulipMessagingTarget, looksLikeZulipTargetId } from "../src/normalize.ts";

test("normalizeZulipMessagingTarget", async (t) => {
  await t.test("empty or whitespace", () => {
    assert.equal(normalizeZulipMessagingTarget(""), undefined);
    assert.equal(normalizeZulipMessagingTarget("   "), undefined);
  });

  await t.test("stream prefix", () => {
    assert.equal(normalizeZulipMessagingTarget("stream:general"), "stream:general");
    assert.equal(normalizeZulipMessagingTarget("STREAM: design "), "stream:design");
    assert.equal(normalizeZulipMessagingTarget("stream:  "), undefined);
  });

  await t.test("user and dm prefix", () => {
    assert.equal(normalizeZulipMessagingTarget("user:alice"), "user:alice");
    assert.equal(normalizeZulipMessagingTarget("USER: bob "), "user:bob");
    assert.equal(normalizeZulipMessagingTarget("dm:charlie"), "user:charlie");
    assert.equal(normalizeZulipMessagingTarget("DM: dave "), "user:dave");
    assert.equal(normalizeZulipMessagingTarget("user:  "), undefined);
    assert.equal(normalizeZulipMessagingTarget("dm:  "), undefined);
  });

  await t.test("zulip prefix", () => {
    assert.equal(normalizeZulipMessagingTarget("zulip:eve"), "user:eve");
    assert.equal(normalizeZulipMessagingTarget("ZULIP: frank "), "user:frank");
    assert.equal(normalizeZulipMessagingTarget("zulip:  "), undefined);
  });

  await t.test("@ prefix", () => {
    assert.equal(normalizeZulipMessagingTarget("@george"), "user:george");
    assert.equal(normalizeZulipMessagingTarget("@ hannah "), "user:hannah");
    assert.equal(normalizeZulipMessagingTarget("@"), undefined);
  });

  await t.test("# prefix", () => {
    assert.equal(normalizeZulipMessagingTarget("#random"), "stream:random");
    assert.equal(normalizeZulipMessagingTarget("# announcements "), "stream:announcements");
    assert.equal(normalizeZulipMessagingTarget("#"), undefined);
  });

  await t.test("contains @", () => {
    assert.equal(normalizeZulipMessagingTarget("user@example.com"), "user:user@example.com");
    assert.equal(normalizeZulipMessagingTarget("first.last@domain.org"), "user:first.last@domain.org");
  });

  await t.test("fallback to stream", () => {
    assert.equal(normalizeZulipMessagingTarget("project-x"), "stream:project-x");
    assert.equal(normalizeZulipMessagingTarget("12345"), "stream:12345");
  });
});

test("looksLikeZulipTargetId", async (t) => {
  await t.test("empty or whitespace", () => {
    assert.equal(looksLikeZulipTargetId(""), false);
    assert.equal(looksLikeZulipTargetId("   "), false);
  });

  await t.test("prefixes", () => {
    assert.equal(looksLikeZulipTargetId("user:alice"), true);
    assert.equal(looksLikeZulipTargetId("stream:general"), true);
    assert.equal(looksLikeZulipTargetId("dm:bob"), true);
    assert.equal(looksLikeZulipTargetId("zulip:charlie"), true);

    assert.equal(looksLikeZulipTargetId("USER:alice"), true);
    assert.equal(looksLikeZulipTargetId("Stream:general"), true);
    assert.equal(looksLikeZulipTargetId("dM:bob"), true);
  });

  await t.test("symbols", () => {
    assert.equal(looksLikeZulipTargetId("@alice"), true);
    assert.equal(looksLikeZulipTargetId("#general"), true);
  });

  await t.test("emails or containing @", () => {
    assert.equal(looksLikeZulipTargetId("user@example.com"), true);
    assert.equal(looksLikeZulipTargetId("foo@bar"), true);
  });

  await t.test("alphanumeric / valid stream names", () => {
    assert.equal(looksLikeZulipTargetId("general"), true);
    assert.equal(looksLikeZulipTargetId("project-x"), true);
    assert.equal(looksLikeZulipTargetId("team.dev"), true);
    assert.equal(looksLikeZulipTargetId("123"), true);
    assert.equal(looksLikeZulipTargetId("a_b"), true);
  });

  await t.test("invalid formats", () => {
    assert.equal(looksLikeZulipTargetId("!invalid"), false);
    assert.equal(looksLikeZulipTargetId("-dashfirst"), false);
    assert.equal(looksLikeZulipTargetId(".dotfirst"), false);
  });
});
