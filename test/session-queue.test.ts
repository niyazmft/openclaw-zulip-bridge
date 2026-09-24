import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_QUEUE_CAP,
  MAX_QUEUE_CAP,
  SessionDispatchQueue,
  resolveSessionQueueConfig,
  type SessionQueueHooks,
} from "../src/zulip/session-queue.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function recordingHooks(): SessionQueueHooks & { events: string[] } {
  const events: string[] = [];
  return {
    events,
    onQueued: ({ sessionKey, waiting }) => events.push(`queued:${sessionKey}:${waiting}`),
    onDequeued: ({ sessionKey }) => events.push(`dequeued:${sessionKey}`),
    onCapReached: ({ sessionKey, waiting, cap }) => events.push(`cap:${sessionKey}:${waiting}/${cap}`),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// ── Config ──────────────────────────────────────────────────────────────────

test("resolveSessionQueueConfig: off by default, and clamps the cap", () => {
  const defaults = resolveSessionQueueConfig();
  assert.equal(defaults.mode, "off");
  assert.equal(defaults.cap, DEFAULT_QUEUE_CAP);

  assert.equal(resolveSessionQueueConfig({ queueMode: "followup" }).mode, "followup");
  assert.equal(resolveSessionQueueConfig({ queueMode: "nonsense" }).mode, "off");
  assert.equal(resolveSessionQueueConfig({ queueCap: 0 }).cap, 1);
  assert.equal(resolveSessionQueueConfig({ queueCap: 99_999 }).cap, MAX_QUEUE_CAP);
  assert.equal(resolveSessionQueueConfig({ queueCap: 5.6 }).cap, 6);
});

// ── off mode ────────────────────────────────────────────────────────────────

test("mode off: tasks are not serialized and no hooks fire", async () => {
  const hooks = recordingHooks();
  const queue = new SessionDispatchQueue({ config: { mode: "off", cap: 5 }, hooks });

  const first = deferred();
  const second = deferred();
  const a = queue.run("s1", async () => {
    await first.promise;
    return "a";
  });
  const b = queue.run("s1", async () => {
    await second.promise;
    return "b";
  });

  // Both start immediately (no queueing) — that is what "off" means.
  assert.equal(queue.waitingCount("s1"), 0);
  first.resolve();
  second.resolve();
  assert.deepEqual(await Promise.all([a, b]), ["a", "b"]);
  assert.deepEqual(hooks.events, []);
});

// ── followup mode ───────────────────────────────────────────────────────────

test("followup: a second message for the same session waits for the run", async () => {
  const hooks = recordingHooks();
  const queue = new SessionDispatchQueue({ config: { mode: "followup", cap: 5 }, hooks });

  const first = deferred();
  const started: string[] = [];
  const a = queue.run("topic:1", async () => {
    started.push("a");
    await first.promise;
    return "a";
  });
  const b = queue.run("topic:1", async () => {
    started.push("b");
    return "b";
  });

  await tick();
  assert.deepEqual(started, ["a"], "the second task must not start while the first runs");
  assert.equal(queue.waitingCount("topic:1"), 1);
  assert.deepEqual(hooks.events, ["queued:topic:1:1"]);

  first.resolve();
  assert.equal(await a, "a");
  assert.equal(await b, "b");
  assert.deepEqual(started, ["a", "b"]);
  assert.deepEqual(hooks.events, ["queued:topic:1:1", "dequeued:topic:1"]);
  assert.equal(queue.waitingCount("topic:1"), 0);
});

test("followup: three messages run strictly in arrival order", async () => {
  const queue = new SessionDispatchQueue({ config: { mode: "followup", cap: 5 } });
  const order: string[] = [];
  const gates = [deferred(), deferred(), deferred()];

  const runs = ["1", "2", "3"].map((id, index) =>
    queue.run("s", async () => {
      order.push(id);
      await gates[index].promise;
      return id;
    }),
  );

  await tick();
  assert.deepEqual(order, ["1"], "only the first may start");
  gates[0].resolve();
  await tick();
  assert.deepEqual(order, ["1", "2"], "the second starts once the first finishes");
  gates[1].resolve();
  await tick();
  assert.deepEqual(order, ["1", "2", "3"]);
  gates[2].resolve();
  assert.deepEqual(await Promise.all(runs), ["1", "2", "3"]);
  assert.equal(queue.waitingCount("s"), 0);
});

test("followup: waiting counts down as each queued message takes its turn", async () => {
  const hooks = recordingHooks();
  const queue = new SessionDispatchQueue({ config: { mode: "followup", cap: 5 }, hooks });
  const gate = deferred();

  const first = queue.run("s", async () => {
    await gate.promise;
  });
  const second = queue.run("s", async () => {});
  const third = queue.run("s", async () => {});

  await tick();
  assert.equal(queue.waitingCount("s"), 2, "both followers are waiting");
  gate.resolve();
  await Promise.all([first, second, third]);
  assert.equal(queue.waitingCount("s"), 0);
  assert.deepEqual(hooks.events, ["queued:s:1", "queued:s:2", "dequeued:s", "dequeued:s"]);
});

test("followup: different sessions are unaffected by each other", async () => {
  const hooks = recordingHooks();
  const queue = new SessionDispatchQueue({ config: { mode: "followup", cap: 5 }, hooks });
  const gate = deferred();

  const a = queue.run("topic-a", async () => {
    await gate.promise;
    return "a";
  });
  const b = queue.run("topic-b", async () => "b");

  assert.equal(await b, "b", "another topic must not wait");
  assert.deepEqual(hooks.events, [], "nothing was queued");
  gate.resolve();
  assert.equal(await a, "a");
});

// ── Error handling ──────────────────────────────────────────────────────────

test("followup: a failing run does not swallow the error and the queue keeps working", async () => {
  const hooks = recordingHooks();
  const queue = new SessionDispatchQueue({ config: { mode: "followup", cap: 5 }, hooks });
  const gate = deferred();

  const failing = queue.run("s", async () => {
    await gate.promise;
    throw new Error("dispatch blew up");
  });
  const after = queue.run("s", async () => "after");

  gate.resolve();
  await assert.rejects(failing, /dispatch blew up/);
  assert.equal(await after, "after", "the message behind a failed run still runs");
  assert.deepEqual(hooks.events, ["queued:s:1", "dequeued:s"]);
});

test("followup: a synchronous throw does not poison the session chain", async () => {
  const queue = new SessionDispatchQueue({ config: { mode: "followup", cap: 5 } });
  const bad = queue.run("s", (() => {
    throw new Error("sync boom");
  }) as () => Promise<never>);
  const good = queue.run("s", async () => "ok");

  await assert.rejects(bad, /sync boom/);
  assert.equal(await good, "ok");
});

// ── Cap ─────────────────────────────────────────────────────────────────────

test("cap: a full queue never drops the message — it dispatches immediately", async () => {
  const hooks = recordingHooks();
  const queue = new SessionDispatchQueue({ config: { mode: "followup", cap: 1 }, hooks });
  const gate = deferred();
  const starts: string[] = [];

  const first = queue.run("s", async () => {
    starts.push("first");
    await gate.promise;
  });
  const waiting = queue.run("s", async () => {
    starts.push("waiting");
  });
  // Cap is 1, so this one cannot wait: it must run now rather than be dropped.
  const overflow = queue.run("s", async () => {
    starts.push("overflow");
  });

  await tick();
  assert.deepEqual(starts, ["first", "overflow"]);
  assert.deepEqual(hooks.events, ["queued:s:1", "cap:s:1/1"]);

  gate.resolve();
  await Promise.all([first, waiting, overflow]);
  assert.deepEqual(starts, ["first", "overflow", "waiting"]);
});
