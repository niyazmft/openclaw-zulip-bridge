import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

// Regression guard for issue #265:
// `formatPairingApproveHint` is exported from `openclaw/plugin-sdk/core`
// (and `channel-plugin-common`), but NOT from `openclaw/plugin-sdk/channel-core`.
// Importing it from `channel-core` resolves to `undefined` at runtime and
// crashes `openclaw doctor --fix` with
// "TypeError: (0, import_channel_core.formatPairingApproveHint) is not a function".
//
// This test statically checks the source so a future SDK migration cannot
// silently reintroduce the wrong import path (the local SDK shim fabricates
// the export, so runtime-style tests would not catch it).

const __dirname = pathResolve(fileURLToPath(import.meta.url), "..");
const channelSource = readFileSync(pathResolve(__dirname, "../src/channel.ts"), "utf8");

test("formatPairingApproveHint is imported from openclaw/plugin-sdk/core, not channel-core", () => {
  // The symbol must be imported from the `core` subpath.
  assert.match(
    channelSource,
    /formatPairingApproveHint[^}]*} from "openclaw\/plugin-sdk\/core"/,
    "formatPairingApproveHint should be imported from openclaw/plugin-sdk/core",
  );
  // And it must NOT be imported from channel-core.
  assert.doesNotMatch(
    channelSource,
    /formatPairingApproveHint[\s\S]*?} from "openclaw\/plugin-sdk\/channel-core"/,
    "formatPairingApproveHint must not be imported from openclaw/plugin-sdk/channel-core",
  );
});

test("channel-core import block contains only host-exported symbols", () => {
  // Symbols the host's channel-core actually exports (verified on 2026.7.1 / 2026.7.1-2).
  const hostExports = [
    "createChatChannelPlugin",
    "deleteAccountFromConfigSection",
    "setAccountEnabledInConfigSection",
  ];
  // formatPairingApproveHint must not appear inside the channel-core import block.
  const channelCoreBlock = channelSource.match(
    /import \{([\s\S]*?)\} from "openclaw\/plugin-sdk\/channel-core"/,
  );
  assert.ok(channelCoreBlock, "expected a channel-core import block in src/channel.ts");
  const importedSymbols = channelCoreBlock[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("type "));
  assert.ok(importedSymbols.length > 0, "expected at least one value import from channel-core");
  for (const symbol of importedSymbols) {
    assert.ok(
      hostExports.includes(symbol),
      `channel-core import ${symbol} is not exported by the host SDK`,
    );
  }
  assert.ok(
    !channelCoreBlock[1].includes("formatPairingApproveHint"),
    "channel-core import block must not contain formatPairingApproveHint",
  );
});
