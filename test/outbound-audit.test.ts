import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getAuditLogger, resetAuditLoggers } from "../src/zulip/audit-log.ts";
import { auditOutboundSend, outboundTargetKind } from "../src/zulip/outbound-audit.ts";
import { setZulipRuntime, clearZulipRuntime } from "../src/runtime.ts";

// #326 cause 2: the agent's `message` tool reaches the host through the channel's
// outbound adapter, which called `sendMessageZulip` directly and wrote no audit
// event. A successful `message`-tool reply and a run that produced nothing were
// therefore identical in the audit log.

function tmpDir(): string {
  return path.join(os.tmpdir(), `zulip-outbound-audit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

async function readAuditEvents(baseDir: string, accountId = "default") {
  const content = await fs.readFile(path.join(baseDir, "audit", `${accountId}.audit.log`), "utf8");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Points the shared logger's data-dir resolution at a temp directory. */
function useRuntimeDataDir(dataDir: string) {
  setZulipRuntime({
    paths: { dataDir },
    logging: undefined,
    config: { current: () => ({}) },
  } as any);
}

test("getAuditLogger returns one instance per account", () => {
  resetAuditLoggers();
  const a = getAuditLogger("default", { dataDir: "/tmp/a" });
  const b = getAuditLogger("default", { dataDir: "/tmp/b" });
  const other = getAuditLogger("secondary", { dataDir: "/tmp/a" });

  // Two instances appending to one file could interleave writes or race on rotation.
  assert.equal(a, b, "same account must share the logger, even with a different dataDir");
  assert.notEqual(a, other, "different accounts get different files");
  resetAuditLoggers();
});

test("getAuditLogger honours an explicit dataDir", async () => {
  resetAuditLoggers();
  const dir = tmpDir();
  try {
    await getAuditLogger("default", { dataDir: dir }).logMonitorStart("default");
    const events = await readAuditEvents(dir);
    assert.equal(events[0].event, "monitor_start");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    resetAuditLoggers();
  }
});

test("outboundTargetKind classifies without echoing the target", () => {
  assert.equal(outboundTargetKind("stream:main:general"), "stream");
  assert.equal(outboundTargetKind("#main"), "stream");
  assert.equal(outboundTargetKind("user:a@example.com"), "dm");
  assert.equal(outboundTargetKind("@a@example.com"), "dm");
  assert.equal(outboundTargetKind(""), "unknown");
  assert.equal(outboundTargetKind("garbage"), "unknown");
});

test("auditOutboundSend records the send with a masked target and no body", async () => {
  resetAuditLoggers();
  const dir = tmpDir();
  useRuntimeDataDir(dir);
  try {
    auditOutboundSend({
      accountId: "default",
      to: "user:sender@example.com",
      kind: "text",
      text: "the answer is 42",
      messageId: "4242",
    });
    // `log()` is queued; give the append a turn to land.
    await new Promise((r) => setTimeout(r, 60));

    const events = await readAuditEvents(dir);
    const event = events.find((e) => e.event === "outbound_send");
    assert.ok(event, "an outbound_send event must be recorded");
    assert.equal(event.direction, "outbound");
    assert.equal(event.source, "channel-outbound");
    assert.equal(event.kind, "text");
    assert.equal(event.targetKind, "dm");
    assert.equal(event.textLen, "the answer is 42".length);
    assert.equal(event.hasMedia, "false");
    assert.equal(event.messageId, "4242");

    const raw = JSON.stringify(event);
    assert.ok(!raw.includes("sender@example.com"), "the target must be masked");
    assert.ok(!raw.includes("the answer is 42"), "the message body must never be recorded");
  } finally {
    clearZulipRuntime();
    resetAuditLoggers();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("auditOutboundSend records media sends", async () => {
  resetAuditLoggers();
  const dir = tmpDir();
  useRuntimeDataDir(dir);
  try {
    auditOutboundSend({
      to: "stream:main:general",
      kind: "media",
      text: "",
      hasMedia: true,
      messageId: 17,
    });
    await new Promise((r) => setTimeout(r, 60));

    const event = (await readAuditEvents(dir)).find((e) => e.event === "outbound_send");
    assert.ok(event);
    assert.equal(event.kind, "media");
    assert.equal(event.targetKind, "stream");
    assert.equal(event.hasMedia, "true");
    assert.equal(event.messageId, "17");
  } finally {
    clearZulipRuntime();
    resetAuditLoggers();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("auditOutboundSend never throws, even when the log cannot be written", async () => {
  resetAuditLoggers();
  const dir = tmpDir();
  // A regular file where the audit *directory* must go: mkdir/write will fail.
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "audit"), "not a directory", "utf8");
  useRuntimeDataDir(dir);
  try {
    assert.doesNotThrow(() =>
      auditOutboundSend({ to: "user:a@example.com", kind: "text", text: "hello" }),
    );
    await new Promise((r) => setTimeout(r, 60));
  } finally {
    clearZulipRuntime();
    resetAuditLoggers();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ── The action path (what the `message` tool and the CLI actually use) ──────

test("handleSendAction audits stream and DM sends", async () => {
  resetAuditLoggers();
  const dir = tmpDir();
  useRuntimeDataDir(dir);
  const { handleSendAction } = await import("../src/actions-send.ts");
  const client = {} as any; // replaced per-call below
  try {
    // Stream send
    const streamClient: any = {
      authHeader: "Basic x",
      baseUrl: "https://example.com",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ result: "success", msg: "", id: 111 }),
        headers: { get: () => null },
      }),
    };
    await handleSendAction(streamClient, { to: "stream:main:general", message: "hello stream" }, "default");
    // DM send
    await handleSendAction(streamClient, { to: "user:a@example.com", message: "hello dm" }, "default");
    await new Promise((r) => setTimeout(r, 80));

    const events = (await readAuditEvents(dir)).filter((e) => e.event === "outbound_send");
    assert.equal(events.length, 2, "one outbound_send per action send");
    assert.equal(events[0].source, "channel-action");
    assert.equal(events[0].targetKind, "stream");
    assert.equal(events[0].textLen, "hello stream".length);
    assert.equal(events[0].messageId, "111");
    assert.equal(events[1].targetKind, "dm");
    assert.ok(!JSON.stringify(events).includes("a@example.com"), "target must be masked");
  } finally {
    void client;
    clearZulipRuntime();
    resetAuditLoggers();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
