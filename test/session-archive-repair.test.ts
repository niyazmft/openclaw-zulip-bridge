import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  hardLinksAvailable,
  listAgentDatabases,
  repairPendingSessionArchives,
  startSessionArchiveRepair,
} from "../src/zulip/session-archive-repair.ts";

// The host publishes deleted-session transcript archives with an atomic
// fs.link(). Where hard links are unavailable (Android/Termux) that publish can
// never succeed, the row keeps published_at NULL, and the host then throws on
// EVERY session operation — so the bot cannot reply on any channel. These tests
// cover the plugin-side repair that publishes those archives itself.

// node:sqlite is not exposed without a flag on Node 22 (which CI runs), and the
// production module treats its absence as "nothing to do". Resolve it once and
// skip the DB-backed cases rather than failing the suite on such runtimes.
let DatabaseSyncCtor: any = null;
try {
  ({ DatabaseSync: DatabaseSyncCtor } = await import("node:sqlite"));
} catch {
  DatabaseSyncCtor = null;
}
const dbTest = DatabaseSyncCtor ? test : test.skip;

const ARCHIVE_TABLE_DDL = `CREATE TABLE session_transcript_archives (
  session_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  session_key TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('deleted','reset')),
  encoding TEXT NOT NULL CHECK (encoding IN ('identity','zstd')),
  archive_blob BLOB NOT NULL,
  archive_sha256 TEXT NOT NULL CHECK (length(archive_sha256) = 64),
  archive_name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  publish_attempts INTEGER NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
  last_publish_attempt_at INTEGER,
  last_publish_error TEXT,
  PRIMARY KEY (session_id, generation)
) STRICT`;

function sha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function makeDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zulip-archive-repair-"));
}

function agentDb(dataDir: string, agentId = "main"): string {
  return path.join(dataDir, "agents", agentId, "agent", "openclaw-agent.sqlite");
}

function sessionsDir(dataDir: string, agentId = "main"): string {
  return path.join(dataDir, "agents", agentId, "sessions");
}

function createDb(dbPath: string, { withArchiveTable = true } = {}): any {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSyncCtor(dbPath);
  if (withArchiveTable) {
    db.exec(ARCHIVE_TABLE_DDL);
  } else {
    db.exec("CREATE TABLE unrelated (id TEXT)");
  }
  return db;
}

function pendingArchive(overrides: Record<string, unknown> = {}) {
  const blob = Buffer.from(overrides.blob as Buffer ?? Buffer.from("transcript-bytes"));
  return {
    session_id: "11111111-2222-3333-4444-555555555555",
    generation: "abc123abc123abc123abc123abc123ab",
    session_key: "agent:main:zulip:direct:user@example.com",
    reason: "deleted",
    encoding: "zstd",
    blob,
    archive_name: "11111111-2222-3333-4444-555555555555.jsonl.deleted.2026-09-19T00-04-32.999Z.abc123abc123abc123abc123abc123ab.zst",
    archive_sha256: sha256(blob),
    created_at: 1789000000000,
    ...overrides,
  };
}

