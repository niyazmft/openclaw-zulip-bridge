import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import { readStringParam, readNumberParam, jsonResult } from "openclaw/plugin-sdk/channel-core";

// Re-export for other action files to avoid duplicate CJS require() calls
// that can cause "is not a function" errors in the bundled CJS build.
export { readStringParam, readNumberParam, jsonResult };
import { resolveZulipAccount } from "./zulip/accounts.js";
import type { ResolvedZulipAccount } from "./zulip/accounts.js";
import { createZulipClient, normalizeZulipBaseUrl, fetchZulipMemberInfo } from "./zulip/client.js";
import type { ZulipClient } from "./zulip/client.js";

export const providerId = "zulip";
export const MAX_STRING_LENGTH = 10000;
export const SAFE_REALM_SETTINGS = [
  "name",
  "description",
  "default_language",
  "notifications_stream_id",
  "signup_notifications_stream_id",
  "message_retention_days",
];

export type StreamTarget = {
  stream: string;
  topic?: string;
};

export type SendTarget =
  | { kind: "stream"; stream: string; topic: string }
  | { kind: "user"; email: string };

export function resolveZulipClient(cfg: OpenClawConfig, accountId?: string | null) {
  const account = resolveZulipAccount({ cfg, accountId });
  const apiKey = account.apiKey?.trim();
  const email = account.email?.trim();
  if (!apiKey || !email) {
    throw new Error(
      `Zulip apiKey/email missing for account "${account.accountId}" (set channels.zulip.accounts.${account.accountId}.apiKey/email or ZULIP_API_KEY/ZULIP_EMAIL for default).`,
    );
  }
  const baseUrl = normalizeZulipBaseUrl(account.baseUrl);
  if (!baseUrl) {
    throw new Error(
      `Zulip url missing for account "${account.accountId}" (set channels.zulip.accounts.${account.accountId}.url or ZULIP_URL for default).`,
    );
  }
  return {
    account,
    client: createZulipClient({ baseUrl, apiKey, email }),
  };
}

export function requireAdminActionsEnabled(account: ResolvedZulipAccount): void {
  if (!account.enableAdminActions) {
    throw new Error("Admin actions require enableAdminActions: true in Zulip config");
  }
}

export async function requireZulipAdmin(client: ZulipClient): Promise<void> {
  const me = await fetchZulipMemberInfo(client, "me");
  if (!me.is_admin) {
    throw new Error("Zulip admin privileges are required for this action.");
  }
}

export function splitStreamTarget(raw: string): StreamTarget {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Stream is required for Zulip channel actions.");
  }

  const lower = trimmed.toLowerCase();
  let candidate = trimmed;
  if (lower.startsWith("stream:")) {
    candidate = trimmed.slice("stream:".length).trim();
  } else if (trimmed.startsWith("#")) {
    candidate = trimmed.slice(1).trim();
  }

  if (!candidate) {
    throw new Error("Stream name is required for Zulip channel actions.");
  }

  let stream = candidate;
  let topic: string | undefined;
  const topicMatch = /(?:^|\s)topic:\s*(.+)$/i.exec(candidate);
  if (topicMatch) {
    stream = candidate.slice(0, topicMatch.index).trim();
    topic = topicMatch[1].trim();
  } else {
    const sepIndex = candidate.search(/[\/#]/);
    if (sepIndex > -1) {
      stream = candidate.slice(0, sepIndex).trim();
      topic = candidate.slice(sepIndex + 1).trim();
    }
  }

  if (!stream) {
    throw new Error("Stream name is required for Zulip channel actions.");
  }

  assertStringLength(stream, "stream", MAX_STRING_LENGTH);
  if (topic) {
    assertStringLength(topic, "topic", MAX_STRING_LENGTH);
  }

  return { stream, topic: topic || undefined };
}

export function parseSendTarget(raw: string): SendTarget {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Recipient is required for Zulip sends.");
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("stream:")) {
    const rest = trimmed.slice("stream:".length).trim();
    if (!rest) {
      throw new Error("Stream name is required for Zulip sends.");
    }
    const sepIndex = rest.indexOf(":");
    if (sepIndex === -1) {
      throw new Error("Topic is required for Zulip stream sends.");
    }
    const stream = rest.slice(0, sepIndex).trim();
    const topic = rest.slice(sepIndex + 1).trim();
    if (!stream) {
      throw new Error("Stream name is required for Zulip sends.");
    }
    if (!topic) {
      throw new Error("Topic is required for Zulip stream sends.");
    }
    assertStringLength(stream, "stream", MAX_STRING_LENGTH);
    assertStringLength(topic, "topic", MAX_STRING_LENGTH);
    return { kind: "stream", stream, topic };
  }

  if (lower.startsWith("user:")) {
    const email = trimmed.slice("user:".length).trim();
    if (!email) {
      throw new Error("Email is required for Zulip direct messages.");
    }
    assertStringLength(email, "email", MAX_STRING_LENGTH);
    return { kind: "user", email };
  }

  throw new Error("Invalid Zulip send target; use stream:{stream}:{topic} or user:{email}.");
}

export function assertStringLength(value: string, field: string, max = MAX_STRING_LENGTH): void {
  if (value.length > max) {
    throw new Error(`${field} must be ${max} characters or fewer.`);
  }
}

