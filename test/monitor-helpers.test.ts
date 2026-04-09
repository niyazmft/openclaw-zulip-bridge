import test from "node:test";
import assert from "node:assert/strict";
import { extractShortModelName } from "../src/zulip/monitor-helpers.js";

test("extractShortModelName", async (t) => {
  await t.test("extracts model name without provider", () => {
    assert.equal(extractShortModelName("openai/gpt-4o"), "gpt-4o");
    assert.equal(extractShortModelName("anthropic/claude-3-opus"), "claude-3-opus");
  });

  await t.test("returns the same name if no provider is present", () => {
    assert.equal(extractShortModelName("gpt-4o"), "gpt-4o");
  });

  await t.test("handles multiple slashes by taking the last part", () => {
    assert.equal(extractShortModelName("provider/namespace/model-name"), "model-name");
  });

  await t.test("removes -latest suffix", () => {
    assert.equal(extractShortModelName("provider/model-latest"), "model");
    assert.equal(extractShortModelName("model-latest"), "model");
  });

  await t.test("removes -YYYYMMDD date suffix", () => {
    assert.equal(extractShortModelName("provider/model-20230101"), "model");
    assert.equal(extractShortModelName("model-20231231"), "model");
    assert.equal(extractShortModelName("gpt-4-0613"), "gpt-4-0613"); // Not 8 digits
  });

  await t.test("handles empty string", () => {
    assert.equal(extractShortModelName(""), "");
  });

  await t.test("leaves non-matching numbers alone", () => {
    assert.equal(extractShortModelName("claude-3-5-sonnet"), "claude-3-5-sonnet");
    assert.equal(extractShortModelName("provider/gpt-4o-123"), "gpt-4o-123");
  });
});
