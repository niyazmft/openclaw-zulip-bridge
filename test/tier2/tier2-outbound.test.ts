import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeZulipServer } from "./fake-zulip-server.js";
import {
  createZulipClient,
  sendZulipStreamMessage,
  sendZulipPrivateMessage,
  uploadZulipFile,
  addZulipReaction,
  editZulipMessage,
  sendZulipTyping,
} from "../../dist/src/zulip/client.js";

async function startFake(): Promise<ReturnType<typeof createFakeZulipServer>> {
  const fake = createFakeZulipServer();
  await new Promise<void>((resolve) => fake.server.listen(0, resolve));
  const addr = fake.server.address();
  fake.port = typeof addr === "object" && addr ? addr.port : 0;
  fake.url = `http://127.0.0.1:${fake.port}`;
  return fake;
}

function makeClient(fake: any) {
  return createZulipClient({
    baseUrl: fake.url,
    email: "bot@zulip.com",
    apiKey: "fake-key",
    allowInsecureHttp: true,
  });
}

async function withFake(testFn: (fake: any, client: any) => Promise<void>) {
  const fake = await startFake();
  try {
    const client = makeClient(fake);
    await testFn(fake, client);
  } finally {
    await fake.close();
  }
}

test("sendZulipStreamMessage captures stream + topic + content", async () => {
  await withFake(async (fake, client) => {
    await sendZulipStreamMessage(client, {
      stream: "test-stream",
      topic: "hello-topic",
      content: "stream msg body",
    });
    const msgs = fake.getCapturedMessages();
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].type, "stream");
    assert.strictEqual(msgs[0].to, "test-stream");
    assert.strictEqual(msgs[0].topic, "hello-topic");
    assert.strictEqual(msgs[0].content, "stream msg body");
  });
});

test("sendZulipPrivateMessage captures DM recipients + content", async () => {
  await withFake(async (fake, client) => {
    await sendZulipPrivateMessage(client, {
      to: ["user@example.com"],
      content: "dm body",
    });
    const msgs = fake.getCapturedMessages();
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].type, "private");
    assert.strictEqual(msgs[0].content, "dm body");
  });
});

test("uploadZulipFile captures multipart upload", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "zulip-tier2-upload-"));
  const filePath = join(tmpDir, "test.txt");
  writeFileSync(filePath, "test file bytes");
  await withFake(async (fake, client) => {
    await uploadZulipFile(client, filePath);
    const ups = fake.getCapturedUploads();
    assert.strictEqual(ups.length, 1);
    assert.ok(ups[0].body.includes("test.txt"));
  });
  rmSync(tmpDir, { recursive: true, force: true });
});

test("addZulipReaction captures emoji + messageId", async () => {
  await withFake(async (fake, client) => {
    await addZulipReaction(client, { messageId: "42", emojiName: "thumbs_up" });
    const rxns = fake.getCapturedReactions();
    assert.strictEqual(rxns.length, 1);
    assert.strictEqual(rxns[0].messageId, "42");
    assert.strictEqual(rxns[0].emoji, "thumbs_up");
  });
});

test("editZulipMessage captures PATCH content + messageId", async () => {
  await withFake(async (fake, client) => {
    await editZulipMessage(client, { messageId: "99", content: "edited text" });
    const edits = fake.getCapturedEdits();
    assert.strictEqual(edits.length, 1);
    assert.strictEqual(edits[0].messageId, "99");
    assert.strictEqual(edits[0].content, "edited text");
  });
});

test("sendZulipTyping captures typing indicator", async () => {
  await withFake(async (fake, client) => {
    await sendZulipTyping(client, { to: ["user@example.com"], op: "start" });
    const typing = fake.getCapturedTyping();
    assert.strictEqual(typing.length, 1);
    assert.strictEqual(typing[0].op, "start");
  });
});
