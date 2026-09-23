/**
 * Activity trace core (epic #293, sub-issue #300).
 *
 * One live, in-place-updated status message per work item, so the room sees the
 * agent's work as a story instead of a single final snapshot.
 *
 * Design rules encoded here:
 * - **Status detail → edit the trace. Actionable result → post a new message.**
 *   This module only ever owns its own dedicated bot message; agent replies stay
 *   separate messages.
 * - **Coalescing is non-negotiable.** Zulip edits are ~600ms round-trips. A
 *   coalescing window (`traceCoalesceMs`) plus a hard rate ceiling
 *   (`traceMaxRate`, ≤2 PATCH/sec by default) keep a chatty agent from turning
 *   the topic into a metronome.
 * - **Best-effort, never blocking.** Tracing must never add latency to agent
 *   work or break a reply. Posts and edits are fire-and-forget; a failed write
 *   is logged and dropped — never retried in a loop (cf. the #287 poll-spin-loop
 *   lesson), never surfaced as a user-visible error.
 * - **Stable step ids.** Steps are upserted by id, so a step flips ✅ / ⏳ / ❌ / 💬
 *   in place instead of appending a log line.
 *
 * The write path deliberately reuses `send.ts` (`sendMessageZulip`, so the
 * outbound secret guard and media/SSRF hardening are inherited) and
 * `client.ts` (`editZulipMessage`), rather than reimplementing request handling.
 */

import { editZulipMessage, type ZulipClient } from "./client.js";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/core";
import { getZulipRuntime } from "../runtime.js";
import { collectKnownSecrets, redactSecrets } from "./secret-guard.js";
import { sendMessageZulip } from "./send.js";
import fs from "node:fs/promises";

export type TraceStepStatus = "running" | "done" | "failed" | "note";

export type TraceStep = {
  /** Stable id: re-using an id updates the existing step in place. */
  id: string;
  label: string;
  status: TraceStepStatus;
  detail?: string;
  durationMs?: number;
};

export type TraceStatus = "running" | "done" | "failed" | "cancelled";

export type TraceTarget = {
  /** Target string understood by `send.ts` (`stream:<name>:<topic>` / `user:<email>`). */
  to: string;
  /** Topic, used only when `to` carries no topic. */
  topic?: string;
  accountId?: string;
};

export type TraceState = {
  id: string;
  title: string;
  target: TraceTarget;
  sessionKey?: string;
  runId?: string;
  /** Zulip message id of the dedicated trace message, once posted. */
  messageId?: string;
  status: TraceStatus;
  summary?: string;
  steps: TraceStep[];
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
};

/** Injected write path so tests can run without a Zulip client. */
export type TraceIo = {
  post: (target: TraceTarget, content: string) => Promise<string | undefined>;
  edit: (messageId: string, content: string) => Promise<void>;
};
/** What `persistPath` holds for a trace that is still running (see `recoverInterruptedTraces`). */
export type PersistedTrace = {
  messageId: string;
  target: TraceTarget;
  title: string;
  createdAt: number;
};

export type TraceLogger = {
  info?: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
};

export type TraceTiming = {
  coalesceMs: number;
  minIntervalMs: number;
  maxRatePerSec: number;
};

export type TraceConfigInput = {
  activityTrace?: boolean;
  traceCoalesceMs?: number;
  traceMaxRate?: number;
};

export const DEFAULT_TRACE_COALESCE_MS = 400;
export const DEFAULT_TRACE_MAX_RATE = 2;
/** Compact final block: the trace is a status board, not an archive of steps. */
export const DEFAULT_TRACE_MAX_CONTENT = 3500;
const MAX_TRACE_STEPS = 20;
const MAX_TRACE_TITLE = 140;
const MAX_TRACE_LABEL = 120;
const MAX_TRACE_DETAIL = 180;
const FINISHED_RETENTION_MS = 5 * 60_000;

const STEP_ICON: Record<TraceStepStatus, string> = {
  running: "⏳",
  done: "✅",
  failed: "❌",
  note: "💬",
};

