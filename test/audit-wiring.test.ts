import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

// Source guards for #326 causes 1 and 2.
//
// Both are wiring regressions that unit tests cannot reach cheaply: the monitoring
// loop needs a Zulip server, and the outbound adapter needs a host. What matters is
// structural — that the audit events are emitted unconditionally and from the path
// that the agent's `message` tool actually takes — so assert on the source, the same
// way monitor-regression.test.ts pins the queue and log behaviour.

const read = (p: string) => fs.readFile(path.resolve(process.cwd(), p), "utf8");

test("#326 cause 1: dispatch_turn is recorded for every dispatched message", async () => {
  const source = await read("src/zulip/monitor.ts");
  const lines = source.split("\n");
  const eventLine = lines.findIndex((line) => line.includes('event: "dispatch_turn"'));
  assert.ok(eventLine > 0, "dispatch_turn audit event must still be emitted");

  // Walk back to the `auditLogger.log({` that emits it, then assert nothing gates
  // it — either wrapped in an `if (...) {` block, or inlined after an `if (...)`
  // on the same line. Gating this on the host's command detector (#326, cause 1)
  // meant ordinary traffic left no inbound record at all, which is the bug.
  let callLine = -1;
  for (let i = eventLine; i >= 0; i -= 1) {
    if (lines[i].includes("auditLogger.log(")) {
      callLine = i;
      break;
    }
  }
  assert.ok(callLine >= 0, "expected an auditLogger.log( call emitting dispatch_turn");

  let previousLine = "";
  for (let i = callLine - 1; i >= 0; i -= 1) {
    if (lines[i].trim()) {
      previousLine = lines[i];
      break;
    }
  }

  const prefix = lines[callLine].slice(0, lines[callLine].indexOf("auditLogger.log("));
  assert.equal(
    /\bif \(/.test(prefix),
    false,
    "dispatch_turn must not be inlined behind an if() — every dispatched message is audited",
  );
  assert.equal(
    /^\s*if \(/.test(previousLine),
    false,
    "dispatch_turn must not be wrapped in an if() block — every dispatched message is audited",
  );

  // The host detector's verdict is kept as a field instead of being used as a filter.
  assert.match(source, /event: "dispatch_turn"[\s\S]{0,400}?hasControlCommand: String\(hasControlCommand\)/);
  assert.match(source, /event: "dispatch_turn"[\s\S]{0,400}?isDM: String\(isDM\)/);
});

test("#326: deliver_payload is not gated on command turns", async () => {
  // The dispatcher delivery is the most common outcome, so it must always be audited.
  // It used to sit inside `if (isCommandTurn) { … }`.
  const source = await read("src/zulip/reply-handler.ts");
  const lines = source.split("\n");
  const eventLine = lines.findIndex((l) => l.includes("onDeliverPayload?.({"));
  assert.ok(eventLine > 0, "expected an onDeliverPayload call");
  let previousLine = "";
  for (let i = eventLine - 1; i >= 0; i -= 1) {
    if (lines[i].trim() && !lines[i].trim().startsWith("//")) {
      previousLine = lines[i];
      break;
    }
  }
  assert.equal(
    /^\s*if \(/.test(previousLine),
    false,
    "onDeliverPayload must not be wrapped in an if() — every delivered payload is audited",
  );
});

test("#326 cause 4: the auto-send rescue is audited as deliver_fallback", async () => {
  const source = await read("src/zulip/monitor.ts");
  assert.match(source, /onDeliverFallback:/, "monitor must pass an onDeliverFallback hook");
  assert.match(source, /event: "deliver_fallback"/);
});

test("#326 cause 2: outbound sends from the channel adapter are audited", async () => {
  const channel = await read("src/channel.ts");

  const sendText = channel.match(/sendText: async \(\{[\s\S]*?\n {4}\},/);
  const sendMedia = channel.match(/sendMedia: async \(\{[\s\S]*?\n {4}\},/);
  assert.ok(sendText, "expected an outbound sendText adapter");
  assert.ok(sendMedia, "expected an outbound sendMedia adapter");

  // `auditOutboundSend` must run on the channel outbound path — that is where the
  // agent's `message` tool lands, and the only place its sends can be recorded.
  assert.match(sendText[0], /await sendMessageZulip\(/);
  assert.match(sendText[0], /auditOutboundSend\(/);
  assert.match(sendMedia[0], /await sendMessageZulip\(/);
  assert.match(sendMedia[0], /auditOutboundSend\(/);

  // And it must be audited *after* the send, so a failure cannot look like success.
  assert.ok(
    sendText[0].indexOf("await sendMessageZulip(") < sendText[0].indexOf("auditOutboundSend("),
    "sendText must audit after sending",
  );
  assert.ok(
    sendMedia[0].indexOf("await sendMessageZulip(") < sendMedia[0].indexOf("auditOutboundSend("),
    "sendMedia must audit after sending",
  );
});

test("#326: the monitor reuses the shared audit logger instead of making its own", async () => {
  const source = await read("src/zulip/monitor.ts");
  // Two logger instances appending to one file could interleave writes or race on
  // rotation; the outbound adapter needs the same instance the monitor uses.
  assert.equal(source.includes("new AuditLogger("), false);
  assert.match(source, /getAuditLogger\(/);
});

test("pre-dispatch drops are audited, so a silently discarding channel is visible", async () => {
  // The counterpart to cause 1: every early return between receipt and dispatch used
  // to be silent, so a channel that receives everything and drops it as unauthorised
  // looked exactly like an idle one. Each exit must now record `inbound_dropped` with
  // a reason, mirroring `deliver_skipped` on the outbound side.
  const source = await read("src/zulip/monitor.ts");

  assert.match(source, /event: "inbound_dropped"/, "expected an inbound_dropped audit event");

  for (const reason of [
    "stream-not-monitored",
    "duplicate",
    "policy-drop",
    "policy-drop-pairing",
    "onchar-gate",
    "empty-body",
  ]) {
    assert.ok(
      source.includes(`"${reason}"`),
      `expected an inbound_dropped reason of ${reason} (an early return is still silent)`,
    );
  }

  // Five call sites: the two policy-drop reasons come from one ternary, so the six
  // reasons above map to five calls. Anything less means an exit went silent again.
  const dropCalls = source.match(/auditInboundDrop\(/g) ?? [];
  assert.ok(dropCalls.length >= 5, `expected >=5 auditInboundDrop call sites, got ${dropCalls.length}`);
});
