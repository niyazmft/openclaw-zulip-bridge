import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveZulipDataDir,
  resolveZulipStatePath,
} from "../src/zulip/data-dir.ts";
import { AuditLogger } from "../src/zulip/audit-logger.ts";

test("resolveZulipDataDir: host-provided dataDir wins", () => {
  assert.equal(
    resolveZulipDataDir({ paths: { dataDir: "/var/lib/openclaw" } }),
    "/var/lib/openclaw",
  );
  assert.equal(
    resolveZulipDataDir({ paths: { dataDir: "  /srv/openclaw  " } }),
    "/srv/openclaw",
  );
});

test("resolveZulipDataDir: falls back to ~/.openclaw when dataDir is missing", () => {
  const expected = path.join(os.homedir(), ".openclaw");
  assert.equal(resolveZulipDataDir({}), expected);
  assert.equal(resolveZulipDataDir(undefined), expected);
  assert.equal(resolveZulipDataDir(null), expected);
  assert.equal(resolveZulipDataDir({ paths: {} }), expected);
  assert.equal(resolveZulipDataDir({ paths: { dataDir: "   " } }), expected);
  assert.equal(resolveZulipDataDir({ paths: { dataDir: null } }), expected);
});

test("resolveZulipDataDir: never hard-codes /tmp (Android has no /tmp)", () => {
  // Regression: the audit logger used to default to "/tmp/openclaw-zulip",
  // which does not exist on Termux/Android, so every audit event was silently
  // dropped. The resolver must not produce that path when a home dir exists.
  const dir = resolveZulipDataDir({});
  assert.notEqual(dir, "/tmp/openclaw-zulip");
  assert.equal(dir.startsWith(path.join(os.tmpdir(), "openclaw-zulip")), false);
});

test("resolveZulipStatePath: dedupe and queue share one directory", () => {
  const runtime = { paths: { dataDir: "/var/lib/openclaw" } };
  assert.equal(
    resolveZulipStatePath(runtime, "zulip_dedupe_default.json"),
    path.join("/var/lib/openclaw", "zulip_dedupe_default.json"),
  );
  assert.equal(
    resolveZulipStatePath(runtime, "zulip_queue_default.json"),
    path.join("/var/lib/openclaw", "zulip_queue_default.json"),
  );
});

test("AuditLogger writes inside the resolved data dir", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "zulip-audit-test-"));
  try {
    const logger = new AuditLogger(base, "default");
    await logger.logMonitorStart("default");

    const auditFile = path.join(base, "audit", "default.audit.log");
    const contents = await fs.readFile(auditFile, "utf8");
    assert.equal(contents.includes("\"event\":\"monitor_start\""), true);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("AuditLogger reports write failures instead of swallowing them", async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "zulip-audit-err-"));
  try {
    // Make the log directory un-creatable: a regular file stands where a
    // directory is required.
    const blocker = path.join(tmp, "blocker");
    await fs.writeFile(blocker, "not a dir", "utf8");
    const errors: unknown[] = [];
    const logger = new AuditLogger(path.join(blocker, "sub"), "default", {
      onError: (err) => errors.push(err),
    });
    await logger.logMonitorStart("default");
    assert.equal(errors.length, 1);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
