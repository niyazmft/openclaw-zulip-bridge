import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const monitorPath = path.resolve(process.cwd(), "src/zulip/monitor.ts");

test("monitor regression: removed SDK cleanup helper is not referenced", async () => {
  const source = await fs.readFile(monitorPath, "utf8");
  assert.equal(source.includes("clearHistoryEntriesIfEnabled"), false);
});

test("monitor regression: the event queue is not deleted on shutdown", async () => {
  // Deleting the queue while the persisted queue id survives made every restart
  // start with a guaranteed "bad event queue" error, a 1s stall, and a window
  // where inbound messages were lost.
  const source = await fs.readFile(monitorPath, "utf8");
  assert.equal(source.includes("deleteZulipQueue(client, queue.queueId)"), false);
  assert.equal(source.includes("deleteZulipQueue,"), false);
});
