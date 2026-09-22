import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ZulipQueueManager } from "../src/zulip/queue-manager.ts";

// Keep persistence in a temp dir instead of the ~/.openclaw fallback so tests
// do not litter the live data directory.
const testDataDir = mkdtempSync(path.join(os.tmpdir(), "zulip-queue-test-"));

const mockRuntime = {
  log: () => {},
  error: () => {},
  exit: (code: number) => {
    throw new Error(`exit ${code}`);
  },
  paths: { dataDir: testDataDir },
} as any;

test("ZulipQueueManager: registers a new queue", async () => {
  const accountId = "test-account-" + Date.now();
  let registerCalled = 0;

  const manager = new ZulipQueueManager({
    accountId,
    runtime: mockRuntime,
    registerFn: async () => {
      registerCalled++;
      return { queueId: "q1", lastEventId: 100 };
    },
  });

  const queue = await manager.ensureQueue();
  assert.equal(queue.queueId, "q1");
  assert.equal(queue.lastEventId, 100);
  assert.equal(registerCalled, 1);

  // Second call should return cached queue
  const queue2 = await manager.ensureQueue();
  assert.equal(queue2.queueId, "q1");
  assert.equal(registerCalled, 1);

  // Cleanup persistence
  await manager.markQueueExpired();
});

test("ZulipQueueManager: re-registers after expiry", async () => {
  const accountId = "test-account-expiry-" + Date.now();
  let registerCalled = 0;

  const manager = new ZulipQueueManager({
    accountId,
    runtime: mockRuntime,
    registerFn: async () => {
      registerCalled++;
      return { queueId: "q" + registerCalled, lastEventId: 100 };
    },
  });

  await manager.ensureQueue();
  assert.equal(registerCalled, 1);

  await manager.markQueueExpired();
  const queue2 = await manager.ensureQueue();
  assert.equal(queue2.queueId, "q2");
  assert.equal(registerCalled, 2);

  // Cleanup
  await manager.markQueueExpired();
});

test("ZulipQueueManager: single-flight locking", async () => {
  const accountId = "test-account-lock-" + Date.now();
  let registerCalled = 0;

  const manager = new ZulipQueueManager({
    accountId,
    runtime: mockRuntime,
    registerFn: async () => {
      registerCalled++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { queueId: "q_lock", lastEventId: 100 };
    },
  });

  const [q1, q2, q3] = await Promise.all([
    manager.ensureQueue(),
    manager.ensureQueue(),
    manager.ensureQueue(),
  ]);

  assert.equal(q1.queueId, "q_lock");
  assert.equal(q2.queueId, "q_lock");
  assert.equal(q3.queueId, "q_lock");
  assert.equal(registerCalled, 1);

  // Cleanup
  await manager.markQueueExpired();
});

test("ZulipQueueManager: persistence across instances", async () => {
  const accountId = "test-account-pers-" + Date.now();
  let registerCalled = 0;
  const registerFn = async () => {
    registerCalled++;
    return { queueId: "q_pers", lastEventId: 100 };
  };

  const manager1 = new ZulipQueueManager({
    accountId,
    runtime: mockRuntime,
    registerFn,
  });

  await manager1.ensureQueue();
  assert.equal(registerCalled, 1);

  const manager2 = new ZulipQueueManager({
    accountId,
    runtime: mockRuntime,
    registerFn,
  });

  const q2 = await manager2.ensureQueue();
  assert.equal(q2.queueId, "q_pers");
  assert.equal(registerCalled, 1); // Should have loaded from file

  // Update event id
  await manager2.updateLastEventId(105);

  const manager3 = new ZulipQueueManager({
    accountId,
    runtime: mockRuntime,
    registerFn,
  });
  const q3 = await manager3.ensureQueue();
  assert.equal(q3.lastEventId, 105);

  // Cleanup
  await manager3.markQueueExpired();
});

test("ZulipQueueManager: getQueue does not trigger registration", async () => {
  const accountId = "test-account-get-" + Date.now();
  let registerCalled = 0;

  const manager = new ZulipQueueManager({
    accountId,
    runtime: mockRuntime,
    registerFn: async () => {
      registerCalled++;
      return { queueId: "q_get", lastEventId: 100 };
    },
  });

  assert.equal(manager.getQueue(), null);
  assert.equal(registerCalled, 0);

  await manager.ensureQueue();
  assert.equal(registerCalled, 1);
  assert.equal(manager.getQueue()?.queueId, "q_get");
  assert.equal(registerCalled, 1);
});

