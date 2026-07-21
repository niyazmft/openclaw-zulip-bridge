import fs from "node:fs/promises";
import path from "node:path";
import { uploadZulipFile, type ZulipClient } from "./client.js";

export type BotWorkspaceOpts = {
  /** Time-to-live for workspace files in milliseconds. Default: 1 hour */
  ttlMs?: number;
  /** Optional Zulip client for auto-upload convenience. */
  client?: ZulipClient;
};

/**
 * Creates a sandboxed workspace for bot-generated files.
 *
 * All files are written under `dataDir/workspace/`.
 * Path traversal attempts are rejected.
 * Files older than the configured TTL are auto-pruned on each save.
 */
export function createBotWorkspace(
  dataDir: string,
  opts: BotWorkspaceOpts = {},
) {
  const ttlMs = opts.ttlMs ?? 60 * 60 * 1000; // default 1 hour
  const workspaceDir = path.resolve(dataDir, "workspace");
  const client = opts.client;

  async function ensureDir(): Promise<void> {
    await fs.mkdir(workspaceDir, { recursive: true });
  }

  function resolveSafePath(filename: string): string {
    const resolved = path.resolve(workspaceDir, filename);
    const safePrefix = path.resolve(workspaceDir) + path.sep;
    if (!resolved.startsWith(safePrefix)) {
      throw new Error(`Path traversal rejected: ${filename}`);
    }
    return resolved;
  }

  async function pruneOldFiles(): Promise<void> {
    try {
      const entries = await fs.readdir(workspaceDir, { withFileTypes: true });
      const now = Date.now();
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const filePath = path.join(workspaceDir, entry.name);
        try {
          const stat = await fs.stat(filePath);
          if (now - stat.mtimeMs > ttlMs) {
            await fs.unlink(filePath);
          }
        } catch {
          // ignore errors during pruning
        }
      }
    } catch {
      // directory may not exist yet
    }
  }

  return {
    /**
     * Writes UTF-8 text to a file in the workspace.
     * Prunes old files before writing.
     */
    async saveText(filename: string, content: string): Promise<string> {
      await ensureDir();
      await pruneOldFiles();
      const filePath = resolveSafePath(filename);
      await fs.writeFile(filePath, content, "utf8");
      return filePath;
    },

    /**
     * Writes raw bytes to a file in the workspace.
     * Prunes old files before writing.
     */
    async saveBytes(filename: string, content: Buffer | Uint8Array): Promise<string> {
      await ensureDir();
      await pruneOldFiles();
      const filePath = resolveSafePath(filename);
      await fs.writeFile(filePath, content);
      return filePath;
    },

    /**
     * Serializes data as JSON with indentation and writes to a file.
     * Prunes old files before writing.
     */
    async saveJson(filename: string, data: unknown): Promise<string> {
      const text = JSON.stringify(data, null, 2);
      return this.saveText(filename, text);
    },

    /**
     * Reads a UTF-8 text file from the workspace.
     */
    async readText(filename: string): Promise<string> {
      const filePath = resolveSafePath(filename);
      return await fs.readFile(filePath, "utf8");
    },

    /**
     * Reads raw bytes from a file in the workspace.
     */
    async readBytes(filename: string): Promise<Buffer> {
      const filePath = resolveSafePath(filename);
      return await fs.readFile(filePath);
    },

    /**
     * Lists all files in the workspace with their sizes and modification times.
     */
    async listFiles(): Promise<
      Array<{ name: string; size: number; mtime: Date }>
    > {
      try {
        const entries = await fs.readdir(workspaceDir, { withFileTypes: true });
        const files: Array<{ name: string; size: number; mtime: Date }> = [];
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const stat = await fs.stat(path.join(workspaceDir, entry.name));
          files.push({
            name: entry.name,
            size: stat.size,
            mtime: stat.mtime,
          });
        }
        return files;
      } catch {
        return [];
      }
    },

    /**
     * Deletes all files in the workspace.
     */
    async clear(): Promise<void> {
      try {
        const entries = await fs.readdir(workspaceDir, { withFileTypes: true });
        for (const entry of entries) {
          const entryPath = path.join(workspaceDir, entry.name);
          if (entry.isFile()) {
            await fs.unlink(entryPath);
          } else if (entry.isDirectory()) {
            await fs.rm(entryPath, { recursive: true });
          }
        }
      } catch {
        // directory may not exist
      }
    },

    /**
     * Uploads a file to Zulip and deletes the local copy.
     * Requires `client` to have been passed in opts.
     */
    async upload(filename: string): Promise<string> {
      if (!client) {
        throw new Error(
          "Zulip client not configured. Pass client in workspace opts.",
        );
      }
      const filePath = resolveSafePath(filename);
      const { url } = await uploadZulipFile(client, filePath);
      try {
        await fs.unlink(filePath);
      } catch {
        // best-effort cleanup
      }
      return url;
    },
  };
}

export type BotWorkspace = ReturnType<typeof createBotWorkspace>;
