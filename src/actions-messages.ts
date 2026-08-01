import { readStringParam, readNumberParam, jsonResult } from "./actions-utils.js";
import {
  splitStreamTarget,
  readMessageId,
  readMessageContent,
  readBooleanParam,
  assertStringLength,
  MAX_STRING_LENGTH,
} from "./actions-utils.js";
import type { ZulipClient } from "./zulip/client.js";
import {
  fetchZulipMessages,
  editZulipMessage,
  deleteZulipMessage,
  addZulipReaction,
  removeZulipReaction,
  updateZulipMessageFlag,
  searchZulipMessages,
} from "./zulip/client.js";

export async function handleReadAction(
  client: ZulipClient,
  params: Record<string, unknown>,
) {
  const raw =
    readStringParam(params, "stream") ??
    readStringParam(params, "channelId") ??
    readStringParam(params, "to", { required: true });
  const target = splitStreamTarget(raw);
  const limit = readNumberParam(params, "limit", { integer: true });
  const explicitTopic = readStringParam(params, "topic");
  const messages = await fetchZulipMessages(client, {
    stream: target.stream,
    topic: explicitTopic ?? target.topic,
    limit: limit ?? undefined,
  });
  return jsonResult({
    ok: true,
    stream: target.stream,
    ...(explicitTopic || target.topic ? { topic: explicitTopic ?? target.topic } : {}),
    messages,
  });
}

export async function handleEditAction(
  client: ZulipClient,
  params: Record<string, unknown>,
) {
  const messageId = readMessageId(params);
  const content = readMessageContent(params);
  await editZulipMessage(client, { messageId, content });
  return jsonResult({ ok: true, edited: messageId });
}

export async function handleDeleteAction(
  client: ZulipClient,
  params: Record<string, unknown>,
) {
  const confirm = readBooleanParam(params, "confirm", "confirmed", "acknowledge");
  if (confirm !== true) {
    throw new Error(
      "Message deletion requires confirm: true. " +
      "This action permanently removes the message from Zulip.",
    );
  }
  const messageId = readMessageId(params);
  await deleteZulipMessage(client, { messageId });
  return jsonResult({ ok: true, deleted: messageId });
}

export async function handleReactAction(
  client: ZulipClient,
  params: Record<string, unknown>,
) {
  const messageId = readMessageId(params);
  const emojiName =
    readStringParam(params, "emoji") ??
    readStringParam(params, "emojiName") ??
    readStringParam(params, "emoji_name");
  const emojiCode =
    readStringParam(params, "emojiCode") ?? readStringParam(params, "emoji_code");
  const reactionType =
    readStringParam(params, "reactionType") ?? readStringParam(params, "reaction_type");
  const remove = params.remove === true;

  if (!emojiName && !remove) {
    throw new Error("Zulip react requires emoji name unless removing reactions.");
  }

  if (remove) {
    await removeZulipReaction(client, {
      messageId,
      emojiName: emojiName ?? undefined,
      emojiCode: emojiCode ?? undefined,
      reactionType: reactionType ?? undefined,
    });
    return jsonResult({ ok: true, removed: true, messageId, emoji: emojiName ?? null });
  }

  await addZulipReaction(client, {
    messageId,
    emojiName: emojiName ?? "",
    emojiCode: emojiCode ?? undefined,
    reactionType: reactionType ?? undefined,
  });
  return jsonResult({ ok: true, added: emojiName, messageId });
}

export async function handlePinAction(
  client: ZulipClient,
  params: Record<string, unknown>,
  action: string,
) {
  const messageId = readMessageId(params);
  // Convert messageId to integer for API call
  const messageIdInt = parseInt(messageId, 10);
  if (isNaN(messageIdInt)) {
    throw new Error(`Invalid messageId: ${messageId}`);
  }
  await updateZulipMessageFlag(client, {
    messageId: messageIdInt,
    flag: "starred",
    op: action === "pin" ? "add" : "remove",
  });
  return jsonResult({
    ok: true,
    messageId,
    starred: action === "pin",
  });
}

export async function handleSearchAction(
  client: ZulipClient,
  params: Record<string, unknown>,
) {
  const query =
    readStringParam(params, "query") ??
    readStringParam(params, "text") ??
    readStringParam(params, "q", { required: true });
  assertStringLength(query, "query", MAX_STRING_LENGTH);
  const rawStream =
    readStringParam(params, "stream") ??
    readStringParam(params, "channelId") ??
    readStringParam(params, "to");
  const explicitTopic = readStringParam(params, "topic");
  const limit = readNumberParam(params, "limit", { integer: true });
  const target = rawStream ? splitStreamTarget(rawStream) : undefined;
  const messages = await searchZulipMessages(client, {
    query,
    stream: target?.stream,
    topic: explicitTopic ?? target?.topic,
    limit: limit ?? undefined,
  });
  return jsonResult({
    ok: true,
    query,
    ...(target?.stream ? { stream: target.stream } : {}),
    ...(explicitTopic || target?.topic ? { topic: explicitTopic ?? target?.topic } : {}),
    messages,
  });
}
