import assert from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { createBotWorkspace } from "../src/zulip/workspace.js";

describe("BotWorkspace", () => {
  let dataDir: string;
  let ws: ReturnType<typeof createBotWorkspace>;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zulip-ws-test-"));
    ws = createBotWorkspace(dataDir, { ttlMs: 1000 }); // 1s TTL for fast tests
  });

  afterEach(async () => {
    try {
      await fs.rm(dataDir, { recursive: true });
    } catch {
      // ignore
    }
  });

  it("saves and reads text files", async () => {
    const filePath = await ws.saveText("hello.txt", "Hello World");
    assert.ok(filePath.includes("workspace"));
    const content = await ws.readText("hello.txt");
    assert.strictEqual(content, "Hello World");
  });

  it("saves and reads bytes", async () => {
    const buffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    await ws.saveBytes("data.bin", buffer);
    const read = await ws.readBytes("data.bin");
    assert.ok(buffer.equals(read));
  });

  it("saves JSON with indentation", async () => {
    await ws.saveJson("config.json", { key: "value", nested: { num: 42 } });
    const content = await ws.readText("config.json");
    const parsed = JSON.parse(content);
    assert.deepStrictEqual(parsed, { key: "value", nested: { num: 42 } });
    assert.ok(content.includes("\n"), "JSON should be indented with actual newlines");
  });

  it("lists files with metadata", async () => {
    await ws.saveText("a.txt", "A");
    await ws.saveText("b.txt", "B");
    const files = await ws.listFiles();
    assert.strictEqual(files.length, 2);
    assert.ok(files.every((f) => typeof f.size === "number" && f.mtime instanceof Date));
  });

  it("clears all files", async () => {
    await ws.saveText("a.txt", "A");
    await ws.saveText("b.txt", "B");
    await ws.clear();
    const files = await ws.listFiles();
    assert.strictEqual(files.length, 0);
  });

  it("rejects path traversal attempts", async () => {
    await assert.rejects(
      () => ws.saveText("../../etc/passwd", "evil"),
      /Path traversal rejected/,
    );
  });

  it("rejects path traversal with dot-dot", async () => {
    await assert.rejects(
      () => ws.saveText("foo/../../../etc/passwd", "evil"),
      /Path traversal rejected/,
    );
  });

  it("prunes old files on save", async () => {
    // Create a file manually with an old mtime
    const workspaceDir = path.join(dataDir, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });
    const oldFile = path.join(workspaceDir, "old.txt");
    await fs.writeFile(oldFile, "old content");
    const past = new Date(Date.now() - 5000); // 5 seconds ago
    await fs.utimes(oldFile, past, past);

    // Now save a new file — should trigger prune
    await ws.saveText("new.txt", "new content");

    const files = await ws.listFiles();
    const names = files.map((f) => f.name);
    assert.ok(!names.includes("old.txt"), "old file should have been pruned");
    assert.ok(names.includes("new.txt"), "new file should exist");
  });

  it("returns empty list when workspace does not exist", async () => {
    // Create a fresh workspace with no prior files
    const freshWs = createBotWorkspace(
      await fs.mkdtemp(path.join(os.tmpdir(), "zulip-ws-empty-")),
    );
    const files = await freshWs.listFiles();
    assert.deepStrictEqual(files, []);
    await fs.rm(dataDir, { recursive: true }).catch(() => {});
  });

  it("upload fails without client", async () => {
    await ws.saveText("report.csv", "id,value\n1,42");
    await assert.rejects(
      () => ws.upload("report.csv"),
      /Zulip client not configured/,
    );
  });
});
