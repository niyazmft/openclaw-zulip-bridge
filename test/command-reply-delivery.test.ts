import test from "node:test";
import assert from "node:assert/strict";
import { shouldSkipPayload } from "../src/zulip/reply-handler.ts";

// Reported from the field: `/new`, `/status` and friends produced *no* response
// at all. The commands were accepted and handled — the host answered them — but
// it marks a command's answer as a status notice, and the deliver path suppressed
// notices outright (#273/#247). So the reply was discarded and the trace even
// claimed "no reply sent", which was false: there was a reply.
//
// The rule: notices stay suppressed for agent runs; a command turn keeps its
// answer, because for a command the notice *is* the reply.
//
// The non-terminal tool-error warning branch cannot be exercised here — the local
// SDK shim returns false for `isReplyPayloadNonTerminalToolErrorWarning` by
// construction, so that path is covered by reasoning, not by this test.

test("agent runs still suppress status notices (#273/#247 must not regress)", () => {
  assert.equal(
    shouldSkipPayload({ text: "compacting context", isStatusNotice: true }, { isCommandTurn: false }),
    "status notice",
  );
  // omitted flag = agent run, i.e. the pre-existing default behaviour
  assert.equal(shouldSkipPayload({ text: "compacting context", isStatusNotice: true }), "status notice");
});

test("a command turn delivers its status notice instead of dropping it", () => {
  // Exactly what the host returns for /new.
  assert.equal(
    shouldSkipPayload({ text: "New session started.", isStatusNotice: true }, { isCommandTurn: true }),
    null,
  );
});

test("compaction and fallback notices stay suppressed even on a command turn", () => {
  // These are agent-runtime artefacts and can never be a command's answer.
  assert.equal(shouldSkipPayload({ isCompactionNotice: true }, { isCommandTurn: true }), "compaction notice");
  assert.equal(shouldSkipPayload({ isFallbackNotice: true }, { isCommandTurn: true }), "fallback notice");
});

test("ordinary replies are never skipped, command turn or not", () => {
  assert.equal(shouldSkipPayload({ text: "here is your answer" }, { isCommandTurn: false }), null);
  assert.equal(shouldSkipPayload({ text: "here is your answer" }, { isCommandTurn: true }), null);
  assert.equal(shouldSkipPayload(undefined, { isCommandTurn: true }), null);
  assert.equal(shouldSkipPayload({}, { isCommandTurn: false }), null);
});
