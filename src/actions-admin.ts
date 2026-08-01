import { readStringParam, readNumberParam, jsonResult } from "./actions-utils.js";
import type { ResolvedZulipAccount } from "./zulip/accounts.js";
import type { ZulipClient } from "./zulip/client.js";
import {
  splitStreamTarget,
  readStreamId,
  readUserIdParam,
  readUserIdOrEmailParam,
  readBooleanParam,
  parseStringArrayParam,
  readRealmUpdateParams,
  resolveTopicName,
  readMessageId,
  assertStringLength,
  requireAdminActionsEnabled,
  requireZulipAdmin,
  MAX_STRING_LENGTH,
} from "./actions-utils.js";
import {
  fetchZulipSubscriptions,
  fetchZulipStreams,
  subscribeZulipStream,
  createZulipStream,
  updateZulipStream,
  resolveZulipStreamId,
  deleteZulipStream,
  fetchZulipMemberInfo,
  fetchZulipUserPresence,
  deactivateZulipUser,
  reactivateZulipUser,
  fetchZulipServerSettings,
  updateZulipRealm,
  inviteZulipUsersToStream,
  fetchZulipMessages,
  updateZulipMessageTopic,
} from "./zulip/client.js";

export async function handleChannelListAction(
  client: ZulipClient,
  params: Record<string, unknown>,
) {
  const includeAllPublic =
    params.includeAllPublic === true ||
    params.includePublic === true ||
    params.allPublic === true ||
    params.all === true;
  const subscriptions = await fetchZulipSubscriptions(client, {
    includeAllPublic,
  });
  const publicStreams = includeAllPublic ? await fetchZulipStreams(client) : undefined;
  return jsonResult({
    ok: true,
    subscriptions,
    ...(publicStreams ? { publicStreams } : {}),
  });
}

export async function handleChannelSubscribeAction(
  client: ZulipClient,
  params: Record<string, unknown>,
) {
  const raw =
    readStringParam(params, "stream") ??
    readStringParam(params, "channelId") ??
    readStringParam(params, "to", { required: true });
  const target = splitStreamTarget(raw);
  const result = await subscribeZulipStream(client, target.stream);
  return jsonResult({ ok: true, stream: target.stream, result });
}

export async function handleChannelCreateAction(
  client: ZulipClient,
  params: Record<string, unknown>,
  account: ResolvedZulipAccount,
) {
  requireAdminActionsEnabled(account);
  const raw =
    readStringParam(params, "stream") ??
    readStringParam(params, "name") ??
    readStringParam(params, "channelId") ??
    readStringParam(params, "to", { required: true });
  const target = splitStreamTarget(raw);
  const description = readStringParam(params, "description", { allowEmpty: true });
  if (description !== undefined) {
    assertStringLength(description, "description", MAX_STRING_LENGTH);
  }
  const principals =
    parseStringArrayParam(params, "principals") ?? parseStringArrayParam(params, "principal");
  const announce = readBooleanParam(params, "announce");
  const inviteOnly = readBooleanParam(
    params,
    "inviteOnly",
    "invite_only",
    "isPrivate",
    "is_private",
  );
  const isWebPublic = readBooleanParam(params, "isWebPublic", "is_web_public");
  const isDefaultStream = readBooleanParam(
    params,
    "isDefaultStream",
    "is_default_stream",
    "defaultStream",
  );
  const historyPublicToSubscribers = readBooleanParam(
    params,
    "historyPublicToSubscribers",
    "history_public_to_subscribers",
  );
  await createZulipStream(client, {
    name: target.stream,
    description: description ?? undefined,
    principals: principals && principals.length > 0 ? principals : undefined,
    announce,
    inviteOnly,
    isWebPublic,
    isDefaultStream,
    historyPublicToSubscribers,
  });
  return jsonResult({ ok: true, stream: target.stream });
}

