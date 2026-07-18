import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getZulipRuntime } from "../runtime.js";
import { resolveZulipAccount } from "./accounts.js";
import {
  createZulipClient,
  isInternalHost,
  normalizeZulipBaseUrl,
  sendZulipPrivateMessage,
  sendZulipStreamMessage,
  uploadZulipFile,
  type ZulipClient,
} from "./client.js";
import { formatZulipLog, maskPII } from "./monitor-helpers.js";

export type ZulipSendOpts = {
  apiKey?: string;
  email?: string;
  baseUrl?: string;
  accountId?: string;
  mediaUrl?: string;
  topic?: string;
  sessionKey?: string;
  kind?: "dm" | "channel";
};

export type ZulipSendResult = {
  messageId: string;
  channelId: string;
};

type ZulipTarget =
  | { kind: "stream"; stream: string; topic?: string }
  | { kind: "user"; email: string };

const DEFAULT_TOPIC = "general";

const getCore = () => getZulipRuntime();

// ⚡ Optimization: Cache clients per account to avoid repeated Buffer encoding and allocations
const clientCache = new Map<string, ZulipClient>();
// ⚡ Optimization: Cache parsed targets to avoid repeated string parsing
const targetCache = new Map<string, ZulipTarget>();
// Cache limits to prevent unbounded growth
const MAX_CLIENT_CACHE_SIZE = 50;
const MAX_TARGET_CACHE_SIZE = 500;

function getCacheKeyForClient(
  baseUrl: string,
  email: string,
  apiKey: string,
): string {
  // Simple concatenation is faster than JSON.stringify for cache keys
  return `${baseUrl}\0${email}\0${apiKey}`;
}

function getCachedClient(
  baseUrl: string,
  email: string,
  apiKey: string,
): ZulipClient {
  const key = getCacheKeyForClient(baseUrl, email, apiKey);
  const existing = clientCache.get(key);
  if (existing) {
    // Move to end to maintain LRU order (re-insert as most recent)
    clientCache.delete(key);
    clientCache.set(key, existing);
    return existing;
  }
  // Clean up old entries if cache is full (LRU eviction)
  if (clientCache.size >= MAX_CLIENT_CACHE_SIZE) {
    const firstKey = clientCache.keys().next().value;
    if (firstKey !== undefined) {
      clientCache.delete(firstKey);
    }
  }
  const client = createZulipClient({ baseUrl, email, apiKey });
  clientCache.set(key, client);
  return client;
}

function getCachedTarget(raw: string): ZulipTarget {
  const trimmed = raw.trim();
  const existing = targetCache.get(trimmed);
  if (existing) {
    // Move to end to maintain LRU order (re-insert as most recent)
    targetCache.delete(trimmed);
    targetCache.set(trimmed, existing);
    return existing;
  }
  // Parse and cache the result
  const cached = parseZulipTarget(trimmed);
  // Clean up old entries if cache is full (LRU eviction)
  if (targetCache.size >= MAX_TARGET_CACHE_SIZE) {
    const firstKey = targetCache.keys().next().value;
    if (firstKey !== undefined) {
      targetCache.delete(firstKey);
    }
  }
  targetCache.set(trimmed, cached);
  return cached;
}

/**
 * Clear all caches. Useful for testing or when config changes require fresh clients.
 * @internal
 */
export function clearSendCache(): void {
  clientCache.clear();
  targetCache.clear();
}

function normalizeMessage(text: string, mediaUrl?: string): string {
  const trimmed = text.trim();
  const media = mediaUrl?.trim();
  return [trimmed, media].filter(Boolean).join("\n");
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}


async function writeTempFile(buffer: Buffer, filename: string): Promise<string> {
  const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "zulip-upload-"));
  const filePath = path.join(dir, filename);
  await fsPromises.writeFile(filePath, buffer);
  return filePath;
}

