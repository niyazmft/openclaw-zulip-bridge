import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zulipPlugin } from "../src/channel.ts";

// `security.resolveDmPolicy` is the DM policy the HOST reads to decide whether
// DMs are gated; `src/zulip/monitor.ts` is what actually enforces it. Those two
// defaults disagreed — the plugin reported `"open"` to the host while the
// monitor required `"pairing"` — so a host-visible surface advertised that
// anyone could DM the bot while the plugin dropped every unpaired sender.
//
// Found during the docs audit: the README followed the monitor (the real gate),
// which is what exposed the mismatch. Guard both halves of it here.

const __dirname = pathResolve(fileURLToPath(import.meta.url), "..");

const resolve = (config: Record<string, unknown>, accountId = "default") =>
  (zulipPlugin as any).security.resolveDmPolicy({
    cfg: { channels: { zulip: { accounts: { [accountId]: config } } } },
    accountId,
    account: { accountId, config },
  });

test("the reported DM policy defaults to pairing, matching the enforced gate", () => {
  assert.equal(resolve({}).policy, "pairing");
});

test("an explicitly configured dmPolicy is reported unchanged", () => {
  for (const policy of ["pairing", "allowlist", "open", "disabled"]) {
    assert.equal(resolve({ dmPolicy: policy }).policy, policy);
  }
});

test("the policy path points at the account section when accounts are configured", () => {
  assert.equal(resolve({}).policyPath, "channels.zulip.accounts.default.dmPolicy");
});

test("the reported default stays equal to the default the monitor enforces", () => {
  const monitor = readFileSync(pathResolve(__dirname, "../src/zulip/monitor.ts"), "utf8");
  const enforced = /const dmPolicy = [^;]*?\?\?\s*"([a-z]+)"/.exec(monitor)?.[1];
  assert.equal(enforced, "pairing", "monitor.ts no longer defaults dmPolicy to pairing");
  // If either default changes, change both — the host acts on one and the
  // plugin enforces the other, so a drift here is a silent security-surface bug.
  assert.equal(resolve({}).policy, enforced);
});
