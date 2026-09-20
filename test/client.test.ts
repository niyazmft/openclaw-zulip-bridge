import test from "node:test";
import assert from "node:assert/strict";
import {
  clampLongpollTimeoutSecs,
  createZulipClient,
  getZulipEventsWithRetry,
  registerZulipQueue,
  resolveEventsTimeoutMs,
} from "../src/zulip/client.ts";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

test("getZulipEventsWithRetry retries once on 429 and then succeeds", async () => {
  let attempts = 0;
  const client = createZulipClient({
    baseUrl: "https://zulip.example.com",
    email: "bot@example.com",
    apiKey: "secret",
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return jsonResponse(
          { result: "error", msg: "rate limited" },
          { status: 429, headers: { "content-type": "application/json", "retry-after": "0" } },
        );
      }
      return jsonResponse({ result: "success", events: [{ id: 42, type: "message" }] });
    },
  });

  const payload = await getZulipEventsWithRetry(client, {
    queueId: "queue-1",
    lastEventId: 41,
    timeoutMs: 100,
    retryBaseDelayMs: 1,
  });

  assert.equal(attempts, 2);
  assert.equal(payload.result, "success");
  assert.deepEqual(payload.events?.map((event) => event.id), [42]);
});

// ── Long-poll timeout handling (issue #287) ─────────────────────────────────
// Without an explicit `timeout` the server may answer immediately with a
// heartbeat event, turning the poll loop into a tight re-poll loop: 33k-67k
// requests and tens of MB of logs per day for an idle channel.

test("getZulipEventsWithRetry never sends an unknown `timeout` param", async () => {
  let seenUrl = "";
  const client = createZulipClient({
    baseUrl: "https://zulip.example.com",
    email: "bot@example.com",
    apiKey: "secret",
    fetchImpl: async (url) => {
      seenUrl = String(url);
      return jsonResponse({ result: "success", events: [] });
    },
  });

  await getZulipEventsWithRetry(client, {
    queueId: "queue-1",
    lastEventId: 5,
    timeoutMs: 1000,
    timeoutSecs: 90,
  });

  const url = new URL(seenUrl);
  // Regression guard: `timeout` is not a documented /events parameter; sending
  // it is silently ignored by the server and gave a false sense of protection.
  assert.equal(url.searchParams.get("timeout"), null);
  assert.deepEqual(
    [...url.searchParams.keys()].sort(),
    ["dont_block", "last_event_id", "queue_id"],
  );
  assert.equal(url.searchParams.get("dont_block"), "false");
  assert.equal(url.searchParams.get("last_event_id"), "5");
});

test("resolveEventsTimeoutMs prefers the server window and adds a grace period", () => {
  assert.equal(resolveEventsTimeoutMs({ timeoutSecs: 60 }), 60_000 + 15_000);
  assert.equal(resolveEventsTimeoutMs({ timeoutSecs: 90 }), 90_000 + 15_000);
  // Clamped to Zulip's 90s ceiling.
  assert.equal(resolveEventsTimeoutMs({ timeoutSecs: 100000 }), 90_000 + 15_000);
  // Non-positive/unusable values fall back to the 90s default window.
  assert.equal(resolveEventsTimeoutMs({ timeoutSecs: 0 }), 90_000 + 15_000);
  assert.equal(resolveEventsTimeoutMs({ timeoutSecs: -5 }), 90_000 + 15_000);
  // Explicit millisecond budget is used verbatim when no server window is known.
  assert.equal(resolveEventsTimeoutMs({ timeoutMs: 5000 }), 5000);
  assert.equal(resolveEventsTimeoutMs({}), 90000);
});

test("getZulipEventsWithRetry omits timeout when not requested", async () => {
  let seenUrl = "";
  const client = createZulipClient({
    baseUrl: "https://zulip.example.com",
    email: "bot@example.com",
    apiKey: "secret",
    fetchImpl: async (url) => {
      seenUrl = String(url);
      return jsonResponse({ result: "success", events: [] });
    },
  });

  await getZulipEventsWithRetry(client, {
    queueId: "queue-1",
    lastEventId: 5,
    timeoutMs: 100,
  });

  assert.equal(new URL(seenUrl).searchParams.get("timeout"), null);
});

test("registerZulipQueue returns the server's long-poll timeout", async () => {
  let seenBody = "";
  const client = createZulipClient({
    baseUrl: "https://zulip.example.com",
    email: "bot@example.com",
    apiKey: "secret",
    fetchImpl: async (url, init) => {
      assert.match(String(url), /\/register$/);
      seenBody = String(init?.body ?? "");
      return jsonResponse({
        result: "success",
        queue_id: "queue-42",
        last_event_id: 7,
        event_queue_longpoll_timeout_seconds: 60,
      });
    },
  });

  const queue = await registerZulipQueue(client, { eventTypes: ["message"] });

  assert.equal(queue.queueId, "queue-42");
  assert.equal(queue.lastEventId, 7);
  assert.equal(queue.longpollTimeoutSecs, 60);
  assert.match(seenBody, /event_queue_longpoll_timeout_seconds=90/);
  // Zulip only returns `event_queue_longpoll_timeout_seconds` when the request
  // asks for the `realm` event type, so this must be present.
  assert.match(seenBody, /fetch_event_types=%5B%22realm%22%5D/);
});

test("registerZulipQueue falls back to 90s when the server omits the timeout", async () => {
  const client = createZulipClient({
    baseUrl: "https://zulip.example.com",
    email: "bot@example.com",
    apiKey: "secret",
    fetchImpl: async () => jsonResponse({ result: "success", queue_id: "q", last_event_id: 1 }),
  });

  const queue = await registerZulipQueue(client, {});
  assert.equal(queue.longpollTimeoutSecs, 90);
});

test("createZulipClient gates plain HTTP behind allowInsecureHttp", () => {
  const base = { email: "bot@example.com", apiKey: "secret" };
  assert.throws(
    () => createZulipClient({ ...base, baseUrl: "http://zulip.lan" }),
    /baseUrl is required/,
  );
  const client = createZulipClient({
    ...base,
    baseUrl: "http://zulip.lan",
    allowInsecureHttp: true,
  });
  assert.equal(client.baseUrl, "http://zulip.lan");
});

test("clampLongpollTimeoutSecs clamps to Zulip's 1..90s window", () => {
  assert.equal(clampLongpollTimeoutSecs(60), 60);
  assert.equal(clampLongpollTimeoutSecs(100000), 90);
  assert.equal(clampLongpollTimeoutSecs(0), 90);
  assert.equal(clampLongpollTimeoutSecs(-5), 90);
  assert.equal(clampLongpollTimeoutSecs(undefined), 90);
  assert.equal(clampLongpollTimeoutSecs("4.9"), 4);
});
