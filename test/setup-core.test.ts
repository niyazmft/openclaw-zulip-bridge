import assert from "node:assert";
import { test, describe } from "node:test";
import { isZulipConfigured } from "../src/setup-core.ts";
import type { ResolvedZulipAccount } from "../src/zulip/accounts.ts";

describe("isZulipConfigured", () => {
  const createMockAccount = (overrides: Partial<ResolvedZulipAccount> = {}): ResolvedZulipAccount => ({
    accountId: "default",
    enabled: true,
    apiKeySource: "config",
    emailSource: "config",
    baseUrlSource: "config",
    config: {},
    ...overrides,
  });

  test("returns true when apiKey, email, and baseUrl are present and non-empty", () => {
    const account = createMockAccount({
      apiKey: "secret-key",
      email: "bot@example.com",
      baseUrl: "https://zulip.example.com",
    });
    assert.strictEqual(isZulipConfigured(account), true);
  });

  test("returns false when apiKey is missing", () => {
    const account = createMockAccount({
      email: "bot@example.com",
      baseUrl: "https://zulip.example.com",
    });
    assert.strictEqual(isZulipConfigured(account), false);
  });

  test("returns false when apiKey is only whitespace", () => {
    const account = createMockAccount({
      apiKey: "   ",
      email: "bot@example.com",
      baseUrl: "https://zulip.example.com",
    });
    assert.strictEqual(isZulipConfigured(account), false);
  });

  test("returns false when email is missing", () => {
    const account = createMockAccount({
      apiKey: "secret-key",
      baseUrl: "https://zulip.example.com",
    });
    assert.strictEqual(isZulipConfigured(account), false);
  });

  test("returns false when email is only whitespace", () => {
    const account = createMockAccount({
      apiKey: "secret-key",
      email: " \t\n ",
      baseUrl: "https://zulip.example.com",
    });
    assert.strictEqual(isZulipConfigured(account), false);
  });

  test("returns false when baseUrl is missing", () => {
    const account = createMockAccount({
      apiKey: "secret-key",
      email: "bot@example.com",
    });
    assert.strictEqual(isZulipConfigured(account), false);
  });

  test("returns false when baseUrl is only whitespace", () => {
    const account = createMockAccount({
      apiKey: "secret-key",
      email: "bot@example.com",
      baseUrl: "   ",
    });
    assert.strictEqual(isZulipConfigured(account), false);
  });

  test("returns false when all required fields are missing", () => {
    const account = createMockAccount();
    assert.strictEqual(isZulipConfigured(account), false);
  });
});
