import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearZulipRuntime,
  getZulipRuntime,
  isZulipRuntimeRegistered,
  readOpenClawConfigFile,
  setZulipRuntime,
} from "../src/runtime.ts";
import { sendMessageZulip } from "../src/zulip/send.ts";

// Regression coverage for #285.
//
// `openclaw message send --channel zulip` loads the plugin entry and dispatches
// channel actions *without* running gateway registration, so the runtime
// singleton is never set. That used to throw "Zulip runtime not initialized"
// before any network call, making every CLI send impossible.

test("getZulipRuntime falls back instead of throwing when no host runtime is set (#285)", () => {
  clearZulipRuntime();
  assert.equal(isZulipRuntimeRegistered(), false);

  const runtime = getZulipRuntime() as any;
  assert.ok(runtime, "should return a usable runtime instead of throwing");
  assert.equal(typeof runtime.config.current, "function");
  assert.equal(typeof runtime.channel.text.chunkMarkdownText, "function");
  assert.equal(typeof runtime.channel.text.convertMarkdownTables, "function");
  assert.equal(typeof runtime.channel.text.resolveMarkdownTableMode, "function");
  assert.equal(typeof runtime.logging.getChildLogger, "function");
  assert.equal(typeof runtime.paths?.dataDir, "string");
});

test("a registered gateway runtime always wins over the fallback", () => {
  clearZulipRuntime();
  const real = { config: { current: () => ({ marker: "real-runtime" }) } };
  setZulipRuntime(real as never);

  assert.equal(isZulipRuntimeRegistered(), true);
  assert.equal(getZulipRuntime(), real, "the registered runtime must be returned as-is");

  clearZulipRuntime();
  assert.equal(isZulipRuntimeRegistered(), false);
});

test("the CLI fallback is built once and cached", () => {
  clearZulipRuntime();
  assert.equal(getZulipRuntime(), getZulipRuntime());
  clearZulipRuntime();
});

test("the fallback deliberately omits gateway-only subsystems", () => {
  clearZulipRuntime();
  const runtime = getZulipRuntime() as any;
  // The monitor and reply pipeline only run inside the gateway, where the real
  // runtime is registered. These must not be silently stubbed.
  assert.equal(runtime.channel.media, undefined);
  assert.equal(runtime.channel.mentions, undefined);
  assert.equal(runtime.channel.reply, undefined);
  assert.equal(runtime.channel.pairing, undefined);
  assert.equal(runtime.channel.session, undefined);
  clearZulipRuntime();
});

test("readOpenClawConfigFile parses a config and tolerates a missing/invalid one", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zulip-cfg-"));
  try {
    const file = path.join(dir, "openclaw.json");
    fs.writeFileSync(file, JSON.stringify({ channels: { zulip: { url: "https://x.example" } } }));

    assert.deepEqual(readOpenClawConfigFile(file), {
      channels: { zulip: { url: "https://x.example" } },
    });
    assert.deepEqual(readOpenClawConfigFile(path.join(dir, "missing.json")), {});

    const bad = path.join(dir, "bad.json");
    fs.writeFileSync(bad, "{ not json");
    assert.deepEqual(readOpenClawConfigFile(bad), {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI-style send succeeds with no host runtime (#285)", async () => {
  clearZulipRuntime();
  const prevEnv = { ...process.env };
  const realFetch = globalThis.fetch;
  process.env.ZULIP_URL = "https://cli-send.example.com";
  process.env.ZULIP_EMAIL = "bot@example.com";
  process.env.ZULIP_API_KEY = "cli-send-key";

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ result: "success", id: 4242 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as never;

  try {
    assert.equal(isZulipRuntimeRegistered(), false, "no host runtime, exactly like the CLI");

    const result = await sendMessageZulip("user:someone@example.com", "hello from the CLI");
    assert.equal(result.messageId, "4242");
    assert.equal(calls, 1, "the send must actually reach the Zulip API");
  } finally {
    globalThis.fetch = realFetch;
    process.env = prevEnv;
    clearZulipRuntime();
  }
});

test("remote media URLs fail with an actionable error when there is no host runtime", async () => {
  clearZulipRuntime();
  const prevEnv = { ...process.env };
  process.env.ZULIP_URL = "https://cli-media.example.com";
  process.env.ZULIP_EMAIL = "bot@example.com";
  process.env.ZULIP_API_KEY = "cli-media-key";

  try {
    await assert.rejects(
      sendMessageZulip("user:someone@example.com", "caption", {
        mediaUrl: "https://cdn.example.com/picture.png",
      }),
      /require the OpenClaw gateway runtime/,
    );
  } finally {
    process.env = prevEnv;
    clearZulipRuntime();
  }
});
