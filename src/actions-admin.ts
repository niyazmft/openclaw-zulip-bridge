import { readStringParam, readNumberParam, jsonResult } from "./actions-utils.js";
import type { ResolvedZulipAccount } from "./zulip/accounts.js";
import type { ZulipClient } from "./zulip/client.js";
import {
  splitStreamTarget,
  readStreamId,
  readBooleanParam,
  parseStringArrayParam,
  assertStringLength,
  requireAdminActionsEnabled,
  MAX_STRING_LENGTH,
} from "./actions-utils.js";
import {
  fetchZulipSubscriptions,
  fetchZulipStreams,
  createZulipStream,
  updateZulipStream,
  resolveZulipStreamId,
  deleteZulipStream,
  fetchZulipMemberInfo,
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
