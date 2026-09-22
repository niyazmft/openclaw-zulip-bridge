import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReactionTriggerMessage,
  isEligibleTargetMessage,
  matchReactionTrigger,
  reactionDedupeKey,
  resolveReactionTriggerConfig,
} from "../src/zulip/reaction-triggers.js";
import type { ZulipMessage } from "../src/zulip/client.js";

const BOT_EMAIL = "bot@example.com";
const BOT_ID = "42";

function targetMessage(overrides: Partial<ZulipMessage> = {}): ZulipMessage {
  return {
    id: "1001",
    sender_id: BOT_ID,
    sender_email: BOT_EMAIL,
    sender_full_name: "Zulip Bot",
    content: "<p>I can fix this by rebasing.</p>",
    timestamp: 1_700_000_000,
    type: "stream",
    stream_id: "7",
    display_recipient: "main",
    subject: "deploys",
    ...overrides,
  };
}

function reactionEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: "reaction",
    op: "add",
    message_id: 1001,
    emoji_name: "+1",
    user_id: 9,
    user: { id: 9, email: "niyaz@example.com", full_name: "Niyaz" },
    ...overrides,
  } as any;
}

// ── Config ──────────────────────────────────────────────────────────────────

test("resolveReactionTriggerConfig: absent config means the feature is off", () => {
  const config = resolveReactionTriggerConfig();
  assert.equal(config.enabled, false);
  assert.deepEqual(config.triggers, {});
  assert.equal(config.anyMessage, false);
  assert.equal(
    resolveReactionTriggerConfig({ reactionTriggers: {} }).enabled,
    false,
    "an empty map must not enable the feature",
  );
});

test("resolveReactionTriggerConfig: reads, normalises and bounds the map", () => {
  const config = resolveReactionTriggerConfig({
    reactionTriggers: {
      "+1": "  Proceed   with it.  ",
      ":check:": "Ship it",
      "": "ignored",
      bad: 42,
      empty: "   ",
    },
    reactionTriggerAnyMessage: true,
  });
  assert.equal(config.enabled, true);
  assert.equal(config.anyMessage, true);
  assert.deepEqual(Object.keys(config.triggers).sort(), ["+1", "check"]);
  assert.equal(config.triggers["+1"], "Proceed with it.");
  assert.equal(config.triggers.check, "Ship it");

  const long = resolveReactionTriggerConfig({
    reactionTriggers: { "+1": "x".repeat(900) },
  });
  assert.equal(long.triggers["+1"].length, 500);
});

// ── Matching ────────────────────────────────────────────────────────────────

test("matchReactionTrigger: matches an add of a configured emoji", () => {
  const config = resolveReactionTriggerConfig({
    reactionTriggers: { "+1": "Proceed with the proposed step." },
  });
  const matched = matchReactionTrigger(reactionEvent(), config);
  assert.ok(matched);
  assert.equal(matched.emoji, "+1");
  assert.equal(matched.instruction, "Proceed with the proposed step.");
  assert.equal(matched.messageId, "1001");
  assert.equal(matched.userId, "9");
  assert.equal(matched.userEmail, "niyaz@example.com");
  assert.equal(matched.userName, "Niyaz");
});

test("matchReactionTrigger: ignores removes, other emoji and unusable events", () => {
  const config = resolveReactionTriggerConfig({ reactionTriggers: { "+1": "go" } });
  assert.equal(matchReactionTrigger(reactionEvent({ op: "remove" }), config), undefined);
  assert.equal(matchReactionTrigger(reactionEvent({ emoji_name: "tada" }), config), undefined);
  assert.equal(matchReactionTrigger(reactionEvent({ type: "message" }), config), undefined);
  assert.equal(matchReactionTrigger(reactionEvent({ message_id: undefined }), config), undefined);
  assert.equal(matchReactionTrigger(reactionEvent({ user_id: undefined, user: {} }), config), undefined);
  assert.equal(matchReactionTrigger(reactionEvent({ emoji_name: null }), config), undefined);
  assert.equal(matchReactionTrigger(undefined, config), undefined);
  assert.equal(matchReactionTrigger(reactionEvent(), resolveReactionTriggerConfig()), undefined);
});

test("matchReactionTrigger: normalises colons on both sides", () => {
  const config = resolveReactionTriggerConfig({ reactionTriggers: { check: "go" } });
  assert.equal(matchReactionTrigger(reactionEvent({ emoji_name: ":check:" }), config)?.emoji, "check");
});