function parseZulipTarget(raw: string): ZulipTarget {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Recipient is required for Zulip sends");
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("stream:")) {
    const rest = trimmed.slice("stream:".length).trim();
    if (!rest) {
      throw new Error("Stream name is required for Zulip sends");
    }
    const [stream, topic] = rest.split(/[:#/]/);
    return { kind: "stream", stream: stream.trim(), topic: topic?.trim() };
  }
  if (lower.startsWith("user:") || lower.startsWith("dm:")) {
    const email = trimmed.slice(trimmed.indexOf(":") + 1).trim();
    if (!email) {
      throw new Error("Email is required for Zulip direct messages");
    }
    return { kind: "user", email };
  }
  if (lower.startsWith("zulip:")) {
    const email = trimmed.slice("zulip:".length).trim();
    if (!email) {
      throw new Error("Email is required for Zulip direct messages");
    }
    return { kind: "user", email };
  }
  if (trimmed.startsWith("@")) {
    const email = trimmed.slice(1).trim();
    if (!email) {
      throw new Error("Email is required for Zulip direct messages");
    }
    return { kind: "user", email };
  }
  if (trimmed.startsWith("#")) {
    const rest = trimmed.slice(1).trim();
    const [stream, topic] = rest.split(/[:#/]/);
    if (!stream) {
      throw new Error("Stream name is required for Zulip sends");
    }
    return { kind: "stream", stream: stream.trim(), topic: topic?.trim() };
  }
  if (trimmed.includes("@")) {
    return { kind: "user", email: trimmed };
  }
  return { kind: "stream", stream: trimmed };
}

/**
 * Sends a message to a Zulip stream or user.
 * Security: This function implements "read-and-send" hardening by:
 * 1. Rejecting non-HTTP protocols for `mediaUrl` to prevent local file exfiltration.
 * 2. Downloading remote media to a controlled temporary file before uploading to Zulip.
 * 3. Only calling `uploadZulipFile` with paths to these verified temporary files.
 */
export async function sendMessageZulip(
  to: string,
  text: string,
  opts: ZulipSendOpts = {},
): Promise<ZulipSendResult> {
  const core = getCore();
  const cfg = core.config.current();
  const account = resolveZulipAccount({
    cfg,
    accountId: opts.accountId,
  });
  const apiKey = opts.apiKey?.trim() || account.apiKey?.trim();
  const email = opts.email?.trim() || account.email?.trim();
  if (!apiKey || !email) {
    throw new Error(
      `Zulip apiKey/email missing for account "${account.accountId}" (set channels.zulip.accounts.${account.accountId}.apiKey/email or ZULIP_API_KEY/ZULIP_EMAIL for default).`,
    );
  }
  const baseUrl = normalizeZulipBaseUrl(opts.baseUrl ?? account.baseUrl);
  if (!baseUrl) {
    throw new Error(
      `Zulip url missing for account "${account.accountId}" (set channels.zulip.accounts.${account.accountId}.url or ZULIP_URL for default).`,
    );
  }

  // ⚡ Optimization: Use cached client to avoid repeated Buffer encoding and allocations
  const client = getCachedClient(baseUrl, email, apiKey);
  // ⚡ Optimization: Use cached target parsing to avoid repeated string operations
  const target = getCachedTarget(to);

  const kind = opts.kind || (target.kind === "user" ? "dm" : "channel");
  const stream = target.kind === "stream" ? target.stream : undefined;
  const topic = target.kind === "stream" ? target.topic || opts.topic : undefined;

  core.log?.(
    formatZulipLog("zulip outbound attempt", {
      accountId: account.accountId,
      target: maskPII(to),
      kind,
      stream: stream ? maskPII(stream) : undefined,
      topic,
      sessionKey: opts.sessionKey,
      hasMedia: Boolean(opts.mediaUrl),
    }),
  );

  let message = text?.trim() ?? "";
  const rawMediaUrl = opts.mediaUrl?.trim();
  let mediaUrl = rawMediaUrl;
  let tempFilePath: string | undefined;
  let tempFileCleanup = false;

  if (mediaUrl) {
    const isZulipHosted = isHttpUrl(mediaUrl) && mediaUrl.startsWith(baseUrl);
    const isRemote = isHttpUrl(mediaUrl);

    if (isRemote && !isZulipHosted) {
      // Security: reject internal/private IPs to prevent SSRF via mediaUrl
      if (isInternalHost(mediaUrl)) {
        core.log?.(
          formatZulipLog("zulip outbound security warning: rejected internal mediaUrl", {
            accountId: account.accountId,
            mediaUrl: maskPII(mediaUrl),
          }),
        );
        mediaUrl = undefined;
      } else {
        const maxBytes = (cfg.agents?.defaults?.mediaMaxMb ?? 5) * 1024 * 1024;
        const fetched = await core.channel.media.fetchRemoteMedia({
          url: mediaUrl,
          maxBytes,
        });
        const filename = (() => {
          try {
            return path.basename(new URL(mediaUrl).pathname) || "upload.bin";
          } catch {
            return "upload.bin";
          }
        })();
        if (core.channel.media?.saveMediaBuffer) {
          const saved = await core.channel.media.saveMediaBuffer(
            fetched.buffer,
            fetched.contentType ?? "application/octet-stream",
            "outbound",
            maxBytes,
            filename,
          );
          tempFilePath = saved.path;
        } else {
          tempFilePath = await writeTempFile(fetched.buffer, filename);
          tempFileCleanup = true;
        }
        const upload = await uploadZulipFile(client, tempFilePath);
        mediaUrl = upload.url;
        if (tempFileCleanup && tempFilePath) {
          await fsPromises.unlink(tempFilePath).catch(() => undefined);
          await fsPromises.rm(path.dirname(tempFilePath), { recursive: true, force: true }).catch(() => undefined);
        }
      }
    } else if (!isRemote) {
      core.log?.(
        formatZulipLog("zulip outbound security warning: rejected non-http mediaUrl", {
          accountId: account.accountId,
          mediaUrl: maskPII(mediaUrl),
        }),
      );
      mediaUrl = undefined;
    }
    message = normalizeMessage(message, mediaUrl);
  }

  if (message) {
    const tableMode = core.channel.text.resolveMarkdownTableMode({
      cfg,
      channel: "zulip",
      accountId: account.accountId,
    });
    message = core.channel.text.convertMarkdownTables(message, tableMode);
  }

  if (!message) {
    throw new Error("Zulip message is empty");
  }

  let messageId = "unknown";
  if (target.kind === "user") {
    const response = await sendZulipPrivateMessage(client, {
      to: target.email,
      content: message,
    });
    messageId = response.id ? String(response.id) : "unknown";
  } else {
    const resolvedTopic = target.topic || opts.topic || DEFAULT_TOPIC;
    const response = await sendZulipStreamMessage(client, {
      stream: target.stream,
      topic: resolvedTopic,
      content: message,
    });
    messageId = response.id ? String(response.id) : "unknown";
  }

  core.log?.(
    formatZulipLog("zulip outbound success", {
      accountId: account.accountId,
      messageId,
      target: maskPII(to),
      kind,
      stream: stream ? maskPII(stream) : undefined,
      topic: target.kind === "stream" ? target.topic || opts.topic || DEFAULT_TOPIC : undefined,
      sessionKey: opts.sessionKey,
    }),
  );

  core.channel.activity.record({
    channel: "zulip",
    accountId: account.accountId,
    direction: "outbound",
  });

  return {
    messageId,
    channelId: target.kind === "stream" ? target.stream : target.email,
  };
}
