import type { ZulipClient, ZulipMessage } from "./client.js";
import { addReactionSafe, removeReactionSafe } from "./reactions.js";
import { formatZulipLog, maskPII } from "./monitor-helpers.js";

/**
 * Reaction info from the Zulip API. The ZulipMessage type doesn't include
 * reactions by default, but the /messages endpoint returns them.
 */
interface MessageReaction {
  emoji_name: string;
  user?: { email: string; id: number };
  user_id?: number;
}

interface MessageWithReactions extends ZulipMessage {
  reactions?: MessageReaction[];
}

/**
 * Recovers interrupted messages after a gateway restart.
 *
 * When the gateway restarts mid-flight, messages that were being processed
 * have a 👀 reaction from the bot but no ✅ or ⚠️ reaction and no response.
 * This function finds those messages and re-dispatches them.
 *
 * @returns The number of messages recovered.
 */
export async function recoverInterruptedMessages(params: {
  client: ZulipClient;
  botEmail: string;
  botUserId: string;
  botUsername: string;
  baseUrl: string;
  accountId: string;
  reactionStart: string;
  reactionSuccess: string;
  reactionError: string;
  reactionsEnabled: boolean;
  logVerboseMessage: (msg: string) => void;
  logger?: { info?: (msg: string, data?: any) => void; error?: (msg: string, data?: any) => void };
  handleMessage: (message: ZulipMessage) => Promise<void>;
}): Promise<number> {
  const {
    client,
    botEmail,
    botUserId,
    accountId,
    reactionStart,
    reactionSuccess,
    reactionError,
    reactionsEnabled,
    logVerboseMessage,
    logger,
    handleMessage,
  } = params;

  let recovered = 0;

  try {
    // Fetch recent messages from all DMs involving the bot.
    // We use the Zulip API directly with a narrow for private messages.
    const narrow = JSON.stringify([{ operator: "is", operand: "private" }]);
    const qs = new URLSearchParams({
      anchor: "newest",
      num_before: "50",
      num_after: "0",
      narrow,
    });

    const payload = await client.request<{
      messages?: MessageWithReactions[];
      result: string;
      msg?: string;
    }>(`/messages?${qs.toString()}`);

    if (payload.result !== "success" || !payload.messages) {
      logger?.info?.("zulip recovery: no messages to scan", { accountId });
      return 0;
    }

    const messages = payload.messages;
    logger?.info?.("zulip recovery: scanning messages for stale reactions", {
      accountId,
      messageCount: messages.length,
    });

    // Build a set of message IDs that have responses from the bot.
    const respondedIds = new Set<string>();
    for (const msg of messages) {
      const senderEmail = msg.sender_email || "";
      const senderId = String(msg.sender_id ?? "");
      if (senderEmail === botEmail || senderId === botUserId) {
        // This is a message FROM the bot (a response).
        // The parent message (the one before it) was responded to.
        respondedIds.add(String(msg.id));
      }
    }

    for (const msg of messages) {
      const messageId = String(msg.id ?? "");
      if (!messageId) continue;

      const senderEmail = msg.sender_email || "";
      const senderId = String(msg.sender_id ?? "");

      // Skip messages from the bot itself.
      if (senderEmail === botEmail || senderId === botUserId) continue;

      // Check if the bot has a 👀 reaction on this message.
      const reactions = msg.reactions ?? [];
      const hasStartReaction = reactions.some(
        (r) =>
          r.emoji_name === reactionStart &&
          (r.user?.email === botEmail || String(r.user?.id ?? r.user_id ?? "") === botUserId),
      );

      if (!hasStartReaction) continue;

      // Check if the bot has a ✅ or ⚠️ reaction (processing completed).
      const hasEndReaction = reactions.some(
        (r) =>
          (r.emoji_name === reactionSuccess || r.emoji_name === reactionError) &&
          (r.user?.email === botEmail || String(r.user?.id ?? r.user_id ?? "") === botUserId),
      );

      if (hasEndReaction) continue;

      // Check if there's a response from the bot after this message.
      const msgIndex = messages.indexOf(msg);
      const hasResponse = messages.slice(msgIndex + 1).some((m) => {
        const mSenderEmail = m.sender_email || "";
        const mSenderId = String(m.sender_id ?? "");
        return mSenderEmail === botEmail || mSenderId === botUserId;
      });

      if (hasResponse) continue;

      // This message was interrupted. Re-dispatch it.
      logger?.info?.("zulip recovery: re-dispatching interrupted message", {
        accountId,
        messageId,
        senderEmail: maskPII(senderEmail),
      });

      // Remove the stale 👀 reaction.
      if (reactionsEnabled) {
        await removeReactionSafe({
          client,
          messageId,
          emojiName: reactionStart,
          reactionsEnabled,
          logVerbose: logVerboseMessage,
        }).catch(() => {});
      }

      // Re-dispatch the message.
      await handleMessage(msg);
      recovered++;
    }

    logger?.info?.("zulip recovery: complete", {
      accountId,
      recovered,
    });
  } catch (err) {
    logger?.error?.("zulip recovery: failed", {
      accountId,
      error: String(err),
    });
  }

  return recovered;
}