function insertArchive(db: any, row: ReturnType<typeof pendingArchive>, publishedAt: number | null = null): void {
  db.prepare(
    `INSERT INTO session_transcript_archives
       (session_id, generation, session_key, reason, encoding, archive_blob, archive_sha256,
        archive_name, created_at, published_at, publish_attempts, last_publish_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(
    row.session_id,
    row.generation,
    row.session_key,
    row.reason,
    row.encoding,
    row.blob,
    row.archive_sha256,
    row.archive_name,
    row.created_at,
    publishedAt,
    publishedAt === null ? "EACCES: permission denied, link '/x/y'" : null,
  );
}

dbTest("publishes a pending transcript archive the host could not publish", async () => {
  const dataDir = makeDataDir();
  try {
    const dbPath = agentDb(dataDir);
    const row = pendingArchive();
    const db = createDb(dbPath);
    insertArchive(db, row);
    db.close();

    const outcome = await repairPendingSessionArchives({ dataDir });

    assert.deepEqual(outcome, { databases: 1, pending: 1, repaired: 1, skipped: 0 });

    // The archive file now exists where the host expects it, checksum-verified.
    const written = path.join(sessionsDir(dataDir), row.archive_name);
    assert.equal(fs.existsSync(written), true);
    assert.equal(sha256(fs.readFileSync(written)), row.archive_sha256);

    // And the row is marked published with its error cleared.
    const check = new DatabaseSyncCtor(dbPath, { readOnly: true });
    const updated: any = check
      .prepare("SELECT published_at, last_publish_error FROM session_transcript_archives")
      .get();
    check.close();
    assert.equal(typeof updated.published_at, "number");
    assert.equal(updated.last_publish_error, null);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

dbTest("is idempotent: a second run finds nothing pending", async () => {
  const dataDir = makeDataDir();
  try {
    const dbPath = agentDb(dataDir);
    const db = createDb(dbPath);
    insertArchive(db, pendingArchive());
    db.close();

    await repairPendingSessionArchives({ dataDir });
    const second = await repairPendingSessionArchives({ dataDir });

    assert.deepEqual(second, { databases: 1, pending: 0, repaired: 0, skipped: 0 });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

dbTest("ignores databases without the archive table (schema is not ours)", async () => {
  const dataDir = makeDataDir();
  try {
    const db = createDb(agentDb(dataDir, "other"), { withArchiveTable: false });
    db.close();

    const outcome = await repairPendingSessionArchives({ dataDir });
    assert.deepEqual(outcome, { databases: 1, pending: 0, repaired: 0, skipped: 0 });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

dbTest("skips a row whose blob does not match archive_sha256", async () => {
  const dataDir = makeDataDir();
  try {
    const dbPath = agentDb(dataDir);
    const row = pendingArchive({ archive_sha256: "0".repeat(64) });
    const db = createDb(dbPath);
    insertArchive(db, row);
    db.close();

    const outcome = await repairPendingSessionArchives({ dataDir });

    assert.equal(outcome.pending, 1);
    assert.equal(outcome.repaired, 0);
    assert.equal(outcome.skipped, 1);
    assert.equal(fs.existsSync(path.join(sessionsDir(dataDir), row.archive_name)), false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

dbTest("skips an archive name that could escape the sessions directory", async () => {
  const dataDir = makeDataDir();
  try {
    const dbPath = agentDb(dataDir);
    const row = pendingArchive({ archive_name: "../../../etc/evil.zst" });
    const db = createDb(dbPath);
    insertArchive(db, row);
    db.close();

    const outcome = await repairPendingSessionArchives({ dataDir });

    assert.equal(outcome.repaired, 0);
    assert.equal(outcome.skipped, 1);
    assert.equal(fs.existsSync(path.join(dataDir, "..", "..", "..", "etc", "evil.zst")), false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

dbTest("never overwrites an existing archive file with different content", async () => {
  const dataDir = makeDataDir();
  try {
    const dbPath = agentDb(dataDir);
    const row = pendingArchive();
    const db = createDb(dbPath);
    insertArchive(db, row);
    db.close();

    const dir = sessionsDir(dataDir);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, row.archive_name);
    fs.writeFileSync(target, "somebody else's data");

    const outcome = await repairPendingSessionArchives({ dataDir });

    assert.equal(outcome.repaired, 0);
    assert.equal(outcome.skipped, 1);
    assert.equal(fs.readFileSync(target, "utf8"), "somebody else's data");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("tolerates a data dir with no agents (nothing to do, no throw)", async () => {
  const dataDir = makeDataDir();
  try {
    const outcome = await repairPendingSessionArchives({ dataDir });
    assert.deepEqual(outcome, { databases: 0, pending: 0, repaired: 0, skipped: 0 });
    assert.deepEqual(listAgentDatabases(dataDir), []);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("hardLinksAvailable probes the data dir and caches the answer", () => {
  const dataDir = makeDataDir();
  try {
    // This is the capability the whole workaround hinges on. On a normal
    // filesystem links work and the repair stays dormant.
    const available = hardLinksAvailable(dataDir);
    assert.equal(typeof available, "boolean");
    assert.equal(hardLinksAvailable(dataDir), available, "result must be cached");
    assert.equal(fs.readdirSync(dataDir).some((e) => e.includes("link-probe")), false, "probe files cleaned up");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

dbTest("auto mode stays dormant when hard links work (healthy hosts untouched)", async () => {
  const dataDir = makeDataDir();
  try {
    const dbPath = agentDb(dataDir);
    const db = createDb(dbPath);
    insertArchive(db, pendingArchive());
    db.close();

    if (!hardLinksAvailable(dataDir)) {
      return; // platform without hard links: auto mode is expected to act instead
    }

    const stop = startSessionArchiveRepair({ dataDir, intervalMs: 20 });
    await new Promise((r) => setTimeout(r, 80));
    stop();

    const check = new DatabaseSyncCtor(dbPath, { readOnly: true });
    const row: any = check
      .prepare("SELECT published_at FROM session_transcript_archives")
      .get();
    check.close();
    assert.equal(row.published_at, null, "auto mode must not touch anything when links work");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

dbTest("mode:false never runs, mode:true repairs and stops on abort", async () => {
  const dataDir = makeDataDir();
  try {
    const dbPath = agentDb(dataDir);
    const db = createDb(dbPath);
    insertArchive(db, pendingArchive());
    db.close();

    // disabled
    const stopDisabled = startSessionArchiveRepair({ dataDir, mode: false, intervalMs: 20 });
    stopDisabled();

    // forced on, stopped by the host abort signal
    const controller = new AbortController();
    startSessionArchiveRepair({
      dataDir,
      mode: true,
      intervalMs: 20,
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 80));
    controller.abort();

    const check = new DatabaseSyncCtor(dbPath, { readOnly: true });
    const row: any = check
      .prepare("SELECT published_at FROM session_transcript_archives")
      .get();
    check.close();
    assert.equal(typeof row.published_at, "number", "forced mode must repair");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
