import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Repairs transcript archives that the host cannot publish on this platform.
 *
 * OpenClaw publishes a deleted session's transcript archive from SQLite to
 * `{dataDir}/agents/{agentId}/sessions/{archiveName}` using an atomic
 * `fs.link()`. On hosts where hard links are unavailable — notably
 * Android/Termux, where `link()` fails with `EACCES` even inside app-private
 * storage — the publish can never succeed, so the row keeps `published_at`
 * NULL. The host then throws on EVERY session operation:
 *
 *   Session deletion committed, but 1 transcript archive file export(s)
 *   remain pending in SQLite; retry the operation to publish them.
 *
 * That wedges inbound dispatch on every channel (not just the one whose session
 * was deleted), and no host-side repair path exists on the platform
 * (`openclaw sessions cleanup` retries the same blocked link(); `doctor --fix`
 * cannot verify service ownership on Android).
 *
 * This module replicates exactly what the host intends — write the stored blob,
 * verify its checksum, mark the row published — using `writeFile` instead of
 * `link()`. It is a workaround for a host limitation, not a feature: it stays
 * dormant unless a one-time probe shows hard links are actually unavailable
 * (see `hardLinksAvailable`), and it becomes unnecessary once the host falls
 * back to a copy-based publish.
 */

const ARCHIVE_TABLE = "session_transcript_archives";
const REQUIRED_COLUMNS = [
  "session_id",
  "generation",
  "archive_name",
  "archive_sha256",
  "archive_blob",
  "published_at",
  "last_publish_error",
];
const DEFAULT_INTERVAL_MS = 120_000;

export type SessionArchiveRepairOutcome = {
  /** Agent databases inspected. */
  databases: number;
  /** Rows found with `published_at IS NULL`. */
  pending: number;
  /** Rows successfully published by this run. */
  repaired: number;
  /** Rows deliberately left alone (checksum/path/schema mismatch). */
  skipped: number;
};

export type SessionArchiveRepairLogger = {
  debug?: (message: string, meta?: unknown) => void;
  info?: (message: string, meta?: unknown) => void;
  warn?: (message: string, meta?: unknown) => void;
};

const linkProbeCache = new Map<string, boolean>();

/**
 * Probes whether hard links work in the plugin data dir (cached per dir).
 * Android/Termux answers no, which is the whole reason this module exists.
 */
export function hardLinksAvailable(dataDir: string): boolean {
  const cached = linkProbeCache.get(dataDir);
  if (cached !== undefined) {
    return cached;
  }
  let available = true;
  const stamp = `${process.pid}-${Date.now()}`;
  const probeA = path.join(dataDir, `.zulip-link-probe-a-${stamp}`);
  const probeB = path.join(dataDir, `.zulip-link-probe-b-${stamp}`);
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(probeA, "");
    fs.linkSync(probeA, probeB);
  } catch {
    available = false;
  } finally {
    for (const probe of [probeA, probeB]) {
      try {
        fs.rmSync(probe, { force: true });
      } catch {
        // best effort cleanup
      }
    }
  }
  linkProbeCache.set(dataDir, available);
  return available;
}

/** Agent SQLite databases that may hold transcript archives. */
export function listAgentDatabases(dataDir: string): string[] {
  const agentsRoot = path.join(dataDir, "agents");
  let entries: string[];
  try {
    entries = fs.readdirSync(agentsRoot);
  } catch {
    return [];
  }
  const databases: string[] = [];
  for (const entry of entries) {
    const candidate = path.join(agentsRoot, entry, "agent", "openclaw-agent.sqlite");
    try {
      if (fs.statSync(candidate).isFile()) {
        databases.push(candidate);
      }
    } catch {
      // not an agent dir
    }
  }
  return databases;
}

function hasArchiveTable(db: any): boolean {
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(ARCHIVE_TABLE);
    if (!table) {
      return false;
    }
    const columns = new Set(
      (db.prepare(`PRAGMA table_info(${ARCHIVE_TABLE})`).all() as Array<{ name?: string }>).map(
        (column) => String(column.name ?? ""),
      ),
    );
    return REQUIRED_COLUMNS.every((column) => columns.has(column));
  } catch {
    return false;
  }
}

function isSafeArchiveName(name: string): boolean {
  return Boolean(name) && !name.includes("/") && !name.includes("\\") && !name.includes("..");
}

