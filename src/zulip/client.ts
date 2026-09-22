import path from "node:path";
import os from "node:os";
import { readSafeLocalFile } from "./fs-utils.js";
import { formatZulipLog, delay } from "./monitor-helpers.js";
import { getZulipRuntime } from "../runtime.js";

export type ZulipClient = {
  baseUrl: string;
  authHeader: string;
  fetchImpl: typeof fetch;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
};

export type ZulipApiResponse = {
  result: "success" | "error";
  msg: string;
  code?: string;
  [key: string]: unknown;
};

export type ZulipUser = {
  id: string;
  email?: string | null;
  full_name?: string | null;
  is_admin?: boolean | null;
};

type ZulipPresenceEntry = {
  status?: "active" | "idle" | string;
  timestamp?: number;
  client?: string | null;
  [key: string]: unknown;
};

export type ZulipPresenceMap = Record<string, ZulipPresenceEntry>;

export type ZulipStream = {
  id: string;
  name?: string | null;
  description?: string | null;
};

export type ZulipSubscription = {
  stream_id?: number;
  name?: string;
  description?: string | null;
  email_address?: string | null;
  invite_only?: boolean;
  is_web_public?: boolean;
};

export type ZulipMessage = {
  id: string;
  sender_id?: string | null;
  sender_email?: string | null;
  sender_full_name?: string | null;
  content?: string | null;
  timestamp?: number | null;
  type?: "stream" | "private" | string | null;
  stream_id?: string | null;
  display_recipient?: string | Array<{ id: number; email: string; full_name: string }> | null;
  subject?: string | null;
  recipient_id?: string | null;
  /** Reactions on the message, returned by /messages endpoint. */
  reactions?: Array<{
    emoji_name: string;
    emoji_code?: string;
    reaction_type?: string;
    user?: { email: string; id: number; full_name?: string };
    user_id?: number;
  }>;
  /**
   * Internal: Override the session key for recovery dispatch.
   * Set by recoverInterruptedMessages() to create a fresh session
   * when the original session was lost due to gateway restart.
   */
  _recoverySessionKey?: string;
  /**
   * Internal: this message was synthesised from a reaction trigger (#297),
   * not received from Zulip. The message handler uses it to skip the
   * "did a human address the bot?" gates (mention/onchar) while still applying
   * every policy, allowlist and rate-limit decision to the reacting user.
   */
  _reactionTrigger?: boolean;
  _reactionEmoji?: string;
  _reactionUserId?: string;
};

/**
 * Checks whether a URL hostname resolves to an internal/private IP or
 * well-known metadata endpoint. Used to prevent SSRF.
 */
export function isInternalHost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(h)) return true;
    if (h === "169.254.169.254") return true; // AWS metadata
    if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    return false;
  } catch {
    return true;
  }
}

/** Options controlling base-URL acceptance (operator-set, trusted-network opt-in). */
export type ZulipBaseUrlOptions = {
  /**
   * Operator opt-in for plaintext HTTP and private/internal hosts.
   *
   * Off by default: Zulip authenticates with HTTP Basic on every request, so an
   * `http://` realm would expose the bot's email and API key in cleartext.
   * Turning it on also relaxes the private-IP (SSRF) ban, because a self-hosted
   * Zulip on a LAN usually *is* a private address — that is the only reason to
   * use this. Only enable it on a network you trust.
   */
  allowInsecureHttp?: boolean;
};

export type ZulipBaseUrlProblem =
  | "missing"
  | "invalid-protocol"
  | "insecure-http"
  | "internal-host";

/**
 * Classifies a Zulip base URL without throwing.
 *
 * Security:
 *  - HTTPS is required unless the operator opted in (`allowInsecureHttp`).
 *  - Internal/private IP literals and cloud metadata endpoints are rejected by
 *    hostname matching unless the operator opted in.
 */
export function inspectZulipBaseUrl(
  raw?: string | null,
  opts?: ZulipBaseUrlOptions,
): { url: string } | { problem: ZulipBaseUrlProblem } {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return { problem: "missing" };
  }
  const isHttp = /^http:\/\//i.test(trimmed);
  const isHttps = /^https:\/\//i.test(trimmed);
  if (!isHttp && !isHttps) {
    return { problem: "invalid-protocol" };
  }
  const allowInsecure = opts?.allowInsecureHttp === true;
  if (isHttp && !allowInsecure) {
    return { problem: "insecure-http" };
  }
  if (!allowInsecure && isInternalHost(trimmed)) {
    return { problem: "internal-host" };
  }
  return { url: trimmed.replace(/\/+$/, "") };
}

/**
 * Normalizes a Zulip base URL by trimming whitespace and removing trailing slashes.
 * Returns undefined when the URL is unusable — use `zulipBaseUrlError` for the reason.
 */
export function normalizeZulipBaseUrl(
  raw?: string | null,
  opts?: ZulipBaseUrlOptions,
): string | undefined {
  const result = inspectZulipBaseUrl(raw, opts);
  return "url" in result ? result.url : undefined;
}

