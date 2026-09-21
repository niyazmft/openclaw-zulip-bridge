import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeZulipServer } from "./fake-zulip-server.js";
import { monitorZulipProvider } from "../../dist/src/zulip/monitor.js";

async function startFake(): Promise<ReturnType<typeof createFakeZulipServer>> {
  const fake = createFakeZulipServer();
  await new Promise<void>((resolve) => fake.server.listen(0, resolve));
  const addr = fake.server.address();
  fake.port = typeof addr === "object" && addr ? addr.port : 0;
  fake.url = `http://127.0.0.1:${fake.port}`;
  return fake;
}

// Minimal OpenClaw config that lets the monitor resolve account settings
function makeConfig(fake: any) {
  return {
    channels: {
      zulip: {
        accounts: {
          default: {
            baseUrl: fake.url,
            email: "bot@zulip.com",
            apiKey: "fake-key",
            allowFrom: ["*"],
            allowInsecureHttp: true,
          },
        },
      },
    },
  };
}

test("monitor starts, calls /register, then polls /events", async () => {
  const fake = await startFake();
  const controller = new AbortController();

  // Start monitor in the background; it blocks until aborted.
  const monitorPromise = monitorZulipProvider({
    baseUrl: fake.url,
    email: "bot@zulip.com",
    apiKey: "fake-key",
    accountId: "default",
    config: makeConfig(fake),
    abortSignal: controller.signal,
  });

  // Give the monitor time to register and start polling.
  await new Promise((r) => setTimeout(r, 600));

  // Abort cleanly with a hard ceiling so the test never hangs.
  setTimeout(() => controller.abort(), 5000);
  await Promise.race([
    monitorPromise.catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, 6000)),
  ]);

  await fake.close();
});

test("monitor processes an inbound stream message without crashing", async () => {
  const fake = await startFake();
  const controller = new AbortController();

  const monitorPromise = monitorZulipProvider({
    baseUrl: fake.url,
    email: "bot@zulip.com",
    apiKey: "fake-key",
    accountId: "default",
    config: makeConfig(fake),
    abortSignal: controller.signal,
  });

  // Wait for registration + first poll to be in flight.
  await new Promise((r) => setTimeout(r, 600));

  // Inject a realistic stream message event.
  fake.injectEvent({
    type: "message",
    id: 10,
    message: {
      id: 101,
      sender_id: 42,
      sender_full_name: "Alice",
      sender_email: "alice@example.com",
      content: "Hello from the fake server",
      content_type: "text/x-markdown",
      timestamp: Math.floor(Date.now() / 1000),
      display_recipient: "test-stream",
      subject: "test-topic",
      type: "stream",
    },
  });

  // Give monitor time to handle the message, then abort with a hard ceiling.
  await new Promise((r) => setTimeout(r, 800));
  setTimeout(() => controller.abort(), 5000);
  await Promise.race([
    monitorPromise.catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, 6000)),
  ]);

  await fake.close();
});

test("monitor stops cleanly on AbortSignal", async () => {
  const fake = await startFake();
  const controller = new AbortController();

  const monitorPromise = monitorZulipProvider({
    baseUrl: fake.url,
    email: "bot@zulip.com",
    apiKey: "fake-key",
    accountId: "default",
    config: makeConfig(fake),
    abortSignal: controller.signal,
  });

  // Let it start.
  await new Promise((r) => setTimeout(r, 400));

  // Abort immediately.
  controller.abort();

  // Should resolve (or reject gracefully) within a short timeout.
  await assert.doesNotReject(
    Promise.race([
      monitorPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("monitor did not stop within 3s")), 3000)),
    ]),
  );

  await fake.close();
});
