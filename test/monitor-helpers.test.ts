import { test, describe } from "node:test";
import * as assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { rawDataToString } from "../src/zulip/monitor-helpers.js";

describe("rawDataToString", () => {
  test("handles string", () => {
    assert.equal(rawDataToString("hello world"), "hello world");
  });

  test("handles Buffer", () => {
    assert.equal(rawDataToString(Buffer.from("hello world")), "hello world");
    assert.equal(rawDataToString(Buffer.from("hello world"), "base64"), Buffer.from("hello world").toString("base64"));
  });

  test("handles Array of Buffers", () => {
    assert.equal(
      rawDataToString([Buffer.from("hello "), Buffer.from("world")]),
      "hello world"
    );
  });

  test("handles ArrayBuffer", () => {
    const buffer = Buffer.from("hello world");
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    assert.equal(rawDataToString(arrayBuffer), "hello world");
  });

  test("handles fallback for arbitrary data", () => {
    assert.equal(rawDataToString(12345 as any), "12345");
    assert.equal(rawDataToString(true as any), "true");
  });
});