/** Human-readable explanation for a rejected base URL, or undefined when valid. */
export function zulipBaseUrlError(
  raw?: string | null,
  opts?: ZulipBaseUrlOptions,
): string | undefined {
  const result = inspectZulipBaseUrl(raw, opts);
  if ("url" in result) {
    return undefined;
  }
  switch (result.problem) {
    case "missing":
      return "Zulip site URL is required.";
    case "invalid-protocol":
      return "Zulip site URL must start with http:// or https:// (for example: https://chat.example.com).";
    case "insecure-http":
      return 'Zulip site URL uses plain http:// — the bot email and API key would be sent unencrypted. Use https://, or set "allowInsecureHttp": true in channels.zulip if this server is on a trusted network.';
    case "internal-host":
      return 'Zulip site URL points at a private/internal address, which is blocked to prevent SSRF. Set "allowInsecureHttp": true in channels.zulip if this self-hosted server is on a trusted network.';
  }
}

function buildZulipApiUrl(
  baseUrl: string,
  path: string,
): string {
  if (!baseUrl) {
    throw new Error("Zulip baseUrl is required");
  }
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}/api/v1${suffix}`;
}

function resolveRetryAfterMs(res: Response): number | undefined {
  const retryAfter = res.headers.get("retry-after");
  if (!retryAfter) {
    return undefined;
  }
  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds)) {
    return Math.max(0, seconds) * 1000;
  }
  const dateMs = Date.parse(retryAfter);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return undefined;
}

export async function readZulipError(res: Response): Promise<string> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const data = (await res.json()) as ZulipApiResponse | undefined;
      if (data?.msg) {
        return data.msg;
      }
    } catch {
      // ignore parse errors
    }
    return "Zulip API error";
  }
  return "Zulip API error";
}

export function createZulipClient(params: {
  baseUrl: string;
  email: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Operator opt-in for plaintext http / private hosts; see ZulipBaseUrlOptions. */
  allowInsecureHttp?: boolean;
}): ZulipClient {
  const baseUrl = normalizeZulipBaseUrl(params.baseUrl, {
    allowInsecureHttp: params.allowInsecureHttp,
  });
  if (!baseUrl) {
    throw new Error("Zulip baseUrl is required");
  }
  const email = params.email?.trim();
  const apiKey = params.apiKey?.trim();
  if (!email || !apiKey) {
    throw new Error("Zulip email + apiKey are required");
  }
  const authHeader = Buffer.from(`${email}:${apiKey}`).toString("base64");
  const fetchImpl = params.fetchImpl ?? fetch;

  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const url = buildZulipApiUrl(baseUrl, path);
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Basic ${authHeader}`);
    if (init?.body && !headers.has("Content-Type") && typeof init.body === "string") {
      headers.set("Content-Type", "application/x-www-form-urlencoded");
    }
    // Security/Reliability: default 30s timeout prevents indefinite hangs
    const controller = new AbortController();
    const timeoutMs = 30000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, headers, signal: controller.signal });
      if (!res.ok) {
        const detail = await readZulipError(res);
        const error = new Error(
          `Zulip API ${res.status} ${res.statusText}: ${detail || "unknown error"}`,
        ) as Error & { status?: number };
        error.status = res.status;
        throw error;
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  };

  return { baseUrl, authHeader, fetchImpl, request };
}

function assertSuccess(payload: ZulipApiResponse, context: string): void {
  if (payload.result === "success") {
    return;
  }
  throw new Error(`${context}: ${payload.msg || "unknown error"}`);
}

