/**
 * History-aware context (#294).
 *
 * The bridge's only durable record of a topic is Zulip itself, but the agent
 * sees just the current message plus whatever survived in its own runtime
 * memory. Ask "have we seen this error before?" and it answers from fresh
 * vibes instead of the team's actual history.
 *
 * This module harvests a *bounded* slice of the current stream/topic history
 * and hands it to the agent as evidence, so it can answer with receipts.
 *
 * Deliberate constraints:
 * - **Opt-in, off by default.** `historyContext: "off" | "on-demand" | "always"`.
 *   On-demand is the default trigger because a harvest is one more Zulip
 *   round-trip (~600ms) on the reply path and costs context budget (the same
 *   philosophy as `dmSessionTurnLimit`).
 * - **Bounded on every axis**: max messages, time window, and total characters.
 *   A topic with 6 months of history must never blow up the context.
 * - **Best-effort**: a slow or failing harvest is logged and dropped — it can
 *   never fail a dispatch, and it is wrapped in a hard timeout so a retrying
 *   API call cannot stall the reply.
 * - **Streams/topics only.** DMs already have per-user session continuity and
 *   strict isolation; harvesting them would add privacy surface for little
 *   gain (documented as a v1 scope decision).
 */

import type { ZulipClient, ZulipMessage } from "./client.js";
import { fetchZulipMessages } from "./client.js";
import { stripHtmlToText } from "./text-utils.js";

export type HistoryContextMode = "off" | "on-demand" | "always";

export type HistoryContextConfig = {
  mode: HistoryContextMode;
  /** Max messages injected into the agent's context. */
  maxMessages: number;
  /** Only messages newer than this are considered. */
  windowHours: number;
  /** Hard cap on the rendered history block. */
  maxChars: number;
};

export type HistoryContextInput = {
  historyContext?: string;
  historyMaxMessages?: number;
  historyWindowHours?: number;
  historyMaxChars?: number;
};

export const DEFAULT_HISTORY_MAX_MESSAGES = 8;
export const DEFAULT_HISTORY_WINDOW_HOURS = 72;
export const DEFAULT_HISTORY_MAX_CHARS = 4000;
/** Hard ceiling on a harvest so a retrying API call cannot stall a reply. */
export const HISTORY_HARVEST_TIMEOUT_MS = 2000;
const MAX_HISTORY_LINE = 300;

/**
 * Conservative "do we know this?" intent patterns.
 *
 * Kept deliberately narrow: a false positive costs a Zulip round-trip on the
 * reply path, and on-demand exists to keep that rare.
 */
const HISTORY_INTENT_PATTERNS: RegExp[] = [
  /have we (seen|had|hit|discussed|fixed|tried)/i,
  /seen (this|it) before/i,
  /did we (already|ever)/i,
  /(any|the) (prior|previous|earlier) (discussion|context|issue|report|mention|work)/i,
  /root cause/i,
  /known (issue|bug|problem|failure)/i,
  /duplicate of/i,
  /what happened (with|to)/i,
  /last time (we|this|it)/i,
  /history (of|on|for) (this|the)/i,
  /context (on|for|around) (this|the|that)/i,
  /already (fixed|reported|discussed|seen|tried)/i,
  /previously (fixed|reported|discussed|seen|tried)/i,
  /\bregression\b/i,
  /when did we/i,
];

export function resolveHistoryContextConfig(input?: HistoryContextInput): HistoryContextConfig {
  const mode: HistoryContextMode =
    input?.historyContext === "always"
      ? "always"
      : input?.historyContext === "on-demand"
        ? "on-demand"
        : "off";
  const maxMessages = clampInt(input?.historyMaxMessages, 1, 50, DEFAULT_HISTORY_MAX_MESSAGES);
  const windowHours = clampInt(input?.historyWindowHours, 1, 8760, DEFAULT_HISTORY_WINDOW_HOURS);
  const maxChars = clampInt(input?.historyMaxChars, 200, 20_000, DEFAULT_HISTORY_MAX_CHARS);
  return { mode, maxMessages, windowHours, maxChars };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), min), max);
}

/** Whether this inbound text should trigger a harvest for the given mode. */
export function shouldHarvestHistory(mode: HistoryContextMode, text: string): boolean {
  if (mode === "off") return false;
  if (mode === "always") return true;
  if (!text) return false;
  return HISTORY_INTENT_PATTERNS.some((pattern) => pattern.test(text));
}

