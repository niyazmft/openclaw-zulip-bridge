/**
 * In-channel action triggers via reactions (#297).
 *
 * The bridge is read/send only: a human cannot say "go" from inside the topic
 * and have the agent act there. This is the cheap half of #297 — a
 * **reaction → action** mapping. A human reacts with a configured emoji on the
 * bot's own proposal, and the plugin turns that into an explicit turn for the
 * same stream/topic session, so the work and the discussion stay connected.
 *
 * Deliberately NOT in v1: launching named workflows/runs through a new runtime
 * surface. A trigger is an *instruction to the agent that is already in this
 * conversation*, which keeps the blast radius identical to a normal message.
 *
 * Safety properties (each is load-bearing):
 * - **The reaction is only a trigger, never an authorisation bypass.** The
 *   synthetic turn is dispatched through the same path as a real message, so
 *   `dmPolicy`/`groupPolicy`, the allowlists, the store allowlist, the control
 *   command gate and the per-sender rate limit all still apply — to the human
 *   who reacted.
 * - **Only the bot's own messages are actionable** by default. Reacting 👍 on
 *   someone else's message must not be a way to make the agent act on it.
 * - **Idempotent per reaction**: the dedupe key includes message, emoji and
 *   user, so replays, double events and repeated taps fire once.
 * - **Off by default**: no `reactionTriggers` config means no trigger emoji is
 *   recognised and the reaction event type is not requested at all.
 */

import type { ZulipMessage } from "./client.js";
import { normalizeZulipEmojiName } from "./uploads.js";

export type ReactionTriggerConfig = {
  enabled: boolean;
  /** Normalised emoji name → instruction dispatched to the agent. */
  triggers: Record<string, string>;
  /** Allow triggering from messages the bot did not author (default false). */
  anyMessage: boolean;
};

export type ReactionTriggerInput = {
  reactionTriggers?: unknown;
  reactionTriggerAnyMessage?: boolean;
};

export type ZulipReactionEvent = {
  type?: string;
  op?: string;
  message_id?: number | string | null;
  emoji_name?: string | null;
  user_id?: number | string | null;
  user?: { id?: number | string | null; email?: string | null; full_name?: string | null } | null;
};

export type MatchedReactionTrigger = {
  /** Normalised emoji name as configured. */
  emoji: string;
  instruction: string;
  messageId: string;
  userId: string;
  userEmail?: string;
  userName?: string;
};

const MAX_INSTRUCTION_LENGTH = 500;

/** Reads the emoji → instruction map, ignoring malformed entries. */
function readTriggers(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const triggers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const emoji = normalizeZulipEmojiName(key);
    const instruction = value.replace(/\s+/g, " ").trim().slice(0, MAX_INSTRUCTION_LENGTH);
    if (!emoji || !instruction) continue;
    triggers[emoji] = instruction;
  }
  return triggers;
}

export function resolveReactionTriggerConfig(
  input?: ReactionTriggerInput,
): ReactionTriggerConfig {
  const triggers = readTriggers(input?.reactionTriggers);
  return {
    enabled: Object.keys(triggers).length > 0,
    triggers,
    anyMessage: input?.reactionTriggerAnyMessage === true,
  };
}

/**
 * Matches a Zulip `reaction` event against the configured triggers.
 *
 * Returns `undefined` for anything that is not an "add" of a configured emoji
 * with a usable message/user identity — those are silently not triggers, not
 * errors.
 */
export function matchReactionTrigger(
  event: ZulipReactionEvent | undefined,
  config: ReactionTriggerConfig,
): MatchedReactionTrigger | undefined {
  if (!config.enabled || !event) return undefined;
  if (event.type !== "reaction" || event.op !== "add") return undefined;

  const messageId = event.message_id == null ? "" : String(event.message_id).trim();
  if (!messageId) return undefined;

  const emoji = normalizeZulipEmojiName(event.emoji_name ?? "");
  const instruction = emoji ? config.triggers[emoji] : undefined;
  if (!emoji || !instruction) return undefined;

  const userId = String(event.user_id ?? event.user?.id ?? "").trim();
  if (!userId) return undefined;

  return {
    emoji,
    instruction,
    messageId,
    userId,
    userEmail: event.user?.email?.trim() || undefined,
    userName: event.user?.full_name?.trim() || undefined,
  };
}

