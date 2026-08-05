import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

/**
 * Simple file-based audit logger for security-relevant events.
 *
 * Writes JSON-line events to a rotating log file under the plugin's
 * data directory. Each event is a single JSON object with a timestamp,
 * event type, and metadata.
 *
 * Log rotation: when the active file exceeds MAX_FILE_SIZE, it is
 * renamed with a timestamp suffix and a new file is started. Old
 * rotated files beyond MAX_ROTATED_FILES are pruned.
 */

const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MB
const MAX_ROTATED_FILES = 3;

export type AuditEvent = {
  ts: string;
  event: string;
  accountId: string;
  [key: string]: unknown;
};

export class AuditLogger {
  private logDir: string;
  private logPath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(baseDir: string, accountId: string) {
    this.logDir = path.join(baseDir, "audit");
    this.logPath = path.join(this.logDir, `${accountId}.audit.log`);
  }

  /**
   * Ensure the log directory exists.
   */
  private async ensureDir(): Promise<void> {
    await fsPromises.mkdir(this.logDir, { recursive: true });
  }

  /**
   * Rotate the log file if it exceeds the maximum size.
   * Renames the current file with a timestamp and prunes old files.
   */
  private async rotateIfNeeded(): Promise<void> {
    try {
      const stat = await fsPromises.stat(this.logPath);
      if (stat.size < MAX_FILE_SIZE) {
        return;
      }
    } catch {
      // File doesn't exist yet, no rotation needed
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rotatedPath = `${this.logPath}.${timestamp}`;
    try {
      await fsPromises.rename(this.logPath, rotatedPath);
    } catch {
      // Ignore rename failures (race conditions)
    }

    // Prune old rotated files
    try {
      const files = await fsPromises.readdir(this.logDir);
      const rotatedFiles = files
        .filter((f) => f.startsWith(path.basename(this.logPath)) && f.includes("."))
        .sort()
        .reverse();
      for (const oldFile of rotatedFiles.slice(MAX_ROTATED_FILES)) {
        await fsPromises.unlink(path.join(this.logDir, oldFile)).catch(() => undefined);
      }
    } catch {
      // Ignore prune failures
    }
  }

  /**
   * Write an audit event to the log file.
   * Events are serialized as JSON lines and appended atomically.
   */
  async log(event: AuditEvent): Promise<void> {
    // Chain writes to preserve ordering
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await this.ensureDir();
        await this.rotateIfNeeded();
        const line = JSON.stringify(event) + "\n";
        await fsPromises.appendFile(this.logPath, line, "utf-8");
      } catch {
        // Audit logging is best-effort; failures are silently ignored
      }
    });
    return this.writeQueue;
  }

  /**
   * Convenience: log a monitor start event.
   */
  async logMonitorStart(accountId: string, details?: Record<string, unknown>): Promise<void> {
    await this.log({
      ts: new Date().toISOString(),
      event: "monitor_start",
      accountId,
      ...details,
    });
  }

  /**
   * Convenience: log a monitor stop event.
   */
  async logMonitorStop(accountId: string, reason?: string): Promise<void> {
    await this.log({
      ts: new Date().toISOString(),
      event: "monitor_stop",
      accountId,
      reason,
    });
  }

  /**
   * Convenience: log a recovery attempt.
   */
  async logRecoveryAttempt(
    accountId: string,
    details: { recovered?: number; scanned?: number },
  ): Promise<void> {
    await this.log({
      ts: new Date().toISOString(),
      event: "recovery_attempt",
      accountId,
      ...details,
    });
  }

  /**
   * Convenience: log an auth failure.
   */
  async logAuthFailure(accountId: string, error: string): Promise<void> {
    await this.log({
      ts: new Date().toISOString(),
      event: "auth_failure",
      accountId,
      error,
    });
  }

  /**
   * Convenience: log a rate limit exceeded event.
   */
  async logRateLimitExceeded(
    accountId: string,
    details: { senderId?: string; limit?: number },
  ): Promise<void> {
    await this.log({
      ts: new Date().toISOString(),
      event: "rate_limit_exceeded",
      accountId,
      ...details,
    });
  }
}
