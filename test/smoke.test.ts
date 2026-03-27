import test from "node:test";
import assert from "node:assert/strict";
import { formatZulipLog } from "../src/zulip/monitor-helpers.js";
import { decidePolicy } from "../src/zulip/policy.js";

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
