import assert from "node:assert";
import { test, describe, beforeEach, afterEach } from "node:test";
import { resolveZulipAccount, listZulipAccountIds } from "../src/zulip/accounts.ts";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/core";

describe("resolveZulipAccount Precedence", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("resolves from environment variables for default account", () => {
    process.env.ZULIP_API_KEY = "env-api-key";
    process.env.ZULIP_EMAIL = "env-email@example.com";
    process.env.ZULIP_URL = "https://env.zulipchat.com";

    const resolved = resolveZulipAccount({
      cfg: { channels: { zulip: { enabled: true } } } as any,
      accountId: DEFAULT_ACCOUNT_ID,
    });

    assert.strictEqual(resolved.apiKey, "env-api-key");
    assert.strictEqual(resolved.email, "env-email@example.com");
    assert.strictEqual(resolved.baseUrl, "https://env.zulipchat.com");
    assert.strictEqual(resolved.apiKeySource, "env");
    assert.strictEqual(resolved.emailSource, "env");
    assert.strictEqual(resolved.baseUrlSource, "env");
  });

  test("environment variables take precedence over config for default account", () => {
    process.env.ZULIP_API_KEY = "env-api-key";
    process.env.ZULIP_EMAIL = "env-email@example.com";
    process.env.ZULIP_URL = "https://env.zulipchat.com";

    const resolved = resolveZulipAccount({
      cfg: {
        channels: {
          zulip: {
            enabled: true,
            apiKey: "config-api-key",
            email: "config@example.com",
            url: "https://config.zulipchat.com"
          }
        }
      } as any,
      accountId: DEFAULT_ACCOUNT_ID,
    });

    // Should be env, not config
    assert.strictEqual(resolved.apiKey, "env-api-key");
    assert.strictEqual(resolved.email, "env-email@example.com");
    assert.strictEqual(resolved.baseUrl, "https://env.zulipchat.com");
    assert.strictEqual(resolved.apiKeySource, "env");
    assert.strictEqual(resolved.emailSource, "env");
    assert.strictEqual(resolved.baseUrlSource, "env");
  });

  test("does not use environment variables for non-default accounts", () => {
    process.env.ZULIP_API_KEY = "env-api-key";

    const resolved = resolveZulipAccount({
      cfg: {
        channels: {
          zulip: {
            enabled: true,
            accounts: {
              "other": {
                enabled: true,
                apiKey: "other-config-api-key",
                email: "other@example.com",
                url: "https://other.zulipchat.com"
              }
            }
          }
        }
      } as any,
      accountId: "other",
    });

    assert.strictEqual(resolved.apiKey, "other-config-api-key");
    assert.strictEqual(resolved.apiKeySource, "config");
  });
});

describe("listZulipAccountIds", () => {
  test("returns [DEFAULT_ACCOUNT_ID] when no zulip configuration is present", () => {
    const ids = listZulipAccountIds({} as any);
    assert.deepStrictEqual(ids, [DEFAULT_ACCOUNT_ID]);
  });

  test("returns [DEFAULT_ACCOUNT_ID] when accounts object is empty", () => {
    const ids = listZulipAccountIds({
      channels: { zulip: { accounts: {} } }
    } as any);
    assert.deepStrictEqual(ids, [DEFAULT_ACCOUNT_ID]);
  });

  test("returns [DEFAULT_ACCOUNT_ID] when accounts property is invalid", () => {
    const ids = listZulipAccountIds({
      channels: { zulip: { accounts: null } }
    } as any);
    assert.deepStrictEqual(ids, [DEFAULT_ACCOUNT_ID]);
  });

  test("returns sorted account IDs when accounts are configured", () => {
    const ids = listZulipAccountIds({
      channels: {
        zulip: {
          accounts: {
            "z-account": {},
            "a-account": {},
            "m-account": {},
            "": {} // Should be filtered out by filter(Boolean)
          }
        }
      }
    } as any);

    assert.deepStrictEqual(ids, ["a-account", "m-account", "z-account"]);
  });
});
