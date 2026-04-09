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
      dataDir: "/tmp/zulip-test-data-" + Date.now(),
    },
  } as any;
  return { runtime, logs, errors };
}

// Helper to create a mock fetch
function createMockFetch(responses: any[]) {
  let callCount = 0;
  return async (url: string, init: any) => {
    const response = responses[callCount] || responses[responses.length - 1];
    callCount++;
    if (response instanceof Error) {
      throw response;
    }
    if (response.onCalled) {
      response.onCalled(url, init);
    }
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      statusText: response.statusText ?? "OK",
      headers: new Headers(response.headers ?? {}),
      json: async () => response.json,
    } as any;
  };
}

test("monitor lifecycle: boilerplate check", () => {
  assert.ok(monitorZulipProvider);
  assert.ok(pollOnce);
});

test("pollOnce: transient network failures are retried", async () => {
  const { runtime } = createMockRuntime();
  const fetchImpl = createMockFetch([
    new Error("ECONNRESET"),
    new Error("ECONNRESET"),
    { ok: true, json: { result: "success", events: [] } },
  ]);
  const client = createZulipClient({
    baseUrl: "https://zulip.example.com",
    email: "bot@example.com",
    apiKey: "fake",
    fetchImpl,
  });

  const queueManager = new ZulipQueueManager({
    accountId: "default",
    runtime,
    registerFn: async () => ({ queueId: "q1", lastEventId: 1 }),
  });

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

test("pollOnce: bad event queue causes re-registration", async () => {
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

test("monitorZulipProvider: cleanup on abort", async () => {
  const { runtime, logs } = createMockRuntime();
  setZulipRuntime(runtime);

  let deleteQueueCalled = false;
  const fetchImpl = createMockFetch([
    { ok: true, json: { result: "success", user_id: 123, email: "bot@example.com", full_name: "Bot" } }, // fetchZulipMe
    { ok: true, json: { result: "success", queue_id: "q1", last_event_id: 1 } }, // registerZulipQueue
    { ok: true, json: { result: "success", events: [] } }, // getZulipEvents
    {
      ok: true,
      json: { result: "success" },
      onCalled: (url: string, init: any) => {
        if (init.method === "DELETE" && url.includes("queue_id=q1")) {
          deleteQueueCalled = true;
        }
      }
    }, // deleteZulipQueue
  ]);

  const controller = new AbortController();

  setTimeout(() => controller.abort(), 10);

  await monitorZulipProvider({
    accountId: "default",
    runtime,
    abortSignal: controller.signal,
    fetchImpl,
  } as any);

  assert.equal(deleteQueueCalled, true);
  assert.ok(logs.some(l => l.includes("zulip monitor cleaning up queue")));
  assert.ok(logs.some(l => l.includes("zulip monitor stopped")));
});

test("monitorZulipProvider: bot ignores own messages", async () => {
  const { runtime } = createMockRuntime();
  setZulipRuntime(runtime);

  let dispatchCalled = false;
  runtime.channel.reply.dispatchReplyFromConfig = async () => {
    dispatchCalled = true;
  };

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
      }
    },
  ]);

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);

  await monitorZulipProvider({
    accountId: "default",
    runtime,
    abortSignal: controller.signal,
    fetchImpl,
  } as any);

  assert.equal(dispatchCalled, false);
});

test("monitorZulipProvider: DM happy-path dispatch", async () => {
  const { runtime } = createMockRuntime();
  setZulipRuntime(runtime);

  let dispatchedCtx: any = null;
  runtime.channel.reply.dispatchReplyFromConfig = async (params: any) => {
    dispatchedCtx = params.ctx;
  };

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
      }
    },
    { ok: true, json: { result: "success" } }, // reaction start
    { ok: true, json: { result: "success" } }, // reaction success
  ]);

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);

  await monitorZulipProvider({
    accountId: "default",
    runtime,
    abortSignal: controller.signal,
    fetchImpl,
  } as any);

  assert.ok(dispatchedCtx);
  assert.equal(dispatchedCtx.SenderId, "user@example.com");
  assert.equal(dispatchedCtx.RawBody, "hello bot");
});

test("monitorZulipProvider: reaction failures do not break processing", async () => {
  const { runtime } = createMockRuntime();
  setZulipRuntime(runtime);

  let dispatchCalled = false;
  runtime.channel.reply.dispatchReplyFromConfig = async () => {
    dispatchCalled = true;
  };

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
      }
    },
    { status: 500, ok: false, json: { result: "error", msg: "Fail reaction" } }, // reaction start fails
    { ok: true, json: { result: "success" } }, // reaction success (still called)
  ]);

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);

  await monitorZulipProvider({
    accountId: "default",
    runtime,
    abortSignal: controller.signal,
    fetchImpl,
  } as any);

  assert.equal(dispatchCalled, true);
});

test("monitorZulipProvider: fatal mid-loop errors preserved cleanup", async () => {
  const { runtime, logs, errors } = createMockRuntime();
  setZulipRuntime(runtime);

  const fetchImpl = createMockFetch([
    { ok: true, json: { result: "success", user_id: 123, email: "bot@example.com", full_name: "Bot" } }, // fetchZulipMe
    { ok: true, json: { result: "success", queue_id: "q1", last_event_id: 1 } }, // registerZulipQueue
    new Error("Fatal error in loop"),
  ]);

  try {
    await monitorZulipProvider({
      accountId: "default",
      runtime,
      fetchImpl,
    } as any);
    assert.fail("Should have thrown");
  } catch (err: any) {
    assert.equal(err.message, "Fatal error in loop");
  }

  assert.ok(errors.some(e => e.includes("zulip monitor fatal error")));
  assert.ok(logs.some(l => l.includes("zulip monitor stopped")));
});
