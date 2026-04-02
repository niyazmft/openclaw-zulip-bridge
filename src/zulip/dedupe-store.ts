import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PluginRuntime } from "openclaw/plugin-sdk";

export type DedupeStoreOpts = {
  accountId: string;
  runtime: PluginRuntime;
  ttlMs: number;
  maxSize: number;
};

export class ZulipDedupeStore {
  private accountId: string;
  private runtime: PluginRuntime;
  private ttlMs: number;
  private maxSize: number;
  private cache = new Map<string, number>();
  private persistenceDirChecked = false;

  constructor(opts: DedupeStoreOpts) {
    this.accountId = opts.accountId;
    this.runtime = opts.runtime;
    this.ttlMs = opts.ttlMs;
    this.maxSize = opts.maxSize;
  }

  private getPersistencePath(): string {
    const safeAccountId = this.accountId.replace(/[^a-z0-9]/gi, "_");
    const dataDir = this.runtime.paths?.dataDir;
    if (dataDir) {
      return path.join(dataDir, `zulip_dedupe_${safeAccountId}.json`);
    }
    return path.join(os.tmpdir(), "openclaw-zulip", `zulip_dedupe_${safeAccountId}.json`);
  }

  /**
   * Loads the persisted dedupe state from disk.
   */
  async load(): Promise<void> {
    try {
      const p = this.getPersistencePath();
      const data = await fs.readFile(p, "utf8");
      const entries = JSON.parse(data) as [string, number][];
      this.cache = new Map(entries);
      this.prune(Date.now());
    } catch (err) {
      // Ignore errors (file not found, etc.)
    }
  }

  /**
   * Saves the current dedupe state to disk.
   */
  async save(): Promise<void> {
    try {
      const p = this.getPersistencePath();
      if (!this.persistenceDirChecked) {
        await fs.mkdir(path.dirname(p), { recursive: true }).catch(() => {});
        this.persistenceDirChecked = true;
      }
      const entries = Array.from(this.cache.entries());
      await fs.writeFile(p, JSON.stringify(entries), "utf8");
    } catch (err) {
      this.runtime.error?.(
        `zulip dedupe store [${this.accountId}]: failed to save: ${String(err)}`,
      );
    }
  }

  /**
   * Checks if a key has been seen recently.
   * Returns true if it was already in the cache (and not expired), false otherwise.
   * If it's a new key, it's added to the cache and persisted.
   */
  async check(key: string, now = Date.now()): Promise<boolean> {
    if (!key) {
      return false;
    }

    const existing = this.cache.get(key);
    if (existing !== undefined && (this.ttlMs <= 0 || now - existing < this.ttlMs)) {
      this.touch(key, now);
      return true;
    }

    this.touch(key, now);
    this.prune(now);
    await this.save();
    return false;
  }

  private touch(key: string, now: number) {
    this.cache.delete(key);
    this.cache.set(key, now);
  }

  private prune(now: number) {
    const cutoff = this.ttlMs > 0 ? now - this.ttlMs : undefined;
    if (cutoff !== undefined) {
      for (const [entryKey, entryTs] of this.cache.entries()) {
        if (entryTs < cutoff) {
          this.cache.delete(entryKey);
        } else {
          // Entries are ordered by insertion/touch, so we can break early.
          break;
        }
      }
    }

    if (this.maxSize > 0) {
      while (this.cache.size > this.maxSize) {
        const oldestKey = this.cache.keys().next().value as string | undefined;
        if (oldestKey === undefined) {
          break;
        }
        this.cache.delete(oldestKey);
      }
    }
  }
}
