import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PluginRuntime } from "openclaw/plugin-sdk";
import { getZulipRuntime } from "../runtime.js";
import { downloadZulipUpload } from "./uploads.js";
import { formatZulipLog, maskPII } from "./monitor-helpers.js";

const checkedMediaDirs = new Set<string>();

/**
 * Saves a Zulip media buffer to a temporary file or using the core media service.
 */
export async function saveZulipMediaBuffer(params: {
  core: ReturnType<typeof getZulipRuntime>;
  buffer: Buffer;
  contentType: string;
  filename: string;
  maxBytes: number;
}): Promise<{ path: string; contentType: string } | null> {
  const { core, buffer, contentType, filename, maxBytes } = params;
  if (core.channel.media?.saveMediaBuffer) {
    const saved = await core.channel.media.saveMediaBuffer(
      buffer,
      contentType,
      "inbound",
      maxBytes,
      filename,
    );
    return {
      path: saved.path,
      contentType: saved.contentType ?? contentType,
    };
  }
  const baseDir = core.paths?.dataDir ?? path.join(os.tmpdir(), "openclaw-zulip");
  if (!checkedMediaDirs.has(baseDir)) {
    await fs.mkdir(baseDir, { recursive: true }).catch(() => {});
    checkedMediaDirs.add(baseDir);
  }
  const dir = await fs.mkdtemp(path.join(baseDir, "zulip-upload-"));
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, buffer);
  return { path: filePath, contentType };
}

/**
 * Downloads and saves attachments from a list of Zulip upload URLs.
 */
export async function downloadAttachments(params: {
  core: ReturnType<typeof getZulipRuntime>;
  uploadUrls: string[];
  baseUrl: string;
  authHeader: string;
  mediaMaxBytes: number;
  accountId: string;
  messageId: string;
}): Promise<{ mediaPaths: string[]; mediaTypes: string[]; mediaUrls: string[] }> {
  const { core, uploadUrls, baseUrl, authHeader, mediaMaxBytes, accountId, messageId } = params;
  const results = await Promise.all(
    uploadUrls.map(async (uploadUrl) => {
      try {
        const downloaded = await downloadZulipUpload(
          uploadUrl,
          baseUrl,
          authHeader,
          mediaMaxBytes,
        );
        const saved = await saveZulipMediaBuffer({
          core,
          buffer: downloaded.buffer,
          contentType: downloaded.contentType,
          filename: downloaded.filename,
          maxBytes: mediaMaxBytes,
        });
        if (saved) {
          return {
            path: saved.path,
            type: saved.contentType,
            url: uploadUrl,
          };
        }
      } catch (err) {
        core.error?.(
          formatZulipLog("zulip attachment download failed", {
            accountId,
            messageId,
            url: maskPII(uploadUrl),
            error: String(err),
          }),
        );
      }
      return null;
    }),
  );

  const mediaPaths: string[] = [];
  const mediaTypes: string[] = [];
  const mediaUrls: string[] = [];

  for (const result of results) {
    if (result) {
      mediaPaths.push(result.path);
      mediaTypes.push(result.type);
      mediaUrls.push(result.url);
    }
  }

  return { mediaPaths, mediaTypes, mediaUrls };
}
