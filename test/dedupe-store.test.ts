import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ZulipDedupeStore } from "../src/zulip/dedupe-store.js";
import type { PluginRuntime } from "openclaw/plugin-sdk";

const mockRuntime: PluginRuntime = {
  log: () => {},
  error: () => {},
  exit: (code: number) => {
    throw new Error(`exit ${code}`);
  },
};

test("ZulipDedupeStore: basic duplicate suppression", async () => {
  const accountId = `test_basic_${Math.random()}`;
  const store = new ZulipDedupeStore({
    accountId,
    runtime: mockRuntime,
    ttlMs: 1000,
    maxSize: 10,
  });

  const key = "msg1";
  const now = Date.now();
  assert.equal(await store.check(key, now), false, "First check should be false");
  assert.equal(await store.check(key, now + 1), true, "Second check should be true");
});

test("ZulipDedupeStore: TTL expiry", async () => {
  const accountId = `test_ttl_${Math.random()}`;
  const ttlMs = 100;
  const store = new ZulipDedupeStore({
    accountId,
    runtime: mockRuntime,
    ttlMs,
    maxSize: 10,
  });

  const key = "msg1";
  const now = Date.now();
  assert.equal(await store.check(key, now), false);
  assert.equal(await store.check(key, now + 10), true);
  // Ensure we are well past the TTL relative to the last touch (now + 10)
  assert.equal(await store.check(key, now + ttlMs + 20), false, "Should expire after TTL");
});

test("ZulipDedupeStore: max size pruning", async () => {
  const accountId = `test_size_${Math.random()}`;
  const store = new ZulipDedupeStore({
    accountId,
    runtime: mockRuntime,
    ttlMs: 1000000,
    maxSize: 2,
  });

  const now = 1000000;
  assert.equal(await store.check("msg1", now), false, "msg1 new");
  assert.equal(await store.check("msg2", now + 1), false, "msg2 new");

  // Re-checking msg1 should move it to the end (most recent).
  assert.equal(await store.check("msg1", now + 2), true, "msg1 touched");

  // Adding msg3 should prune the oldest entry, which is msg2.
  assert.equal(await store.check("msg3", now + 3), false, "msg3 new");

  // Cache is [msg1, msg3]
  assert.equal(await store.check("msg1", now + 4), true, "msg1 should be present");
  assert.equal(await store.check("msg3", now + 5), true, "msg3 should be present");
  assert.equal(await store.check("msg2", now + 6), false, "msg2 should have been pruned");
});

test("ZulipDedupeStore: persistence across restarts", async () => {
  const accountId = `test_persist_${Math.random()}`;
  const store1 = new ZulipDedupeStore({
    accountId,
    runtime: mockRuntime,
    ttlMs: 1000,
    maxSize: 10,
  });

  const now = Date.now();
  await store1.check("msg1", now);
  await store1.save();

  const store2 = new ZulipDedupeStore({
    accountId,
    runtime: mockRuntime,
    ttlMs: 1000,
    maxSize: 10,
  });
  await store2.load();

  assert.equal(await store2.check("msg1", now + 1), true, "Should remember msg1 across restart");
  assert.equal(await store2.check("msg2", now + 2), false, "Should not know msg2");
});

test("ZulipDedupeStore: load prunes expired entries", async () => {
  const accountId = `test_load_prune_${Math.random()}`;
  const ttlMs = 100;
  const store1 = new ZulipDedupeStore({
    accountId,
    runtime: mockRuntime,
    ttlMs,
    maxSize: 10,
  });

  const now = Date.now();
  await store1.check("msg1", now);
  await store1.save();

  // Simulate time passing beyond TTL
  const store2 = new ZulipDedupeStore({
    accountId,
    runtime: mockRuntime,
    ttlMs,
    maxSize: 10,
  });

  // Wait a bit to ensure Date.now() inside store2.load() is after TTL
  await new Promise(resolve => setTimeout(resolve, ttlMs + 10));
  await store2.load();

  assert.equal(await store2.check("msg1", Date.now()), false, "msg1 should have been pruned during load");
});
