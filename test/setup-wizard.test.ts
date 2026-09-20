import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { zulipSetupAdapter, zulipSetupWizard } from "../src/setup-surface.ts";

// `openclaw channels add` is the first place an operator meets the HTTPS rule,
// so these tests pin the exact message that tells them how to opt out. A plain
// `http://` URL must never fail with a generic "invalid URL".

type WizardField = {
  inputKey?: string;
  validate?: (ctx: unknown) => string | undefined | null;
};

function httpUrlValidate(): (ctx: unknown) => string | undefined | null {
  const fields =
    (zulipSetupWizard as unknown as { textInputs?: WizardField[] }).textInputs ?? [];
  const field = fields.find((candidate) => candidate.inputKey === "httpUrl");
  assert.ok(field, "setup wizard must define an httpUrl text input");
  assert.equal(typeof field.validate, "function", "httpUrl must define validate()");
  return field.validate as (ctx: unknown) => string | undefined | null;
}

const optedInCfg = {
  channels: { zulip: { url: "http://zulip.lan", allowInsecureHttp: true } },
} as never;

describe("setup wizard: httpUrl validation names the opt-in", () => {
  test("rejects plain http and names allowInsecureHttp", () => {
    const message = httpUrlValidate()({ value: "http://zulip.lan" });
    assert.ok(message, "plain http must be rejected by the wizard");
    assert.match(String(message), /allowInsecureHttp/);
    assert.match(String(message), /unencrypted/);
  });

  test("rejects a private/internal host and names allowInsecureHttp", () => {
    const message = httpUrlValidate()({ value: "https://192.168.1.10" });
    assert.ok(message, "a private LAN host must be rejected by default");
    assert.match(String(message), /allowInsecureHttp/);
  });

  test("accepts a public https host", () => {
    assert.equal(httpUrlValidate()({ value: "https://chat.example.com" }), undefined);
  });

  test("accepts plain http once the operator has opted in", () => {
    assert.equal(
      httpUrlValidate()({ value: "http://zulip.lan", cfg: optedInCfg, accountId: "default" }),
      undefined,
    );
    assert.equal(
      httpUrlValidate()({ value: "http://192.168.1.10", cfg: optedInCfg, accountId: "default" }),
      undefined,
    );
  });

  test("still requires a value", () => {
    assert.match(String(httpUrlValidate()({ value: "   " })), /required/);
  });

  test("still rejects non-http protocols", () => {
    const message = httpUrlValidate()({ value: "ftp://example.com" });
    assert.ok(message);
    assert.match(String(message), /http:\/\/ or https:\/\//);
  });
});

describe("setup adapter: httpUrl validation names the opt-in", () => {
  function adapterValidate(): (ctx: unknown) => unknown {
    const validateInput = (zulipSetupAdapter as unknown as {
      validateInput?: (ctx: unknown) => unknown;
    }).validateInput;
    assert.equal(typeof validateInput, "function", "setup adapter must expose validateInput");
    return validateInput as (ctx: unknown) => unknown;
  }

  test("rejects plain http with the opt-in instruction", () => {
    const message = adapterValidate()({ input: { httpUrl: "http://zulip.lan" } });
    assert.ok(message, "plain http must be rejected by the adapter");
    assert.match(String(message), /allowInsecureHttp/);
  });

  test("rejects a private host with the opt-in instruction", () => {
    const message = adapterValidate()({ input: { httpUrl: "https://10.0.0.5" } });
    assert.ok(message);
    assert.match(String(message), /allowInsecureHttp/);
  });

  test("accepts a public https host", () => {
    const result = adapterValidate()({ input: { httpUrl: "https://chat.example.com" } });
    assert.ok(!result || result === true, `expected success, got ${String(result)}`);
  });

  test("still rejects non-http protocols", () => {
    const message = adapterValidate()({ input: { httpUrl: "ftp://example.com" } });
    assert.ok(message);
    assert.match(String(message), /http:\/\/ or https:\/\//);
  });
});
