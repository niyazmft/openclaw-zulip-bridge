import test from "node:test";
import assert from "node:assert/strict";
import {
  isSenderAllowed,
  normalizeAllowEntry,
  normalizeAllowList,
} from "../src/zulip/auth.ts";

// ── Authorization identity (security regression) ────────────────────────────
// An earlier version also accepted an allowlist entry equal to `senderName`,
// which is Zulip's user-settable `sender_full_name`. Any user could rename
// their profile to an allowlisted address and bypass pairing/commands.

test("isSenderAllowed matches the exact normalized sender id", () => {
  assert.equal(
    isSenderAllowed({ senderId: "admin@good.com", allowFrom: ["admin@good.com"] }),
    true,
  );
  assert.equal(
    isSenderAllowed({ senderId: "ADMIN@Good.com", allowFrom: ["admin@good.com"] }),
    true,
  );
  assert.equal(
    isSenderAllowed({ senderId: "user:admin@good.com", allowFrom: ["admin@good.com"] }),
    true,
  );
});

test("isSenderAllowed rejects a non-allowlisted id", () => {
  assert.equal(
    isSenderAllowed({ senderId: "attacker@evil.com", allowFrom: ["admin@good.com"] }),
    false,
  );
});

test("an impersonating display name cannot authorize", () => {
  // Callers pass only `senderId`; a stray `senderName` must be ignored even if
  // it matches an allowlisted entry.
  const params = {
    senderId: "attacker@evil.com",
    senderName: "admin@good.com",
    allowFrom: ["admin@good.com"],
  } as unknown as Parameters<typeof isSenderAllowed>[0];
  assert.equal(isSenderAllowed(params), false);
});

test("isSenderAllowed treats an empty allowlist as deny", () => {
  assert.equal(isSenderAllowed({ senderId: "anyone@example.com", allowFrom: [] }), false);
});

test("isSenderAllowed honors an explicit wildcard", () => {
  assert.equal(isSenderAllowed({ senderId: "anyone@example.com", allowFrom: ["*"] }), true);
});

test("normalizeAllowEntry strips channel prefixes and trims", () => {
  assert.equal(normalizeAllowEntry("  zulip:Admin@Good.com "), "admin@good.com");
  assert.equal(normalizeAllowEntry("user:@admin@good.com"), "admin@good.com");
  assert.equal(normalizeAllowEntry("*"), "*");
  assert.equal(normalizeAllowEntry("   "), "");
});

test("normalizeAllowList de-duplicates and drops empties", () => {
  assert.deepEqual(
    normalizeAllowList(["a@x.com", "A@X.com", "", "b@y.com"]),
    ["a@x.com", "b@y.com"],
  );
});
