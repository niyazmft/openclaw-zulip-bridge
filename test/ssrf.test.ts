import { test, describe } from "node:test";
import assert from "node:assert";
import { isInternalHost, normalizeZulipBaseUrl } from "../src/zulip/client.ts";

describe("SSRF protection", () => {
  test("normalizeZulipBaseUrl rejects localhost", () => {
    assert.strictEqual(normalizeZulipBaseUrl("http://localhost/api"), undefined);
    assert.strictEqual(normalizeZulipBaseUrl("https://localhost:8080"), undefined);
  });

  test("normalizeZulipBaseUrl rejects 127.0.0.1", () => {
    assert.strictEqual(normalizeZulipBaseUrl("http://127.0.0.1"), undefined);
    assert.strictEqual(normalizeZulipBaseUrl("https://127.0.0.1:3000/zulip"), undefined);
  });

  test("normalizeZulipBaseUrl rejects ::1", () => {
    assert.strictEqual(normalizeZulipBaseUrl("http://[::1]"), undefined);
  });

  test("normalizeZulipBaseUrl rejects 0.0.0.0", () => {
    assert.strictEqual(normalizeZulipBaseUrl("http://0.0.0.0"), undefined);
  });

  test("normalizeZulipBaseUrl rejects AWS metadata endpoint", () => {
    assert.strictEqual(normalizeZulipBaseUrl("http://169.254.169.254"), undefined);
    assert.strictEqual(normalizeZulipBaseUrl("https://169.254.169.254/latest/meta-data/"), undefined);
  });

  test("normalizeZulipBaseUrl rejects 10.x.x.x", () => {
    assert.strictEqual(normalizeZulipBaseUrl("http://10.0.0.1"), undefined);
    assert.strictEqual(normalizeZulipBaseUrl("https://10.255.255.255"), undefined);
  });

  test("normalizeZulipBaseUrl rejects 192.168.x.x", () => {
    assert.strictEqual(normalizeZulipBaseUrl("http://192.168.1.1"), undefined);
    assert.strictEqual(normalizeZulipBaseUrl("https://192.168.0.100"), undefined);
  });

  test("normalizeZulipBaseUrl rejects 172.16-31.x.x", () => {
    assert.strictEqual(normalizeZulipBaseUrl("http://172.16.0.1"), undefined);
    assert.strictEqual(normalizeZulipBaseUrl("https://172.31.255.255"), undefined);
    assert.strictEqual(normalizeZulipBaseUrl("http://172.20.0.1"), undefined);
  });

  test("normalizeZulipBaseUrl allows 172.15.x.x (outside private range)", () => {
    assert.strictEqual(normalizeZulipBaseUrl("http://172.15.0.1"), "http://172.15.0.1");
    assert.strictEqual(normalizeZulipBaseUrl("https://172.32.0.1"), "https://172.32.0.1");
  });

  test("normalizeZulipBaseUrl allows public hosts", () => {
    assert.strictEqual(normalizeZulipBaseUrl("https://chat.example.com"), "https://chat.example.com");
    assert.strictEqual(normalizeZulipBaseUrl("https://zulip.example.com/"), "https://zulip.example.com");
    assert.strictEqual(normalizeZulipBaseUrl("http://myserver.localdomain"), "http://myserver.localdomain");
  });

  test("isInternalHost rejects internal IPs", () => {
    assert.strictEqual(isInternalHost("http://localhost"), true);
    assert.strictEqual(isInternalHost("https://127.0.0.1"), true);
    assert.strictEqual(isInternalHost("http://10.0.0.1"), true);
    assert.strictEqual(isInternalHost("https://192.168.1.1"), true);
    assert.strictEqual(isInternalHost("http://172.16.0.1"), true);
    assert.strictEqual(isInternalHost("http://169.254.169.254"), true);
  });

  test("isInternalHost allows public hosts", () => {
    assert.strictEqual(isInternalHost("https://chat.example.com"), false);
    assert.strictEqual(isInternalHost("https://zulip.org"), false);
    assert.strictEqual(isInternalHost("http://8.8.8.8"), false);
  });

  test("normalizeZulipBaseUrl still rejects non-http protocols", () => {
    assert.strictEqual(normalizeZulipBaseUrl("ftp://example.com"), undefined);
    assert.strictEqual(normalizeZulipBaseUrl("file:///etc/passwd"), undefined);
    assert.strictEqual(normalizeZulipBaseUrl("javascript://alert(1)"), undefined);
  });
});
