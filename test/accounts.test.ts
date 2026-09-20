import assert from "node:assert";
import { test, describe, beforeEach, afterEach } from "node:test";
import { resolveZulipAccount } from "../src/zulip/accounts.ts";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/channel-core";

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

describe("allowInsecureHttp resolution", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("defaults to false and rejects a plain http URL", () => {
    const resolved = resolveZulipAccount({
      cfg: { channels: { zulip: { url: "http://zulip.lan" } } } as any,
      accountId: DEFAULT_ACCOUNT_ID,
    });
    assert.strictEqual(resolved.allowInsecureHttp, false);
    assert.strictEqual(resolved.baseUrl, undefined);
  });

  test("config opt-in allows a plain http URL", () => {
    const resolved = resolveZulipAccount({
      cfg: {
        channels: { zulip: { url: "http://zulip.lan", allowInsecureHttp: true } },
      } as any,
      accountId: DEFAULT_ACCOUNT_ID,
    });
    assert.strictEqual(resolved.allowInsecureHttp, true);
    assert.strictEqual(resolved.baseUrl, "http://zulip.lan");
  });

  test("env opt-in applies to the default account", () => {
    process.env.ZULIP_URL = "http://zulip.lan";
    process.env.ZULIP_ALLOW_INSECURE_HTTP = "1";
    const resolved = resolveZulipAccount({
      cfg: { channels: { zulip: {} } } as any,
      accountId: DEFAULT_ACCOUNT_ID,
    });
    assert.strictEqual(resolved.allowInsecureHttp, true);
    assert.strictEqual(resolved.baseUrl, "http://zulip.lan");
  });

  test("per-account opt-in allows a private LAN host", () => {
    const resolved = resolveZulipAccount({
      cfg: {
        channels: {
          zulip: {
            accounts: {
              work: { url: "https://192.168.1.10", allowInsecureHttp: true },
            },
          },
        },
      } as any,
      accountId: "work",
    });
    assert.strictEqual(resolved.allowInsecureHttp, true);
    assert.strictEqual(resolved.baseUrl, "https://192.168.1.10");
  });

  test("env is not consulted for non-default accounts", () => {
    process.env.ZULIP_ALLOW_INSECURE_HTTP = "1";
    const resolved = resolveZulipAccount({
      cfg: {
        channels: { zulip: { accounts: { work: { url: "http://zulip.lan" } } } },
      } as any,
      accountId: "work",
    });
    assert.strictEqual(resolved.allowInsecureHttp, false);
    assert.strictEqual(resolved.baseUrl, undefined);
  });
});
