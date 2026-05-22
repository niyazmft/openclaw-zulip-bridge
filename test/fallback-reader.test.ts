import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, describe, beforeEach, afterEach } from "node:test";
import { readLatestAssistantTexts } from "../src/zulip/fallback-reader.ts";

const AGENT_ID = "main";
const SESSION_KEY = "agent:main:zulip:channel:5:thread:cinemas around";

function mkTrajectoryLine(event: Record<string, unknown>): string {
  return JSON.stringify(event);
}

function artifactsEvent(opts: {
  sessionKey: string;
  assistantTexts: string[];
  ts?: string;
}): string {
  return mkTrajectoryLine({
    type: "trace.artifacts",
    sessionKey: opts.sessionKey,
    ts: opts.ts ?? new Date().toISOString(),
    data: {
      assistantTexts: opts.assistantTexts,
      didSendViaMessagingTool: false,
    },
  });
}

describe("readLatestAssistantTexts", () => {
  let tmpDir: string;
  let sessionsDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zulip-fallback-test-"));
    sessionsDir = path.join(tmpDir, "agents", AGENT_ID, "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  test("returns null when sessions dir doesn't exist", async () => {
    const result = await readLatestAssistantTexts({
      dataDir: path.join(tmpDir, "nonexistent"),
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
    });
    assert.strictEqual(result, null);
  });

  test("returns null when no trajectory files match", async () => {
    await fs.writeFile(
      path.join(sessionsDir, "abc.trajectory.jsonl"),
      artifactsEvent({ sessionKey: "different-key", assistantTexts: ["hi"] }),
    );
    const result = await readLatestAssistantTexts({
      dataDir: tmpDir,
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
    });
    assert.strictEqual(result, null);
  });

  test("matches when artifact sessionKey extends the provided base with ':thread:...'", async () => {
    // route.sessionKey gives us the channel-base; the trajectory artifact
    // uses the per-thread session key.
    const baseKey = "agent:main:zulip:channel:5";
    const threadKey = `${baseKey}:thread:large asian supermarkets`;
    await fs.writeFile(
      path.join(sessionsDir, "abc.trajectory.jsonl"),
      artifactsEvent({ sessionKey: threadKey, assistantTexts: ["thread reply"] }),
    );
    const result = await readLatestAssistantTexts({
      dataDir: tmpDir,
      agentId: AGENT_ID,
      sessionKey: baseKey,
    });
    assert.deepStrictEqual(result, ["thread reply"]);
  });

  test("does NOT match a different base prefix that just happens to start similarly", async () => {
    const baseKey = "agent:main:zulip:channel:5";
    // Same prefix-but-different scope (numerical extension)
    const otherKey = "agent:main:zulip:channel:55:thread:other";
    await fs.writeFile(
      path.join(sessionsDir, "abc.trajectory.jsonl"),
      artifactsEvent({ sessionKey: otherKey, assistantTexts: ["wrong scope"] }),
    );
    const result = await readLatestAssistantTexts({
      dataDir: tmpDir,
      agentId: AGENT_ID,
      sessionKey: baseKey,
    });
    assert.strictEqual(result, null);
  });

  test("returns assistantTexts for matching session", async () => {
    const lines = [
      mkTrajectoryLine({ type: "session.started", sessionKey: SESSION_KEY }),
      artifactsEvent({
        sessionKey: SESSION_KEY,
        assistantTexts: ["Hello world", "Second message"],
      }),
      mkTrajectoryLine({ type: "session.ended", sessionKey: SESSION_KEY }),
    ];
    await fs.writeFile(
      path.join(sessionsDir, "abc.trajectory.jsonl"),
      lines.join("\n"),
    );
    const result = await readLatestAssistantTexts({
      dataDir: tmpDir,
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
    });
    assert.deepStrictEqual(result, ["Hello world", "Second message"]);
  });

  test("ignores trajectory files older than maxAgeMs", async () => {
    const filePath = path.join(sessionsDir, "old.trajectory.jsonl");
    await fs.writeFile(
      filePath,
      artifactsEvent({ sessionKey: SESSION_KEY, assistantTexts: ["stale"] }),
    );
    // Backdate the file.
    const oldTime = new Date(Date.now() - 5 * 60_000);
    await fs.utimes(filePath, oldTime, oldTime);
    const result = await readLatestAssistantTexts({
      dataDir: tmpDir,
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
      maxAgeMs: 30_000,
    });
    assert.strictEqual(result, null);
  });

  test("prefers the most recently modified matching file", async () => {
    const oldPath = path.join(sessionsDir, "old.trajectory.jsonl");
    const newPath = path.join(sessionsDir, "new.trajectory.jsonl");
    await fs.writeFile(
      oldPath,
      artifactsEvent({ sessionKey: SESSION_KEY, assistantTexts: ["old"] }),
    );
    // Sleep briefly so mtimes differ.
    await new Promise((r) => setTimeout(r, 10));
    await fs.writeFile(
      newPath,
      artifactsEvent({ sessionKey: SESSION_KEY, assistantTexts: ["new"] }),
    );
    const result = await readLatestAssistantTexts({
      dataDir: tmpDir,
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
    });
    assert.deepStrictEqual(result, ["new"]);
  });

  test("filters out non-string and empty entries", async () => {
    await fs.writeFile(
      path.join(sessionsDir, "abc.trajectory.jsonl"),
      mkTrajectoryLine({
        type: "trace.artifacts",
        sessionKey: SESSION_KEY,
        data: { assistantTexts: ["good", "", null, 42, "alsogood"] },
      }),
    );
    const result = await readLatestAssistantTexts({
      dataDir: tmpDir,
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
    });
    assert.deepStrictEqual(result, ["good", "alsogood"]);
  });

  test("skips malformed JSON lines without failing", async () => {
    const lines = [
      "{not valid json",
      artifactsEvent({ sessionKey: SESSION_KEY, assistantTexts: ["ok"] }),
    ];
    await fs.writeFile(
      path.join(sessionsDir, "abc.trajectory.jsonl"),
      lines.join("\n"),
    );
    const result = await readLatestAssistantTexts({
      dataDir: tmpDir,
      agentId: AGENT_ID,
      sessionKey: SESSION_KEY,
    });
    assert.deepStrictEqual(result, ["ok"]);
  });
});
