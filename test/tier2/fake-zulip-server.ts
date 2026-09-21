/**
 * Minimal fake Zulip server for Tier 2 behavior tests.
 *
 * Implements the exact subset of the Zulip API surface that the plugin uses:
 *   /api/v1/register
 *   /api/v1/events          (long-poll with injectable events)
 *   /api/v1/messages        (outbound send capture)
 *   /api/v1/user_uploads    (upload capture)
 *   /api/v1/messages/{id}/reactions
 *   PATCH /api/v1/messages/{id}
 *   /api/v1/users/me
 *   /api/v1/streams
 *   /api/v1/users/me/subscriptions
 *   /api/v1/typing
 *
 * Usage:
 *   const fake = createFakeZulipServer();
 *   fake.server.listen(0, () => {
 *     fake.port = (fake.server.address() as any).port;
 *     fake.url = `http://127.0.0.1:${fake.port}`;
 *   });
 *   fake.injectEvent({ type: "message", message: { ... } });
 *   const msgs = fake.getCapturedMessages();
 *   await fake.close();
 */

import http from "node:http";

export type FakeZulipEvent = {
  type: string;
  id?: number;
  [k: string]: any;
};

export type FakeZulipServer = {
  server: http.Server;
  port: number;
  url: string;
  injectEvent(event: FakeZulipEvent): void;
  getCapturedMessages(): any[];
  getCapturedUploads(): any[];
  getCapturedReactions(): any[];
  getCapturedEdits(): any[];
  getCapturedTyping(): any[];
  clear(): void;
  close(): Promise<void>;
};

export function createFakeZulipServer(): FakeZulipServer {
  const events: FakeZulipEvent[] = [];
  const captured = {
    messages: [] as any[],
    uploads: [] as any[],
    reactions: [] as any[],
    edits: [] as any[],
    typing: [] as any[],
  };
  let nextEventId = 1;
  let nextMessageId = 1;

  type Waiter = { resolve: (events: any[]) => void; timeout: NodeJS.Timeout };
  const waiters: Waiter[] = [];

  function notifyWaiters() {
    while (waiters.length > 0 && events.length > 0) {
      const w = waiters.shift()!;
      clearTimeout(w.timeout);
      const batch = events.splice(0, events.length);
      w.resolve(batch);
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, `http://localhost`);
    const path = url.pathname;

    // Accept any HTTP Basic auth
    const auth = req.headers.authorization;
    if (!auth) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ msg: "Missing auth", result: "error" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        handleRequest(req.method!, path, body, url, res);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ msg: String(err), result: "error" }));
      }
    });
  });

  function handleRequest(
    method: string,
    path: string,
    body: string,
    url: URL,
    res: http.ServerResponse,
  ) {
    // --- register ---
    if (method === "POST" && path === "/api/v1/register") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          result: "success",
          msg: "",
          queue_id: `fake-queue-${Date.now()}`,
          last_event_id: 0,
          event_queue_longpoll_timeout_seconds: 1,
        }),
      );
      return;
    }

    // --- events (long-poll) ---
    if (method === "GET" && path === "/api/v1/events") {
      if (events.length > 0) {
        const batch = events.splice(0, events.length);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ result: "success", msg: "", events: batch }));
        return;
      }

      const timeout = setTimeout(() => {
        const idx = waiters.findIndex((w) => w.timeout === timeout);
        if (idx >= 0) waiters.splice(idx, 1);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            result: "success",
            msg: "",
            events: [{ type: "heartbeat", id: nextEventId++ }],
          }),
        );
      }, 500);

      waiters.push({
        timeout,
        resolve: (batch) => {
          clearTimeout(timeout);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ result: "success", msg: "", events: batch }));
        },
      });
      return;
    }

    // --- messages (outbound) ---
    if (method === "POST" && path === "/api/v1/messages") {
      const params = new URLSearchParams(body);
      const msg = {
        id: nextMessageId++,
        type: params.get("type"),
        to: params.get("to"),
        topic: params.get("topic"),
        content: params.get("content"),
      };
      captured.messages.push(msg);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result: "success", msg: "", id: msg.id }));
      return;
    }

    // --- uploads ---
    if (method === "POST" && path === "/api/v1/user_uploads") {
      captured.uploads.push({ body });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result: "success", msg: "", uri: `${url.origin}/uploads/fake-file.txt` }));
      return;
    }

    // --- reactions ---
    const reactionMatch = path.match(/^\/api\/v1\/messages\/([^/]+)\/reactions$/);
    if (method === "POST" && reactionMatch) {
      const params = new URLSearchParams(body);
      captured.reactions.push({
        messageId: reactionMatch[1],
        emoji: params.get("emoji_name"),
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result: "success" }));
      return;
    }

    // --- edits ---
    const editMatch = path.match(/^\/api\/v1\/messages\/([^/]+)$/);
    if (method === "PATCH" && editMatch) {
      const params = new URLSearchParams(body);
      captured.edits.push({
        messageId: editMatch[1],
        content: params.get("content"),
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result: "success" }));
      return;
    }

    // --- users/me ---
    if (method === "GET" && path === "/api/v1/users/me") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          result: "success",
          msg: "",
          user_id: 1,
          full_name: "Fake Bot",
          email: "bot@zulip.com",
        }),
      );
      return;
    }

    // --- streams ---
    if (method === "GET" && path === "/api/v1/streams") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          result: "success",
          msg: "",
          streams: [{ name: "test-stream", stream_id: 100 }],
        }),
      );
      return;
    }

    // --- subscriptions ---
    if (method === "GET" && path === "/api/v1/users/me/subscriptions") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          result: "success",
          msg: "",
          subscriptions: [{ name: "test-stream", stream_id: 100 }],
        }),
      );
      return;
    }

    // --- typing ---
    if (method === "POST" && path === "/api/v1/typing") {
      const params = new URLSearchParams(body);
      captured.typing.push({
        op: params.get("op"),
        to: params.get("to"),
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result: "success" }));
      return;
    }

    // Fallback
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ msg: "not found", path, method, result: "error" }));
  }

  return {
    server,
    port: 0,
    url: "",
    injectEvent(event: FakeZulipEvent) {
      events.push(event);
      notifyWaiters();
    },
    getCapturedMessages() {
      return [...captured.messages];
    },
    getCapturedUploads() {
      return [...captured.uploads];
    },
    getCapturedReactions() {
      return [...captured.reactions];
    },
    getCapturedEdits() {
      return [...captured.edits];
    },
    getCapturedTyping() {
      return [...captured.typing];
    },
    clear() {
      events.length = 0;
      captured.messages.length = 0;
      captured.uploads.length = 0;
      captured.reactions.length = 0;
      captured.edits.length = 0;
      captured.typing.length = 0;
    },
    async close() {
      // Force-end any held long-poll responses so server.close() doesn't wait.
      for (const w of waiters) {
        clearTimeout(w.timeout);
        try {
          // The response object may still be writable; send a heartbeat to unblock it.
          // If the client already disconnected this is a no-op.
        } catch {}
      }
      waiters.length = 0;
      return new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
        // Destroy any remaining open sockets after a short grace period.
        setTimeout(() => {
          for (const sock of (server as any).connections || []) {
            try { sock.destroy(); } catch {}
          }
          resolve();
        }, 500);
      });
    },
  };
}
