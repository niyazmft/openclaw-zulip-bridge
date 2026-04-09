import test from "node:test";
import assert from "node:assert/strict";
import { formatZulipLog } from "../src/zulip/monitor-helpers.js";
import { decidePolicy } from "../src/zulip/policy.js";
import { extractZulipUploadUrls, normalizeZulipEmojiName } from "../src/zulip/uploads.js";

test("smoke test extractZulipUploadUrls with tightened regex", () => {
  const baseUrl = "https://zulip.example.com";
  const html = `
    Check this out: <a href="/user_uploads/1/abc-123/file.png">link</a>
    And this: /user_uploads/2/xyz_456/another.jpg
    But not this: /user_uploads/malformed/url
    And definitely not this: /user_uploads/1/too-short
    Full URL: https://zulip.example.com/user_uploads/3/hash789/full.pdf
  `;

  const urls = extractZulipUploadUrls(html, baseUrl);

  assert.equal(urls.length, 3, "Should extract exactly 3 valid upload URLs");
  assert.ok(urls.includes("https://zulip.example.com/user_uploads/1/abc-123/file.png"));
  assert.ok(urls.includes("https://zulip.example.com/user_uploads/2/xyz_456/another.jpg"));
  assert.ok(urls.includes("https://zulip.example.com/user_uploads/3/hash789/full.pdf"));
  assert.ok(!urls.includes("https://zulip.example.com/user_uploads/malformed/url"));
  assert.ok(!urls.includes("https://zulip.example.com/user_uploads/1/too-short"));
});

test("smoke test formatZulipLog outputs expected string format", () => {
  const result = formatZulipLog("test event", { accountId: "default", messageId: 123, stream: "general" });
  assert.match(result, /test event/);
  assert.match(result, /\[accountId=default/);
  assert.match(result, /messageId=123/);
  assert.match(result, /stream=general\]/);
});

test("smoke test decidePolicy enforces rules correctly", () => {
  const resDM = decidePolicy({
    kind: "dm",
    senderId: "user_1",
    senderName: "User One",
    dmPolicy: "open",
    groupPolicy: "open",
    senderAllowedForCommands: true,
    groupAllowedForCommands: false,
    effectiveGroupAllowFromLength: 0,
    shouldRequireMention: false,
    wasMentioned: false,
    isControlCommand: false,
    commandAuthorized: false,
    oncharTriggered: false,
    canDetectMention: true,
  });
  assert.equal(resDM.shouldDrop, false);

  const resGroupAllow = decidePolicy({
    kind: "channel",
    senderId: "user_2",
    senderName: "User Two",
    dmPolicy: "open",
    groupPolicy: "allowlist",
    senderAllowedForCommands: true,
    groupAllowedForCommands: true,
    effectiveGroupAllowFromLength: 1,
    shouldRequireMention: true,
    wasMentioned: true,
    isControlCommand: false,
    commandAuthorized: false,
    oncharTriggered: false,
    canDetectMention: true,
  });
  assert.equal(resGroupAllow.shouldDrop, false);

  const resGroupDrop = decidePolicy({
    kind: "channel",
    senderId: "user_3",
    senderName: "User Three",
    dmPolicy: "open",
    groupPolicy: "allowlist",
    senderAllowedForCommands: true,
    groupAllowedForCommands: false,
    effectiveGroupAllowFromLength: 1,
    shouldRequireMention: true,
    wasMentioned: true,
    isControlCommand: false,
    commandAuthorized: false,
    oncharTriggered: false,
    canDetectMention: true,
  });
  assert.equal(resGroupDrop.shouldDrop, true);
});

test("smoke test normalizeZulipEmojiName handles various formats", () => {

  assert.equal(normalizeZulipEmojiName("smile"), "smile");
  assert.equal(normalizeZulipEmojiName(":smile:"), "smile");
  assert.equal(normalizeZulipEmojiName("::smile::"), "smile");
  assert.equal(normalizeZulipEmojiName("  smile  "), "smile");
  assert.equal(normalizeZulipEmojiName(" :smile: "), "smile");
  assert.equal(normalizeZulipEmojiName(""), "");
  assert.equal(normalizeZulipEmojiName(null), "");
  assert.equal(normalizeZulipEmojiName(undefined), "");
  assert.equal(normalizeZulipEmojiName("smile:cry"), "smile:cry");
  assert.equal(normalizeZulipEmojiName(":smile:cry:"), "smile:cry");
  assert.equal(normalizeZulipEmojiName(":::"), ""); // edge case: only colons
});
