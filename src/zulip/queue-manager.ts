import type { PluginRuntime } from "openclaw/plugin-sdk";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

  constructor(opts: QueueManagerOpts) {
    this.accountId = opts.accountId;
    this.runtime = opts.runtime;
    this.registerFn = opts.registerFn;
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
    const logger = this.runtime.log;
    const errorLogger = this.runtime.error;

    // Try loading from persistence first
    try {
      const persisted = await this.loadMetadata();
      if (persisted) {
        logger?.(
          `zulip queue manager [${this.accountId}]: loaded persisted queue ${persisted.queueId} (last_event_id: ${persisted.lastEventId})`,
        );
        return persisted;
      }
    } catch (err) {
      errorLogger?.(
        `zulip queue manager [${this.accountId}]: failed to load persisted queue: ${String(err)}`,
      );
    }

    let attempt = 0;
    const maxAttempts = 5;
    const baseDelayMs = 1000;

    while (attempt < maxAttempts) {
      try {
        logger?.(
          `zulip queue manager [${this.accountId}]: registering new queue (attempt ${attempt + 1})...`,
        );
        const queue = await this.registerFn();
        const metadata: QueueMetadata = {
          queueId: queue.queueId,
          lastEventId: queue.lastEventId,
          registeredAt: Date.now(),
        };
        await this.saveMetadata(metadata);
        logger?.(
          `zulip queue manager [${this.accountId}]: registered new queue ${metadata.queueId} (last_event_id: ${metadata.lastEventId})`,
        );
        return metadata;
      } catch (err) {
        attempt++;
        if (attempt >= maxAttempts) {
          errorLogger?.(`zulip queue manager [${this.accountId}]: failed to register queue after ${maxAttempts} attempts: ${String(err)}`);
          throw err;
        }
        const delayMs = baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000;
        logger?.(`zulip queue manager [${this.accountId}]: registration failed, retrying in ${Math.round(delayMs)}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw new Error("Registration failed");
  }

  async markQueueExpired(): Promise<void> {
    const logger = this.runtime.log;
    if (this.currentQueue) {
      logger?.(`zulip queue manager [${this.accountId}]: marking queue ${this.currentQueue.queueId} as expired`);
      this.currentQueue = null;
      const p = this.getPersistencePath();
      await fs.unlink(p).catch(() => {});
    }
  }

  async updateLastEventId(lastEventId: number): Promise<void> {
    if (this.currentQueue && lastEventId > this.currentQueue.lastEventId) {
      this.currentQueue.lastEventId = lastEventId;
      await this.saveMetadata(this.currentQueue);
    }
  }

  private getPersistencePath(): string {
    const safeAccountId = this.accountId.replace(/[^a-z0-9]/gi, "_");
    return path.join(os.tmpdir(), `zulip_queue_${safeAccountId}.json`);
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
      await fs.writeFile(p, JSON.stringify(metadata), "utf8");
    } catch (err) {
      this.runtime.error?.(`zulip queue manager [${this.accountId}]: failed to save metadata: ${String(err)}`);
    }
  }
}
