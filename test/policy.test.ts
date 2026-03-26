import test from "node:test";
import assert from "node:assert/strict";
import { decidePolicy } from "../src/zulip/policy.ts";

test("Policy Logic: DM - open allows everyone", () => {
  const result = decidePolicy({
    kind: 'dm',
    senderId: 'user1',
    senderName: 'User One',
    dmPolicy: 'open',
    groupPolicy: 'allowlist',
    senderAllowedForCommands: false,
    groupAllowedForCommands: false,
    effectiveGroupAllowFromLength: 0,
    shouldRequireMention: false,
    wasMentioned: false,
    isControlCommand: false,
    commandAuthorized: false,
    oncharTriggered: false,
    canDetectMention: true
  });
  assert.strictEqual(result.shouldDrop, false);
});

test("Policy Logic: DM - disabled drops everyone", () => {
  const result = decidePolicy({
    kind: 'dm',
    senderId: 'user1',
    senderName: 'User One',
    dmPolicy: 'disabled',
    groupPolicy: 'allowlist',
    senderAllowedForCommands: true,
    groupAllowedForCommands: true,
    effectiveGroupAllowFromLength: 0,
    shouldRequireMention: false,
    wasMentioned: false,
    isControlCommand: false,
    commandAuthorized: false,
    oncharTriggered: false,
    canDetectMention: true
  });
  assert.strictEqual(result.shouldDrop, true);
  assert.strictEqual(result.reason, "dmPolicy=disabled");
});

test("Policy Logic: DM - allowlist drops if not allowed", () => {
  const result = decidePolicy({
    kind: 'dm',
    senderId: 'user1',
    senderName: 'User One',
    dmPolicy: 'allowlist',
    groupPolicy: 'allowlist',
    senderAllowedForCommands: false,
    groupAllowedForCommands: false,
    effectiveGroupAllowFromLength: 0,
    shouldRequireMention: false,
    wasMentioned: false,
    isControlCommand: false,
    commandAuthorized: false,
    oncharTriggered: false,
    canDetectMention: true
  });
  assert.strictEqual(result.shouldDrop, true);
  assert.strictEqual(result.reason, "dmPolicy=allowlist");
});

test("Policy Logic: DM - allowlist allows if allowed", () => {
  const result = decidePolicy({
    kind: 'dm',
    senderId: 'user1',
    senderName: 'User One',
    dmPolicy: 'allowlist',
    groupPolicy: 'allowlist',
    senderAllowedForCommands: true,
    groupAllowedForCommands: false,
    effectiveGroupAllowFromLength: 0,
    shouldRequireMention: false,
    wasMentioned: false,
    isControlCommand: false,
    commandAuthorized: true,
    oncharTriggered: false,
    canDetectMention: true
  });
  assert.strictEqual(result.shouldDrop, false);
});

test("Policy Logic: DM - pairing triggers pairing if not allowed", () => {
  const result = decidePolicy({
    kind: 'dm',
    senderId: 'user1',
    senderName: 'User One',
    dmPolicy: 'pairing',
    groupPolicy: 'allowlist',
    senderAllowedForCommands: false,
    groupAllowedForCommands: false,
    effectiveGroupAllowFromLength: 0,
    shouldRequireMention: false,
    wasMentioned: false,
    isControlCommand: false,
    commandAuthorized: false,
    oncharTriggered: false,
    canDetectMention: true
  });
  assert.strictEqual(result.shouldDrop, true);
  assert.strictEqual(result.shouldPair, true);
  assert.strictEqual(result.reason, "pairing");
});

test("Policy Logic: Group - disabled drops everyone", () => {
  const result = decidePolicy({
    kind: 'channel',
    senderId: 'user1',
    senderName: 'User One',
    dmPolicy: 'open',
    groupPolicy: 'disabled',
    senderAllowedForCommands: true,
    groupAllowedForCommands: true,
    effectiveGroupAllowFromLength: 1,
    shouldRequireMention: true,
    wasMentioned: true,
    isControlCommand: false,
    commandAuthorized: false,
    oncharTriggered: false,
    canDetectMention: true
  });
  assert.strictEqual(result.shouldDrop, true);
  assert.strictEqual(result.reason, "groupPolicy=disabled");
});

test("Policy Logic: Group - open allows everyone if mentioned", () => {
  const result = decidePolicy({
    kind: 'channel',
    senderId: 'user1',
    senderName: 'User One',
    dmPolicy: 'open',
    groupPolicy: 'open',
    senderAllowedForCommands: false,
    groupAllowedForCommands: false,
    effectiveGroupAllowFromLength: 0,
    shouldRequireMention: true,
    wasMentioned: true,
    isControlCommand: false,
    commandAuthorized: false,
    oncharTriggered: false,
    canDetectMention: true
  });
  assert.strictEqual(result.shouldDrop, false);
});

