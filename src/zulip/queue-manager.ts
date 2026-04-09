import type { PluginRuntime } from "openclaw/plugin-sdk";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { formatZulipLog } from "./monitor-helpers.js";

export type QueueMetadata = {
  queueId: string;
  lastEventId: number;
  registeredAt: number;
};

export type QueueRegisterCallback = () => Promise<{ queueId: string; lastEventId: number }>;

export type QueueManagerOpts = {
  accountId: string;
  runtime: PluginRuntime;
  registerFn: QueueRegisterCallback;
};

export class ZulipQueueManager {
  private accountId: string;
  private runtime: PluginRuntime;
  private registerFn: QueueRegisterCallback;
  private currentQueue: QueueMetadata | null = null;
  private registrationPromise: Promise<QueueMetadata> | null = null;
  private persistenceDirChecked = false;

  constructor(opts: QueueManagerOpts) {
    this.accountId = opts.accountId;
    this.runtime = opts.runtime;
    this.registerFn = opts.registerFn;
  }

  getQueue(): QueueMetadata | null {
    return this.currentQueue;
  }

  async ensureQueue(): Promise<QueueMetadata> {
    if (this.currentQueue) {
      return this.currentQueue;
    }

    if (this.registrationPromise) {
      return this.registrationPromise;
    }

    this.registrationPromise = this.performRegistration();
    try {
      this.currentQueue = await this.registrationPromise;
      return this.currentQueue;
    } finally {
      this.registrationPromise = null;
    }
  }

  private async performRegistration(): Promise<QueueMetadata> {
    // Try loading from persistence first
    try {
      const persisted = await this.loadMetadata();
      if (persisted) {
        this.runtime.log?.(
          formatZulipLog("zulip queue loaded", {
            accountId: this.accountId,
            queueId: persisted.queueId,
            lastEventId: persisted.lastEventId,
          }),
        );
        return persisted;
      }
    } catch (err) {
      this.runtime.error?.(
        formatZulipLog("zulip queue load failed", {
          accountId: this.accountId,
          error: String(err),
        }),
      );
    }

    let attempt = 0;
    const maxAttempts = 5;
    const baseDelayMs = 1000;

    while (attempt < maxAttempts) {
      try {
        this.runtime.log?.(
          formatZulipLog("zulip queue registering", {
            accountId: this.accountId,
            attempt: attempt + 1,
          }),
        );
        const queue = await this.registerFn();
        const metadata: QueueMetadata = {
          queueId: queue.queueId,
          lastEventId: queue.lastEventId,
          registeredAt: Date.now(),
        };
        await this.saveMetadata(metadata);
        this.runtime.log?.(
          formatZulipLog("zulip queue registered", {
            accountId: this.accountId,
            queueId: metadata.queueId,
            lastEventId: metadata.lastEventId,
          }),
        );
        return metadata;
      } catch (err) {
        attempt++;
        if (attempt >= maxAttempts) {
          this.runtime.error?.(
            formatZulipLog("zulip queue registration failed final", {
              accountId: this.accountId,
              attempts: maxAttempts,
              error: String(err),
            }),
          );
          throw err;
        }
        const delayMs = baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000;
        this.runtime.log?.(
          formatZulipLog("zulip queue registration failed, retrying", {
            accountId: this.accountId,
            error: String(err),
            delayMs: Math.round(delayMs),
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw new Error("Registration failed");
  }

  async markQueueExpired(): Promise<void> {
    if (this.currentQueue) {
      this.runtime.log?.(
        formatZulipLog("zulip queue expired", {
          accountId: this.accountId,
          queueId: this.currentQueue.queueId,
        }),
      );
    }
    this.currentQueue = null;
    const p = this.getPersistencePath();
    await fs.unlink(p).catch(() => {});
  }

  async updateLastEventId(lastEventId: number): Promise<void> {
    if (this.currentQueue && lastEventId > this.currentQueue.lastEventId) {
      this.currentQueue.lastEventId = lastEventId;
      await this.saveMetadata(this.currentQueue);
    }
  }

  private getPersistencePath(): string {
    const safeAccountId = this.accountId.replace(/[^a-z0-9]/gi, "_");
    const dataDir = this.runtime.paths?.dataDir;
    if (dataDir) {
      return path.join(dataDir, `zulip_queue_${safeAccountId}.json`);
    }
    return path.join(os.tmpdir(), "openclaw-zulip", `zulip_queue_${safeAccountId}.json`);
  }

  private async loadMetadata(): Promise<QueueMetadata | null> {
    try {
      const p = this.getPersistencePath();
      const data = await fs.readFile(p, "utf8");
      const metadata = JSON.parse(data) as QueueMetadata;
      // Basic validation
      if (metadata && metadata.queueId && typeof metadata.lastEventId === "number") {
        return metadata;
      }
    } catch (err) {
      // Ignore errors (file not found, etc.)
    }
    return null;
  }

  private async saveMetadata(metadata: QueueMetadata): Promise<void> {
    try {
      const p = this.getPersistencePath();
      if (!this.persistenceDirChecked) {
        await fs.mkdir(path.dirname(p), { recursive: true }).catch(() => {});
        this.persistenceDirChecked = true;
      }
      await fs.writeFile(p, JSON.stringify(metadata), "utf8");
    } catch (err) {
      this.runtime.error?.(
        formatZulipLog("zulip queue metadata save failed", {
          accountId: this.accountId,
          error: String(err),
        }),
      );
    }
  }
}
