import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { uploadZulipFile, type ZulipClient } from "../src/zulip/client.js";
import { handleUploadFileAction } from "../src/actions-upload.js";
import { setZulipRuntime } from "../src/runtime.js";

function fakeClient(): { client: ZulipClient; calls: string[] } {
  const calls: string[] = [];
  const jsonResponse = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const client: ZulipClient = {
    baseUrl: "https://zulip.example.com",
    authHeader: "dGVzdDp0ZXN0",
    fetchImpl: (async (url: any) => {
      calls.push("fetch");
      const path = typeof url === "string" ? url : String(url);
      if (path.includes("/user_uploads")) {
        return jsonResponse({ result: "success", uri: "/user_uploads/abc/file.png" });
      }
      return jsonResponse({ result: "success", id: 1 });
    }) as typeof fetch,
    request: (async () => {
      calls.push("request");
      return { result: "success", id: 1, uri: "/user_uploads/abc/file.png" };
    }) as ZulipClient["request"],
  };
  return { client, calls };
}

// ── uploadZulipFile path allowlist ──────────────────────────────────────────

async function setMinimalRuntime() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zulip-upload-rt-"));
  setZulipRuntime({ paths: { dataDir: dir } } as any);
  return dir;
}

test("uploadZulipFile rejects paths outside tmpdir/dataDir", async () => {
  await setMinimalRuntime();
  const { client } = fakeClient();
  await assert.rejects(
    uploadZulipFile(client, "/etc/passwd"),
    /Refusing to upload file from unauthorized path/,
  );
});

test("uploadZulipFile rejects path traversal into system files", async () => {
  await setMinimalRuntime();
  const { client } = fakeClient();
  await assert.rejects(
    uploadZulipFile(client, "/tmp/../etc/passwd"),
    /Refusing to upload file from unauthorized path/,
  );
});

test("uploadZulipFile accepts a temp file and returns a base-relative URL", async () => {
  await setMinimalRuntime();
  const { client, calls } = fakeClient();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zulip-upload-test-"));
  const filePath = path.join(dir, "report.txt");
  await fs.writeFile(filePath, "hello upload", "utf8");
  try {
    const { url } = await uploadZulipFile(client, filePath);
    assert.match(url, /^https:\/\/zulip\.example\.com\/user_uploads\//);
    assert.equal(calls.filter((c) => c === "fetch").length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ── handleUploadFileAction (core `upload-file` action) ─────────────────────

function mockRuntimeFor(dataDir: string) {
  return {
    paths: { dataDir },
    config: {
      current: () => ({
        channels: {
          zulip: {
            accounts: {
              default: {
                url: "https://zulip.example.com",
                email: "bot@example.com",
                apiKey: "secret",
              },
            },
          },
        },
      }),
    },
    logging: {
      getChildLogger: () => ({ info: () => {}, error: () => {} }),
    },
    channel: {
      text: {
        resolveMarkdownTableMode: () => "none" as const,
        convertMarkdownTables: (m: string) => m,
        resolveChunkMode: () => "length" as const,
        chunkMarkdownTextWithMode: (t: string) => [t],
        resolveTextChunkLimit: () => 4000,
      },
      media: {},
      activity: { record: () => {} },
    },
  };
}

test("handleUploadFileAction stages, uploads, and sends the Zulip-hosted URL", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zulip-upload-act-"));
  setZulipRuntime(mockRuntimeFor(dataDir) as any);

  // Global fetch mock backs sendMessageZulip's own client (send step).
  const fetchCalls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalls.push("fetch");
    return new Response(
      JSON.stringify({ result: "success", id: 42 }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const { client, calls } = fakeClient();
    const result = (await handleUploadFileAction(client, {
      to: "stream:general",
      buffer: Buffer.from("file body").toString("base64"),
      filename: "report.txt",
      caption: "see attachment",
    })) as { success: boolean; messageId: string; url: string };

    assert.equal(result.success, true);
    assert.equal(result.messageId, "42");
    assert.match(result.url, /^https:\/\/zulip\.example\.com\/user_uploads\//);
    // Upload went through the client's fetch; the send went through global fetch.
    assert.ok(calls.some((c) => c === "fetch"));
    assert.ok(fetchCalls.length > 0);

    // Staged file is cleaned up after upload.
    const staged = path.join(dataDir, "workspace", "report.txt");
    await assert.rejects(fs.access(staged));
  } finally {
    globalThis.fetch = realFetch;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("handleUploadFileAction sanitizes traversal filenames", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zulip-upload-trav-"));
  setZulipRuntime(mockRuntimeFor(dataDir) as any);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ result: "success", id: 7 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  try {
    const { client } = fakeClient();
    const result = (await handleUploadFileAction(client, {
      to: "stream:general",
      buffer: Buffer.from("x").toString("base64"),
      filename: "../../etc/evil.txt",
    })) as { success: boolean; url: string };
    assert.equal(result.success, true);
    // Nothing escaped the workspace.
    const escaped = path.resolve("/etc", "evil.txt");
    await assert.rejects(fs.access(escaped));
  } finally {
    globalThis.fetch = realFetch;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("handleUploadFileAction requires a file source", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zulip-upload-empty-"));
  setZulipRuntime(mockRuntimeFor(dataDir) as any);
  try {
    const { client } = fakeClient();
    await assert.rejects(
      handleUploadFileAction(client, { to: "stream:general" }),
      /requires a file source/,
    );
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

// ── Source regression tests ────────────────────────────────────────────────

test("actions source: upload-file is registered and routed (#268)", async () => {
  const fsmod = await import("node:fs/promises");
  const src = await fsmod.readFile(
    path.resolve(process.cwd(), "src/actions.ts"),
    "utf8",
  );
  assert.equal(src.includes('"upload-file"'), true);
  assert.equal(src.includes("handleUploadFileAction"), true);
});

test("send source: local mediaUrl attempts sandboxed upload instead of silent drop (#268)", async () => {
  const fsmod = await import("node:fs/promises");
  const src = await fsmod.readFile(
    path.resolve(process.cwd(), "src/zulip/send.ts"),
    "utf8",
  );
  assert.equal(src.includes("rejected local mediaUrl"), true);
  assert.equal(src.includes("uploadZulipFile(client, localPath)"), true);
  // Keep file:// handling present.
  assert.equal(src.includes("fileURLToPath(mediaUrl)"), true);
});