import test from "node:test";
import assert from "node:assert/strict";
import { monitorZulipProvider } from "../src/zulip/monitor.ts";
import { pollOnce } from "../src/zulip/polling.ts";
import { createZulipClient } from "../src/zulip/client.ts";
import { ZulipQueueManager } from "../src/zulip/queue-manager.ts";
import { setZulipRuntime } from "../src/runtime.ts";

// Helper to create a mock PluginRuntime
function createMockRuntime() {
  const logs: string[] = [];
  const errors: string[] = [];
  const runtime = {
    log: (msg: string) => logs.push(msg),
    error: (msg: string) => errors.push(msg),
    config: {
      loadConfig: () => ({
        channels: {
          zulip: {
            accounts: {
              default: {
                apiKey: "fake-key",
                email: "bot@example.com",
                url: "https://zulip.example.com",
                dmPolicy: "open",
              },
            },
          },
        },
      }),
    },
    logging: {
      getChildLogger: () => ({
        debug: (msg: string) => logs.push(msg),
        info: (msg: string) => logs.push(msg),
        warn: (msg: string) => logs.push(msg),
        error: (msg: string) => errors.push(msg),
      }),
      shouldLogVerbose: () => true,
    },
    channel: {
      mentions: {
        buildMentionRegexes: () => [],
        matchesMentionPatterns: () => false,
      },
      pairing: {
        readAllowFromStore: async () => [],
        upsertPairingRequest: async () => ({ code: "123", created: true }),
        buildPairingReply: () => "pairing code 123",
      },
      commands: {
        shouldHandleTextCommands: () => false,
      },
      text: {
        hasControlCommand: () => false,
        resolveTextChunkLimit: () => 4000,
        resolveMarkdownTableMode: () => "standard",
        chunkMarkdownTextWithMode: (t: string) => [t],
        resolveChunkMode: () => "paragraph",
        convertMarkdownTables: (t: string) => t,
      },
      groups: {
        resolveRequireMention: () => false,
      },
      activity: {
        record: () => {},
      },
      routing: {
        resolveAgentRoute: () => ({
          accountId: "default",
          agentId: "agent1",
          peer: { kind: "dm", id: "user1" },
          mainSessionKey: "session1",
        }),
      },
      reply: {
        formatInboundEnvelope: (env: any) => env.body,
        finalizeInboundContext: (ctx: any) => ctx,
        createReplyDispatcherWithTyping: () => ({
          dispatcher: {},
          replyOptions: {},
          markDispatchIdle: () => {},
        }),
        dispatchReplyFromConfig: async () => {},
        resolveHumanDelayConfig: () => ({}),
      },
      session: {
        resolveStorePath: () => "store.json",
        updateLastRoute: async () => {},
      },
    },
    system: {
      enqueueSystemEvent: () => {},
    },
    paths: {
      dataDir: "/tmp/zulip-test-data-" + Date.now() + "-" + Math.random().toString(36).slice(2),
    },
  } as any;
  return { runtime, logs, errors };
}

// Helper to create a mock fetch
function createMockFetch(responses: any[], controller?: AbortController) {
  let callCount = 0;
  return async (url: string, init: any) => {
    const response = responses[callCount];
    callCount++;

    if (!response && controller) {
      controller.abort();
    }

    const actualResponse = response || { ok: true, json: { result: "success", events: [] } };

    if (actualResponse instanceof Error) {
      throw actualResponse;
    }
    if (actualResponse.onCalled) {
      actualResponse.onCalled(url, init);
    }
    return {
      ok: actualResponse.ok ?? true,
      status: actualResponse.status ?? 200,
      statusText: actualResponse.statusText ?? "OK",
      headers: new Headers({
        "content-type": "application/json",
        ...actualResponse.headers
      }),
      json: async () => actualResponse.json,
    } as any;
  };
}

// Mock QueueManager to avoid file I/O issues in CI
class MockQueueManager {
  async ensureQueue() { return { queueId: "q1", lastEventId: 1 }; }
  async markQueueExpired() {}
  async updateLastEventId() {}
  getQueue() { return { queueId: "q1", lastEventId: 1 }; }
}

