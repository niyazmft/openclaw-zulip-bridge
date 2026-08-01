import test from "node:test";
import assert from "node:assert/strict";
import {
  splitStreamTarget,
  parseSendTarget,
  assertStringLength,
  resolveTopicName,
  parseBooleanValue,
  readBooleanParam,
  parseStringArrayParam,
  readRealmUpdateParams,
} from "../src/actions-utils.ts";

// ── splitStreamTarget ───────────────────────────────────────────────────────

test("splitStreamTarget: parses stream:name format", () => {
  const result = splitStreamTarget("stream:general");
  assert.equal(result.stream, "general");
  assert.equal(result.topic, undefined);
});

test("splitStreamTarget: parses stream:name/topic format", () => {
  const result = splitStreamTarget("stream:general/updates");
  assert.equal(result.stream, "general");
  assert.equal(result.topic, "updates");
});

test("splitStreamTarget: parses #name format", () => {
  const result = splitStreamTarget("#general");
  assert.equal(result.stream, "general");
  assert.equal(result.topic, undefined);
});

test("splitStreamTarget: parses #name/topic format", () => {
  const result = splitStreamTarget("#general/updates");
  assert.equal(result.stream, "general");
  assert.equal(result.topic, "updates");
});

test("splitStreamTarget: parses stream:name topic:topic format", () => {
  const result = splitStreamTarget("stream:general topic: updates");
  assert.equal(result.stream, "general");
  assert.equal(result.topic, "updates");
});

test("splitStreamTarget: trims whitespace", () => {
  const result = splitStreamTarget("  stream:  general  /  updates  ");
  assert.equal(result.stream, "general");
  assert.equal(result.topic, "updates");
});

test("splitStreamTarget: throws on empty input", () => {
  assert.throws(() => splitStreamTarget(""), /Stream is required/);
  assert.throws(() => splitStreamTarget("   "), /Stream is required/);
});

test("splitStreamTarget: throws on empty stream after prefix", () => {
  assert.throws(() => splitStreamTarget("stream:"), /Stream name is required/);
  assert.throws(() => splitStreamTarget("#"), /Stream name is required/);
});

// ── parseSendTarget ─────────────────────────────────────────────────────────

test("parseSendTarget: parses stream:name:topic format", () => {
  const result = parseSendTarget("stream:general:updates");
  assert.equal(result.kind, "stream");
  assert.equal(result.stream, "general");
  assert.equal(result.topic, "updates");
});

test("parseSendTarget: parses user:email format", () => {
  const result = parseSendTarget("user:test@example.com");
  assert.equal(result.kind, "user");
  assert.equal(result.email, "test@example.com");
});

test("parseSendTarget: throws on missing topic for stream", () => {
  assert.throws(() => parseSendTarget("stream:general"), /Topic is required/);
});

test("parseSendTarget: throws on empty input", () => {
  assert.throws(() => parseSendTarget(""), /Recipient is required/);
  assert.throws(() => parseSendTarget("   "), /Recipient is required/);
});

test("parseSendTarget: throws on invalid format", () => {
  assert.throws(() => parseSendTarget("invalid"), /Invalid Zulip send target/);
});

test("parseSendTarget: throws on empty email for user", () => {
  assert.throws(() => parseSendTarget("user:"), /Email is required/);
});

// ── assertStringLength ───────────────────────────────────────────────────────

test("assertStringLength: does not throw for short strings", () => {
  assert.doesNotThrow(() => assertStringLength("hello", "field"));
});

test("assertStringLength: does not throw at exact max", () => {
  assert.doesNotThrow(() => assertStringLength("x".repeat(10000), "field", 10000));
});

test("assertStringLength: throws for strings over max", () => {
  assert.throws(() => assertStringLength("x".repeat(10001), "field", 10000), /field must be/);
});

test("assertStringLength: uses default max of 10000", () => {
  assert.throws(() => assertStringLength("x".repeat(10001), "field"), /field must be/);
});

// ── resolveTopicName ─────────────────────────────────────────────────────────

test("resolveTopicName: adds checkmark prefix to unresolved topic", () => {
  const result = resolveTopicName("updates");
  assert.equal(result.topic, "✔ updates");
  assert.equal(result.alreadyResolved, false);
});

test("resolveTopicName: detects already resolved with ✔ prefix", () => {
  const result = resolveTopicName("✔ updates");
  assert.equal(result.topic, "✔ updates");
  assert.equal(result.alreadyResolved, true);
});

test("resolveTopicName: detects already resolved with ✅ prefix", () => {
  const result = resolveTopicName("✅ updates");
  assert.equal(result.topic, "✅ updates");
  assert.equal(result.alreadyResolved, true);
});

test("resolveTopicName: trims whitespace", () => {
  const result = resolveTopicName("  updates  ");
  assert.equal(result.topic, "✔ updates");
});

test("resolveTopicName: returns empty for empty input", () => {
  const result = resolveTopicName("");
  assert.equal(result.topic, "");
  assert.equal(result.alreadyResolved, false);
});

// ── parseBooleanValue ────────────────────────────────────────────────────────

test("parseBooleanValue: returns boolean as-is", () => {
  assert.equal(parseBooleanValue(true), true);
  assert.equal(parseBooleanValue(false), false);
});

test("parseBooleanValue: parses truthy numbers", () => {
  assert.equal(parseBooleanValue(1), true);
  assert.equal(parseBooleanValue(0), false);
});

