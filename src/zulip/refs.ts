/**
 * Actionable refs in replies (#295).
 *
 * Agent prose like "I opened a PR" is read-only: the team cannot act on it.
 * This module lets the agent emit a structured marker —
 *
 *   [[zulip_ref: https://github.com/owner/repo/pull/128 | PR #128]]
 *
 * — which the plugin **validates for real** (a provider API call) and renders
 * as a clickable link only when the ref actually exists. The goal is evidence,
 * not claims.
 *
 * Security posture (this is the part that matters):
 * - **No user-controlled fetch target.** Only `https://github.com/...` refs are
 *   handled at all, matched by an anchored regex (`github.com.evil.com`, ports,
 *   credentials and queries do not match), and the API URL is built from a
 *   *hardcoded* `https://api.github.com` origin. There is no allowlist knob that
 *   could be widened into an SSRF primitive, and the ref is rejected before any
 *   fetch if it is not a well-formed GitHub ref.
 * - **No credentials are ever sent.** Validation is unauthenticated, so private
 *   refs simply 404 and degrade to plain text. Nothing from the host config
 *   leaves the process on this path.
 * - **Real validation, never cosmetic.** With the feature enabled there is no
 *   "skip validation" mode: a ref that cannot be confirmed renders as plain
 *   text. That is also the degradation path for rate limits (GitHub allows 60
 *   unauthenticated requests/hour/IP), timeouts and network errors.
 * - **Best-effort.** Rendering never throws and never blocks a send beyond a
 *   short timeout; outcomes are cached so repeated replies do not re-spend the
 *   API budget.
 *
 * v1 supports GitHub refs (pull/issue, commit, Actions run). Refs on any other
 * host degrade to plain text rather than rendering unverified links.
 */

const MARKER_SOURCE = "\\[\\[zulip_ref:\\s*([^\\]|]+?)\\s*(?:\\|\\s*([^\\]]+?)\\s*)?\\]\\]";

/**
 * Anchored GitHub ref matcher. The host is matched exactly — no subdomains, no
 * ports, no userinfo, no query/fragment — so the API origin can be hardcoded.
 */
const GITHUB_REF_RE =
  /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(pull|issues|commit|actions\/runs)\/([A-Za-z0-9_.-]+)\/?$/;

export const GITHUB_API_ORIGIN = "https://api.github.com";
export const DEFAULT_REF_VALIDATION_TIMEOUT_MS = 1500;
/** Cap per message so one reply cannot spend the whole API budget. */
export const MAX_REFS_PER_MESSAGE = 3;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 200;

export type GithubRefKind = "pull" | "issue" | "commit" | "run";

export type GithubRefTarget = {
  kind: GithubRefKind;
  owner: string;
  repo: string;
  id: string;
};

export type RefMarker = {
  raw: string;
  index: number;
  url: string;
  label?: string;
};

export type RefLogger = (message: string, meta?: Record<string, unknown>) => void;

export type RefRenderOptions = {
  enabled: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  log?: RefLogger;
};

function markerRegex(): RegExp {
  return new RegExp(MARKER_SOURCE, "gi");
}

/** Finds every `[[zulip_ref: url | label]]` marker, in order. */
export function findZulipRefMarkers(text: string): RefMarker[] {
  if (!text) return [];
  const markers: RefMarker[] = [];
  const re = markerRegex();
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const url = (match[1] ?? "").trim();
    if (!url) continue;
    const label = (match[2] ?? "").trim();
    markers.push({ raw: match[0], index: match.index, url, label: label || undefined });
  }
  return markers;
}

/**
 * Parses a GitHub ref URL into a fetchable target, or `undefined` when the URL
 * is not a well-formed, link-safe GitHub ref.
 */
export function parseGithubRef(url: string): GithubRefTarget | undefined {
  const match = GITHUB_REF_RE.exec(url.trim());
  if (!match) return undefined;
  const [, owner, repo, path, id] = match;
  const kind: GithubRefKind =
    path === "pull" ? "pull" : path === "issues" ? "issue" : path === "commit" ? "commit" : "run";
  if (kind === "commit") {
    if (!/^[0-9a-fA-F]{7,40}$/.test(id)) return undefined;
  } else if (!/^\d+$/.test(id)) {
    return undefined;
  }
  return { kind, owner, repo, id };
}

/** Builds the API URL. The origin is a constant; only validated path parts vary. */
export function githubApiUrl(target: GithubRefTarget): string {
  const base = `${GITHUB_API_ORIGIN}/repos/${target.owner}/${target.repo}`;
  switch (target.kind) {
    case "pull":
      return `${base}/pulls/${target.id}`;
    case "issue":
      return `${base}/issues/${target.id}`;
    case "commit":
      return `${base}/commits/${target.id}`;
    case "run":
      return `${base}/actions/runs/${target.id}`;
  }
}

export function defaultRefLabel(target: GithubRefTarget): string {
  const { owner, repo, kind, id } = target;
  switch (kind) {
    case "pull":
    case "issue":
      return `${owner}/${repo}#${id}`;
    case "commit":
      return `${owner}/${repo}@${id.slice(0, 7)}`;
    case "run":
      return `${owner}/${repo} run ${id}`;
  }
}

// ── Validation ──────────────────────────────────────────────────────────────

export type RefValidation = "valid" | "invalid" | "unverified";

type CacheEntry = { result: RefValidation; expiresAt: number };
const validationCache = new Map<string, CacheEntry>();

/** Test helper: drop the validation cache. */
export function clearRefValidationCache(): void {
  validationCache.clear();
}