test("ZulipQueueManager: markQueueExpired clears persistence even if not loaded in memory", async () => {
  const accountId = "test-account-clear-pers-" + Date.now();
  const registerFn = async () => ({ queueId: "q_clear", lastEventId: 100 });

  const manager1 = new ZulipQueueManager({ accountId, runtime: mockRuntime, registerFn });
  await manager1.ensureQueue();

  // Create a new manager instance, it doesn't have it in memory yet
  const manager2 = new ZulipQueueManager({ accountId, runtime: mockRuntime, registerFn });
  assert.equal(manager2.getQueue(), null);

  // Expire it - should clear the file created by manager1
  await manager2.markQueueExpired();

  // Manager 3 should now NOT find any persisted metadata
  let registerCalled = 0;
  const manager3 = new ZulipQueueManager({
    accountId,
    runtime: mockRuntime,
    registerFn: async () => {
      registerCalled++;
      return { queueId: "q_new", lastEventId: 1 };
    },
  });

  const q3 = await manager3.ensureQueue();
  assert.equal(q3.queueId, "q_new");
  assert.equal(registerCalled, 1);

  await manager3.markQueueExpired();
});

// ── Event-type awareness (#297 regression) ──────────────────────────────────
// `/register` fixes `event_types` for a queue's whole lifetime, and the manager
// reuses a persisted queue across restarts. Without comparing the requested
// event types, enabling a feature that needs a new event type (e.g.
// `reactionTriggers` needing `reaction`) silently receives nothing.

/** Same file the manager persists to (see `getPersistencePath`). */
function queuePath(accountId: string): string {
  const safeAccountId = accountId.replace(/[^a-z0-9]/gi, "_");
  return path.join(testDataDir, `zulip_queue_${safeAccountId}.json`);
}

test("ZulipQueueManager: records the event types it registered with", async () => {
  const accountId = "test-account-eventtypes-" + Date.now();
  const manager = new ZulipQueueManager({
    accountId,
    runtime: mockRuntime,
    registerFn: async () => ({ queueId: "q_et", lastEventId: 5 }),
    desiredEventTypes: ["message", "reaction"],
  });

  await manager.ensureQueue();
  const persisted = JSON.parse(readFileSync(queuePath(accountId), "utf8"));
  assert.deepEqual(persisted.eventTypes, ["message", "reaction"]);

  await manager.markQueueExpired();
});

test("ZulipQueueManager: reuses a persisted queue when the event types match", async () => {
  const accountId = "test-account-reuse-ets-" + Date.now();
  let registered = 0;
  const registerFn = async () => {
    registered++;
    return { queueId: "q_reuse" + registered, lastEventId: 10 };
  };

  const first = new ZulipQueueManager({
    accountId,
    runtime: mockRuntime,
    registerFn,
    desiredEventTypes: ["message", "reaction"],
  });
  await first.ensureQueue();
  assert.equal(registered, 1);

  // Order must not matter.
  const second = new ZulipQueueManager({
    accountId,
    runtime: mockRuntime,
    registerFn,
    desiredEventTypes: ["reaction", "message"],
  });
  const queue = await second.ensureQueue();
  assert.equal(queue.queueId, "q_reuse1");
  assert.equal(registered, 1, "matching event types must reuse the persisted queue");

  await second.markQueueExpired();
});

test("ZulipQueueManager: re-registers when a newly needed event type is missing (#297)", async () => {
  const accountId = "test-account-et-upgrade-" + Date.now();
  let registered = 0;
  const registerFn = async () => {
    registered++;
    return { queueId: "q_gen" + registered, lastEventId: 1 };
  };

  // Before: no reaction triggers configured, so only `message` was requested.
  const before = new ZulipQueueManager({
    accountId,
    runtime: mockRuntime,
    registerFn,
    desiredEventTypes: ["message"],
  });
  await before.ensureQueue();
  assert.equal(registered, 1);

  // After enabling `reactionTriggers`: the persisted queue can never deliver
  // reaction events, so it must NOT be reused.
  const after = new ZulipQueueManager({
    accountId,
    runtime: mockRuntime,
    registerFn,
    desiredEventTypes: ["message", "reaction"],
  });
  const queue = await after.ensureQueue();
  assert.equal(queue.queueId, "q_gen2");
  assert.equal(registered, 2);
  assert.match(queuePath(accountId), /zulip_queue_test_account_et_upgrade_/);

  await after.markQueueExpired();
});

test("ZulipQueueManager: legacy metadata without eventTypes counts as message-only", async () => {
  const accountId = "test-account-et-legacy-" + Date.now();
  writeFileSync(
    queuePath(accountId),
    JSON.stringify({ queueId: "q_legacy", lastEventId: 42, registeredAt: Date.now() }),
  );
  let registered = 0;
  const registerFn = async () => {
    registered++;
    return { queueId: "q_new" + registered, lastEventId: 1 };
  };

  // Still only `message` wanted → the legacy queue remains valid (no churn on upgrade).
  const same = new ZulipQueueManager({
    accountId,
    runtime: mockRuntime,
    registerFn,
    desiredEventTypes: ["message"],
  });
  assert.equal((await same.ensureQueue()).queueId, "q_legacy");
  assert.equal(registered, 0);

  // Reactions wanted → the legacy queue cannot serve it, so re-register.
  const more = new ZulipQueueManager({
    accountId,
    runtime: mockRuntime,
    registerFn,
    desiredEventTypes: ["message", "reaction"],
  });
  assert.equal((await more.ensureQueue()).queueId, "q_new1");
  assert.equal(registered, 1);

  await more.markQueueExpired();
});
