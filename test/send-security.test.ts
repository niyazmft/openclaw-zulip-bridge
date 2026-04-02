import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { sendMessageZulip } from "../src/zulip/send.js";
import { setZulipRuntime } from "../src/runtime.js";

test("sendMessageZulip should NOT allow local file paths in mediaUrl", async (t) => {
  let logCalled = false;
  let logMessage = "";

  // Mock runtime
  const mockRuntime = {
    config: {
      loadConfig: () => ({
        channels: {
          zulip: {
            accounts: {
              default: {
                url: "https://zulip.example.com",
                email: "bot@example.com",
                apiKey: "secret"
              }
            }
          }
        }
      })
    },
    log: (msg: string) => {
      if (msg.includes("security warning")) {
        logCalled = true;
        logMessage = msg;
      }
    },
    channel: {
      text: {
        resolveMarkdownTableMode: () => "none",
        convertMarkdownTables: (m: string) => m
      },
      activity: {
        record: () => {}
      }
    },
    agents: {
      defaults: {
        mediaMaxMb: 5
      }
    }
  };
  setZulipRuntime(mockRuntime as any);

  // Spy on fs.existsSync
  const existsSyncSpy = t.mock.method(fs, 'existsSync', (p: string) => {
    return true; // Pretend it exists
  });

  try {
    await sendMessageZulip("stream:general", "hello", {
      mediaUrl: "/etc/passwd",
      accountId: "default"
    });
  } catch (e: any) {
    // It might still fail because we haven't mocked sendZulipStreamMessage
  }

  // After the fix, existsSync should NOT be called.
  assert.strictEqual(existsSyncSpy.mock.callCount(), 0, "Should NOT have checked if local file exists");
  assert.strictEqual(logCalled, true, "Should have logged a security warning");
  assert.match(logMessage, /security warning: rejected non-http mediaUrl/);
});
