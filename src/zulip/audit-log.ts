import { AuditLogger } from "./audit-logger.js";
import { resolveZulipDataDir, type DataDirRuntime } from "./data-dir.js";

/**
 * One `AuditLogger` per account id, process-wide.
 *
 * The audit file was previously written by exactly one owner (the monitor), which
 * built its own logger. That meant any outbound send that does not go through the
 * monitor's reply path — most importantly the agent's `message` tool, which reaches
 * the channel's outbound adapter — could not be audited at all, so a successful
 * reply and a silently dropped one looked identical in the log (#326, cause 2).
 *
 * Sharing one instance per account keeps that fix safe: the logger holds an
 * append queue and owns rotation, so two instances appending to the same file
 * could interleave writes or race on rotation. Everything that needs to record an
 * event now asks for the same object.
 */

const loggers = new Map<string, AuditLogger>();

export type AuditLogOptions = {
  /** Explicit data directory (the monitor already resolves one). */
  dataDir?: string;
  /** Runtime to resolve the data directory from when `dataDir` is absent. */
  runtime?: DataDirRuntime;
  /** Report write failures instead of silently dropping events. */
  onError?: (error: unknown) => void;
};

/** Returns (creating on first use) the shared audit logger for `accountId`. */
export function getAuditLogger(accountId: string, options: AuditLogOptions = {}): AuditLogger {
  const id = accountId?.trim() || "default";
  const existing = loggers.get(id);
  if (existing) {
    // A later caller (the monitor) may bring the error handler; keep the instance.
    if (options.onError) existing.setErrorHandler(options.onError);
    return existing;
  }
  const logger = new AuditLogger(
    options.dataDir ?? resolveZulipDataDir(options.runtime),
    id,
    { onError: options.onError },
  );
  loggers.set(id, logger);
  return logger;
}

/** Test seam: forget cached loggers so each test starts clean. */
export function resetAuditLoggers(): void {
  loggers.clear();
}