/**
 * Whether the reacted message may be triggered on.
 *
 * `onlyOwnMessages` (the default) is the safety rule: a reaction is an approval
 * of the *agent's* proposal, so a reaction on anyone else's message is ignored.
 */
export function isEligibleTargetMessage(
  message: ZulipMessage | undefined,
  opts: { anyMessage: boolean; botUserId?: string; botEmail?: string },
): boolean {
  if (!message) return false;
  if (message.type !== "stream") return false;
  if (opts.anyMessage) return true;
  const senderId = String(message.sender_id ?? "").trim();
  if (opts.botUserId && senderId && senderId === String(opts.botUserId)) return true;
  const senderEmail = (message.sender_email ?? "").trim().toLowerCase();
  if (opts.botEmail && senderEmail && senderEmail === opts.botEmail.trim().toLowerCase()) {
    return true;
  }
  return false;
}

/**
 * Builds the synthetic inbound message for a matched trigger.
 *
 * It carries the *reacting human* as the sender so every authorisation and
 * rate-limit decision is made about them, and the original message id so ids,
 * reactions and session context stay consistent. The internal fields are what
 * let the message handler skip the "did a human address the bot?" gates while
 * keeping the policy ones (see monitor.ts).
 */
export function buildReactionTriggerMessage(params: {
  target: ZulipMessage;
  matched: MatchedReactionTrigger;
  streamName: string;
  topic: string;
  nowMs?: number;
}): ZulipMessage {
  const { target, matched } = params;
  const where = params.topic ? `#${params.streamName} / ${params.topic}` : `#${params.streamName}`;
  const who = matched.userName || matched.userEmail || matched.userId;
  const content = [
    `[Zulip reaction] ${who} reacted with :${matched.emoji}: to your message in ${where}.`,
    `Instruction: ${matched.instruction}`,
  ].join("\n");

  return {
    id: String(target.id),
    sender_id: matched.userId,
    sender_email: matched.userEmail ?? null,
    sender_full_name: matched.userName ?? matched.userEmail ?? matched.userId,
    content: `<p>${content}</p>`,
    timestamp: Math.floor((params.nowMs ?? Date.now()) / 1000),
    type: "stream",
    display_recipient: params.streamName,
    subject: params.topic,
    stream_id: target.stream_id ?? null,
    _reactionTrigger: true,
    _reactionEmoji: matched.emoji,
    _reactionUserId: matched.userId,
    _reactionInstruction: matched.instruction,
  } as ZulipMessage;
}

/** Stable dedupe key: one dispatch per (message, emoji, user). */
export function reactionDedupeKey(
  accountId: string,
  parts: { messageId: string; emoji: string; userId: string },
): string {
  return `reaction:${accountId}:${parts.messageId}:${parts.emoji}:${parts.userId}`;
}

/**
 * Monitored streams the bot is not subscribed to.
 *
 * Zulip only delivers `reaction` events for messages in streams the user is
 * **subscribed** to, while `message` events arrive anyway when the queue was
 * registered with `all_public_streams`. The mismatch makes reaction triggers
 * fail silently, so the missing set is surfaced at startup.
 *
 * `"*"` cannot be enumerated, so it returns `[]` and the caller reports the
 * subscribed list instead of pretending it checked.
 */
export function findUnsubscribedStreams(params: {
  monitored: string[];
  subscribed: string[];
}): string[] {
  if (params.monitored.includes("*")) return [];
  const subscribed = new Set(
    params.subscribed.map((name) => name.trim().toLowerCase()).filter(Boolean),
  );
  return params.monitored.filter((name) => {
    const trimmed = name.trim();
    return Boolean(trimmed) && !subscribed.has(trimmed.toLowerCase());
  });
}
