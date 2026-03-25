import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ZulipQueueManager } from "../src/zulip/queue-manager.js";
import type { ZulipClient } from "../src/zulip/client.js";

const mockRuntime = {
  log: () => {},
  error: () => {},
  exit: (code: number) => { throw new Error(`exit ${code}`); },
} as any;

test("ZulipQueueManager: registers a new queue", async () => {
  const accountId = "test-account-" + Date.now();
  let registerCalled = 0;
  const mockClient = {
    request: async (path: string) => {
      if (path === "/register") {
        registerCalled++;
        return { result: "success", queue_id: "q1", last_event_id: 100 };
      }
      return { result: "success" };
    }
  } as unknown as ZulipClient;

  const manager = new ZulipQueueManager({
    accountId,
    client: mockClient,
    runtime: mockRuntime,
    streams: ["*"]
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
  const mockClient = {
    request: async (path: string) => {
      if (path === "/register") {
        registerCalled++;
        return { result: "success", queue_id: "q" + registerCalled, last_event_id: 100 };
      }
      return { result: "success" };
    }
  } as unknown as ZulipClient;

  const manager = new ZulipQueueManager({
    accountId,
    client: mockClient,
    runtime: mockRuntime,
    streams: ["*"]
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
  const mockClient = {
    request: async (path: string) => {
      if (path === "/register") {
        registerCalled++;
        await new Promise(resolve => setTimeout(resolve, 50));
        return { result: "success", queue_id: "q_lock", last_event_id: 100 };
      }
      return { result: "success" };
    }
  } as unknown as ZulipClient;

  const manager = new ZulipQueueManager({
    accountId,
    client: mockClient,
    runtime: mockRuntime,
    streams: ["*"]
  });

  const [q1, q2, q3] = await Promise.all([
    manager.ensureQueue(),
    manager.ensureQueue(),
    manager.ensureQueue()
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
  const mockClient = {
    request: async (path: string) => {
      if (path === "/register") {
        registerCalled++;
        return { result: "success", queue_id: "q_pers", last_event_id: 100 };
      }
      return { result: "success" };
    }
  } as unknown as ZulipClient;

  const manager1 = new ZulipQueueManager({
    accountId,
    client: mockClient,
    runtime: mockRuntime,
    streams: ["*"]
  });

  await manager1.ensureQueue();
  assert.equal(registerCalled, 1);

  const manager2 = new ZulipQueueManager({
    accountId,
    client: mockClient,
    runtime: mockRuntime,
    streams: ["*"]
  });

  const q2 = await manager2.ensureQueue();
  assert.equal(q2.queueId, "q_pers");
  assert.equal(registerCalled, 1); // Should have loaded from file

  // Update event id
  await manager2.updateLastEventId(105);

  const manager3 = new ZulipQueueManager({
    accountId,
    client: mockClient,
    runtime: mockRuntime,
    streams: ["*"]
  });
  const q3 = await manager3.ensureQueue();
  assert.equal(q3.lastEventId, 105);

  // Cleanup
  await manager3.markQueueExpired();
});
