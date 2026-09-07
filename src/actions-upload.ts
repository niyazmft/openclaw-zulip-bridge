import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readStringParam, jsonResult } from "./actions-utils.js";
import { uploadZulipFile, type ZulipClient } from "./zulip/client.js";
import { createBotWorkspace } from "./zulip/workspace.js";
import { sendMessageZulip } from "./zulip/send.js";
import { getZulipRuntime } from "./runtime.js";

/**
 * Handles the core-owned `upload-file` message action (#268).
 *
 * The host hydrates attachment params before dispatch: a `media` path/URL is
 * resolved into `params.buffer` (base64) under the configured media policy,
 * with `filename`/`contentType` inferred. This handler:
 *
 * 1. Stages the decoded bytes in the sandboxed bot workspace
 *    (`dataDir/workspace/`, path-traversal rejected, TTL-pruned).
 * 2. Uploads via `uploadZulipFile` (path allowlist: tmpdir + dataDir only).
 * 3. Sends the Zulip-hosted URL to the target with the caption, using the
 *    normal send path (Zulip-hosted URLs skip re-download).
 */
export async function handleUploadFileAction(
  client: ZulipClient,
  params: Record<string, unknown>,
): Promise<unknown> {
  const to = readStringParam(params, "to", { required: true });
  const bufferB64 = readStringParam(params, "buffer");
  if (!bufferB64 || !bufferB64.trim()) {
    throw new Error(
      "upload-file requires a file source. Pass `media` (path or URL) and the host resolves it to `buffer`.",
    );
  }
  const rawFilename =
    readStringParam(params, "filename") || "upload.bin";
  // Flatten directory components before staging; the workspace still
  // re-validates path traversal as a second layer.
  const filename =
    path.basename(rawFilename).replace(/^\.+/, "").trim() || "upload.bin";
  const caption = (
    readStringParam(params, "caption") ??
    readStringParam(params, "message") ??
    ""
  ).trim();

  const dataDir =
    getZulipRuntime().paths?.dataDir ??
    path.join(os.homedir(), ".openclaw");

  const buffer = Buffer.from(bufferB64, "base64");
  const workspace = createBotWorkspace(dataDir);
  const stagedPath = await workspace.saveBytes(filename, buffer);

  let url: string;
  try {
    const uploaded = await uploadZulipFile(client, stagedPath);
    url = uploaded.url;
  } finally {
    // Best-effort cleanup; the workspace TTL-prunes anyway.
    await fs.unlink(stagedPath).catch(() => undefined);
  }

  const sendResult = await sendMessageZulip(to, caption, { mediaUrl: url });
  return jsonResult({
    success: true,
    messageId: sendResult.messageId,
    url,
  });
}