test("Policy Logic: Group - open drops if not mentioned", () => {
  const result = decidePolicy({
    kind: 'channel',
    senderId: 'user1',
    senderName: 'User One',
    dmPolicy: 'open',
    groupPolicy: 'open',
    senderAllowedForCommands: false,
    groupAllowedForCommands: false,
    effectiveGroupAllowFromLength: 0,
    shouldRequireMention: true,
    wasMentioned: false,
    isControlCommand: false,
    commandAuthorized: false,
    oncharTriggered: false,
    canDetectMention: true
  });
  assert.strictEqual(result.shouldDrop, true);
  assert.strictEqual(result.reason, "mention required");
});

test("Policy Logic: Group - allowlist drops if not in allowlist", () => {
  const result = decidePolicy({
    kind: 'channel',
    senderId: 'user1',
    senderName: 'User One',
    dmPolicy: 'open',
    groupPolicy: 'allowlist',
    senderAllowedForCommands: false,
    groupAllowedForCommands: false,
    effectiveGroupAllowFromLength: 1, // list is not empty
    shouldRequireMention: true,
    wasMentioned: true,
    isControlCommand: false,
    commandAuthorized: false,
    oncharTriggered: false,
    canDetectMention: true
  });
  assert.strictEqual(result.shouldDrop, true);
  assert.strictEqual(result.reason, "not in groupAllowFrom");
});

test("Policy Logic: Group - allowlist allows if in allowlist", () => {
  const result = decidePolicy({
    kind: 'channel',
    senderId: 'user1',
    senderName: 'User One',
    dmPolicy: 'open',
    groupPolicy: 'allowlist',
    senderAllowedForCommands: false,
    groupAllowedForCommands: true,
    effectiveGroupAllowFromLength: 1,
    shouldRequireMention: true,
    wasMentioned: true,
    isControlCommand: false,
    commandAuthorized: false,
    oncharTriggered: false,
    canDetectMention: true
  });
  assert.strictEqual(result.shouldDrop, false);
});

test("Policy Logic: Group - allowlist drops if allowlist is empty", () => {
  const result = decidePolicy({
    kind: 'channel',
    senderId: 'user1',
    senderName: 'User One',
    dmPolicy: 'open',
    groupPolicy: 'allowlist',
    senderAllowedForCommands: true,
    groupAllowedForCommands: true,
    effectiveGroupAllowFromLength: 0,
    shouldRequireMention: true,
    wasMentioned: true,
    isControlCommand: false,
    commandAuthorized: false,
    oncharTriggered: false,
    canDetectMention: true
  });
  assert.strictEqual(result.shouldDrop, true);
  assert.strictEqual(result.reason, "no group allowlist");
});

test("Policy Logic: Group - bypassed mention for authorized control command", () => {
  const result = decidePolicy({
    kind: 'channel',
    senderId: 'user1',
    senderName: 'User One',
    dmPolicy: 'open',
    groupPolicy: 'open',
    senderAllowedForCommands: true,
    groupAllowedForCommands: true,
    effectiveGroupAllowFromLength: 0,
    shouldRequireMention: true,
    wasMentioned: false,
    isControlCommand: true,
    commandAuthorized: true,
    oncharTriggered: false,
    canDetectMention: true
  });
  assert.strictEqual(result.shouldDrop, false);
});

test("Policy Logic: Group - onchar triggered bypasses mention", () => {
  const result = decidePolicy({
    kind: 'channel',
    senderId: 'user1',
    senderName: 'User One',
    dmPolicy: 'open',
    groupPolicy: 'open',
    senderAllowedForCommands: false,
    groupAllowedForCommands: false,
    effectiveGroupAllowFromLength: 0,
    shouldRequireMention: true,
    wasMentioned: false,
    isControlCommand: false,
    commandAuthorized: false,
    oncharTriggered: true,
    canDetectMention: true
  });
  assert.strictEqual(result.shouldDrop, false);
});

test("Policy Logic: Group - cannot detect mention does not drop if mentioned but undetected", () => {
  // If we can't detect mentions (no botUsername and no mentionRegexes), we shouldn't drop
  // because we don't know if it was mentioned or not.
  const result = decidePolicy({
    kind: 'channel',
    senderId: 'user1',
    senderName: 'User One',
    dmPolicy: 'open',
    groupPolicy: 'open',
    senderAllowedForCommands: false,
    groupAllowedForCommands: false,
    effectiveGroupAllowFromLength: 0,
    shouldRequireMention: true,
    wasMentioned: false,
    isControlCommand: false,
    commandAuthorized: false,
    oncharTriggered: false,
    canDetectMention: false
  });
  assert.strictEqual(result.shouldDrop, false);
});