test("parseBooleanValue: returns undefined for non-0/1 numbers", () => {
  assert.equal(parseBooleanValue(2), undefined);
  assert.equal(parseBooleanValue(-1), undefined);
});

test("parseBooleanValue: parses truthy strings", () => {
  assert.equal(parseBooleanValue("true"), true);
  assert.equal(parseBooleanValue("1"), true);
  assert.equal(parseBooleanValue("yes"), true);
  assert.equal(parseBooleanValue("y"), true);
  assert.equal(parseBooleanValue("on"), true);
  assert.equal(parseBooleanValue("TRUE"), true);
  assert.equal(parseBooleanValue("Yes"), true);
});

test("parseBooleanValue: parses falsy strings", () => {
  assert.equal(parseBooleanValue("false"), false);
  assert.equal(parseBooleanValue("0"), false);
  assert.equal(parseBooleanValue("no"), false);
  assert.equal(parseBooleanValue("n"), false);
  assert.equal(parseBooleanValue("off"), false);
});

test("parseBooleanValue: returns undefined for unknown strings", () => {
  assert.equal(parseBooleanValue("maybe"), undefined);
  assert.equal(parseBooleanValue(""), undefined);
});

test("parseBooleanValue: returns undefined for objects/arrays", () => {
  assert.equal(parseBooleanValue({}), undefined);
  assert.equal(parseBooleanValue([]), undefined);
});

// ── readBooleanParam ─────────────────────────────────────────────────────────

test("readBooleanParam: reads from first matching key", () => {
  const result = readBooleanParam({ inviteOnly: true }, "inviteOnly", "invite_only", "is_private");
  assert.equal(result, true);
});

test("readBooleanParam: tries fallback keys", () => {
  const result = readBooleanParam({ is_private: true }, "inviteOnly", "invite_only", "is_private");
  assert.equal(result, true);
});

test("readBooleanParam: returns undefined when no keys match", () => {
  const result = readBooleanParam({ other: true }, "inviteOnly", "invite_only");
  assert.equal(result, undefined);
});

test("readBooleanParam: returns undefined for empty params", () => {
  const result = readBooleanParam({}, "inviteOnly");
  assert.equal(result, undefined);
});

// ── parseStringArrayParam ────────────────────────────────────────────────────

test("parseStringArrayParam: returns array as-is", () => {
  const result = parseStringArrayParam({ users: ["alice", "bob"] }, "users");
  assert.deepEqual(result, ["alice", "bob"]);
});

test("parseStringArrayParam: splits comma-separated string", () => {
  const result = parseStringArrayParam({ users: "alice,bob,charlie" }, "users");
  assert.deepEqual(result, ["alice", "bob", "charlie"]);
});

test("parseStringArrayParam: splits newline-separated string", () => {
  const result = parseStringArrayParam({ users: "alice\nbob\ncharlie" }, "users");
  assert.deepEqual(result, ["alice", "bob", "charlie"]);
});

test("parseStringArrayParam: wraps single number in array", () => {
  const result = parseStringArrayParam({ users: 42 }, "users");
  assert.deepEqual(result, [42]);
});

test("parseStringArrayParam: returns empty array for empty string", () => {
  const result = parseStringArrayParam({ users: "" }, "users");
  assert.deepEqual(result, []);
});

test("parseStringArrayParam: returns undefined when key not present", () => {
  const result = parseStringArrayParam({ other: "value" }, "users");
  assert.equal(result, undefined);
});

test("parseStringArrayParam: trims whitespace from entries", () => {
  const result = parseStringArrayParam({ users: " alice , bob " }, "users");
  assert.deepEqual(result, ["alice", "bob"]);
});

test("parseStringArrayParam: filters empty entries", () => {
  const result = parseStringArrayParam({ users: "alice,,bob," }, "users");
  assert.deepEqual(result, ["alice", "bob"]);
});

// ── readRealmUpdateParams ────────────────────────────────────────────────────

test("readRealmUpdateParams: parses object settings", () => {
  const result = readRealmUpdateParams({
    settings: { name: "New Name", description: "New desc" },
  });
  assert.deepEqual(result, { name: "New Name", description: "New desc" });
});

test("readRealmUpdateParams: parses JSON string settings", () => {
  const result = readRealmUpdateParams({
    settings: '{"name": "New Name", "description": "New desc"}',
  });
  assert.deepEqual(result, { name: "New Name", description: "New desc" });
});

test("readRealmUpdateParams: throws on unsupported settings", () => {
  assert.throws(
    () => readRealmUpdateParams({ settings: { invite_required: true } }),
    /Unsupported organization setting/,
  );
});

test("readRealmUpdateParams: throws on empty settings", () => {
  assert.throws(
    () => readRealmUpdateParams({ settings: {} }),
    /at least one field/,
  );
});

test("readRealmUpdateParams: throws on missing settings", () => {
  assert.throws(
    () => readRealmUpdateParams({}),
    /settings are required/,
  );
});

test("readRealmUpdateParams: throws on invalid JSON string", () => {
  assert.throws(
    () => readRealmUpdateParams({ settings: "not json" }),
    /JSON object/,
  );
});

test("readRealmUpdateParams: throws on array settings", () => {
  assert.throws(
    () => readRealmUpdateParams({ settings: ["a", "b"] }),
    /key\/value object/,
  );
});
