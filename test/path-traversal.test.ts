import { test, describe } from "node:test";
import assert from "node:assert";
import { downloadZulipUpload } from "../src/zulip/uploads.js";

describe("Zulip Upload Path Traversal", () => {
  test("downloadZulipUpload should sanitize filenames from Content-Disposition", async (t) => {
    const mockUrl = "https://zulip.example.com/user_uploads/1/abc/test.png";
    const mockBaseUrl = "https://zulip.example.com";

    const originalFetch = global.fetch;
    // @ts-ignore
    global.fetch = async () => ({
      ok: true,
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === "content-type") return "image/png";
          if (name.toLowerCase() === "content-disposition") return 'attachment; filename="../../../../etc/passwd"';
          return null;
        }
      },
      arrayBuffer: async () => new ArrayBuffer(8)
    } as any);

    try {
      const result = await downloadZulipUpload(mockUrl, mockBaseUrl, "auth", 1024);
      assert.strictEqual(result.filename, "passwd", "Filename from Content-Disposition should be sanitized to basename");
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("downloadZulipUpload should handle URL-based filenames correctly", async (t) => {
    // This URL is already "resolved" by the URL constructor in JS,
    // but we want to ensure the final filename extracted is just the basename.
    const mockUrl = "https://zulip.example.com/user_uploads/1/abc/test.png";
    const mockBaseUrl = "https://zulip.example.com";

    const originalFetch = global.fetch;
    // @ts-ignore
    global.fetch = async () => ({
      ok: true,
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === "content-type") return "image/png";
          return null;
        }
      },
      arrayBuffer: async () => new ArrayBuffer(8)
    } as any);

    try {
      const result = await downloadZulipUpload(mockUrl, mockBaseUrl, "auth", 1024);
      assert.strictEqual(result.filename, "test.png", "Filename from URL should be the basename");
    } finally {
      global.fetch = originalFetch;
    }
  });
});
