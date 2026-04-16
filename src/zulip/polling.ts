import type { PluginRuntime } from "openclaw/plugin-sdk";
import type { ZulipMessage } from "./client.js";
import { getZulipEventsWithRetry } from "./client.js";
import { formatZulipLog, delay, maskPII } from "./monitor-helpers.js";
import { ZulipQueueManager } from "./queue-manager.js";
import type { MonitorZulipOpts } from "./monitor.js";

/**
 * Performs a single polling cycle for Zulip events.
 */
export async function pollOnce(params: {
  client: any;
  queueManager: ZulipQueueManager;
  core: PluginRuntime;
  accountId: string;
  opts: MonitorZulipOpts;
  pollBackoffMs: number;
  resetPollBackoff: () => void;
  processMessage: (message: ZulipMessage) => Promise<void>;
}): Promise<{ pollBackoffMs: number; shouldContinue: boolean }> {
  const {
    client,
    queueManager,
    core,
    accountId,
    opts,
    resetPollBackoff,
    processMessage,
  } = params;
  let { pollBackoffMs } = params;

  let queue;
  try {
    queue = await queueManager.ensureQueue();
  } catch (err) {
    core.error?.(
      formatZulipLog("zulip queue management failed", {
        accountId,
        error: String(err),
      }),
    );
    await delay(5000);
    return { pollBackoffMs, shouldContinue: true };
  }

  try {
    const response = await getZulipEventsWithRetry(client, {
      queueId: queue.queueId,
      lastEventId: queue.lastEventId,
      timeoutMs: 90000,
      retryBaseDelayMs: 1000,
    });

    if (response.result === "error") {
      const msg = response.msg ?? "";
      const isBadQueue =
        response.code === "BAD_EVENT_QUEUE_ID" || msg.toLowerCase().includes("bad event queue");
      if (isBadQueue) {
        await queueManager.markQueueExpired();
        resetPollBackoff();
        return { pollBackoffMs: 0, shouldContinue: true };
      }
      throw new Error(`Zulip events error: ${response.msg}`);
    }

    const events = response.events ?? [];
    if (events.length > 0) {
      core.log?.(
        formatZulipLog("zulip events received", {
          accountId,
          queueId: maskPII(queue.queueId),
          count: events.length,
        }),
      );
      opts.statusSink?.({
        connected: true,
        lastConnectedAt: Date.now(),
      });
    }

    if (events.length === 0) {
      await delay(1000);
    }

    resetPollBackoff();
    pollBackoffMs = 0;

    let maxEventId = -1;

    try {
      for (const event of events) {
        if (event.type === "message" && event.message) {
          await processMessage(event.message);
        }
        const nextEventId = Number((event as { id?: unknown })?.id);
        if (!Number.isNaN(nextEventId) && nextEventId > maxEventId) {
          maxEventId = nextEventId;
        }
      }
    } finally {
      if (maxEventId > 0) {
        // ⚡ Bolt Optimization: Batch disk I/O updates for event ID
        // Previously, we updated the queue manager (which writes to disk) for every event.
        // By keeping track of the maxEventId and updating once per batch, we turn
        // O(N) disk writes into O(1) writes, drastically reducing I/O operations.
        // It's in a finally block to make sure progress is not lost upon errors.
        await queueManager.updateLastEventId(maxEventId);
      }
    }
  } catch (err) {
    if (opts.abortSignal?.aborted) {
      return { pollBackoffMs, shouldContinue: false };
    }
    const errStr = String(err);
    if (errStr.toLowerCase().includes("bad event queue")) {
      await queueManager.markQueueExpired();
      resetPollBackoff();
      return { pollBackoffMs: 0, shouldContinue: true };
    }
    const status = (err as { status?: number })?.status;
    const retryAfterMs = (err as { retryAfterMs?: number })?.retryAfterMs;
    core.error?.(
      formatZulipLog("zulip polling error", {
        accountId,
        error: String(err),
        status,
      }),
    );
    opts.statusSink?.({
      connected: false,
      lastError: String(err),
    });
    const baseDelay = status === 429 ? 10000 : 1000;
    if (!pollBackoffMs) {
      pollBackoffMs = baseDelay;
    } else {
      pollBackoffMs = Math.min(30000, pollBackoffMs * 2);
    }
    const waitMs =
      retryAfterMs && retryAfterMs > 0 ? Math.min(30000, retryAfterMs) : pollBackoffMs;
    await delay(waitMs);
  }

  return { pollBackoffMs, shouldContinue: true };
}