function sha256Of(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Publishes every pending transcript archive it can verify.
 * Never throws: failures are reported through the returned outcome and the
 * optional logger, because the caller runs inside the monitor loop.
 */
export async function repairPendingSessionArchives(params: {
  dataDir: string;
  /** Override the databases to inspect (used by tests). */
  databases?: string[];
  logger?: SessionArchiveRepairLogger;
}): Promise<SessionArchiveRepairOutcome> {
  const { dataDir, logger } = params;
  const outcome: SessionArchiveRepairOutcome = {
    databases: 0,
    pending: 0,
    repaired: 0,
    skipped: 0,
  };

  let sqlite: any;
  try {
    sqlite = await import("node:sqlite");
  } catch {
    // Host Node without node:sqlite: nothing we can safely do.
    return outcome;
  }

  const databases = params.databases ?? listAgentDatabases(dataDir);
  for (const databasePath of databases) {
    outcome.databases += 1;
    let db: any;
    try {
      db = new sqlite.DatabaseSync(databasePath);
      db.exec("PRAGMA busy_timeout = 15000");
      if (!hasArchiveTable(db)) {
        continue;
      }
      const rows = db
        .prepare(
          `SELECT session_id, generation, archive_name, archive_sha256, archive_blob
             FROM ${ARCHIVE_TABLE} WHERE published_at IS NULL`,
        )
        .all() as Array<Record<string, unknown>>;
      if (rows.length === 0) {
        continue;
      }
      outcome.pending += rows.length;
      const sessionsDir = path.join(path.dirname(path.dirname(databasePath)), "sessions");

      for (const row of rows) {
        try {
          const archiveName = String(row.archive_name ?? "");
          if (!isSafeArchiveName(archiveName)) {
            outcome.skipped += 1;
            logger?.warn?.("zulip session archive repair: unsafe archive name, skipping", {
              archiveName,
            });
            continue;
          }
          const blob = Buffer.from(row.archive_blob as ArrayBuffer);
          const expectedSha = String(row.archive_sha256 ?? "");
          if (sha256Of(blob) !== expectedSha) {
            outcome.skipped += 1;
            logger?.warn?.("zulip session archive repair: blob checksum mismatch, skipping", {
              archiveName,
            });
            continue;
          }

          const target = path.join(sessionsDir, archiveName);
          let existingSha: string | undefined;
          try {
            existingSha = sha256Of(fs.readFileSync(target));
          } catch {
            existingSha = undefined;
          }
          if (existingSha !== undefined && existingSha !== expectedSha) {
            outcome.skipped += 1;
            logger?.warn?.("zulip session archive repair: existing file differs, skipping", {
              archiveName,
            });
            continue;
          }
          if (existingSha === undefined) {
            fs.mkdirSync(sessionsDir, { recursive: true });
            fs.writeFileSync(target, blob);
          }

          const result = db
            .prepare(
              `UPDATE ${ARCHIVE_TABLE}
                  SET published_at = ?, last_publish_error = NULL
                WHERE session_id = ? AND generation = ?`,
            )
            .run(Date.now(), row.session_id, row.generation);
          if (result?.changes) {
            outcome.repaired += 1;
            logger?.info?.("zulip session archive repair: published pending archive", {
              archiveName,
            });
          }
        } catch (err) {
          outcome.skipped += 1;
          logger?.warn?.("zulip session archive repair: row failed", { error: String(err) });
        }
      }
    } catch (err) {
      logger?.warn?.("zulip session archive repair: database failed", {
        database: path.basename(databasePath),
        error: String(err),
      });
    } finally {
      try {
        db?.close();
      } catch {
        // ignore
      }
    }
  }
  return outcome;
}

/**
 * Starts the background repair loop and returns a stop function.
 *
 * `mode`:
 *  - `undefined` (default): auto — run only when the hard-link probe fails,
 *    so healthy hosts are never touched and the database is never opened.
 *  - `true`: always run.
 *  - `false`: never run.
 */
export function startSessionArchiveRepair(params: {
  dataDir: string;
  mode?: boolean;
  intervalMs?: number;
  signal?: AbortSignal;
  logger?: SessionArchiveRepairLogger;
}): () => void {
  const { dataDir, logger, mode } = params;
  if (mode === false) {
    return () => {};
  }
  if (mode !== true && hardLinksAvailable(dataDir)) {
    logger?.debug?.(
      "zulip session archive repair: hard links available, repair not needed",
      { dataDir },
    );
    return () => {};
  }

  const intervalMs = params.intervalMs ?? DEFAULT_INTERVAL_MS;
  let stopped = false;

  const run = async () => {
    if (stopped || params.signal?.aborted) {
      return;
    }
    try {
      const outcome = await repairPendingSessionArchives({ dataDir, logger });
      if (outcome.repaired > 0) {
        logger?.warn?.(
          "zulip session archive repair: published archives that the host could not publish (hard links unavailable on this platform)",
          outcome,
        );
      }
    } catch (err) {
      // Never let the repair loop disturb the monitor.
      logger?.debug?.("zulip session archive repair: run failed", { error: String(err) });
    }
  };

  void run();
  const timer = setInterval(() => {
    void run();
  }, intervalMs);
  // Do not keep the process alive because of this loop.
  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }

  const stop = () => {
    stopped = true;
    clearInterval(timer);
  };
  params.signal?.addEventListener("abort", stop, { once: true });
  return stop;
}
