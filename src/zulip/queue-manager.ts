import type { PluginRuntime } from "openclaw/plugin-sdk/channel-core";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveZulipStatePath } from "./data-dir.js";
import { formatZulipLog } from "./monitor-helpers.js";

export type QueueMetadata = {
  queueId: string;
  lastEventId: number;
  registeredAt: number;
  /**
   * Long-poll timeout the server handed back at registration. Replayed on
   * every `/events` request so the server blocks instead of answering
   * immediately (see polling.ts). Undefined for metadata persisted by older
   * plugin versions; callers fall back to the default.
   */
  longpollTimeoutSecs?: number;
  /**
   * The `event_types` this queue was registered with.
   *
   * Reusing a persisted queue is only safe while the requested event types are
   * unchanged: `/register` fixes them for the queue's whole lifetime, so a
   * config change that needs a new event type receives **nothing** for it until
   * a fresh registration happens. Undefined means metadata written by an older
   * plugin version, which only ever asked for `message`.
   *
   * Found in the field: enabling `reactionTriggers` (#297) needs `reaction`
   * events, but a five-day-old persisted queue kept being reused across
   * restarts, so reactions were never delivered and the feature looked broken.
   */
  eventTypes?: string[];
};

export type QueueRegisterCallback = () => Promise<{
  queueId: string;
  lastEventId: number;
  longpollTimeoutSecs?: number;
}>;

export type QueueManagerOpts = {
  accountId: string;
  runtime: PluginRuntime;
  registerFn: QueueRegisterCallback;
  /**
   * Event types the caller wants. A persisted queue is only reused while these
   * match what it was registered with; otherwise a fresh queue is registered.
   * Defaults to `["message"]` (the historical behaviour).
   */
  desiredEventTypes?: string[];
};

export class ZulipQueueManager {
  private accountId: string;
  private runtime: PluginRuntime;
  private registerFn: QueueRegisterCallback;
  private desiredEventTypes: string[];
  private currentQueue: QueueMetadata | null = null;
  private registrationPromise: Promise<QueueMetadata> | null = null;
  private persistenceDirChecked = false;

  constructor(opts: QueueManagerOpts) {
    this.accountId = opts.accountId;
    this.runtime = opts.runtime;
    this.registerFn = opts.registerFn;
    this.desiredEventTypes = [...(opts.desiredEventTypes ?? ["message"])];
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
      if (persisted && this.canReuseQueue(persisted)) {
        this.runtime.log?.(
          formatZulipLog("zulip queue loaded", {
            accountId: this.accountId,
            queueId: persisted.queueId,
            lastEventId: persisted.lastEventId,
          }),
        );
        return persisted;
      }
      if (persisted) {
        // A reused queue would receive none of the newly needed events.
        this.runtime.log?.(
          formatZulipLog("zulip queue event types changed; registering a fresh queue", {
            accountId: this.accountId,
            persisted: (persisted.eventTypes ?? ["message"]).join(","),
            desired: this.desiredEventTypes.join(","),
          }),
        );
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
          longpollTimeoutSecs: queue.longpollTimeoutSecs,
          eventTypes: [...this.desiredEventTypes],
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

  /**
   * A persisted queue may only be reused while it was registered for exactly
   * the event types we want now. Metadata without `eventTypes` predates that
   * field and only ever asked for `message`.
   */
  private canReuseQueue(persisted: QueueMetadata): boolean {
    const persistedTypes = [...(persisted.eventTypes ?? ["message"])].sort();
    const desiredTypes = [...this.desiredEventTypes].sort();
    return (
      persistedTypes.length === desiredTypes.length &&
      persistedTypes.every((type, index) => type === desiredTypes[index])
    );
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
    // Shared resolver so dedupe/queue/audit agree on one directory
    // (see ./data-dir.ts for the Termux/container rationale).
    return resolveZulipStatePath(this.runtime, `zulip_queue_${safeAccountId}.json`);
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
