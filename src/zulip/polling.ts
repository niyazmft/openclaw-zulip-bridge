import type { PluginRuntime } from "openclaw/plugin-sdk/channel-core";
import type { ZulipMessage } from "./client.js";
import type { ZulipReactionEvent } from "./reaction-triggers.js";
import {
  DEFAULT_LONGPOLL_TIMEOUT_SECS,
  getZulipEventsWithRetry,
} from "./client.js";
import { formatZulipLog, delay, maskPII } from "./monitor-helpers.js";
import { ZulipQueueManager } from "./queue-manager.js";
import type { MonitorZulipOpts } from "./monitor.js";

/**
 * A `/events` response that comes back faster than this cannot have been a
 * long-poll the server actually held — the server answered immediately (e.g.
 * with a heartbeat event). Two very different healthy regimes exist in the
 * wild, and this threshold is what tells them apart:
 *
 *   - Real long-poll (server holds the request): responses take ~45-90s.
 *     The server already paces the loop, so we must NOT add our own delay —
 *     doing so would only delay delivery of the next real message.
 *   - Immediate responses: the loop becomes a tight re-poll loop. Without a
 *     backoff a host polls ~2,700 times/hour, ~72k times/day, and (when every
 *     poll is logged) writes tens of MB of log per day for an idle channel.
 */
export const FAST_RESPONSE_MS = 2_500;

/** Idle backoff applied when the server answers immediately with no messages. */
export const IDLE_BACKOFF_START_MS = 1_000;
/** Upper bound of the idle backoff. Kept small so message latency stays low. */
export const IDLE_BACKOFF_MAX_MS = 5_000;

/** How often the "no message events" line may be logged while idle. */
export const IDLE_LOG_INTERVAL_MS = 5 * 60_000;

export type IdlePollState = {
  /** Timestamp of the last idle-poll log line; 0 means "log the next one". */
  lastAt: number;
};

export type IdleStateResult = {
  /** Backoff to carry into the next poll. */
  idleBackoffMs: number;
  /** How long to wait before polling again. */
  delayMs: number;
};

/**
 * Pure decision function for the idle path: given how long the last poll took
 * and whether it carried any real message, decide the next backoff and delay.
 *
 * Exported for tests — see test/polling.test.ts.
 */
export function nextIdleState(params: {
  hadMessageEvents: boolean;
  elapsedMs: number;
  idleBackoffMs: number;
}): IdleStateResult {
  if (params.hadMessageEvents) {
    // Real traffic: reset and poll again immediately.
    return { idleBackoffMs: 0, delayMs: 0 };
  }
  if (params.elapsedMs >= FAST_RESPONSE_MS) {
    // The server held the long-poll. It paces the loop; adding a delay here
    // would only postpone the next real message on healthy hosts.
    return { idleBackoffMs: 0, delayMs: 0 };
  }
  const idleBackoffMs =
    params.idleBackoffMs > 0
      ? Math.min(IDLE_BACKOFF_MAX_MS, params.idleBackoffMs * 2)
      : IDLE_BACKOFF_START_MS;
  return { idleBackoffMs, delayMs: idleBackoffMs };
}

/**
 * Idle-poll logging is throttled: it is emitted on the first idle poll after
 * traffic (or after a restart) and then at most once per
 * {@link IDLE_LOG_INTERVAL_MS}. On the audit hosts this line alone accounted
 * for 97.8-99.5% of the entire gateway log.
 */
