import test from "node:test";
import assert from "node:assert/strict";

// The local-file rejection behavior moved into uploadZulipFile's path
// allowlist (see test/upload-file.test.ts). The pre-#268 behavior of
// silently dropping ALL non-HTTP mediaUrl values no longer holds: local
// paths under the plugin data dir / tmpdir are now uploaded (#268), while
// paths outside the sandbox are still refused and dropped.
//
// The end-to-end rejection flow (sendMessageZulip with /etc/passwd) is
// covered by the uploadZulipFile allowlist tests plus the send.ts source
// regression test in test/upload-file.test.ts.

test("local mediaUrl policy moved to uploadZulipFile allowlist (#268)", async () => {
  const src = await import("node:fs/promises");
  const source = await src.readFile(
    new URL("../src/zulip/send.ts", import.meta.url),
    "utf8",
  );
  // The silent drop must NOT come back.
  assert.equal(source.includes("rejected non-http mediaUrl"), false);
  // Local paths go through the sandboxed uploader.
  assert.equal(source.includes("uploadZulipFile(client, localPath)"), true);
});