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
   * This is a coarse performance guard; the primary filter is
   * `startTime` which matches events by their actual timestamp.
   * Default: 300_000 (5 minutes).
   */
  maxAgeMs?: number;
  /**
   * ISO 8601 timestamp (e.g. `new Date().toISOString()`). Only
   * `trace.artifacts` events with `ts >= startTime` are considered.
   * This is the robust primary filter that prevents matching stale
   * events from reused sessions or prior messages.
   */
  startTime?: string;
  /**
   * Optional file-system override for tests.
   */
  fsImpl?: Pick<typeof fs, "readdir" | "stat" | "readFile">;
  /**
   * Optional logger for debug output.
   */
  log?: (msg: string) => void;
};

function sessionKeyMatches(artifactKey: unknown, target: string): boolean {
  if (typeof artifactKey !== "string") return false;
  if (artifactKey === target) return true;
  return artifactKey.startsWith(target + ":");
}

const DEFAULT_MAX_AGE_MS = 300_000; // kept for API compat; no longer used internally

function resolveSessionsDir(opts: FallbackReaderOptions): string {
  const dataDir = opts.dataDir ?? path.join(os.homedir(), ".openclaw");
  return path.join(dataDir, "agents", opts.agentId, "sessions");
}

export async function readLatestAssistantTexts(
  opts: FallbackReaderOptions,
): Promise<string[] | null> {
  const fsi = opts.fsImpl ?? fs;
  const sessionsDir = resolveSessionsDir(opts);
  const startTime = opts.startTime;
  const log = opts.log;

  log?.(
    `[fallback-reader] start sessionsDir=${sessionsDir} sessionKey=${opts.sessionKey} startTime=${startTime ?? "(none)"}`,
  );

  let entries: string[];
  try {
    entries = await fsi.readdir(sessionsDir);
  } catch (err) {
    log?.(`[fallback-reader] readdir failed: ${String(err)}`);
    return null;
  }

  const trajectoryFiles = entries.filter((n) => n.endsWith(".trajectory.jsonl"));
  if (trajectoryFiles.length === 0) {
    log?.(`[fallback-reader] no trajectory files in ${sessionsDir}`);
    return null;
  }

  // Scan ALL trajectory files — do NOT filter by mtime.
  // The `startTime` parameter (passed from reply-handler.ts) already
  // filters out stale events by their actual timestamp, making mtime
  // filtering unnecessary and potentially harmful due to filesystem
  // race conditions: the host appends trace.artifacts but the file's
  // mtime may not have been flushed when our finally block runs.
  const filesToScan = trajectoryFiles.map((name) => ({ name }));

  log?.(
    `[fallback-reader] scanning ${filesToScan.length} trajectory files (mtime filter removed)`,
  );

  for (const { name } of filesToScan) {
    const fullPath = path.join(sessionsDir, name);
    let content: string;
    try {
      content = await fsi.readFile(fullPath, "utf8");
    } catch {
      continue;
    }

    // Scan lines from the end backwards for our latest trace.artifacts.
    const lines = content.split("\n");
    let foundInFile = 0;
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
      foundInFile++;

      if (!sessionKeyMatches(event.sessionKey, opts.sessionKey)) continue;

      // If startTime is provided, reject events that occurred before it.
      // This prevents matching stale events from reused sessions.
      if (startTime && event.ts) {
        const eventTime = new Date(event.ts).getTime();
        const startTimeMs = new Date(startTime).getTime();
        if (!Number.isNaN(eventTime) && !Number.isNaN(startTimeMs)) {
          if (eventTime < startTimeMs) {
            log?.(
              `[fallback-reader] skipping stale event in ${name}: eventTime=${event.ts} < startTime=${startTime}`,
            );
            continue;
          }
        }
      }

      const texts = event.data?.assistantTexts;
      if (Array.isArray(texts) && texts.length > 0) {
        const result = texts.filter(
          (t: unknown) => typeof t === "string" && t.length > 0,
        );
        log?.(
          `[fallback-reader] MATCH in ${name} eventTime=${event.ts} texts=${result.length}`,
        );
        return result;
      }
    }
    if (foundInFile > 0) {
      log?.(
        `[fallback-reader] ${foundInFile} trace.artifacts in ${name} but none matched sessionKey/startTime`,
      );
    }
  }

  log?.(`[fallback-reader] no match after scanning ${filesToScan.length} files`);
  return null;
}
