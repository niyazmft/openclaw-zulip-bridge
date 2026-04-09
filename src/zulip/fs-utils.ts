import { readFile } from "node:fs/promises";

/**
 * Reads a local file into a Buffer.
 * Security: This is a low-level utility. Callers are responsible for path validation
 * and ensuring the file is safe to read. Used primarily for uploading media to Zulip.
 */
export async function readSafeLocalFile(filePath: string): Promise<Buffer> {
  return await readFile(filePath);
}