export async function handleChannelEditAction(
  client: ZulipClient,
  params: Record<string, unknown>,
  account: ResolvedZulipAccount,
) {
  requireAdminActionsEnabled(account);
  const streamIdOrName = readStreamId(params);
  const description = readStringParam(params, "description", { allowEmpty: true });
  const newName = readStringParam(params, "newName") ?? readStringParam(params, "name");
  if (description !== undefined) {
    assertStringLength(description, "description", MAX_STRING_LENGTH);
  }
  if (newName !== undefined) {
    assertStringLength(newName, "name", MAX_STRING_LENGTH);
  }
  const isPrivate = readBooleanParam(
    params,
    "isPrivate",
    "inviteOnly",
    "invite_only",
    "is_private",
  );
  const isWebPublic = readBooleanParam(params, "isWebPublic", "is_web_public");
  const historyPublicToSubscribers = readBooleanParam(
    params,
    "historyPublicToSubscribers",
    "history_public_to_subscribers",
  );
  const isDefaultStream = readBooleanParam(params, "isDefaultStream", "is_default_stream");

  if (
    description === undefined &&
    newName === undefined &&
    isPrivate === undefined &&
    isWebPublic === undefined &&
    historyPublicToSubscribers === undefined &&
    isDefaultStream === undefined
  ) {
    throw new Error("At least one field is required to update a Zulip channel.");
  }

  // Resolve stream name to ID if necessary
  const streamId = await resolveZulipStreamId(client, streamIdOrName);

  await updateZulipStream(client, {
    streamId,
    description: description ?? undefined,
    newName: newName ?? undefined,
    isPrivate,
    isWebPublic,
    historyPublicToSubscribers,
    isDefaultStream,
  });
  return jsonResult({ ok: true, streamId, ...(newName ? { name: newName } : {}) });
}

export async function handleChannelDeleteAction(
  client: ZulipClient,
  params: Record<string, unknown>,
  account: ResolvedZulipAccount,
) {
  requireAdminActionsEnabled(account);
  const confirm = readBooleanParam(params, "confirm", "confirmed", "acknowledge");
  if (confirm !== true) {
    throw new Error(
      "Channel deletion requires confirm: true. " +
      "This action permanently removes the stream and its message history from Zulip.",
    );
  }
  const streamIdOrName = readStreamId(params);
  // Resolve stream name to ID if necessary
  const streamId = await resolveZulipStreamId(client, streamIdOrName);
  await deleteZulipStream(client, streamId);
  return jsonResult({ ok: true, streamId });
}

export async function handleMemberInfoAction(
  client: ZulipClient,
  params: Record<string, unknown>,
) {
  const userId =
    readStringParam(params, "userId") ??
    readStringParam(params, "memberId") ??
    readStringParam(params, "id") ??
    readStringParam(params, "user");
  const user = await fetchZulipMemberInfo(client, userId ?? undefined);
  return jsonResult({ ok: true, user });
}

export async function handleUserPresenceAction(
  client: ZulipClient,
  params: Record<string, unknown>,
) {
  const userIdOrEmail = readUserIdOrEmailParam(params);
  const presence = await fetchZulipUserPresence(client, userIdOrEmail);
  return jsonResult({ ok: true, user: userIdOrEmail, presence });
}

export async function handleUserDeactivateAction(
  client: ZulipClient,
  params: Record<string, unknown>,
  account: ResolvedZulipAccount,
) {
  requireAdminActionsEnabled(account);
  await requireZulipAdmin(client);
  const confirm = readBooleanParam(params, "confirm", "confirmed", "acknowledge");
  if (confirm !== true) {
    throw new Error(
      "User deactivation requires confirm: true. " +
      "This action disables the user's Zulip account and removes their login access.",
    );
  }
  const userId = readUserIdParam(params);
  await deactivateZulipUser(client, userId);
  return jsonResult({ ok: true, userId, deactivated: true });
}

export async function handleUserReactivateAction(
  client: ZulipClient,
  params: Record<string, unknown>,
  account: ResolvedZulipAccount,
) {
  requireAdminActionsEnabled(account);
  await requireZulipAdmin(client);
  const confirm = readBooleanParam(params, "confirm", "confirmed", "acknowledge");
  if (confirm !== true) {
    throw new Error(
      "User reactivation requires confirm: true. " +
      "This action restores a previously deactivated Zulip user account.",
    );
  }
  const userId = readUserIdParam(params);
  await reactivateZulipUser(client, userId);
  return jsonResult({ ok: true, userId, reactivated: true });
}

