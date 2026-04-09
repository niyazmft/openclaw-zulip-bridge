import test from "node:test";
import assert from "node:assert/strict";
import { ZulipQueueManager } from "../src/zulip/queue-manager.ts";

const mockRuntime = {
  log: () => {},
  error: () => {},
  exit: (code: number) => {
    throw new Error(`exit ${code}`);
  },
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
