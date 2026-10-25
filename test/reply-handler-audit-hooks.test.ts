import test from "node:test";
import assert from "node:assert/strict";

import { dispatchZulipReply } from "../src/zulip/reply-handler.js";

// Regression guard for #326 (cause 3).
//
// `onDeliverEmpty` used to be called inside the `if (trace) { … }` block, so it only
// fired when `activityTrace` was enabled — and that is off by default. On a default
// config a run that delivered nothing therefore left no record at all: no
// `deliver_payload` (nothing was delivered), no `deliver_empty` (unreachable). Since
// plugin child-logger output does not reach the host log on every host, the audit log
// is the only durable surface, and it could not tell a working channel from a silently
// broken one. These tests pin the hook to being independent of activity tracing.

/**
 * Minimal host surface for `dispatchZulipReply`, mirroring
 * `reply-handler-trace.test.ts`. `deliverText` undefined means the host never calls
 * the deliver callback; a string (including "") makes it deliver once.
 */
function makeCore(options?: { dispatchError?: unknown; deliverText?: string }) {
  const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  return {
    logging: { getChildLogger: () => noopLogger, shouldLogVerbose: () => false },
    log: () => {},
    error: () => {},
    paths: { dataDir: undefined },
    system: { enqueueSystemEvent: () => {} },
    channel: {
      reply: {
        createReplyDispatcherWithTyping: (args: any) => ({
          dispatcher: args,
          replyOptions: {},
          markDispatchIdle: () => {},
        }),
        dispatchReplyFromConfig: async ({ dispatcher }: any) => {
          if (options?.dispatchError) throw options.dispatchError;
          if (options?.deliverText !== undefined) {
            await dispatcher.deliver({ text: options.deliverText });
          }
        },
      },
      text: {
        convertMarkdownTables: (text: string) => text,
        resolveChunkMode: () => "length",
        chunkMarkdownTextWithMode: (text: string) => [text],
        resolveMarkdownTableMode: () => "off",
      },
      activity: { record: () => {} },
      media: {},
    },
  } as any;
}

function makeParams(overrides: Record<string, unknown> = {}) {
  return {
    core: makeCore(),
    cfg: {},
    account: { accountId: "default", config: {} },
    route: { sessionKey: "zulip:default:stream:1:general" },
    client: {},
    ctxPayload: { Body: "please fix it", SessionKey: "zulip:default:stream:1:general" },
    isDM: false,
    senderId: "user@example.com",
    senderNumericId: 5,
    streamId: "1",
    topic: "general",
    messageId: "100",
    botUsername: "bot",
    onModelSelected: () => {},
    prefixOptions: {},
    tableMode: "off",
    textLimit: 4000,
    to: "stream:main:general",
    logVerboseMessage: () => {},
    ...overrides,
  } as any;
}

test("deliver_empty fires with activity tracing OFF (no traceManager)", async () => {
  const calls: Array<{ elapsedMs: number; isCommandTurn: boolean }> = [];
  await dispatchZulipReply(
    makeParams({ onDeliverEmpty: (info: any) => calls.push(info) }),
  );

  assert.equal(calls.length, 1, "a run that delivered nothing must be audited exactly once");
  assert.equal(typeof calls[0].elapsedMs, "number");
  assert.ok(calls[0].elapsedMs >= 0);
  assert.equal(calls[0].isCommandTurn, false);
});

test("deliver_empty carries the command-turn flag through", async () => {
  const calls: Array<{ isCommandTurn: boolean }> = [];
  await dispatchZulipReply(
    makeParams({
      isCommandTurn: true,
      onDeliverEmpty: (info: any) => calls.push(info),
    }),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].isCommandTurn, true);
});

test("deliver_empty does not fire when a payload was delivered", async () => {
  const calls: unknown[] = [];
  await dispatchZulipReply(
    makeParams({
      core: makeCore({ deliverText: "here is the answer" }),
      onDeliverEmpty: (info: any) => calls.push(info),
    }),
  );

  assert.deepEqual(calls, [], "a delivered run must not look empty");
});