test("monitor lifecycle: sequential tests", async (t) => {

  await t.test("boilerplate check", () => {
    assert.ok(monitorZulipProvider);
    assert.ok(pollOnce);
  });

  await t.test("pollOnce: transient network failures are retried", async () => {
    const { runtime } = createMockRuntime();
    const fetchImpl = createMockFetch([
      new Error("ECONNRESET"),
      { ok: true, json: { result: "success", events: [] } },
    ]);
    const client = createZulipClient({
      baseUrl: "https://zulip.example.com",
      email: "bot@example.com",
      apiKey: "fake",
      fetchImpl,
    });

    const queueManager = new MockQueueManager() as any;

    const result = await pollOnce({
      client,
      queueManager,
      core: runtime,
      accountId: "default",
      opts: {},
      pollBackoffMs: 0,
      resetPollBackoff: () => {},
      processMessage: async () => {},
    });

    assert.equal(result.shouldContinue, true);
    assert.equal(result.pollBackoffMs, 0);
  });

  await t.test("pollOnce: bad event queue causes re-registration", async () => {
    const { runtime } = createMockRuntime();

    const fetchImpl = createMockFetch([
      {
        status: 200,
        ok: true,
        json: { result: "error", code: "BAD_EVENT_QUEUE_ID", msg: "Bad event queue id" }
      }
    ]);
    const client = createZulipClient({
      baseUrl: "https://zulip.example.com",
      email: "bot@example.com",
      apiKey: "fake",
      fetchImpl,
    });

    let expired = false;
    const queueManager = {
      ensureQueue: async () => ({ queueId: "q1", lastEventId: 1 }),
      markQueueExpired: async () => { expired = true; },
      updateLastEventId: async () => {},
    } as any;

    const result = await pollOnce({
      client,
      queueManager,
      core: runtime,
      accountId: "default",
      opts: {},
      pollBackoffMs: 0,
      resetPollBackoff: () => {},
      processMessage: async () => {},
    });

    assert.equal(result.shouldContinue, true);
    assert.equal(expired, true);
    assert.equal(result.pollBackoffMs, 0);
  });

  await t.test("monitorZulipProvider: cleanup on abort", async () => {
    const { runtime, logs } = createMockRuntime();
    setZulipRuntime(runtime);

    const controller = new AbortController();
    const fetchImpl = createMockFetch([
      { ok: true, json: { result: "success", user_id: 123, email: "bot@example.com", full_name: "Bot" } }, // fetchZulipMe
      { ok: true, json: { result: "success", queue_id: "q1", last_event_id: 1 } }, // registerZulipQueue
      { ok: true, json: { result: "success", events: [] } }, // getZulipEvents
    ], controller);

    let deleteQueueCalled = false;
    const originalFetch = fetchImpl;
    const wrappedFetch = async (url: string, init: any) => {
      if (init.method === "DELETE" && url.includes("queue_id=q1")) {
        deleteQueueCalled = true;
        return { ok: true, json: async () => ({ result: "success" }) } as any;
      }
      return originalFetch(url, init);
    };

    setTimeout(() => controller.abort(), 100);

    await monitorZulipProvider({
      accountId: "default",
      runtime,
      abortSignal: controller.signal,
      fetchImpl: wrappedFetch,
    } as any);

    assert.equal(deleteQueueCalled, true);
    assert.ok(logs.some(l => l.includes("zulip monitor stops") || l.includes("zulip monitor loop exited")));
  });

  await t.test("monitorZulipProvider: bot ignores own messages", async () => {
    const { runtime } = createMockRuntime();
    setZulipRuntime(runtime);

    let dispatchCalled = false;
    runtime.channel.reply.dispatchReplyFromConfig = async () => {
      dispatchCalled = true;
    };

    const controller = new AbortController();

    const fetchImpl = createMockFetch([
      { ok: true, json: { result: "success", user_id: 123, email: "bot@example.com", full_name: "Bot" } }, // fetchZulipMe
      { ok: true, json: { result: "success", queue_id: "q1", last_event_id: 1 } }, // registerZulipQueue
      {
        ok: true,
        json: {
          result: "success",
          events: [
            {
              id: 10,
              type: "message",
              message: {
                id: "100",
                sender_id: "123", // bot's own ID
                sender_email: "bot@example.com",
                content: "hello",
                type: "private"
              }
            }
          ]
        },
        onCalled: () => {
          setTimeout(() => controller.abort(), 10);
        }
      },
    ], controller);

    await monitorZulipProvider({
      accountId: "default",
      runtime,
      abortSignal: controller.signal,
      fetchImpl,
    } as any);

    assert.equal(dispatchCalled, false);
  });

  await t.test("monitorZulipProvider: DM happy-path dispatch", async () => {
    const { runtime } = createMockRuntime();
    setZulipRuntime(runtime);

    let dispatchedCtx: any = null;
    runtime.channel.reply.dispatchReplyFromConfig = async (params: any) => {
      dispatchedCtx = params.ctx;
    };

    const controller = new AbortController();

    const fetchImpl = createMockFetch([
      { ok: true, json: { result: "success", user_id: 123, email: "bot@example.com", full_name: "Bot" } }, // fetchZulipMe
      { ok: true, json: { result: "success", queue_id: "q1", last_event_id: 1 } }, // registerZulipQueue
      {
        ok: true,
        json: {
          result: "success",
          events: [
            {
              id: 10,
              type: "message",
              message: {
                id: "100",
                sender_id: "456",
                sender_email: "user@example.com",
                sender_full_name: "User One",
                content: "hello bot",
                type: "private"
              }
            }
          ]
        },
        onCalled: () => {
           setTimeout(() => controller.abort(), 100);
        }
      },
      { ok: true, json: { result: "success" } }, // reaction start
      { ok: true, json: { result: "success" } }, // send message
      { ok: true, json: { result: "success" } }, // reaction success
    ], controller);

    await monitorZulipProvider({
      accountId: "default",
      runtime,
      abortSignal: controller.signal,
      fetchImpl,
    } as any);

    assert.ok(dispatchedCtx, "Expected dispatchedCtx to be set");
    assert.equal(dispatchedCtx.SenderId, "user@example.com");
  });

  await t.test("monitorZulipProvider: reaction failures do not break processing", async () => {
    const { runtime } = createMockRuntime();
    setZulipRuntime(runtime);

    let dispatchCalled = false;
    runtime.channel.reply.dispatchReplyFromConfig = async () => {
      dispatchCalled = true;
    };

    const controller = new AbortController();

    const fetchImpl = createMockFetch([
      { ok: true, json: { result: "success", user_id: 123, email: "bot@example.com", full_name: "Bot" } }, // fetchZulipMe
      { ok: true, json: { result: "success", queue_id: "q1", last_event_id: 1 } }, // registerZulipQueue
      {
        ok: true,
        json: {
          result: "success",
          events: [
            {
              id: 10,
              type: "message",
              message: {
                id: "100",
                sender_id: "456",
                sender_email: "user@example.com",
                sender_full_name: "User One",
                content: "hello bot",
                type: "private"
              }
            }
          ]
        },
        onCalled: () => {
           setTimeout(() => controller.abort(), 100);
        }
      },
      { status: 500, ok: false, json: { result: "error", msg: "Fail reaction" } }, // reaction start fails
      { ok: true, json: { result: "success" } }, // reaction success (still called)
    ], controller);

    await monitorZulipProvider({
      accountId: "default",
      runtime,
      abortSignal: controller.signal,
      fetchImpl,
    } as any);

    assert.equal(dispatchCalled, true);
  });

  await t.test("monitorZulipProvider: fatal mid-loop errors preserved cleanup", async () => {
    const { runtime, logs } = createMockRuntime();
    setZulipRuntime(runtime);

    const controller = new AbortController();

    const fetchImpl = createMockFetch([
      { ok: true, json: { result: "success", user_id: 123, email: "bot@example.com", full_name: "Bot" } }, // fetchZulipMe
      { ok: true, json: { result: "success", queue_id: "q1", last_event_id: 1 } }, // registerZulipQueue
      // Exhaust retries in zulipRequestWithRetry by returning errors that match retry statuses or network errors
      { status: 502, ok: false, json: { result: "error", msg: "Fatal 1" } },
      { status: 502, ok: false, json: { result: "error", msg: "Fatal 2" } },
      { status: 502, ok: false, json: { result: "error", msg: "Fatal 3" } },
      { status: 502, ok: false, json: { result: "error", msg: "Fatal 4" } },
    ], controller);

    try {
      await monitorZulipProvider({
        accountId: "default",
        runtime,
        fetchImpl,
        abortSignal: controller.signal,
      } as any);
    } catch (err: any) {
      // Expected to throw after retries exhausted
    }

    assert.ok(logs.some(l => l.includes("zulip monitor stopped")));
  });

});