const FINAL_ICON: Record<Exclude<TraceStatus, "running">, string> = {
  done: "✅",
  failed: "❌",
  cancelled: "⚪",
};

const FINAL_LABEL: Record<Exclude<TraceStatus, "running">, string> = {
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Collapses whitespace and truncates, so one step can never wreck the block. */
function sanitizeText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, Math.max(0, max - 1))}…`;
}

export function formatTraceDuration(durationMs?: number): string | undefined {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
    return undefined;
  }
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
  const totalSeconds = Math.round(durationMs / 1000);
  return `${Math.floor(totalSeconds / 60)}m${String(totalSeconds % 60).padStart(2, "0")}s`;
}

function renderStep(step: TraceStep): string {
  const icon = STEP_ICON[step.status] ?? STEP_ICON.running;
  const parts = [sanitizeText(step.label, MAX_TRACE_LABEL)];
  const detail = sanitizeText(step.detail, MAX_TRACE_DETAIL);
  if (detail) parts.push(`— ${detail}`);
  const duration = formatTraceDuration(step.durationMs);
  if (duration) parts.push(`(${duration})`);
  return `- ${icon} ${parts.join(" ")}`;
}

/**
 * Renders the whole trace message.
 *
 * While running: a header plus one line per step.
 * Finished: a single compact summary line (the step block collapses, but the
 * message — and Zulip's own edit history — keeps the audit trail).
 */
export function renderTraceContent(
  state: TraceState,
  opts: { maxLength?: number } = {},
): string {
  const maxLength =
    typeof opts.maxLength === "number" && opts.maxLength > 0
      ? opts.maxLength
      : DEFAULT_TRACE_MAX_CONTENT;

  let content: string;
  if (state.status === "running") {
    const header = `**Working** — ${sanitizeText(state.title, MAX_TRACE_TITLE) || "work item"}`;
    const steps = state.steps.map(renderStep);
    content = steps.length > 0 ? `${header}\n\n${steps.join("\n")}` : header;
  } else {
    const icon = FINAL_ICON[state.status];
    const label = FINAL_LABEL[state.status];
    const summary = sanitizeText(state.summary, MAX_TRACE_TITLE);
    const title = sanitizeText(state.title, MAX_TRACE_TITLE);
    content = `${icon} **${label}** — ${summary || title || "work item"}`;
  }

  return content.length <= maxLength ? content : content.slice(0, Math.max(0, maxLength - 1)) + "…";
}

/** Clamps operator-supplied timing so a bad value cannot disable or flood edits. */
export function resolveTraceTiming(config?: TraceConfigInput): TraceTiming {
  const rawCoalesce = config?.traceCoalesceMs;
  const coalesceMs =
    typeof rawCoalesce === "number" && Number.isFinite(rawCoalesce)
      ? Math.min(Math.max(Math.round(rawCoalesce), 0), 60_000)
      : DEFAULT_TRACE_COALESCE_MS;
  const rawRate = config?.traceMaxRate;
  const maxRatePerSec =
    typeof rawRate === "number" && Number.isFinite(rawRate)
      ? Math.min(Math.max(rawRate, 0.1), 50)
      : DEFAULT_TRACE_MAX_RATE;
  return { coalesceMs, minIntervalMs: Math.round(1000 / maxRatePerSec), maxRatePerSec };
}

export function resolveActivityTraceConfig(config?: TraceConfigInput): {
  enabled: boolean;
  timing: TraceTiming;
} {
  return {
    enabled: config?.activityTrace === true,
    timing: resolveTraceTiming(config),
  };
}

type TimerHandle = ReturnType<typeof setTimeout>;

export type TraceScheduler = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
};

const defaultScheduler: TraceScheduler = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

type TraceRecord = {  state: TraceState;
  ready: Promise<string | undefined>;
  /** True until the initial post settles — the post is a write too. */
  posting: boolean;
  timer?: TimerHandle;
  inFlight: boolean;
  dirty: boolean;
  dead: boolean;
  lastEditAt: number;
  /** Last content written, so an unchanged render does not spend a PATCH. */
  lastContent: string;
  settleWaiters: Array<() => void>;
};

export type ActivityTraceManagerOpts = {
  io: TraceIo;
  log?: TraceLogger;
  config?: TraceConfigInput;
  scheduler?: TraceScheduler;
  /** Called when a trace is dropped because its post failed. */
  onDrop?: (state: TraceState, error: unknown) => void;
  /**
   * File used to remember in-flight traces across restarts.
   *
   * A trace can only be finalized by the process that created it, so a run
   * killed mid-flight (deploy, OOM, crash) otherwise leaves `**Working** — …`
   * frozen in the topic forever — the one case where "no trace is left
   * permanently in progress" does not hold. With a path set, in-flight traces
   * are written here and `recoverInterruptedTraces()` closes them out on the
   * next start.
   */
  persistPath?: string;
  /**
   * Called when a recovery edit fails, so the failure can be surfaced.
   *
   * Zulip only lets the bot edit its own message for a limited time
   * (`message_content_edit_limit_seconds`), so a trace discovered long after
   * the crash cannot be fixed — and plugin logs do not reach the host log on
   * every host, so silently logging it means nobody ever learns why a status
   * line is stuck.
   */
  onRecoveryError?: (info: { messageId: string; error: string }) => void;
};

/**
 * Owns every live trace for one account and serializes their writes.
 *
 * A trace is keyed by work item, never by topic: two concurrent runs in the
 * same topic must not share one message, or interleaved edits corrupt the block.
 */
export class ActivityTraceManager {
  private readonly io: TraceIo;
  private readonly log?: TraceLogger;
  private readonly timing: TraceTiming;
  private readonly scheduler: TraceScheduler;
  private readonly onDrop?: ActivityTraceManagerOpts["onDrop"];
  private readonly persistPath?: string;
  private readonly onRecoveryError?: ActivityTraceManagerOpts["onRecoveryError"];
  private readonly records = new Map<string, TraceRecord>();
  private counter = 0;

  constructor(opts: ActivityTraceManagerOpts) {
    this.io = opts.io;
    this.log = opts.log;
    this.timing = resolveTraceTiming(opts.config);
    this.scheduler = opts.scheduler ?? defaultScheduler;
    this.onDrop = opts.onDrop;
    this.persistPath = opts.persistPath;
    this.onRecoveryError = opts.onRecoveryError;
  }

  /**
   * Closes out traces a previous process left mid-flight.
   *
   * Best-effort and idempotent: each remembered message is edited to a
   * cancelled summary line, then the record file is removed. Never throws — a
   * recovery edit that fails (message deleted, network down) is logged and the
   * file still gets cleared so this cannot repeat forever.
   */
  async recoverInterruptedTraces(): Promise<number> {
    if (!this.persistPath) return 0;
    let entries: PersistedTrace[] = [];
    try {
      const raw = await fs.readFile(this.persistPath, "utf8");
      const parsed = JSON.parse(raw);
      entries = Array.isArray(parsed) ? (parsed as PersistedTrace[]) : [];
    } catch {
      // No file (or unreadable) means nothing was in flight.
      return 0;
    }

    let recovered = 0;
    for (const entry of entries) {
      const messageId = entry?.messageId;
      if (!messageId) continue;
      try {
        await this.io.edit(
          String(messageId),
          renderTraceContent({
            id: `recovered-${messageId}`,
            title: entry.title ?? "work item",
            target: entry.target ?? { to: "" },
            status: "cancelled",
            summary: "run interrupted by a gateway restart",
            steps: [],
            createdAt: entry.createdAt ?? this.scheduler.now(),
            updatedAt: this.scheduler.now(),
            finishedAt: this.scheduler.now(),
          }),
        );
        recovered += 1;
      } catch (err) {
        // Surfaced, not just logged: see `onRecoveryError`.
        this.log?.warn?.("zulip activity trace recovery edit failed", {
          messageId: String(messageId),
          error: String(err),
        });
        this.onRecoveryError?.({ messageId: String(messageId), error: String(err) });
      }
    }

    try {
      await fs.unlink(this.persistPath);
    } catch {
      // Already gone / not permitted: nothing more to do.
    }
    if (recovered > 0) {
      this.log?.info?.("zulip activity traces recovered after restart", { recovered });
    }
    return recovered;
  }

  /**
   * Writes the in-flight traces (those with a posted message and a running
   * status). Finished and dropped traces are therefore *excluded*, which is what
   * removes them from the file — so recovery only ever touches stale ones.
   */
  private persistPending(): void {
    if (!this.persistPath) return;
    const pending: PersistedTrace[] = [];
    for (const record of this.records.values()) {
      const { state } = record;
      if (record.dead || state.status !== "running" || !state.messageId) continue;
      pending.push({
        messageId: state.messageId,
        target: state.target,
        title: state.title,
        createdAt: state.createdAt,
      });
    }
    void fs.writeFile(this.persistPath, JSON.stringify(pending), "utf8").catch((err) => {
      this.log?.warn?.("zulip activity trace persist failed", { error: String(err) });
    });
  }

  get timingConfig(): TraceTiming {
    return this.timing;
  }

  /**
   * Creates a trace and posts its initial message in the background.
   *
   * Deliberately synchronous: the caller (a dispatch path) must never wait on a
   * ~600ms Zulip round-trip. Steps recorded before the post resolves are
   * coalesced and applied right after it.
   */
  start(input: {
    title: string;
    target: TraceTarget;
    id?: string;
    sessionKey?: string;
    runId?: string;
  }): ActivityTrace {
    const now = this.scheduler.now();
    const id = input.id?.trim() || this.nextId();
    const state: TraceState = {
      id,
      title: sanitizeText(input.title, MAX_TRACE_TITLE) || "work item",
      target: input.target,
      sessionKey: input.sessionKey,
      runId: input.runId,
      status: "running",
      steps: [],
      createdAt: now,
      updatedAt: now,
    };

    const record: TraceRecord = {
      state,
      ready: Promise.resolve(undefined),
      posting: true,
      inFlight: false,
      dirty: false,
      dead: false,
      lastEditAt: 0,
      lastContent: "",
      settleWaiters: [],
    };

    const initialContent = renderTraceContent(state);
    record.lastContent = initialContent;
    record.ready = this.io.post(state.target, initialContent).then(
      (messageId) => {
        record.posting = false;
        if (record.dead) {
          this.resolveSettle(record);
          return undefined;
        }
        if (!messageId) {
          this.dropRecord(record, new Error("trace post returned no message id"));
          return undefined;
        }
        state.messageId = messageId;
        // Remember it: if this process dies before `finish`, the next start
        // closes the message out instead of leaving it saying "Working".
        this.persistPending();
        // Steps may have arrived while the post was in flight.
        if (record.dirty) this.scheduleFlush(record);
        else this.resolveSettle(record);
        return messageId;
      },
      (err) => {
        record.posting = false;
        this.dropRecord(record, err);
        return undefined;
      },
    );

    this.records.set(id, record);
    this.pruneFinished();
    return new ActivityTrace(this, id);
  }

  get(id: string | undefined): ActivityTrace | undefined {
    if (!id || !this.records.has(id)) return undefined;
    return new ActivityTrace(this, id);
  }

  /** Lookup used by mode A (#302) to attribute a hook to a room. */
  findBySessionKey(sessionKey: string | undefined): ActivityTrace | undefined {
    if (!sessionKey) return undefined;
    for (const [id, record] of this.records) {
      if (record.state.sessionKey === sessionKey && !record.dead) {
        return new ActivityTrace(this, id);
      }
    }
    return undefined;
  }

  /** Lookup used by mode A (#302) to attribute a hook to a room. */
  findByRunId(runId: string | undefined): ActivityTrace | undefined {
    if (!runId) return undefined;
    for (const [id, record] of this.records) {
      if (record.state.runId === runId && !record.dead) {
        return new ActivityTrace(this, id);
      }
    }
    return undefined;
  }

  list(): TraceState[] {
    return [...this.records.values()].map((record) => record.state);
  }

  size(): number {
    return this.records.size;
  }

  state(id: string): TraceState | undefined {
    return this.records.get(id)?.state;
  }

  isFinished(id: string): boolean {
    const record = this.records.get(id);
    if (!record || record.dead) return true;
    return record.state.status !== "running";
  }

  attachRunId(id: string, runId: string | undefined): void {
    const record = this.records.get(id);
    if (record && !record.dead && runId) {
      record.state.runId = runId;
    }
  }

  upsertStep(id: string, step: Partial<TraceStep> & { id: string; label?: string }): void {
    const record = this.records.get(id);
    if (!record || record.dead || record.state.status !== "running") return;

    const stepId = step.id;
    if (!stepId) return;
    const existing = record.state.steps.find((candidate) => candidate.id === stepId);
    if (existing) {
      if (step.label !== undefined) existing.label = step.label;
      if (step.status !== undefined) existing.status = step.status;
      if (step.detail !== undefined) existing.detail = step.detail;
      if (step.durationMs !== undefined) existing.durationMs = step.durationMs;
    } else {
      record.state.steps.push({
        id: stepId,
        label: step.label ?? stepId,
        status: step.status ?? "running",
        detail: step.detail,
        durationMs: step.durationMs,
      });
    }
    this.pruneSteps(record);
    this.markDirty(record);
  }

  finish(
    id: string,
    opts: { status: Exclude<TraceStatus, "running">; summary?: string },
  ): void {
    const record = this.records.get(id);
    if (!record || record.dead || record.state.status !== "running") return;
    record.state.status = opts.status;
    record.state.summary = opts.summary;
    record.state.finishedAt = this.scheduler.now();
    // Dropped from the persisted set (it is no longer "running").
    this.persistPending();
    this.markDirty(record);
  }

  /** Resolves once no write is pending or in flight for the trace. */
  async settle(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    if (record.dead || (!record.posting && !record.timer && !record.inFlight && !record.dirty)) {
      return;
    }
    await new Promise<void>((resolve) => {
      record.settleWaiters.push(resolve);
    });
  }

  /** Clears timers and forgets every trace (monitor shutdown / tests). */
  stop(): void {
    // Persist *before* clearing: a graceful shutdown also leaves in-flight
    // traces unfinalized, and the next start should close them out rather than
    // leaving them frozen. The file is deliberately not deleted here.
    this.persistPending();
    for (const record of this.records.values()) {
      if (record.timer) {
        this.scheduler.clearTimeout(record.timer);
        record.timer = undefined;
      }
      record.dead = true;
      const waiters = record.settleWaiters.splice(0);
      for (const resolve of waiters) resolve();
    }
    this.records.clear();
  }

  clearFinished(): void {
    for (const [id, record] of this.records) {
      if (record.state.status !== "running") {
        this.resolveSettle(record);
        this.records.delete(id);
      }
    }
  }

  private nextId(): string {
    this.counter += 1;
    return `trace-${this.scheduler.now().toString(36)}-${this.counter.toString(36)}`;
  }

  private pruneSteps(record: TraceRecord): void {
    if (record.state.steps.length <= MAX_TRACE_STEPS) return;
    const running = record.state.steps.filter((step) => step.status === "running");
    const settled = record.state.steps.filter((step) => step.status !== "running");
    const keepSettled = settled.slice(Math.max(0, settled.length - (MAX_TRACE_STEPS - running.length)));
    const keepIds = new Set([...running, ...keepSettled].map((step) => step.id));
    record.state.steps = record.state.steps.filter((step) => keepIds.has(step.id));
  }

  private pruneFinished(): void {
    const now = this.scheduler.now();
    for (const [id, record] of this.records) {
      if (
        record.state.status !== "running" &&
        record.state.finishedAt !== undefined &&
        now - record.state.finishedAt > FINISHED_RETENTION_MS
      ) {
        this.records.delete(id);
      }
    }
  }

  private dropRecord(record: TraceRecord, error: unknown): void {
    record.dead = true;
    record.dirty = false;
    if (record.timer) {
      this.scheduler.clearTimeout(record.timer);
      record.timer = undefined;
    }
    this.log?.warn?.("zulip activity trace dropped", {
      traceId: record.state.id,
      error: String(error),
    });
    this.onDrop?.(record.state, error);
    this.resolveSettle(record);
  }

  private markDirty(record: TraceRecord): void {
    if (record.dead) return;
    record.state.updatedAt = this.scheduler.now();
    record.dirty = true;
    if (record.inFlight || record.timer) return;
    this.scheduleFlush(record);
  }

  private scheduleFlush(record: TraceRecord): void {
    if (record.dead || record.timer) return;
    const sinceEdit =
      record.lastEditAt > 0 ? this.scheduler.now() - record.lastEditAt : Number.POSITIVE_INFINITY;
    const rateDelay = Number.isFinite(sinceEdit)
      ? Math.max(0, this.timing.minIntervalMs - sinceEdit)
      : 0;
    const delayMs = Math.max(this.timing.coalesceMs, rateDelay);
    record.timer = this.scheduler.setTimeout(() => {
      record.timer = undefined;
      void this.flush(record);
    }, delayMs);
    // Deliberately NOT `unref()`'d: an unreferenced timer lets the event loop
    // drain while a caller is still awaiting the flush, which node:test reports
    // as "Promise resolution is still pending" and cancels. Timers are cleared
    // on `stop()`, so a shutdown never waits on a pending trace edit.
  }

  private async flush(record: TraceRecord): Promise<void> {
    if (record.dead) {
      this.resolveSettle(record);
      return;
    }
    if (record.inFlight) {
      record.dirty = true;
      return;
    }
    record.inFlight = true;
    record.dirty = false;
    try {
      const messageId = await record.ready;
      if (!messageId) {
        // Dead traces already resolved their waiters when they were dropped.
        if (!record.dead) this.dropRecord(record, new Error("trace message unavailable"));
        return;
      }
      const content = renderTraceContent(record.state);
      if (content === record.lastContent) {
        return;
      }
      await this.io.edit(messageId, content);
      record.lastContent = content;
      record.lastEditAt = this.scheduler.now();
    } catch (err) {
      // Log-and-drop: no retry, no user-visible error, no blocked agent work.
      this.log?.warn?.("zulip activity trace edit failed", {
        traceId: record.state.id,
        error: String(err),
      });
    } finally {
      record.inFlight = false;
      if (record.dead) {
        this.resolveSettle(record);
      } else if (record.dirty || record.timer) {
        // A mutation landed mid-flight, or a rate-delayed flush is scheduled.
        if (record.dirty) this.scheduleFlush(record);
      } else {
        this.resolveSettle(record);
      }
    }
  }

  private resolveSettle(record: TraceRecord): void {
    if (record.dead) {
      const deadWaiters = record.settleWaiters.splice(0);
      for (const resolve of deadWaiters) resolve();
      return;
    }
    if (record.posting || record.inFlight || record.timer || record.dirty) return;
    const waiters = record.settleWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }
}

/** Thin handle so callers never hold a stale state object. */
export class ActivityTrace {
  private readonly manager: ActivityTraceManager;
  readonly id: string;

  constructor(manager: ActivityTraceManager, id: string) {
    this.manager = manager;
    this.id = id;
  }

  get state(): TraceState | undefined {
    return this.manager.state(this.id);
  }

  get messageId(): string | undefined {
    return this.manager.state(this.id)?.messageId;
  }

  get status(): TraceStatus | undefined {
    return this.manager.state(this.id)?.status;
  }

  isFinished(): boolean {
    return this.manager.isFinished(this.id);
  }

  attachRunId(runId: string | undefined): this {
    this.manager.attachRunId(this.id, runId);
    return this;
  }

  /** Upsert a step by stable id; re-using the id flips it in place. */
  step(
    id: string,
    label: string,
    opts: { status?: TraceStepStatus; detail?: string; durationMs?: number } = {},
  ): this {
    this.manager.upsertStep(this.id, {
      id,
      label,
      status: opts.status ?? "running",
      detail: opts.detail,
      durationMs: opts.durationMs,
    });
    return this;
  }

  complete(id: string, opts: { detail?: string; durationMs?: number } = {}): this {
    this.manager.upsertStep(this.id, { id, status: "done", ...opts });
    return this;
  }

  failStep(id: string, opts: { label?: string; detail?: string; durationMs?: number } = {}): this {
    this.manager.upsertStep(this.id, { id, status: "failed", ...opts });
    return this;
  }

  /** 💬 narration line — intent the plugin cannot infer from tool calls. */
  note(text: string, id?: string): this {
    this.manager.upsertStep(this.id, {
      id: id ?? `note-${this.state?.steps.length ?? 0}`,
      label: text,
      status: "note",
    });
    return this;
  }

  /** Final edit: collapses the block to one compact summary line. */
  finish(opts: { status: Exclude<TraceStatus, "running">; summary?: string }): void {
    this.manager.finish(this.id, opts);
  }

  settle(): Promise<void> {
    return this.manager.settle(this.id);
  }
}

/** Default write path: `send.ts` for the post, `client.ts` for the edits. */
export function createZulipTraceIo(
  client: ZulipClient,
  opts: { cfg?: unknown; log?: TraceLogger } = {},
): TraceIo {
  // Edits go straight through `editZulipMessage`, which — unlike
  // `sendMessageZulip` — has no secret guard. A tool error or command line in a
  // trace step must never be the one place a host credential reaches Zulip, so
  // both writes are redacted here as defence in depth.
  const sanitize = (content: string): string => {
    if (!content) return content;
    try {
      const cfg = opts.cfg ?? getZulipRuntime().config.current();
      const { text, redacted } = redactSecrets(content, collectKnownSecrets(cfg));
      if (redacted > 0) {
        opts.log?.warn?.("zulip activity trace redacted credentials", { redacted });
      }
      return text;
    } catch {
      return content;
    }
  };

  return {
    post: async (target, content) => {
      const result = await sendMessageZulip(target.to, sanitize(content), {
        accountId: target.accountId,
        topic: target.topic,
      });
      const messageId = result?.messageId;
      return messageId && messageId !== "unknown" ? messageId : undefined;
    },
    edit: (messageId, content) => editZulipMessage(client, { messageId, content: sanitize(content) }),
  };
}

// ── Per-account registry ────────────────────────────────────────────────────
// The monitor owns one manager per account (it has the account's Zulip client);
// other call sites (mode A hooks in #302, `zulip_progress` in #303) reach it
// through this registry rather than re-creating one per message.

const managers = new Map<string, ActivityTraceManager>();

export function registerActivityTraceManager(
  accountId: string | undefined,
  manager: ActivityTraceManager,
): void {
  managers.set(accountId ?? DEFAULT_ACCOUNT_ID, manager);
}

export function getActivityTraceManager(
  accountId?: string,
): ActivityTraceManager | undefined {
  return managers.get(accountId ?? DEFAULT_ACCOUNT_ID);
}

/**
 * Resolves the live trace for an agent run, across every registered account.
 *
 * Hooks (#302) carry `runId`/`sessionKey` — the *agent run*, not the room — so
 * attribution is done here. Returns `undefined` when nothing matches; callers
 * must drop unattributable hooks rather than guess a topic.
 */
export function findActivityTrace(
  sessionKey?: string,
  runId?: string,
): ActivityTrace | undefined {
  if (!sessionKey && !runId) return undefined;
  for (const manager of managers.values()) {
    const byRun = manager.findByRunId(runId);
    if (byRun) return byRun;
    const bySession = manager.findBySessionKey(sessionKey);
    if (bySession) return bySession;
  }
  return undefined;
}

export function unregisterActivityTraceManager(accountId?: string): void {
  const key = accountId ?? DEFAULT_ACCOUNT_ID;
  managers.get(key)?.stop();
  managers.delete(key);
}

export function clearActivityTraceManagers(): void {
  for (const manager of managers.values()) manager.stop();
  managers.clear();
}