function relativeAge(timestampMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - timestampMs) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** The trace/placeholder messages this plugin writes are status noise, not history. */
function isStatusNoise(text: string): boolean {
  return (
    /^\*\*Working\*\* —/.test(text) ||
    /^[✅❌⚪] \*\*(Done|Failed|Cancelled)\*\*/.test(text) ||
    /^🤔 Thinking\.\.\.$/.test(text)
  );
}

function renderLine(message: ZulipMessage, nowMs: number): string | undefined {
  const raw = message.content ?? "";
  const text = stripHtmlToText(raw).replace(/\s+/g, " ").trim();
  if (!text || isStatusNoise(text)) return undefined;
  const sender =
    (message.sender_full_name ?? "").trim() || (message.sender_email ?? "").trim() || "unknown";
  const truncated =
    text.length <= MAX_HISTORY_LINE ? text : `${text.slice(0, MAX_HISTORY_LINE - 1)}…`;
  const timestampMs = message.timestamp ? message.timestamp * 1000 : undefined;
  const age = timestampMs ? ` (${relativeAge(timestampMs, nowMs)})` : "";
  return `- ${sender}${age}: ${truncated}`;
}

/**
 * Renders the bounded history block, or `undefined` when there is nothing
 * useful to add.
 *
 * Selection is newest-first so the character budget always keeps the most
 * recent context, then the kept lines are emitted oldest → newest.
 */
export function formatHistoryContext(params: {
  messages: ZulipMessage[];
  stream: string;
  topic?: string;
  config: HistoryContextConfig;
  currentMessageId?: string;
  nowMs?: number;
}): string | undefined {
  const { messages, config } = params;
  const nowMs = params.nowMs ?? Date.now();
  const oldestAllowedMs = nowMs - config.windowHours * 3_600_000;

  const candidates: ZulipMessage[] = [];
  for (const message of messages) {
    if (params.currentMessageId && String(message.id) === String(params.currentMessageId)) continue;
    if (message.timestamp) {
      const timestampMs = message.timestamp * 1000;
      if (timestampMs < oldestAllowedMs) continue;
    }
    candidates.push(message);
  }

  // Sort newest → oldest, then keep while the budget allows.
  candidates.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

  const kept: string[] = [];
  let used = 0;
  for (const message of candidates) {
    if (kept.length >= config.maxMessages) break;
    const line = renderLine(message, nowMs);
    if (!line) continue;
    if (used + line.length + 1 > config.maxChars) break;
    kept.push(line);
    used += line.length + 1;
  }
  if (kept.length === 0) return undefined;

  kept.reverse();
  const where = params.topic ? `#${params.stream} / ${params.topic}` : `#${params.stream}`;
  return [
    `[Zulip history — ${kept.length} earlier message(s) in ${where}]`,
    ...kept,
    "[end history]",
  ].join("\n");
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return promise.then((value) => value as T | undefined);
  }
  return new Promise<T | undefined>((resolve, reject) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Fetches and formats recent history for one stream/topic.
 *
 * Never throws: on timeout or error it logs and returns `undefined` so the
 * dispatch proceeds without history.
 */
export async function harvestTopicHistory(params: {
  client: ZulipClient;
  stream: string;
  topic?: string;
  config: HistoryContextConfig;
  currentMessageId?: string;
  nowMs?: number;
  timeoutMs?: number;
  log?: (message: string) => void;
  /** Injected for tests. */
  fetchMessages?: (
    client: ZulipClient,
    params: { stream: string; topic?: string; limit?: number },
  ) => Promise<ZulipMessage[]>;
}): Promise<string | undefined> {
  const { config } = params;
  if (config.mode === "off") return undefined;

  const log = params.log ?? (() => {});
  const fetchMessages = params.fetchMessages ?? fetchZulipMessages;

  try {
    // Over-fetch so filtering (current message, status noise, window) still
    // leaves enough candidates for the message budget.
    const limit = Math.min(1000, config.maxMessages * 4 + 1);
    const messages = await withTimeout(
      fetchMessages(params.client, { stream: params.stream, topic: params.topic, limit }),
      params.timeoutMs ?? HISTORY_HARVEST_TIMEOUT_MS,
    );
    if (!messages) {
      log("zulip history harvest timed out");
      return undefined;
    }
    return formatHistoryContext({
      messages,
      stream: params.stream,
      topic: params.topic,
      config,
      currentMessageId: params.currentMessageId,
      nowMs: params.nowMs,
    });
  } catch (err) {
    log(`zulip history harvest failed: ${String(err)}`);
    return undefined;
  }
}
