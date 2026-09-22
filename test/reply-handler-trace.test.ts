import test from "node:test";
import assert from "node:assert/strict";

import { dispatchZulipReply } from "../src/zulip/reply-handler.js";
import {
  ActivityTraceManager,
  type TraceIo,
  type TraceTarget,
} from "../src/zulip/activity-trace.js";

type PostRecord = { target: TraceTarget; content: string };
type EditRecord = { messageId: string; content: string };

function makeTraceIo(options?: { postError?: unknown }): {
  io: TraceIo;
  posts: PostRecord[];
  edits: EditRecord[];
} {
  const posts: PostRecord[] = [];
  const edits: EditRecord[] = [];
  return {
    io: {
      post: async (target, content) => {
        if (options?.postError) throw options.postError;
        posts.push({ target, content });
        return `trace-msg-${posts.length}`;
      },
      edit: async (messageId, content) => {
        edits.push({ messageId, content });
      },
    },
    posts,
    edits,
  };
}

function makeManager(io: TraceIo): ActivityTraceManager {
  return new ActivityTraceManager({ io, config: { traceCoalesceMs: 5, traceMaxRate: 50 } });
}

/**
 * Minimal host surface for `dispatchZulipReply`.
 *
 * `deliver` is never invoked with non-empty text, so `sendMessageZulip` cannot
 * reach the network from a unit test — an empty block still marks the run as
 * delivered, which is what the trace summary keys off.
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

// ── Success ─────────────────────────────────────────────────────────────────

test("run boundary: starts a trace in the reply's topic and finalizes it on success", async () => {
  const { io, posts, edits } = makeTraceIo();
  const manager = makeManager(io);
  const params = makeParams({ traceManager: manager, traceTitle: "fix the failing test" });

  const result = await dispatchZulipReply(params);
  assert.equal(result, undefined);

  assert.equal(posts.length, 1);
  assert.equal(posts[0].target.to, "stream:main:general");
  assert.equal(posts[0].target.topic, "general");
  assert.equal(posts[0].target.accountId, "default");
  assert.match(posts[0].content, /^\*\*Working\*\* — fix the failing test/);

  await manager.settle(manager.list()[0].id);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].messageId, "trace-msg-1");
  assert.match(edits[0].content, /^✅ \*\*Done\*\* — run finished in /);
  assert.equal(manager.list()[0].sessionKey, "zulip:default:stream:1:general");
  manager.stop();
});

test("run boundary: a delivered run is summarized without the no-reply note", async () => {
  const { io, edits } = makeTraceIo();
  const manager = makeManager(io);
  const params = makeParams({
    core: makeCore({ deliverText: "" }),
    traceManager: manager,
    traceTitle: "empty reply",
  });

  await dispatchZulipReply(params);
  await manager.settle(manager.list()[0].id);

  const final = edits[edits.length - 1];
  assert.match(final.content, /^✅ \*\*Done\*\* — run finished in /);
  assert.doesNotMatch(final.content, /no reply sent/);
  manager.stop();
});

test("run boundary: a run that produces no reply still finalizes its trace", async () => {
  const { io, edits } = makeTraceIo();
  const manager = makeManager(io);
  const params = makeParams({ traceManager: manager, traceTitle: "silent run" });

  await dispatchZulipReply(params);
  await manager.settle(manager.list()[0].id);

  const final = edits[edits.length - 1];
  assert.match(final.content, /^✅ \*\*Done\*\* — run finished in /);
  assert.match(final.content, /no reply sent/);
  manager.stop();
});

// ── Error / abort ───────────────────────────────────────────────────────────

test("run boundary: a failed run finalizes its trace with ❌ and does not change dispatch semantics", async () => {
  const { io, edits } = makeTraceIo();
  const manager = makeManager(io);
  const boom = new Error("agent blew up");
  const params = makeParams({
    core: makeCore({ dispatchError: boom }),
    traceManager: manager,
    traceTitle: "failing run",
  });

  const result = await dispatchZulipReply(params);
  assert.equal(result, boom, "dispatch error must still be returned to the caller");

  await manager.settle(manager.list()[0].id);
  const final = edits[edits.length - 1];
  assert.match(final.content, /^❌ \*\*Failed\*\* — run failed after /);
  manager.stop();
});

test("run boundary: an aborted run finalizes its trace as cancelled, never left in progress", async () => {
  const { io, edits } = makeTraceIo();
  const manager = makeManager(io);
  const controller = new AbortController();
  controller.abort();
  const params = makeParams({
    traceManager: manager,
    traceTitle: "aborted run",
    abortSignal: controller.signal,
  });

  await dispatchZulipReply(params);
  await manager.settle(manager.list()[0].id);

  const final = edits[edits.length - 1];
  assert.match(final.content, /^⚪ \*\*Cancelled\*\* — run cancelled$/);
  assert.equal(manager.list()[0].status, "cancelled");
  manager.stop();
});

test("run boundary: an AbortError from dispatch is treated as cancelled", async () => {
  const { io, edits } = makeTraceIo();
  const manager = makeManager(io);
  const abortError = new Error("aborted");
  abortError.name = "AbortError";
  const params = makeParams({
    core: makeCore({ dispatchError: abortError }),
    traceManager: manager,
    traceTitle: "abort error run",
  });

  await dispatchZulipReply(params);
  await manager.settle(manager.list()[0].id);

  assert.match(edits[edits.length - 1].content, /^⚪ \*\*Cancelled\*\*/);
  manager.stop();
});

// ── Best-effort ─────────────────────────────────────────────────────────────

test("trace failures never turn a successful dispatch into a failure", async () => {
  const { io, edits } = makeTraceIo({ postError: new Error("zulip unreachable") });
  const manager = makeManager(io);
  const params = makeParams({ traceManager: manager, traceTitle: "doomed trace" });

  const result = await dispatchZulipReply(params);
  assert.equal(result, undefined, "a dead trace must not fail the run");
  await manager.settle(manager.list()[0].id);
  assert.equal(edits.length, 0);
  manager.stop();
});

test("no trace manager means no trace writes at all", async () => {
  const { io, posts } = makeTraceIo();
  const manager = makeManager(io);
  // Manager exists but is not wired into the dispatch: nothing should be written.
  const params = makeParams({ traceTitle: "unwired" });
  const result = await dispatchZulipReply(params);
  assert.equal(result, undefined);
  assert.equal(posts.length, 0);
  assert.equal(manager.list().length, 0);
  manager.stop();
});

test("concurrent dispatches in one topic get separate trace messages", async () => {
  const { io, posts, edits } = makeTraceIo();
  const manager = makeManager(io);

  await Promise.all([
    dispatchZulipReply(makeParams({ traceManager: manager, traceTitle: "run A" })),
    dispatchZulipReply(makeParams({ traceManager: manager, traceTitle: "run B" })),
  ]);
  await Promise.all(manager.list().map((state) => manager.settle(state.id)));

  assert.equal(posts.length, 2);
  const messageIds = new Set(edits.map((edit) => edit.messageId));
  assert.equal(messageIds.size, 2, "each run must edit its own trace message");
  assert.equal(manager.list().length, 2);
  manager.stop();
});