async function zulipRequestWithRetry<T>(
  client: ZulipClient,
  path: string,
  init?: RequestInit,
  options?: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    retryStatuses?: number[];
    rateLimitDelayMs?: number;
  },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1000;
  const maxDelayMs = options?.maxDelayMs ?? 30000;
  const retryStatuses = new Set(options?.retryStatuses ?? [429, 502, 503, 504]);
  const rateLimitDelayMs = options?.rateLimitDelayMs ?? baseDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const url = buildZulipApiUrl(client.baseUrl, path);
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Basic ${client.authHeader}`);
    if (init?.body && !headers.has("Content-Type") && typeof init.body === "string") {
      headers.set("Content-Type", "application/x-www-form-urlencoded");
    }
    let res: Response;
    try {
      res = await client.fetchImpl(url, { ...init, headers });
    } catch (err) {
      if (attempt >= maxRetries) {
        throw err;
      }
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      // We don't always have easy access to a logger here without passing it through,
      // but we can at least ensure the error is retryable.
      await delay(backoff);
      continue;
    }

    if (res.ok) {
      return (await res.json()) as T;
    }

    const status = res.status;
    const retryAfterMs = resolveRetryAfterMs(res);
    const detail = await readZulipError(res);
    const error = new Error(
      `Zulip API ${status} ${res.statusText}: ${detail || "unknown error"}`,
    ) as Error & { status?: number; retryAfterMs?: number };
    error.status = status;
    error.retryAfterMs = retryAfterMs;

    if (!retryStatuses.has(status) || attempt >= maxRetries) {
      throw error;
    }

    const base = status === 429 ? rateLimitDelayMs : baseDelayMs;
    const backoff = Math.min(maxDelayMs, base * 2 ** attempt);
    const waitMs = retryAfterMs && retryAfterMs > 0 ? Math.min(maxDelayMs, retryAfterMs) : backoff;
    await delay(waitMs);
  }

  throw new Error("Zulip API request failed after retries");
}

export async function fetchZulipMe(client: ZulipClient): Promise<ZulipUser> {
  const payload = await client.request<
    ZulipApiResponse & {
      user_id?: number;
      email?: string;
      full_name?: string;
      is_admin?: boolean;
    }
  >("/users/me");
  assertSuccess(payload, "Zulip /users/me failed");
  return {
    id: String(payload.user_id ?? ""),
    email: payload.email ?? null,
    full_name: payload.full_name ?? null,
    is_admin: payload.is_admin ?? null,
  };
}

export async function fetchZulipUser(client: ZulipClient, userId: string): Promise<ZulipUser> {
  const payload = await client.request<
    ZulipApiResponse & { user?: { user_id: number; email?: string; full_name?: string } }
  >(`/users/${encodeURIComponent(userId)}`);
  assertSuccess(payload, "Zulip /users/{id} failed");
  const user = payload.user;
  return {
    id: String(user?.user_id ?? userId),
    email: user?.email ?? null,
    full_name: user?.full_name ?? null,
  };
}

export async function fetchZulipMemberInfo(
  client: ZulipClient,
  userId?: string | null,
): Promise<ZulipUser> {
  const trimmed = userId?.trim();
  if (!trimmed || trimmed.toLowerCase() === "me") {
    return await fetchZulipMe(client);
  }
  return await fetchZulipUser(client, trimmed);
}

export async function fetchZulipStream(
  client: ZulipClient,
  streamId: string,
): Promise<ZulipStream> {
  const payload = await client.request<
    ZulipApiResponse & { stream?: { stream_id: number; name?: string; description?: string } }
  >(`/streams/${encodeURIComponent(streamId)}`);
  assertSuccess(payload, "Zulip /streams/{id} failed");
  const stream = payload.stream;
  return {
    id: String(stream?.stream_id ?? streamId),
    name: stream?.name ?? null,
    description: stream?.description ?? null,
  };
}

/**
 * Default long-poll timeout (seconds) requested at queue registration and
 * replayed on every `/events` request.
 */
export const DEFAULT_LONGPOLL_TIMEOUT_SECS = 90;
/** Zulip caps `/events` long-polls at 90 seconds. */
export const MAX_LONGPOLL_TIMEOUT_SECS = 90;
const MIN_LONGPOLL_TIMEOUT_SECS = 1;

/**
 * Clamps a server-provided long-poll timeout into the range Zulip accepts.
 * Falls back to the default when the value is missing or unusable.
 */
export function clampLongpollTimeoutSecs(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_LONGPOLL_TIMEOUT_SECS;
  }
  return Math.min(
    MAX_LONGPOLL_TIMEOUT_SECS,
    Math.max(MIN_LONGPOLL_TIMEOUT_SECS, Math.floor(n)),
  );
}

export async function registerZulipQueue(
  client: ZulipClient,
  params: {
    eventTypes?: string[];
    streams?: string[];
  },
): Promise<{ queueId: string; lastEventId: number; longpollTimeoutSecs: number }> {
  const body = new URLSearchParams();
  const eventTypes = params.eventTypes ?? ["message"];
  body.set("event_types", JSON.stringify(eventTypes));
  // Ask for the `realm` event type so the server actually returns
  // `event_queue_longpoll_timeout_seconds` in the /register response. Zulip
  // omits that field unless it is explicitly requested via `fetch_event_types`
  // (see /api/register-queue); clients must never assume the default.
  body.set("fetch_event_types", JSON.stringify(["realm"]));
  body.set("event_queue_longpoll_timeout_seconds", String(DEFAULT_LONGPOLL_TIMEOUT_SECS));
  if (params.streams && params.streams.length > 0 && !params.streams.includes("*")) {
    // Zulip expects legacy array format for narrow filters.
    const narrow = params.streams.map((stream) => ["stream", stream]);
    body.set("narrow", JSON.stringify(narrow));
  }
  if (params.streams?.includes("*")) {
    body.set("all_public_streams", "true");
  }

  const payload = await client.request<
    ZulipApiResponse & {
      queue_id?: string;
      last_event_id?: number;
      event_queue_longpoll_timeout_seconds?: number;
    }
  >("/register", { method: "POST", body: body.toString() });
  assertSuccess(payload, "Zulip /register failed");
  if (!payload.queue_id) {
    throw new Error("Zulip /register missing queue_id");
  }
  return {
    queueId: payload.queue_id,
    lastEventId: payload.last_event_id ?? -1,
    // Zulip's documented contract: clients use the value the server returned at
    // registration rather than assuming a default (see /api/get-events).
    longpollTimeoutSecs: clampLongpollTimeoutSecs(
      payload.event_queue_longpoll_timeout_seconds,
    ),
  };
}

/** Extra client-side grace on top of the server-advertised long-poll window. */
const EVENTS_TIMEOUT_GRACE_MS = 15000;

/**
 * Resolves the client-side abort budget for a `/events` long-poll.
 *
 * `timeout` is NOT a Zulip query parameter; the long-poll window the server
 * advertises at registration (`event_queue_longpoll_timeout_seconds`) has to be
 * enforced by the client. We add a small grace period so a well-behaved server
 * does not race our abort.
 */
export function resolveEventsTimeoutMs(params: {
  timeoutSecs?: number;
  timeoutMs?: number;
}): number {
  if (params.timeoutSecs !== undefined) {
    return clampLongpollTimeoutSecs(params.timeoutSecs) * 1000 + EVENTS_TIMEOUT_GRACE_MS;
  }
  return params.timeoutMs ?? 90000;
}

async function getZulipEvents(
  client: ZulipClient,
  params: {
    queueId: string;
    lastEventId: number;
    timeoutMs?: number;
    timeoutSecs?: number;
  },
): Promise<
  ZulipApiResponse & { events?: Array<{ id: number; type: string; message?: ZulipMessage }> }
> {
  const qs = new URLSearchParams({
    queue_id: params.queueId,
    last_event_id: String(params.lastEventId),
    dont_block: "false",
  });
  // `timeout` is NOT a valid /events query parameter (Zulip documents only
  // `queue_id`, `last_event_id` and `dont_block`; unknown params are silently
  // ignored). The long-poll budget is enforced client-side instead: abort a
  // little after the server-advertised window would have elapsed.
  const controller = new AbortController();
  const timeoutMs = resolveEventsTimeoutMs(params);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await client.request<
      ZulipApiResponse & { events?: Array<{ id: number; type: string; message?: ZulipMessage }> }
    >(`/events?${qs.toString()}`, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function getZulipEventsWithRetry(
  client: ZulipClient,
  params: {
    queueId: string;
    lastEventId: number;
    timeoutMs?: number;
    /** Explicit `/events` long-poll timeout in seconds (see clampLongpollTimeoutSecs). */
    timeoutSecs?: number;
    retryBaseDelayMs?: number;
    signal?: AbortSignal;
  },
): Promise<
  ZulipApiResponse & { events?: Array<{ id: number; type: string; message?: ZulipMessage }> }
> {
  const qs = new URLSearchParams({
    queue_id: params.queueId,
    last_event_id: String(params.lastEventId),
    dont_block: "false",
  });
  // `timeout` is NOT a valid /events query parameter (Zulip documents only
  // `queue_id`, `last_event_id` and `dont_block`; unknown params are silently
  // ignored). The long-poll budget is enforced client-side instead: abort a
  // little after the server-advertised window would have elapsed.
  const controller = new AbortController();
  const timeoutMs = resolveEventsTimeoutMs(params);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Wire host-level abort so we exit cleanly within ~90s instead of blocking 105s
  const hostAbort = params.signal;
  const onHostAbort = () => controller.abort();
  if (hostAbort) {
    if (hostAbort.aborted) {
      controller.abort();
    } else {
      hostAbort.addEventListener("abort", onHostAbort);
    }
  }

  try {
    return await zulipRequestWithRetry<
      ZulipApiResponse & { events?: Array<{ id: number; type: string; message?: ZulipMessage }> }
    >(
      client,
      `/events?${qs.toString()}`,
      { signal: controller.signal },
      { baseDelayMs: params.retryBaseDelayMs },
    );
  } finally {
    clearTimeout(timeout);
    if (hostAbort) {
      hostAbort.removeEventListener("abort", onHostAbort);
    }
  }
}

export async function deleteZulipQueue(client: ZulipClient, queueId: string): Promise<void> {
  if (!queueId) {
    return;
  }
  try {
    const payload = await client.request<ZulipApiResponse>(
      `/events?queue_id=${encodeURIComponent(queueId)}`,
      {
        method: "DELETE",
      },
    );
    assertSuccess(payload, "Zulip delete event queue failed");
  } catch {
    // ignore cleanup errors
  }
}

export async function sendZulipStreamMessage(
  client: ZulipClient,
  params: {
    stream: string;
    topic: string;
    content: string;
  },
): Promise<{ id?: number }> {
  const body = new URLSearchParams({
    type: "stream",
    to: params.stream,
    topic: params.topic,
    content: params.content,
  });
  const payload = await zulipRequestWithRetry<ZulipApiResponse & { id?: number }>(
    client,
    "/messages",
    {
      method: "POST",
      body: body.toString(),
    },
  );
  assertSuccess(payload, "Zulip stream send failed");
  return { id: payload.id };
}

export async function sendZulipPrivateMessage(
  client: ZulipClient,
  params: {
    to: string | string[];
    content: string;
  },
): Promise<{ id?: number }> {
  const recipients = Array.isArray(params.to) ? params.to : [params.to];
  const body = new URLSearchParams({
    type: "private",
    to: JSON.stringify(recipients),
    content: params.content,
  });
  const payload = await zulipRequestWithRetry<ZulipApiResponse & { id?: number }>(
    client,
    "/messages",
    {
      method: "POST",
      body: body.toString(),
    },
  );
  assertSuccess(payload, "Zulip private send failed");
  return { id: payload.id };
}

/**
 * Uploads a local file to the Zulip server.
 * Security: This function relies on the caller (e.g., sendMessageZulip) to ensure that the
 * `filePath` refers to a safe, temporary, or verified local file and not an arbitrary
 * system path controlled by an untrusted source. The destination is always the validated
 * `client.baseUrl` associated with the provided client.
 */
export async function uploadZulipFile(
  client: ZulipClient,
  filePath: string,
): Promise<{ url: string }> {
  const tmpDir = path.resolve(os.tmpdir());
  // Host 2026.9.2 runtimes may not expose paths.dataDir; default to the
  // standard ~/.openclaw data dir (same default as the fallback reader).
  const rawDataDir = getZulipRuntime().paths?.dataDir ?? path.join(os.homedir(), ".openclaw");
  const dataDir = path.resolve(rawDataDir);
  const workspaceDir = path.join(dataDir, "workspace");

  const allowedPaths: string[] = [tmpDir + path.sep, dataDir + path.sep];
  const isAllowedPath = (candidate: string) =>
    allowedPaths.some((allowed) => candidate.startsWith(allowed));

  // Security: the data dir also holds the gateway config, channel credentials,
  // session transcripts and the audit log. A prompt-injected agent must not be
  // able to exfiltrate any of those to Zulip, so refuse them explicitly even
  // though they sit under an allowed root.
  const SENSITIVE_FILE_NAMES = new Set([
    "openclaw.json",
    ".env",
    "trust.json",
    "honcho-memory.json",
  ]);
  const SENSITIVE_DIR_NAMES = new Set(["credentials", "audit", "agents", "sessions"]);
  const isSensitivePath = (candidate: string): boolean => {
    const rel = path.relative(dataDir, candidate);
    if (!rel || rel.startsWith("..")) {
      return false;
    }
    const parts = rel.toLowerCase().split(/[\\/]+/);
    return parts.some(
      (part) => SENSITIVE_FILE_NAMES.has(part) || SENSITIVE_DIR_NAMES.has(part),
    );
  };

  // Relative paths (e.g. "haiku.txt" from the agent workspace) resolve
  // against the gateway process CWD, which is rarely meaningful. Try the
  // agent workspace and the data dir first, then the caller's CWD (#268).
  const candidates = [filePath];
  if (!path.isAbsolute(filePath)) {
    candidates.push(path.join(workspaceDir, filePath));
    candidates.push(path.join(dataDir, filePath));
    candidates.push(path.join(tmpDir, filePath));
  }

  let buffer: Buffer | undefined;
  let resolvedPath: string | undefined;
  let lastRefusal: Error | undefined;
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (isSensitivePath(resolved)) {
      lastRefusal = new Error(
        `Refusing to upload sensitive path (config/credentials/sessions): ${filePath}.`,
      );
      continue;
    }
    if (!isAllowedPath(resolved)) {
      lastRefusal = new Error(
        `Refusing to upload file from unauthorized path: ${filePath}. ` +
        `Allowed paths are under ${tmpDir} or ${dataDir}.`,
      );
      continue;
    }
    try {
      buffer = await readSafeLocalFile(resolved);
      resolvedPath = resolved;
      break;
    } catch (err) {
      // Not found here (or symlink-refused) — try the next candidate.
      lastRefusal = err instanceof Error ? err : new Error(String(err));
    }
  }
  if (!buffer || !resolvedPath) {
    throw (
      lastRefusal ??
      new Error(`Refusing to upload file: unable to read ${filePath}.`)
    );
  }

  const filename = filePath.split("/").pop() || "upload.bin";
  const form = new FormData();
  form.append("file", new Blob([buffer]), filename);
  const payload = await zulipRequestWithRetry<ZulipApiResponse & { uri?: string }>(
    client,
    "/user_uploads",
    {
      method: "POST",
      body: form,
    },
  );
  assertSuccess(payload, "Zulip file upload failed");
  if (!payload.uri) {
    throw new Error("Zulip file upload missing uri");
  }
  const url = payload.uri.startsWith("/") ? `${client.baseUrl}${payload.uri}` : payload.uri;
  return { url };
}

export async function sendZulipTyping(
  client: ZulipClient,
  params: {
    op: "start" | "stop";
  } & (
    | { type: "stream"; streamId: number | string; topic: string }
    | { type: "direct"; to: number[] }
  ),
): Promise<void> {
  const body = new URLSearchParams();
  body.set("op", params.op);
  body.set("type", params.type);
  if (params.type === "stream") {
    body.set("stream_id", String(params.streamId));
    body.set("topic", params.topic);
  } else {
    body.set("to", JSON.stringify(params.to));
  }
  await client.request("/typing", {
    method: "POST",
    body: body.toString(),
  });
}

export async function fetchZulipSubscriptions(
  client: ZulipClient,
  params: { includeAllPublic?: boolean } = {},
): Promise<ZulipSubscription[]> {
  const qs = new URLSearchParams();
  if (params.includeAllPublic) {
    qs.set("include_all_public_streams", "true");
  }
  const suffix = qs.toString();
  const payload = await client.request<ZulipApiResponse & { subscriptions?: ZulipSubscription[] }>(
    `/users/me/subscriptions${suffix ? `?${suffix}` : ""}`,
  );
  assertSuccess(payload, "Zulip /users/me/subscriptions failed");
  return payload.subscriptions ?? [];
}

export async function fetchZulipStreams(client: ZulipClient): Promise<ZulipStream[]> {
  const payload = await client.request<
    ZulipApiResponse & {
      streams?: Array<{ stream_id: number; name?: string; description?: string }>;
    }
  >("/streams");
  assertSuccess(payload, "Zulip /streams failed");
  return (payload.streams ?? []).map((stream) => ({
    id: String(stream.stream_id),
    name: stream.name ?? null,
    description: stream.description ?? null,
  }));
}

export async function resolveZulipStreamId(
  client: ZulipClient,
  streamIdOrName: string,
): Promise<string> {
  // The SDK normalizes channelId params to "stream:NAME" format (via normalizeZulipMessagingTarget)
  // before passing to the plugin. Strip the prefix so we can match against actual stream names.
  const raw = streamIdOrName
    .trim()
    .replace(/^stream:/i, "")
    .trim();
  const trimmed = raw;
  // If it's already a numeric ID, return it
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  // Otherwise, look up the stream by name
  const subscriptions = await fetchZulipSubscriptions(client, { includeAllPublic: true });
  const found = subscriptions.find((sub) => sub.name?.toLowerCase() === trimmed.toLowerCase());
  if (found?.stream_id) {
    return String(found.stream_id);
  }
  // Fall back to fetching all streams
  const streams = await fetchZulipStreams(client);
  const foundStream = streams.find(
    (stream) => stream.name?.toLowerCase() === trimmed.toLowerCase(),
  );
  if (foundStream) {
    return foundStream.id;
  }
  throw new Error(`Zulip stream not found: ${streamIdOrName}`);
}

export async function subscribeZulipStream(client: ZulipClient, stream: string): Promise<void> {
  const body = new URLSearchParams({
    subscriptions: JSON.stringify([{ name: stream }]),
  });
  const payload = await client.request<ZulipApiResponse>("/users/me/subscriptions", {
    method: "POST",
    body: body.toString(),
  });
  assertSuccess(payload, "Zulip stream subscribe failed");
}

export async function inviteZulipUsersToStream(
  client: ZulipClient,
  params: {
    stream: string;
    principals: Array<string | number>;
  },
): Promise<void> {
  const body = new URLSearchParams({
    subscriptions: JSON.stringify([{ name: params.stream }]),
    principals: JSON.stringify(params.principals),
  });
  const payload = await client.request<ZulipApiResponse>("/users/me/subscriptions", {
    method: "POST",
    body: body.toString(),
  });
  assertSuccess(payload, "Zulip stream invite failed");
}

export async function createZulipStream(
  client: ZulipClient,
  params: {
    name: string;
    description?: string;
    principals?: Array<string | number>;
    announce?: boolean;
    inviteOnly?: boolean;
    isWebPublic?: boolean;
    isDefaultStream?: boolean;
    historyPublicToSubscribers?: boolean;
  },
): Promise<void> {
  const subscriptions: Array<{ name: string; description?: string }> = [
    {
      name: params.name,
      ...(params.description ? { description: params.description } : {}),
    },
  ];
  const body = new URLSearchParams({
    subscriptions: JSON.stringify(subscriptions),
  });
  if (params.principals && params.principals.length > 0) {
    body.set("principals", JSON.stringify(params.principals));
  }
  if (params.announce !== undefined) {
    body.set("announce", String(params.announce));
  }
  if (params.inviteOnly !== undefined) {
    body.set("invite_only", String(params.inviteOnly));
  }
  if (params.isWebPublic !== undefined) {
    body.set("is_web_public", String(params.isWebPublic));
  }
  if (params.isDefaultStream !== undefined) {
    body.set("is_default_stream", String(params.isDefaultStream));
  }
  if (params.historyPublicToSubscribers !== undefined) {
    body.set("history_public_to_subscribers", String(params.historyPublicToSubscribers));
  }
  const payload = await client.request<ZulipApiResponse>("/users/me/subscriptions", {
    method: "POST",
    body: body.toString(),
  });
  assertSuccess(payload, "Zulip stream create failed");
}

export async function updateZulipStream(
  client: ZulipClient,
  params: {
    streamId: string;
    description?: string;
    newName?: string;
    isPrivate?: boolean;
    isWebPublic?: boolean;
    historyPublicToSubscribers?: boolean;
    isDefaultStream?: boolean;
  },
): Promise<void> {
  const body = new URLSearchParams();
  if (params.description !== undefined) {
    body.set("description", params.description);
  }
  if (params.newName !== undefined) {
    body.set("new_name", params.newName);
  }
  if (params.isPrivate !== undefined) {
    body.set("is_private", String(params.isPrivate));
  }
  if (params.isWebPublic !== undefined) {
    body.set("is_web_public", String(params.isWebPublic));
  }
  if (params.historyPublicToSubscribers !== undefined) {
    body.set("history_public_to_subscribers", String(params.historyPublicToSubscribers));
  }
  if (params.isDefaultStream !== undefined) {
    body.set("is_default_stream", String(params.isDefaultStream));
  }
  const payload = await client.request<ZulipApiResponse>(
    `/streams/${encodeURIComponent(params.streamId)}` as const,
    {
      method: "PATCH",
      body: body.toString(),
    },
  );
  assertSuccess(payload, "Zulip stream update failed");
}

export async function deleteZulipStream(client: ZulipClient, streamId: string): Promise<void> {
  const payload = await client.request<ZulipApiResponse>(
    `/streams/${encodeURIComponent(streamId)}` as const,
    {
      method: "DELETE",
    },
  );
  assertSuccess(payload, "Zulip stream delete failed");
}

export async function addZulipReaction(
  client: ZulipClient,
  params: {
    messageId: string;
    emojiName: string;
    emojiCode?: string;
    reactionType?: string;
  },
): Promise<void> {
  const body = new URLSearchParams({
    emoji_name: params.emojiName,
  });
  if (params.emojiCode) {
    body.set("emoji_code", params.emojiCode);
  }
  if (params.reactionType) {
    body.set("reaction_type", params.reactionType);
  }
  const payload = await zulipRequestWithRetry<ZulipApiResponse>(
    client,
    `/messages/${encodeURIComponent(params.messageId)}/reactions`,
    { method: "POST", body: body.toString() },
  );
  assertSuccess(payload, "Zulip add reaction failed");
}

export async function removeZulipReaction(
  client: ZulipClient,
  params: {
    messageId: string;
    emojiName?: string;
    emojiCode?: string;
    reactionType?: string;
  },
): Promise<void> {
  const qs = new URLSearchParams();
  if (params.emojiName) {
    qs.set("emoji_name", params.emojiName);
  }
  if (params.emojiCode) {
    qs.set("emoji_code", params.emojiCode);
  }
  if (params.reactionType) {
    qs.set("reaction_type", params.reactionType);
  }
  const suffix = qs.toString();
  const payload = await zulipRequestWithRetry<ZulipApiResponse>(
    client,
    `/messages/${encodeURIComponent(params.messageId)}/reactions${suffix ? `?${suffix}` : ""}`,
    { method: "DELETE" },
  );
  assertSuccess(payload, "Zulip remove reaction failed");
}

export async function editZulipMessage(
  client: ZulipClient,
  params: {
    messageId: string;
    content: string;
  },
): Promise<void> {
  const body = new URLSearchParams({
    content: params.content,
  });
  const payload = await client.request<ZulipApiResponse>(
    `/messages/${encodeURIComponent(params.messageId)}`,
    {
      method: "PATCH",
      body: body.toString(),
    },
  );
  assertSuccess(payload, "Zulip edit message failed");
}

export async function deleteZulipMessage(
  client: ZulipClient,
  params: {
    messageId: string;
  },
): Promise<void> {
  const payload = await client.request<ZulipApiResponse>(
    `/messages/${encodeURIComponent(params.messageId)}`,
    {
      method: "DELETE",
    },
  );
  assertSuccess(payload, "Zulip delete message failed");
}

export async function updateZulipMessageFlag(
  client: ZulipClient,
  params: {
    messageId: string | number;
    flag: "starred" | "read";
    op: "add" | "remove";
  },
): Promise<void> {
  // Convert messageId to integer
  const messageIdInt =
    typeof params.messageId === "number" ? params.messageId : parseInt(params.messageId, 10);
  if (isNaN(messageIdInt)) {
    throw new Error(`Invalid messageId: ${params.messageId}`);
  }
  const body = new URLSearchParams({
    messages: JSON.stringify([messageIdInt]),
    flag: params.flag,
    op: params.op,
  });
  const payload = await client.request<ZulipApiResponse>("/messages/flags", {
    method: "POST",
    body: body.toString(),
  });
  assertSuccess(payload, "Zulip update message flags failed");
}

export async function updateZulipMessageTopic(
  client: ZulipClient,
  params: {
    messageId: string;
    topic: string;
    propagateMode?: "change_one" | "change_all";
  },
): Promise<void> {
  const body = new URLSearchParams({
    topic: params.topic,
    propagate_mode: params.propagateMode ?? "change_all",
  });
  const payload = await client.request<ZulipApiResponse>(
    `/messages/${encodeURIComponent(params.messageId)}`,
    {
      method: "PATCH",
      body: body.toString(),
    },
  );
  assertSuccess(payload, "Zulip update message topic failed");
}

export async function fetchZulipMessages(
  client: ZulipClient,
  params: {
    stream: string;
    topic?: string;
    limit?: number;
  },
): Promise<ZulipMessage[]> {  const limit = Math.min(Math.max(1, params.limit ?? 50), 1000);
  const narrow = [{ operator: "stream", operand: params.stream } as Record<string, unknown>];
  if (params.topic) {
    narrow.push({ operator: "topic", operand: params.topic });
  }
  const qs = new URLSearchParams({
    anchor: "newest",
    num_before: String(limit),
    num_after: "0",
    narrow: JSON.stringify(narrow),
  });
  const payload = await client.request<ZulipApiResponse & { messages?: ZulipMessage[] }>(
    `/messages?${qs.toString()}`,
  );
  assertSuccess(payload, "Zulip /messages failed");
  return payload.messages ?? [];
}

/**
 * Fetches a single message by id.
 *
 * Used by the reaction triggers (#297) to learn which stream/topic a reacted
 * message belongs to and who authored it, without keeping an outbound-message
 * index in memory.
 */
export async function fetchZulipMessage(
  client: ZulipClient,
  messageId: string | number,
): Promise<ZulipMessage | undefined> {
  const id = String(messageId).trim();
  if (!id) return undefined;
  const payload = await client.request<ZulipApiResponse & { message?: ZulipMessage }>(
    `/messages/${encodeURIComponent(id)}`,
  );
  assertSuccess(payload, "Zulip /messages/{id} failed");
  return payload.message;
}

export async function searchZulipMessages(
  client: ZulipClient,
  params: {
    query: string;
    stream?: string;
    topic?: string;
    limit?: number;
  },
): Promise<ZulipMessage[]> {
  const limit = Math.min(Math.max(1, params.limit ?? 50), 1000);
  const narrow: Array<Record<string, unknown>> = [{ operator: "search", operand: params.query }];
  if (params.stream) {
    narrow.push({ operator: "stream", operand: params.stream });
  }
  if (params.topic) {
    narrow.push({ operator: "topic", operand: params.topic });
  }
  const qs = new URLSearchParams({
    anchor: "newest",
    num_before: String(limit),
    num_after: "0",
    narrow: JSON.stringify(narrow),
  });
  const payload = await client.request<ZulipApiResponse & { messages?: ZulipMessage[] }>(
    `/messages?${qs.toString()}`,
  );
  assertSuccess(payload, "Zulip search failed");
  return payload.messages ?? [];
}

export async function fetchZulipUserPresence(
  client: ZulipClient,
  userIdOrEmail: string,
): Promise<ZulipPresenceMap> {
  const trimmed = userIdOrEmail?.trim();
  if (!trimmed) {
    throw new Error("userId or email is required to fetch Zulip presence.");
  }
  const encoded = encodeURIComponent(trimmed);
  const payload = await client.request<ZulipApiResponse & { presence?: ZulipPresenceMap }>(
    `/users/${encoded}/presence`,
  );
  assertSuccess(payload, "Zulip user presence failed");
  return payload.presence ?? {};
}

export async function deactivateZulipUser(client: ZulipClient, userId: string): Promise<void> {
  const trimmed = userId?.trim();
  if (!trimmed) {
    throw new Error("userId is required to deactivate a Zulip user.");
  }
  const payload = await client.request<ZulipApiResponse>(
    `/users/${encodeURIComponent(trimmed)}` as const,
    {
      method: "DELETE",
    },
  );
  assertSuccess(payload, "Zulip deactivate user failed");
}

export async function reactivateZulipUser(client: ZulipClient, userId: string): Promise<void> {
  const trimmed = userId?.trim();
  if (!trimmed) {
    throw new Error("userId is required to reactivate a Zulip user.");
  }
  const payload = await client.request<ZulipApiResponse>(
    `/users/${encodeURIComponent(trimmed)}/reactivate` as const,
    {
      method: "POST",
    },
  );
  assertSuccess(payload, "Zulip reactivate user failed");
}

