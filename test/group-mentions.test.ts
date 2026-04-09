import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveZulipGroupRequireMention } from "../src/group-mentions.ts";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/core";

describe("resolveZulipGroupRequireMention", () => {
  test("returns requireMention when explicitly true", () => {
    const params: any = {
      cfg: { channels: { zulip: { enabled: true, requireMention: true } } },
      accountId: DEFAULT_ACCOUNT_ID,
    };
    assert.strictEqual(resolveZulipGroupRequireMention(params), true);
  });

  test("returns requireMention when explicitly false", () => {
    const params: any = {
      cfg: { channels: { zulip: { enabled: true, requireMention: false } } },
      accountId: DEFAULT_ACCOUNT_ID,
    };
    assert.strictEqual(resolveZulipGroupRequireMention(params), false);
  });

  test("returns true for chatmode 'oncall' if requireMention not explicit", () => {
    const params: any = {
      cfg: { channels: { zulip: { enabled: true, chatmode: "oncall" } } },
      accountId: DEFAULT_ACCOUNT_ID,
    };
    assert.strictEqual(resolveZulipGroupRequireMention(params), true);
  });

  test("returns false for chatmode 'onmessage' if requireMention not explicit", () => {
    const params: any = {
      cfg: { channels: { zulip: { enabled: true, chatmode: "onmessage" } } },
      accountId: DEFAULT_ACCOUNT_ID,
    };
    assert.strictEqual(resolveZulipGroupRequireMention(params), false);
  });

  test("returns true for chatmode 'onchar' if requireMention not explicit", () => {
    const params: any = {
      cfg: { channels: { zulip: { enabled: true, chatmode: "onchar" } } },
      accountId: DEFAULT_ACCOUNT_ID,
    };
    assert.strictEqual(resolveZulipGroupRequireMention(params), true);
  });

  test("returns undefined if neither requireMention nor chatmode are provided", () => {
    const params: any = {
      cfg: { channels: { zulip: { enabled: true } } },
      accountId: DEFAULT_ACCOUNT_ID,
    };
    assert.strictEqual(resolveZulipGroupRequireMention(params), undefined);
  });
});
