import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readAllowFromStore } from "../src/zulip/allowlist-store.ts";

const DATA_DIR = "/var/lib/openclaw";
const EXPECTED = path.join(DATA_DIR, "credentials", "zulip-default-allowFrom.json");

function mockFs(files: Record<string, string>) {
  const seen: string[] = [];
  const fileSystem = {
    readFile: async (p: string, _enc: string): Promise<unknown> => {
      seen.push(p);
      if (p in files) {
        return files[p];
      }
      const err = new Error("ENOENT: " + p) as Error & { code?: string };
      err.code = "ENOENT";
      throw err;
    },
  };
  return { fileSystem, seen };
}

test("readAllowFromStore reads only the resolved data dir", async () => {
  const { fileSystem, seen } = mockFs({
    [EXPECTED]: JSON.stringify({ allowFrom: ["admin@good.com"] }),
  });
  const result = await readAllowFromStore({ dataDir: DATA_DIR, accountId: "default", fileSystem });
  assert.deepEqual(result, { allowFrom: ["admin@good.com"], wildcardRejected: false });
  assert.deepEqual(seen, [EXPECTED]);
});

test("readAllowFromStore never probes /tmp or other fallback dirs", async () => {
  const { fileSystem, seen } = mockFs({});
  await readAllowFromStore({ dataDir: DATA_DIR, accountId: "default", fileSystem });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].startsWith(DATA_DIR + path.sep), true);
  assert.equal(seen.some((p) => p.includes("/tmp/") || p.includes("openclaw-zulip")), false);
});

test("readAllowFromStore rejects a wildcard from the store file", async () => {
  const { fileSystem } = mockFs({ [EXPECTED]: JSON.stringify({ allowFrom: ["*"] }) });
  const result = await readAllowFromStore({ dataDir: DATA_DIR, accountId: "default", fileSystem });
  assert.deepEqual(result, { allowFrom: [], wildcardRejected: true });
});

test("readAllowFromStore rejects a wildcard mixed with real entries", async () => {
  const { fileSystem } = mockFs({
    [EXPECTED]: JSON.stringify({ allowFrom: ["admin@good.com", "*"] }),
  });
  const result = await readAllowFromStore({ dataDir: DATA_DIR, accountId: "default", fileSystem });
  assert.deepEqual(result, { allowFrom: [], wildcardRejected: true });
});

test("readAllowFromStore returns empty for a missing file", async () => {
  const { fileSystem } = mockFs({});
  const result = await readAllowFromStore({ dataDir: DATA_DIR, accountId: "default", fileSystem });
  assert.deepEqual(result, { allowFrom: [], wildcardRejected: false });
});

test("readAllowFromStore tolerates malformed JSON and non-array values", async () => {
  for (const raw of ["not json", JSON.stringify({ allowFrom: "nope" }), "null"]) {
    const { fileSystem } = mockFs({ [EXPECTED]: raw });
    const result = await readAllowFromStore({ dataDir: DATA_DIR, accountId: "default", fileSystem });
    assert.deepEqual(result, { allowFrom: [], wildcardRejected: false });
  }
});

test("readAllowFromStore normalizes entries", async () => {
  const { fileSystem } = mockFs({
    [EXPECTED]: JSON.stringify({ allowFrom: ["zulip:Admin@Good.com"] }),
  });
  const result = await readAllowFromStore({ dataDir: DATA_DIR, accountId: "default", fileSystem });
  assert.deepEqual(result.allowFrom, ["admin@good.com"]);
});