export function shouldLogIdlePoll(state: IdlePollState, now: number): boolean {
  if (state.lastAt === 0) {
    return true;
  }
  return now - state.lastAt >= IDLE_LOG_INTERVAL_MS;
}

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
  /** Carried across polls; see {@link nextIdleState}. */
  idleBackoffMs: number;
  idleLogState: IdlePollState;
  resetPollBackoff: () => void;
  processMessage: (message: ZulipMessage) => Promise<void>;
  /**
   * Optional handler for `reaction` events (#297). Omitted when no reaction
   * triggers are configured, in which case reaction events are ignored (their
   * ids are still tracked so the queue advances).
   */
  processReaction?: (event: ZulipReactionEvent) => Promise<void>;
}): Promise<{ pollBackoffMs: number; idleBackoffMs: number; shouldContinue: boolean }> {
  const {
    client,
    queueManager,
    core,
    accountId,
    opts,
    resetPollBackoff,
    processMessage,
    processReaction,
    idleLogState,
  } = params;
  let { pollBackoffMs, idleBackoffMs } = params;

  const pLogger = core.logging?.getChildLogger?.({ module: "zulip" });

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
    return { pollBackoffMs, idleBackoffMs, shouldContinue: true };
  }

  try {
    // Replay the long-poll timeout the server returned at registration, and ask
    // for it explicitly: relying on a server-side default is what turns the loop
    // into a tight re-poll loop on hosts/proxies that would otherwise answer
    // immediately (see Zulip's "Get events" docs).
    const longpollSecs = queue.longpollTimeoutSecs ?? DEFAULT_LONGPOLL_TIMEOUT_SECS;
    const pollStartedAt = Date.now();
    const response = await getZulipEventsWithRetry(client, {
      queueId: queue.queueId,
      lastEventId: queue.lastEventId,
      timeoutMs: longpollSecs * 1000,
      timeoutSecs: longpollSecs,
      retryBaseDelayMs: 1000,
      signal: opts.abortSignal,
    });

    if (response.result === "error") {
      const msg = response.msg ?? "";
      const isBadQueue =
        response.code === "BAD_EVENT_QUEUE_ID" || msg.toLowerCase().includes("bad event queue");
      if (isBadQueue) {
        await queueManager.markQueueExpired();
        // /events requests that consume the rate-limit budget.
        pLogger?.info?.("zulip poll throttle: bad queue (error response), waiting 1s", {
          accountId,
          queueId: maskPII(queue.queueId),
        });
        const backoffMs = 1000;
        await delay(backoffMs);
        return { pollBackoffMs: backoffMs, idleBackoffMs: 0, shouldContinue: true };
      }
      throw new Error(`Zulip events error: ${response.msg}`);
    }

    const elapsedMs = Date.now() - pollStartedAt;
    const events = response.events ?? [];
    if (events.length > 0) {
      core.log?.(
        formatZulipLog("zulip events received", {
          accountId,
          queueId: maskPII(queue.queueId),
          count: events.length,
        }),
      );
    }
    // Heartbeat: assert health on every poll cycle regardless of event count
    opts.statusSink?.({
      connected: true,
      lastConnectedAt: Date.now(),
    });

    // not only when the events array is empty. Heartbeat events (non-message)
    // should not trigger an immediate re-poll.
    const hadMessageEvents = events.some((e: any) => e.type === "message" && e.message);
    const idle = nextIdleState({ hadMessageEvents, elapsedMs, idleBackoffMs });
    idleBackoffMs = idle.idleBackoffMs;

    if (!hadMessageEvents) {
      const now = Date.now();
      if (shouldLogIdlePoll(idleLogState, now)) {
        idleLogState.lastAt = now;
        pLogger?.info?.("zulip poll idle: no message events", {
          accountId,
          eventCount: events.length,
          eventTypes: [...new Set(events.map((e: any) => e.type))],
          elapsedMs,
          nextDelayMs: idle.delayMs,
        });
      }
      if (idle.delayMs > 0) {
        await delay(idle.delayMs);
      }
    } else {
      // Log the next idle poll once so the transition remains observable.
      idleLogState.lastAt = 0;
    }

    resetPollBackoff();
    pollBackoffMs = 0;

    let maxEventId = -1;

    try {
      const processing: Promise<void>[] = [];
      for (const event of events) {
        if (event.type === "message" && event.message) {
          // Process messages asynchronously so a slow model call does not block
          // the poll loop. The host's session locks still serialize messages
          // for the same session, while unrelated sessions can run in parallel.
          processing.push(
            processMessage(event.message).catch((err) => {
              core.error?.(
                formatZulipLog("zulip message processing error", {
                  accountId,
                  error: String(err),
                }),
              );
            }),
          );
        } else if (event.type === "reaction" && processReaction) {
          // Reaction triggers (#297) are dispatched the same way: never block
          // the poll loop, and never let a handler failure kill the monitor.
          processing.push(
            processReaction(event as ZulipReactionEvent).catch((err) => {
              core.error?.(
                formatZulipLog("zulip reaction processing error", {
                  accountId,
                  error: String(err),
                }),
              );
            }),
          );
        }
        const nextEventId = Number((event as { id?: unknown })?.id);
        if (!Number.isNaN(nextEventId) && nextEventId > maxEventId) {
          maxEventId = nextEventId;
        }
      }
      // Intentionally do NOT await processing here. The poll loop must keep
      // fetching events; processMessage handles its own errors and retries.
      void Promise.all(processing);
    } finally {
      if (maxEventId > 0) {
        // Previously, we updated the queue manager (which writes to disk) for every event.
        // By keeping track of the maxEventId and updating once per batch, we turn
        // O(N) disk writes into O(1) writes, drastically reducing I/O operations.
        // It's in a finally block to make sure progress is not lost upon errors.
        await queueManager.updateLastEventId(maxEventId);
      }
    }
  } catch (err) {
    if (opts.abortSignal?.aborted) {
      return { pollBackoffMs, idleBackoffMs, shouldContinue: false };
    }
    const errStr = String(err);
    if (errStr.toLowerCase().includes("bad event queue")) {
      await queueManager.markQueueExpired();
      // /events requests that consume the rate-limit budget.
      pLogger?.info?.("zulip poll throttle: bad queue (exception path), waiting 1s", {
        accountId,
      });
      const backoffMs = 1000;
      await delay(backoffMs);
      return { pollBackoffMs: backoffMs, idleBackoffMs: 0, shouldContinue: true };
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

  return { pollBackoffMs, idleBackoffMs, shouldContinue: true };
}