function readCache(url: string, nowMs: number): RefValidation | undefined {
  const entry = validationCache.get(url);
  if (!entry) return undefined;
  if (entry.expiresAt <= nowMs) {
    validationCache.delete(url);
    return undefined;
  }
  return entry.result;
}

function writeCache(url: string, result: RefValidation, nowMs: number): void {
  if (validationCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = validationCache.keys().next().value;
    if (oldest !== undefined) validationCache.delete(oldest);
  }
  validationCache.set(url, { result, expiresAt: nowMs + CACHE_TTL_MS });
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
 * Confirms a GitHub ref exists. Unauthenticated by design: private refs 404 and
 * the caller degrades them to plain text.
 */
export async function validateGithubRef(
  target: GithubRefTarget,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; log?: RefLogger } = {},
): Promise<RefValidation> {
  const apiUrl = githubApiUrl(target);
  const nowMs = Date.now();
  const cached = readCache(apiUrl, nowMs);
  if (cached) return cached;

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    opts.log?.("zulip ref validation unavailable: no fetch implementation", {});
    return "unverified";
  }

  try {
    const response = await withTimeout(
      fetchImpl(apiUrl, {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "openclaw-zulip-bridge",
        },
      }),
      opts.timeoutMs ?? DEFAULT_REF_VALIDATION_TIMEOUT_MS,
    );
    if (!response) {
      opts.log?.("zulip ref validation timed out", { apiUrl });
      return "unverified";
    }
    let result: RefValidation;
    if (response.ok) {
      result = "valid";
    } else if (response.status === 404 || response.status === 410) {
      result = "invalid";
    } else {
      // 403 is usually rate limiting; 5xx is the provider's problem. Neither
      // proves the ref is wrong, so it stays unverified (and unlinked).
      opts.log?.("zulip ref validation inconclusive", { apiUrl, status: response.status });
      result = "unverified";
    }
    // Never cache an inconclusive result: the condition clears, and caching it
    // would keep a real ref unlinked for the whole TTL.
    if (result !== "unverified") writeCache(apiUrl, result, nowMs);
    return result;
  } catch (err) {
    opts.log?.("zulip ref validation failed", { apiUrl, error: String(err) });
    return "unverified";
  }
}

function renderLink(label: string, url: string): string {
  const safeLabel = label.replace(/[[\]]/g, "");
  return `[${safeLabel || url}](${url})`;
}

/**
 * Unverified refs render as inline code so Zulip does not auto-link a URL that
 * we could not confirm — the reply still carries the reference, without
 * promoting it to evidence.
 */
function renderUnverified(label: string, url: string): string {
  const safeLabel = (label || url).replace(/`/g, "'");
  const safeUrl = url.replace(/`/g, "");
  if (!safeLabel || safeLabel === safeUrl) return `\`${safeUrl}\``;
  return `\`${safeLabel}\` \`${safeUrl}\``;
}

/**
 * Final safety net: never leak the raw marker syntax into the room.
 *
 * Catches over-cap markers *and* malformed ones the grammar refused to parse
 * (for example a label containing `]`). A label is only kept when it is
 * well-formed; otherwise the URL alone is shown unverified.
 */
function stripLeftoverMarkers(text: string): string {
  if (!/\[\[zulip_ref:/i.test(text)) return text;
  return text.replace(/\[\[zulip_ref:[^\n]*?(?:\]\]|$)/gi, (raw) => {
    const url = /(https?:\/\/[^\s|\]]+)/i.exec(raw)?.[1];
    if (!url) return "";
    const rawLabel = raw.includes("|")
      ? raw.slice(raw.indexOf("|") + 1).replace(/\]\]$/, "").trim()
      : "";
    const label = rawLabel && !rawLabel.includes("]") ? rawLabel : undefined;
    return renderUnverified(label ?? url, url);
  });
}

/**
 * Replaces `[[zulip_ref: ...]]` markers with validated links.
 *
 * Never throws: any failure leaves the ref as unverified plain text, and the
 * reply still sends. Disabled (or marker-free) input is returned verbatim.
 */
export async function renderZulipRefs(text: string, opts: RefRenderOptions): Promise<string> {
  if (!opts.enabled || !text) return text;
  const markers = findZulipRefMarkers(text);
  let result = text;

  if (markers.length > 0) {
    const log = opts.log;
    const considered = markers.slice(0, MAX_REFS_PER_MESSAGE);
    if (markers.length > considered.length) {
      log?.("zulip ref markers over the per-message cap were left unverified", {
        total: markers.length,
        cap: MAX_REFS_PER_MESSAGE,
      });
    }

    const replacements = await Promise.all(
      considered.map(async (marker) => {
        const target = parseGithubRef(marker.url);
        if (!target) {
          // Rejected before any fetch: not a well-formed GitHub ref, no request.
          log?.("zulip ref rejected before any fetch", { url: marker.url });
          return renderUnverified(marker.label ?? marker.url, marker.url);
        }
        const label = marker.label ?? defaultRefLabel(target);
        const validation = await validateGithubRef(target, {
          fetchImpl: opts.fetchImpl,
          timeoutMs: opts.timeoutMs,
          log,
        });
        return validation === "valid"
          ? renderLink(label, marker.url)
          : renderUnverified(label, marker.url);
      }),
    );

    for (let i = considered.length - 1; i >= 0; i -= 1) {
      const marker = considered[i];
      result =
        result.slice(0, marker.index) +
        replacements[i] +
        result.slice(marker.index + marker.raw.length);
    }
  }

  return stripLeftoverMarkers(result);
}
