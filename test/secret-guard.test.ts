import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  collectKnownSecrets,
  describeLeakedSecrets,
  findLeakedSecrets,
} from "../src/zulip/secret-guard.ts";
import { sendMessageZulip } from "../src/zulip/send.ts";
import { clearZulipRuntime, setZulipRuntime } from "../src/runtime.ts";

// Regression coverage for a live leak: an agent read the host config and typed
// credential values into a Zulip DM. A path allowlist on file *uploads* cannot
// stop that, because nothing was uploaded — the plugin is the last hop, so it
// refuses to transmit known credentials.

const SECRET = "SUPERSECRET-value-abcdef123456";
const OTHER_SECRET = "ANOTHERSECRET-value-zyxwvu654321";

// send.ts caches Zulip clients by url+email+apiKey, so each test must use its
// own credentials or it would inherit an earlier test's stubbed fetch.
let unique = 0;
function cfgWith(secret: string, extra: Record<string, unknown> = {}) {
  unique += 1;
  return {
    channels: {
      zulip: {
        url: `https://guard${unique}.example.com`,
        email: `bot${unique}@example.com`,
        apiKey: secret,
        ...extra,
      },
    },
  };
}

function installRuntime(cfg: unknown, dataDir: string) {
  setZulipRuntime({
    config: { current: () => cfg },
    logging: { getChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }), shouldLogVerbose: () => false },
    log: () => {},
    error: () => {},
    paths: { dataDir },
    channel: {
      text: { resolveMarkdownTableMode: () => "off", convertMarkdownTables: (t: string) => t },
      activity: { record: () => {} },
    },
  } as never);
}

test("collectKnownSecrets finds credential-shaped values, nested and in arrays", () => {
  const cfg = {
    channels: { zulip: { apiKey: SECRET } },
    plugins: { entries: { honcho: { config: { token: OTHER_SECRET } } } },
    accounts: [{ password: "third-secret-value-1234" }],
  };
  const found = collectKnownSecrets(cfg);
  const values = found.map((s) => s.value);
  assert.equal(values.includes(SECRET), true);
  assert.equal(values.includes(OTHER_SECRET), true);
  assert.equal(values.includes("third-secret-value-1234"), true);
  assert.equal(found.find((s) => s.value === SECRET)?.name, "channels.zulip.apiKey");
});

test("collectKnownSecrets ignores short values and non-credential keys", () => {
  const cfg = {
    channels: { zulip: { apiKey: "short" } }, // below the length floor
    theme: "a-very-long-but-not-a-secret-string",
    name: "another-long-innocuous-value",
  };
  assert.deepEqual(collectKnownSecrets(cfg), []);
});

test("collectKnownSecrets reports a duplicated value once", () => {
  const cfg = { a: { apiKey: SECRET }, b: { apiKey: SECRET } };
  const found = collectKnownSecrets(cfg).filter((s) => s.value === SECRET);
  assert.equal(found.length, 1);
});

test("findLeakedSecrets matches verbatim substrings only", () => {
  const secrets = [{ name: "channels.zulip.apiKey", value: SECRET }];
  assert.equal(findLeakedSecrets(`here it is: ${SECRET}`, secrets).length, 1);
  assert.equal(findLeakedSecrets("nothing sensitive here", secrets).length, 0);
  assert.equal(findLeakedSecrets("", secrets).length, 0);
  assert.equal(findLeakedSecrets(SECRET, []).length, 0, "no secrets configured => never matches");
});

test("the leak description names the source but never the value", () => {
  const summary = describeLeakedSecrets([{ name: "channels.zulip.apiKey", value: SECRET }]);
  assert.match(summary, /channels\.zulip\.apiKey/);
  assert.equal(summary.includes(SECRET), false, "the message about a leak must not itself leak");
});

test("send is refused when the message contains a host credential", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "zulip-guard-"));
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as never;
  try {
    installRuntime(cfgWith(SECRET), dataDir);
    await assert.rejects(
      sendMessageZulip("user:someone@example.com", `the config says apiKey=${SECRET}`),
      (err: Error) => {
        assert.match(err.message, /Refusing to send/);
        assert.match(err.message, /channels\.zulip\.apiKey/);
        assert.equal(err.message.includes(SECRET), false, "the refusal must not echo the secret");
        return true;
      },
    );
    assert.equal(calls, 0, "nothing may reach the Zulip API");
  } finally {
    globalThis.fetch = realFetch;
    clearZulipRuntime();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("a benign message still sends", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "zulip-guard-"));
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ result: "success", id: 777 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as never;
  try {
    installRuntime(cfgWith(SECRET), dataDir);
    const result = await sendMessageZulip("user:someone@example.com", "just a normal reply");
    assert.equal(result.messageId, "777");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
    clearZulipRuntime();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("blockSecretLeaks:false disables the guard", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "zulip-guard-"));
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ result: "success", id: 888 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as never;
  try {
    installRuntime(cfgWith(SECRET, { blockSecretLeaks: false }), dataDir);
    const result = await sendMessageZulip("user:someone@example.com", `opt-out: ${SECRET}`);
    assert.equal(result.messageId, "888");
    assert.equal(calls, 1, "the opt-out must actually allow the send");
  } finally {
    globalThis.fetch = realFetch;
    clearZulipRuntime();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