// ── Eligibility ─────────────────────────────────────────────────────────────

test("isEligibleTargetMessage: only the bot's own stream messages by default", () => {
  const opts = { anyMessage: false, botUserId: BOT_ID, botEmail: BOT_EMAIL };
  assert.equal(isEligibleTargetMessage(targetMessage(), opts), true);
  assert.equal(
    isEligibleTargetMessage(targetMessage({ sender_id: "99", sender_email: BOT_EMAIL }), opts),
    true,
    "email match is enough when the id is absent/other",
  );
  assert.equal(
    isEligibleTargetMessage(
      targetMessage({ sender_id: "99", sender_email: "someone@example.com" }),
      opts,
    ),
    false,
    "a human's message must not be triggerable by default",
  );
  assert.equal(isEligibleTargetMessage(targetMessage({ type: "private" }), opts), false);
  assert.equal(isEligibleTargetMessage(undefined, opts), false);
});

test("isEligibleTargetMessage: anyMessage relaxes authorship but not the stream requirement", () => {
  const opts = { anyMessage: true, botUserId: BOT_ID, botEmail: BOT_EMAIL };
  assert.equal(
    isEligibleTargetMessage(
      targetMessage({ sender_id: "99", sender_email: "someone@example.com" }),
      opts,
    ),
    true,
  );
  assert.equal(isEligibleTargetMessage(targetMessage({ type: "private" }), opts), false);
});

// ── Synthetic message ───────────────────────────────────────────────────────

test("buildReactionTriggerMessage: carries the reacting human and the instruction", () => {
  const config = resolveReactionTriggerConfig({
    reactionTriggers: { "+1": "Proceed with the proposed step." },
  });
  const matched = matchReactionTrigger(reactionEvent(), config)!;
  const message = buildReactionTriggerMessage({
    target: targetMessage(),
    matched,
    streamName: "main",
    topic: "deploys",
    nowMs: 1_800_000_000_000,
  });

  // The *human* is the sender, so authorisation and rate limiting apply to them.
  assert.equal(message.sender_id, "9");
  assert.equal(message.sender_email, "niyaz@example.com");
  assert.equal(message.sender_full_name, "Niyaz");
  // The original message id is kept so ids/reactions/session context stay consistent.
  assert.equal(message.id, "1001");
  assert.equal(message.type, "stream");
  assert.equal(message.display_recipient, "main");
  assert.equal(message.subject, "deploys");
  assert.equal(message.timestamp, 1_800_000_000);
  // Internal markers drive the mention-gate bypass and the dedupe key.
  assert.equal(message._reactionTrigger, true);
  assert.equal(message._reactionEmoji, "+1");
  assert.equal(message._reactionUserId, "9");

  assert.match(message.content ?? "", /Niyaz reacted with :\+1:/);
  assert.match(message.content ?? "", /#main \/ deploys/);
  assert.match(message.content ?? "", /Instruction: Proceed with the proposed step\./);
});

test("buildReactionTriggerMessage: falls back to a readable identity and stream label", () => {
  const config = resolveReactionTriggerConfig({ reactionTriggers: { "+1": "go" } });
  const matched = matchReactionTrigger(
    reactionEvent({ user: { id: 9 } }),
    config,
  )!;
  const message = buildReactionTriggerMessage({
    target: targetMessage({ subject: undefined }),
    matched,
    streamName: "main",
    topic: "general",
  });
  assert.equal(message.sender_full_name, "9");
  assert.match(message.content ?? "", /#main \/ general/);
});

// ── Dedupe key ──────────────────────────────────────────────────────────────

test("reactionDedupeKey: one dispatch per message, emoji and user", () => {
  const base = { messageId: "1001", emoji: "+1", userId: "9" };
  const key = reactionDedupeKey("default", base);
  assert.equal(key, "reaction:default:1001:+1:9");
  assert.notEqual(key, reactionDedupeKey("default", { ...base, emoji: "check" }));
  assert.notEqual(key, reactionDedupeKey("default", { ...base, userId: "10" }));
  assert.notEqual(key, reactionDedupeKey("other", base));
  // Never collides with the plain inbound message key for the same message.
  assert.notEqual(key, `default:1001`);
});