test("deliver_empty does not fire when the dispatch threw", async () => {
  const calls: unknown[] = [];
  const result = await dispatchZulipReply(
    makeParams({
      core: makeCore({ dispatchError: new Error("model exploded") }),
      onDeliverEmpty: (info: any) => calls.push(info),
    }),
  );

  assert.ok(result instanceof Error, "the dispatch error is still propagated");
  assert.deepEqual(calls, [], "a failed run is reported as a failure, not as empty");
});

test("deliver_empty does not fire when the run was aborted", async () => {
  const calls: unknown[] = [];
  const controller = new AbortController();
  controller.abort();

  await dispatchZulipReply(
    makeParams({
      abortSignal: controller.signal,
      onDeliverEmpty: (info: any) => calls.push(info),
    }),
  );

  assert.deepEqual(calls, [], "a cancelled run must not be reported as an empty one");
});

test("deliver_empty still fires when a trace is active (no double reporting)", async () => {
  // The hook moved out of the trace block; make sure it did not also stay inside it.
  const calls: unknown[] = [];
  const posts: string[] = [];
  const traceManager = {
    start: ({ target, title }: any) => {
      posts.push(title);
      return {
        id: "trace-1",
        sessionKey: "zulip:default:stream:1:general",
        finish: () => {},
        settle: async () => {},
        step: () => {},
        failStep: () => {},
      };
    },
    findBySessionKey: () => undefined,
    findByRunId: () => undefined,
    stop: () => {},
  };

  await dispatchZulipReply(
    makeParams({
      traceManager: traceManager as any,
      traceTitle: "no reply run",
      onDeliverEmpty: (info: any) => calls.push(info),
    }),
  );

  assert.equal(calls.length, 1, "exactly one deliver_empty, trace on or off");
});

// ── Cause 4: the auto-send fallback rescue ──────────────────────────────────

function makeFallbackParams(overrides: Record<string, unknown> = {}) {
  const sent: Array<{ to: string; text: string }> = [];
  const fallbackCalls: Array<{ textLen: number; chunks: number; isCommandTurn: boolean }> = [];
  const emptyCalls: unknown[] = [];
  return {
    sent,
    fallbackCalls,
    emptyCalls,
    params: makeParams({
      account: { accountId: "default", config: {}, autoSendOnMissingTool: true },
      route: {
        sessionKey: "zulip:default:stream:1:general",
        agentId: "enkidu",
        mainSessionKey: "zulip:default:stream:1:general",
      },
      sendText: async (to: string, text: string) => {
        sent.push({ to, text });
        return { messageId: `m-${sent.length}`, channelId: "1" };
      },
      fallbackReader: async () => ["rescued answer"],
      onDeliverFallback: (info: any) => fallbackCalls.push(info),
      onDeliverEmpty: (info: any) => emptyCalls.push(info),
      ...overrides,
    }),
  };
}

test("deliver_fallback fires when the auto-send rescue sends a reply", async () => {
  const { params, sent, fallbackCalls, emptyCalls } = makeFallbackParams();

  await dispatchZulipReply(params);

  assert.equal(sent.length, 1, "the rescue actually sent the text");
  assert.equal(sent[0].text, "rescued answer");
  assert.equal(fallbackCalls.length, 1, "the rescue must be audited");
  assert.equal(fallbackCalls[0].textLen, "rescued answer".length);
  assert.equal(fallbackCalls[0].chunks, 1);
  assert.equal(fallbackCalls[0].isCommandTurn, false);
  assert.deepEqual(
    emptyCalls,
    [],
    "a rescued run delivered something, so it must not also report empty",
  );
});

test("deliver_fallback carries the command-turn flag", async () => {
  const { params, fallbackCalls } = makeFallbackParams({ isCommandTurn: true });

  await dispatchZulipReply(params);

  assert.equal(fallbackCalls.length, 1);
  assert.equal(fallbackCalls[0].isCommandTurn, true);
});

test("deliver_fallback does not fire when the host delivered normally", async () => {
  const { params, fallbackCalls } = makeFallbackParams({
    core: makeCore({ deliverText: "delivered by the host" }),
  });

  await dispatchZulipReply(params);

  assert.deepEqual(fallbackCalls, [], "no rescue happened, so nothing to report");
});
