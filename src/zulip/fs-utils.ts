import { lstat, readFile } from "node:fs/promises";

/**
 * Reads a local file into a Buffer.
 * Security: Rejects symlinks to prevent path traversal attacks. Callers are
 * responsible for ensuring the resolved path is within an allowed directory.
 * Used primarily for uploading media to Zulip.
 */
export async function readSafeLocalFile(filePath: string): Promise<Buffer> {
  const stats = await lstat(filePath);
  if (stats.isSymbolicLink()) {
    throw new Error("Symlinks are not allowed for file upload paths");
  }
  return await readFile(filePath);
}
