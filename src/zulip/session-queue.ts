/**
 * Per-session dispatch queue (#297 follow-up).
 *
 * OpenClaw serializes runs **per session** (one Zulip topic, or one DM = one
 * session) and decides what to do with a message that arrives mid-run via
 * `messages.queue.mode`:
 *
 *   - `steer` (the host default) pushes it *into* the running turn;
 *   - `followup` waits until the run finishes;
 *   - `collect` waits and batches;
 *   - `interrupt` aborts the run.
 *
 * For a room with two people that default is wrong: teammate B's message
 * redirects teammate A's in-flight work. Both reference implementations we
 * compared behave like `followup` — OpenClaw's own Slack model serializes per
 * thread, and Buzz explicitly queues `@mention`s per channel with *"at most one
 * prompt in-flight per channel; subsequent @mentions queue until the agent
 * responds"*.
 *
 * The per-channel host knob (`messages.queue.byChannel.<channel>`) cannot be
 * used from a third-party channel: the host rejects an unknown channel id as
 * `Unrecognized key: "zulip"`. A per-message override is not exposed to channel
 * plugins either (`queueModeOverride` exists only on the host's internal /
 * gateway chat-send path). So the plugin queues **before** handing the message
 * to the host: the host then never sees two concurrent turns for one session,
 * which gives `followup` semantics for Zulip only, with nothing for a user to
 * type and no effect on other channels.
 *
 * Queuing here is what also makes the wait *visible*: because we know a message
 * is waiting, we can mark it (the `onQueued` hook adds a ⏳ reaction) instead of
 * leaving the person staring at silence — Zulip has no "queued input" surface.
 *
 * Failure policy: a capped queue **never drops a message**. Past the cap the
 * task is dispatched immediately (degrading to the host's own behaviour for
 * that one message, and reported through `onCapReached`) rather than being
 * silently discarded.
 */

export type QueueMode = "off" | "followup";

export type SessionQueueConfig = {
  mode: QueueMode;
  /** Max messages waiting behind an active run for one session. */
  cap: number;
};

export type SessionQueueInput = {
  queueMode?: string;
  queueCap?: number;
};

export const DEFAULT_QUEUE_CAP = 20;
export const MAX_QUEUE_CAP = 500;

export type SessionQueueHooks = {
  /** A message was queued behind an active run (`waiting` includes it). */
  onQueued?: (info: { sessionKey: string; waiting: number }) => void;
  /** A queued message's turn has come; the run is about to start. */
  onDequeued?: (info: { sessionKey: string }) => void;
  /** The queue was full, so this message was dispatched immediately. */
  onCapReached?: (info: { sessionKey: string; waiting: number; cap: number }) => void;
};

export function resolveSessionQueueConfig(input?: SessionQueueInput): SessionQueueConfig {
  const mode: QueueMode = input?.queueMode === "followup" ? "followup" : "off";
  const rawCap = input?.queueCap;
  const cap =
    typeof rawCap === "number" && Number.isFinite(rawCap)
      ? Math.min(Math.max(Math.round(rawCap), 1), MAX_QUEUE_CAP)
      : DEFAULT_QUEUE_CAP;
  return { mode, cap };
}

/**
 * Serializes tasks per session key.
 *
 * `run` resolves/rejects with the task's own result, so callers keep their
 * error handling (the monitor uses the dispatch result to decide terminal
 * status) — queuing must never swallow an error.
 */
export class SessionDispatchQueue {
  private readonly mode: QueueMode;
  private readonly cap: number;
  private readonly hooks: SessionQueueHooks;
  private readonly log?: (message: string, meta?: Record<string, unknown>) => void;
  /** Resolves when the session's most recently accepted task finishes. */
  private readonly tails = new Map<string, Promise<void>>();
  private readonly waiting = new Map<string, number>();

  constructor(opts: { config?: SessionQueueConfig; hooks?: SessionQueueHooks; log?: SessionDispatchQueue["log"] }) {
    const config = opts.config ?? { mode: "off", cap: DEFAULT_QUEUE_CAP };
    this.mode = config.mode;
    this.cap = config.cap;
    this.hooks = opts.hooks ?? {};
    this.log = opts.log;
  }

  /** Number of messages waiting behind a run for this session. */
  waitingCount(sessionKey: string): number {
    return this.waiting.get(sessionKey) ?? 0;
  }

  async run<T>(
    sessionKey: string,
    task: () => Promise<T>,
    /** Per-call hooks, e.g. to mark *this* message as waiting. Override the instance hooks. */
    callHooks?: SessionQueueHooks,
  ): Promise<T> {
    if (this.mode === "off") {
      return task();
    }
    const onQueued = callHooks?.onQueued ?? this.hooks.onQueued;
    const onDequeued = callHooks?.onDequeued ?? this.hooks.onDequeued;
    const onCapReached = callHooks?.onCapReached ?? this.hooks.onCapReached;

    const previous = this.tails.get(sessionKey);
    if (!previous) {
      return this.start(sessionKey, task);
    }

    const waiting = (this.waiting.get(sessionKey) ?? 0) + 1;
    this.waiting.set(sessionKey, waiting);
    if (waiting > this.cap) {
      // Never drop a message: dispatch immediately instead. Degrades to the
      // host's behaviour for this message only, and says so.
      this.waiting.set(sessionKey, waiting - 1);
      this.log?.("zulip session queue at capacity; dispatching immediately", {
        sessionKey,
        waiting: waiting - 1,
        cap: this.cap,
      });
      this.hooks.onCapReached?.({ sessionKey, waiting: waiting - 1, cap: this.cap });
      return this.start(sessionKey, task);
    }

    onQueued?.({ sessionKey, waiting });
    // Chain onto the tail **at enqueue time**, not after the wait: reading the
    // tail later would make two followers wait on the same predecessor and then
    // run concurrently, breaking FIFO.
    const chained = (async () => {
      try {
        await previous;
      } finally {
        const remaining = Math.max(0, (this.waiting.get(sessionKey) ?? 1) - 1);
        if (remaining > 0) this.waiting.set(sessionKey, remaining);
        else this.waiting.delete(sessionKey);
      }
      onDequeued?.({ sessionKey });
      return task();
    })();
    this.trackTail(sessionKey, chained);
    return chained;
  }

  private start<T>(sessionKey: string, task: () => Promise<T>): Promise<T> {
    let result: Promise<T>;
    try {
      result = task();
    } catch (err) {
      // A synchronous throw must not poison the session's chain.
      result = Promise.reject(err);
    }
    this.trackTail(sessionKey, result);
    return result;
  }

  /** Registers `result` as the session's tail so later arrivals queue behind it. */
  private trackTail<T>(sessionKey: string, result: Promise<T>): void {
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(sessionKey, tail);
    void tail.then(() => {
      // Only clear if nothing newer took over the slot.
      if (this.tails.get(sessionKey) === tail) {
        this.tails.delete(sessionKey);
        this.waiting.delete(sessionKey);
      }
    });
  }
}
