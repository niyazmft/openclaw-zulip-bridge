import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readStringParam, jsonResult } from "./actions-utils.js";
import { parseSendTarget, readSendMessageContent } from "./actions-utils.js";
import { sendZulipStreamMessage, sendZulipPrivateMessage, uploadZulipFile } from "./zulip/client.js";
import type { ZulipClient } from "./zulip/client.js";
import { maskPII } from "./zulip/monitor-helpers.js";
import { getZulipRuntime } from "./runtime.js";

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function zulipLogger() {
  return getZulipRuntime().logging?.getChildLogger?.({ module: "zulip" });
}

/**
 * Collects attachment media sources from message-tool `send` params (#268).
 *
 * The host stages explicit `buffer` params to local files before dispatch, so
 * the plugin sees `media`/`mediaUrl`/`mediaUrls` and structured
 * `attachments[].media` entries as local paths or http(s) URLs.
 */
export function collectSendAttachmentSources(params: Record<string, unknown>): string[] {
  const sources: string[] = [];
  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed && !sources.includes(trimmed)) sources.push(trimmed);
  };
  push(readStringParam(params, "mediaUrl"));
  push(readStringParam(params, "media"));
  if (Array.isArray(params.mediaUrls)) {
    for (const entry of params.mediaUrls) push(entry);
  }
  if (Array.isArray(params.attachments)) {
    for (const entry of params.attachments) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        push((entry as Record<string, unknown>).media);
      }
    }
  }
  return sources;
}

/**
 * Resolves attachment sources to Zulip-hosted or http(s) URLs.
 * Local paths go through `uploadZulipFile` (path allowlist: tmpdir + dataDir;
 * symlink/traversal rejection). Refused or failed sources are logged and
 * skipped — the message still delivers without them.
 */
export async function resolveAttachmentUrls(
  client: ZulipClient,
  sources: string[],
): Promise<string[]> {
  const logger = zulipLogger();
  const urls: string[] = [];
  for (const source of sources) {
    if (isHttpUrl(source)) {
      urls.push(source);
      continue;
    }
    try {
      const localPath = source.startsWith("file://")
        ? fileURLToPath(source)
        : source;
      const { url } = await uploadZulipFile(client, localPath);
      urls.push(url);
    } catch (err) {
      logger?.info?.("zulip outbound security warning: rejected attachment path", {
        mediaUrl: maskPII(source),
        error: String(err),
      });
    }
  }
  return urls;
}

export async function handleSendAction(
  client: ZulipClient,
  params: Record<string, unknown>,
) {
  const to = readStringParam(params, "to", { required: true });
  const content = readSendMessageContent(params);
  const target = parseSendTarget(to);

  // Attachments (#268): resolve media sources through the sandboxed upload
  // path and append the resulting links to the outgoing message.
  const attachmentSources = collectSendAttachmentSources(params);
  const attachmentUrls = await resolveAttachmentUrls(client, attachmentSources);
  const fullContent =
    attachmentUrls.length > 0
      ? [content, ...attachmentUrls].filter(Boolean).join("\n\n")
      : content;

  if (target.kind === "stream") {
    const result = await sendZulipStreamMessage(client, {
      stream: target.stream,
      topic: target.topic,
      content: fullContent,
    });
    return jsonResult({ success: true, messageId: result.id });
  }

  const result = await sendZulipPrivateMessage(client, {
    to: [target.email],
    content: fullContent,
  });
  return jsonResult({ success: true, messageId: result.id });
}