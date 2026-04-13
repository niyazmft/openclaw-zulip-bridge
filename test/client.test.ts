import test from "node:test";
import assert from "node:assert/strict";
import { createZulipClient, getZulipEventsWithRetry } from "../src/zulip/client.ts";

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
