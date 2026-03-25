import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const monitorPath = path.resolve(process.cwd(), "src/zulip/monitor.ts");

test("monitor regression: removed SDK cleanup helper is not referenced", async () => {
  const source = await fs.readFile(monitorPath, "utf8");
  assert.equal(source.includes("clearHistoryEntriesIfEnabled"), false);
  assert.equal(source.includes("deleteZulipQueue(client, queueId)"), true);
});
