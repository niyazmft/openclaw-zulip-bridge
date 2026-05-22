import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Reads the latest assistant texts from a session's trajectory file.
 *
 * Used as a fallback path when the dispatcher's `deliver` callback was
 * never invoked during a run — typically because the agent ended the
 * turn with plain assistant text instead of a structured `message()`
 * tool call. This happens with local OSS models (Qwen, Gemma, Llama)
 * that have weaker structured-tool-call training than frontier APIs.
 *
 * The runtime writes a `trace.artifacts` event with `assistantTexts`
 * immediately before `session.ended`, so by the time
 * `dispatchReplyFromConfig` resolves, the file is flushed to disk.
 *
 * Returns the most recent `assistantTexts` array for the given session
 * key, or `null` if no matching artifacts were found.
 */
export type FallbackReaderOptions = {
  /** Resolved openclaw data dir (~/.openclaw by default). */
  dataDir?: string;
  /** Agent id (route.agentId from the runtime). */
  agentId: string;
  /**
   * Session key (or session-key prefix) to match. The plugin's `route`
   * exposes the channel-base session key (e.g.
   * `agent:main:zulip:channel:5`), but the runtime's per-thread sessions
   * have a longer key (e.g. `agent:main:zulip:channel:5:thread:<topic>`).
   * We accept either: artifacts match if their `sessionKey` is exactly
   * this value OR starts with this value followed by `:`.
   */
  sessionKey: string;
  /**
   * Only consider trajectory files modified within this many ms.
   * Prevents historical sessions with the same key from being matched.
   * Default: 30_000 (30 seconds).
   */
  maxAgeMs?: number;
  /**
   * Optional file-system override for tests.
   */
  fsImpl?: Pick<typeof fs, "readdir" | "stat" | "readFile">;
};

function sessionKeyMatches(artifactKey: unknown, target: string): boolean {
  if (typeof artifactKey !== "string") return false;
  if (artifactKey === target) return true;
  return artifactKey.startsWith(target + ":");
}

const DEFAULT_MAX_AGE_MS = 30_000;

function resolveSessionsDir(opts: FallbackReaderOptions): string {
  const dataDir = opts.dataDir ?? path.join(os.homedir(), ".openclaw");
  return path.join(dataDir, "agents", opts.agentId, "sessions");
}

export async function readLatestAssistantTexts(
  opts: FallbackReaderOptions,
): Promise<string[] | null> {
  const fsi = opts.fsImpl ?? fs;
  const sessionsDir = resolveSessionsDir(opts);
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;

  let entries: string[];
  try {
    entries = await fsi.readdir(sessionsDir);
  } catch {
    return null;
  }

  const trajectoryFiles = entries.filter((n) => n.endsWith(".trajectory.jsonl"));
  if (trajectoryFiles.length === 0) {
    return null;
  }

  const cutoff = Date.now() - maxAgeMs;

  // Stat each, keep only the recently-modified ones, sort newest first.
  const recent: Array<{ name: string; mtimeMs: number }> = [];
  for (const name of trajectoryFiles) {
    try {
      const st = await fsi.stat(path.join(sessionsDir, name));
      if (st.mtimeMs >= cutoff) {
        recent.push({ name, mtimeMs: st.mtimeMs });
      }
    } catch {
      // Ignore unreadable entries.
    }
  }
  recent.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const { name } of recent) {
    const fullPath = path.join(sessionsDir, name);
    let content: string;
    try {
      content = await fsi.readFile(fullPath, "utf8");
    } catch {
      continue;
    }

    // Scan lines from the end backwards for our latest trace.artifacts.
    const lines = content.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line) continue;
      if (!line.includes("trace.artifacts")) continue;

      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event?.type !== "trace.artifacts") continue;
      if (!sessionKeyMatches(event.sessionKey, opts.sessionKey)) continue;
      const texts = event.data?.assistantTexts;
      if (Array.isArray(texts) && texts.length > 0) {
        return texts.filter((t: unknown) => typeof t === "string" && t.length > 0);
      }
    }
  }

  return null;
}
