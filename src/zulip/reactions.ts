import { addZulipReaction, removeZulipReaction } from "./client.js";

/**
 * Safely adds a Zulip reaction, catching and logging errors.
 */
export async function addReactionSafe(params: {
  client: any;
  messageId: string;
  emojiName: string;
  reactionsEnabled: boolean;
  logVerbose: (msg: string) => void;
}): Promise<void> {
  const { client, messageId, emojiName, reactionsEnabled, logVerbose } = params;
  if (!reactionsEnabled || !emojiName) {
    return;
  }
  try {
    await addZulipReaction(client, { messageId, emojiName });
  } catch (err) {
    logVerbose(`zulip: failed to add reaction ${emojiName}: ${String(err)}`);
  }
}

/**
 * Safely removes a Zulip reaction, catching and logging errors.
 */
export async function removeReactionSafe(params: {
  client: any;
  messageId: string;
  emojiName: string;
  reactionsEnabled: boolean;
  logVerbose: (msg: string) => void;
}): Promise<void> {
  const { client, messageId, emojiName, reactionsEnabled, logVerbose } = params;
  if (!reactionsEnabled || !emojiName) {
    return;
  }
  try {
    await removeZulipReaction(client, { messageId, emojiName });
  } catch (err) {
    logVerbose(`zulip: failed to remove reaction ${emojiName}: ${String(err)}`);
  }
}
