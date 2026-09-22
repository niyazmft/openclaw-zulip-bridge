import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Schema ↔ manifest parity guard.
 *
 * The runtime schema (`src/config-schema.ts`) and the two hand-written JSON
 * schemas in `openclaw.plugin.json` must describe the same config keys. They
 * are `additionalProperties: false`, and the host validates the root schema at
 * load time on older hosts, so a key that exists at runtime but is missing from
 * the manifest is a real bug: a config using it can be rejected.
 *
 * (Found live: `dmSessionTurnLimit`, `enableSessionRecovery`,
 * `maxMessagesPerMinute` and `maxMessageLength` were in the runtime schema and
 * the UI hints but in neither manifest schema.)
 */

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => readFileSync(path.join(rootDir, relative), "utf8");

/** Top-level keys of `ZulipAccountSchema`. */
function runtimeSchemaKeys(): string[] {
  const source = read("src/config-schema.ts");
  const start = source.indexOf("const ZulipAccountSchema = z.object({");
  const end = source.indexOf("const ZulipConfigSchema");
  assert.ok(start >= 0 && end > start, "could not locate ZulipAccountSchema in src/config-schema.ts");
  return [...source.slice(start, end).matchAll(/^\s{2}([A-Za-z_][A-Za-z0-9_]*):/gm)].map(
    (match) => match[1],
  );
}

/** `accounts` is structural (the multi-account map), not an account key. */
function manifestSchemas(): {
  root: { keys: string[]; additionalProperties: unknown };
  channel: { keys: string[]; additionalProperties: unknown };
} {
  const manifest = JSON.parse(read("openclaw.plugin.json"));
  const root = manifest.configSchema.properties.zulip;
  const channel = manifest.channelConfigs.zulip.schema;
  const withoutAccounts = (props: Record<string, unknown>) =>
    Object.keys(props).filter((key) => key !== "accounts");
  return {
    root: { keys: withoutAccounts(root.properties), additionalProperties: root.additionalProperties },
    channel: {
      keys: withoutAccounts(channel.properties),
      additionalProperties: channel.additionalProperties,
    },
  };
}

const sorted = (values: string[]) => [...values].sort();

test("the runtime account schema has no duplicate keys", () => {
  const keys = runtimeSchemaKeys();
  assert.equal(new Set(keys).size, keys.length, "duplicate key in ZulipAccountSchema");
  assert.ok(keys.length > 30, `expected a substantive schema, found ${keys.length} keys`);
});

test("the channel manifest schema matches the runtime account schema exactly", () => {
  const { channel } = manifestSchemas();
  assert.deepEqual(
    sorted(channel.keys),
    sorted(runtimeSchemaKeys()),
    "openclaw.plugin.json channelConfigs.zulip.schema drifted from ZulipAccountSchema",
  );
  assert.equal(
    channel.additionalProperties,
    false,
    "channel schema must stay closed, so every runtime key has to be declared",
  );
});

test("the root manifest schema matches the runtime account schema exactly", () => {
  const { root } = manifestSchemas();
  assert.deepEqual(
    sorted(root.keys),
    sorted(runtimeSchemaKeys()),
    "openclaw.plugin.json configSchema drifted from ZulipAccountSchema",
  );
  assert.equal(
    root.additionalProperties,
    false,
    "root schema must stay closed, so every runtime key has to be declared",
  );
});

test("both manifest schemas declare the same keys as each other", () => {
  const { root, channel } = manifestSchemas();
  assert.deepEqual(sorted(root.keys), sorted(channel.keys));
});

test("every UI hint refers to a key that exists", () => {
  const hints = JSON.parse(read("openclaw.plugin.json")).channelConfigs.zulip.uiHints ?? {};
  const hintKeys = Object.keys(hints).filter((key) => key !== "");
  for (const key of hintKeys) {
    assert.ok(
      runtimeSchemaKeys().includes(key),
      `uiHints documents ${key}, which is not in the runtime account schema`,
    );
  }
});