export async function handleOrgSettingsAction(
  client: ZulipClient,
  params: Record<string, unknown>,
) {
  const settings = await fetchZulipServerSettings(client);
  return jsonResult({ ok: true, settings });
}

export async function handleOrgSettingsEditAction(
  client: ZulipClient,
  params: Record<string, unknown>,
  account: ResolvedZulipAccount,
) {
  requireAdminActionsEnabled(account);
  await requireZulipAdmin(client);
  const confirm = readBooleanParam(params, "confirm", "confirmed", "acknowledge");
  if (confirm !== true) {
    throw new Error(
      "Organization settings update requires confirm: true. " +
      "This action modifies global Zulip realm configuration.",
    );
  }
  const updates = readRealmUpdateParams(params);
  await updateZulipRealm(client, updates);
  return jsonResult({ ok: true, updated: Object.keys(updates) });
}

export async function handleInviteAction(
  client: ZulipClient,
  params: Record<string, unknown>,
) {
  const raw =
    readStringParam(params, "stream") ??
    readStringParam(params, "channelId") ??
    readStringParam(params, "to", { required: true });
  const target = splitStreamTarget(raw);
  let principals =
    parseStringArrayParam(params, "principals") ??
    parseStringArrayParam(params, "principal") ??
    parseStringArrayParam(params, "userIds") ??
    parseStringArrayParam(params, "users");
  // Support comma-separated string for userId param (message tool compat)
  if ((!principals || principals.length === 0) && typeof params.userId === "string") {
    principals = params.userId
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
  }
  if (!principals || principals.length === 0) {
    throw new Error("principals are required to invite Zulip users to a stream.");
  }
  for (const principal of principals) {
    if (typeof principal === "string") {
      assertStringLength(principal, "principal", MAX_STRING_LENGTH);
    }
  }
  await inviteZulipUsersToStream(client, {
    stream: target.stream,
    principals,
  });
  return jsonResult({ ok: true, stream: target.stream, principals });
}

export async function handleResolveTopicAction(
  client: ZulipClient,
  params: Record<string, unknown>,
) {
  const explicitTopic = readStringParam(params, "topic") ?? readStringParam(params, "subject");
  const rawStream =
    readStringParam(params, "stream") ??
    readStringParam(params, "channelId") ??
    readStringParam(params, "to");
  const target = rawStream ? splitStreamTarget(rawStream) : undefined;
  const topic = explicitTopic ?? target?.topic;

  if (!topic) {
    throw new Error("topic is required to resolve a Zulip topic.");
  }

  assertStringLength(topic, "topic", MAX_STRING_LENGTH);
  const { topic: resolvedTopic, alreadyResolved } = resolveTopicName(topic);
  if (alreadyResolved) {
    return jsonResult({ ok: true, topic, resolvedTopic, alreadyResolved: true });
  }

  const messageId = (() => {
    try {
      return readMessageId(params);
    } catch {
      return undefined;
    }
  })();

  let targetMessageId = messageId;
  if (!targetMessageId) {
    if (!target?.stream) {
      throw new Error(
        "stream is required to resolve a Zulip topic when messageId is not provided.",
      );
    }
    const messages = await fetchZulipMessages(client, {
      stream: target.stream,
      topic,
      limit: 1,
    });
    const latest = messages[0];
    if (!latest?.id) {
      throw new Error("No messages found for the specified stream/topic.");
    }
    targetMessageId = String(latest.id);
  }

  await updateZulipMessageTopic(client, {
    messageId: targetMessageId,
    topic: resolvedTopic,
    propagateMode: "change_all",
  });

  return jsonResult({
    ok: true,
    stream: target?.stream,
    topic,
    resolvedTopic,
    messageId: targetMessageId,
  });
}
