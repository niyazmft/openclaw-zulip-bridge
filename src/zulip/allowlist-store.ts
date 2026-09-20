import fs from "node:fs/promises";
import path from "node:path";
import { normalizeAllowList } from "./auth.js";

export type AllowFromStoreResult = {
  allowFrom: string[];
  /** True when the store file existed and contained a "*" wildcard entry. */
  wildcardRejected: boolean;
};

/**
 * Reads the persisted allowlist for an account.
 *
 * Security:
 *  - Only the resolver-provided data directory is consulted. Earlier versions
 *    probed `~/.openclaw`, `/home/node/.openclaw` **and** `/tmp/openclaw-zulip`,
 *    using the first readable file. A world-writable temp directory therefore
 *    let any local user drop an allowlist and authorize themselves.
 *  - A `"*"` entry coming from the store is rejected. Only static config may
 *    authorize everyone; a file on disk must never be able to.
 */
export async function readAllowFromStore(params: {
  dataDir: string;
  accountId: string;
  /** Injectable for tests; defaults to node:fs/promises. */
  fileSystem?: { readFile: (p: string, enc: string) => Promise<unknown> };
}): Promise<AllowFromStoreResult> {
  const { dataDir, accountId } = params;
  const readFile = params.fileSystem?.readFile ?? fs.readFile;
  const allowPath = path.join(
    dataDir,
    "credentials",
    `zulip-${accountId}-allowFrom.json`,
  );
  try {
    const raw = String(await readFile(allowPath, "utf8"));
    const parsed = JSON.parse(raw) as { allowFrom?: unknown } | null;
    const list = Array.isArray(parsed?.allowFrom) ? parsed.allowFrom : [];
    const hasWildcard = list.some((entry) => String(entry).trim() === "*");
    if (hasWildcard) {
      return { allowFrom: [], wildcardRejected: true };
    }
    return { allowFrom: normalizeAllowList(list), wildcardRejected: false };
  } catch {
    return { allowFrom: [], wildcardRejected: false };
  }
}