export function readMessageId(params: Record<string, unknown>): string {
  const messageId = readStringParam(params, "messageId") ?? readStringParam(params, "id");
  if (messageId) {
    return messageId;
  }
  const numericId =
    readNumberParam(params, "messageId", { integer: true }) ??
    readNumberParam(params, "id", { integer: true });
  if (typeof numericId === "number") {
    return String(numericId);
  }
  throw new Error("messageId is required for Zulip message actions.");
}

export function readMessageContent(params: Record<string, unknown>): string {
  const content =
    readStringParam(params, "message", { allowEmpty: true }) ??
    readStringParam(params, "text", { allowEmpty: true }) ??
    readStringParam(params, "content", { allowEmpty: true }) ??
    readStringParam(params, "newText", { allowEmpty: true });
  if (content === undefined) {
    throw new Error("message content is required for Zulip edit actions.");
  }
  assertStringLength(content, "message", MAX_STRING_LENGTH);
  return content;
}

export function readSendMessageContent(params: Record<string, unknown>): string {
  const content =
    readStringParam(params, "message", { allowEmpty: true }) ??
    readStringParam(params, "text", { allowEmpty: true }) ??
    readStringParam(params, "content", { allowEmpty: true }) ??
    readStringParam(params, "newText", { allowEmpty: true });
  if (content === undefined) {
    throw new Error("message content is required for Zulip sends.");
  }
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Zulip message is empty.");
  }
  assertStringLength(trimmed, "message", MAX_STRING_LENGTH);
  return trimmed;
}

export const resolvedTopicPrefixes = ["✔", "✅"];

export function resolveTopicName(topic: string): { topic: string; alreadyResolved: boolean } {
  const trimmed = topic.trim();
  if (!trimmed) {
    return { topic: trimmed, alreadyResolved: false };
  }
  const alreadyResolved = resolvedTopicPrefixes.some((prefix) => trimmed.startsWith(prefix));
  if (alreadyResolved) {
    return { topic: trimmed, alreadyResolved: true };
  }
  return { topic: `✔ ${trimmed}`, alreadyResolved: false };
}

export function parseBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "n", "off"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

export function readBooleanParam(params: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      const parsed = parseBooleanValue(params[key]);
      if (parsed !== undefined) {
        return parsed;
      }
    }
  }
  return undefined;
}

export function parseStringArrayParam(
  params: Record<string, unknown>,
  key: string,
): Array<string | number> | undefined {
  if (!Object.prototype.hasOwnProperty.call(params, key)) {
    return undefined;
  }
  const raw = params[key];
  if (Array.isArray(raw)) {
    return raw as Array<string | number>;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return [];
    }
    return trimmed
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof raw === "number") {
    return [raw];
  }
  return undefined;
}

export function readStreamId(params: Record<string, unknown>): string {
  const streamId =
    readStringParam(params, "streamId") ??
    readStringParam(params, "channelId") ??
    readStringParam(params, "id");
  if (streamId) {
    return streamId;
  }
  const numericId =
    readNumberParam(params, "streamId", { integer: true }) ??
    readNumberParam(params, "channelId", { integer: true }) ??
    readNumberParam(params, "id", { integer: true });
  if (typeof numericId === "number") {
    return String(numericId);
  }
  throw new Error("streamId is required for Zulip channel actions.");
}

export function readUserIdParam(params: Record<string, unknown>): string {
  const userId =
    readStringParam(params, "userId") ??
    readStringParam(params, "memberId") ??
    readStringParam(params, "id") ??
    readStringParam(params, "user");
  if (userId) {
    return userId;
  }
  const numericId =
    readNumberParam(params, "userId", { integer: true }) ??
    readNumberParam(params, "memberId", { integer: true }) ??
    readNumberParam(params, "id", { integer: true });
  if (typeof numericId === "number") {
    return String(numericId);
  }
  throw new Error("userId is required for Zulip user actions.");
}

export function readUserIdOrEmailParam(params: Record<string, unknown>): string {
  const userIdOrEmail =
    readStringParam(params, "userId") ??
    readStringParam(params, "memberId") ??
    readStringParam(params, "id") ??
    readStringParam(params, "user") ??
    readStringParam(params, "email");
  if (userIdOrEmail) {
    return userIdOrEmail;
  }
  const numericId =
    readNumberParam(params, "userId", { integer: true }) ??
    readNumberParam(params, "memberId", { integer: true }) ??
    readNumberParam(params, "id", { integer: true });
  if (typeof numericId === "number") {
    return String(numericId);
  }
  throw new Error("userId or email is required for Zulip presence.");
}

export function readRealmUpdateParams(
  params: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const raw = params.settings ?? params.realm ?? params.updates ?? params.update;
  if (raw === undefined) {
    throw new Error("settings are required to update Zulip organization settings.");
  }
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("settings must be a JSON object or key/value map.");
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("settings must be a key/value object to update Zulip organization settings.");
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) {
    throw new Error("settings must include at least one field to update.");
  }
  const updates: Record<string, string | number | boolean> = {};
  for (const [key, value] of entries) {
    if (!SAFE_REALM_SETTINGS.includes(key)) {
      throw new Error(`Unsupported organization setting: ${key}.`);
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      if (typeof value === "string") {
        assertStringLength(value, key, MAX_STRING_LENGTH);
      }
      updates[key] = value;
      continue;
    }
    throw new Error(`Unsupported setting value for ${key}; expected string, number, or boolean.`);
  }
  return updates;
}
