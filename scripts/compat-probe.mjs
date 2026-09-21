/**
 * In-workspace probe for `scripts/check-compat.js` (Tier 1 host-compatibility).
 *
 * This file is COPIED into a throwaway workspace that contains:
 *   - the plugin's built artifacts (dist/, dist-cjs/)
 *   - the plugin's own staged dependencies (`zod`, mirroring a real host install)
 *   - one pinned `openclaw` host version in node_modules
 *
 * Because it runs inside that workspace, bare specifiers (`zod`) and
 * `openclaw/plugin-sdk/*` resolve against the PINNED host — which is exactly what
 * the repo's own smoke test cannot do (its loader collapses every SDK subpath into
 * one permissive stub that exports everything as a no-op).
 *
 * Modes are run as separate processes so module-graph state from one check can
 * never mask or corrupt another.
 *
 * Usage: node compat-probe.mjs <esm|cjs|register>
 */

const mode = process.argv[2];
const out = (obj) => console.log(JSON.stringify(obj));

function fail(msg, extra = {}) {
  out({ ok: false, error: msg, ...extra });
  process.exit(1);
}

async function main() {
  if (mode === "esm") {
    // Node's own ESM linker is the oracle: a subpath that is not exported, or a
    // named import the host does not provide, throws here.
    const mod = await import("./dist/index.js");
    if (!mod.default) fail("dist/index.js has no default export");
    out({ ok: true, mode, defaultKeys: Object.keys(mod.default) });
    return;
  }

  if (mode === "cjs") {
    // The CJS runtime entry is what `openclaw.runtimeExtensions` loads on CJS
    // Gateway hosts. `require()` interop is LENIENT, so a missing named export
    // arrives as `undefined` instead of throwing — hence the separate symbol check.
    const { createRequire } = await import("node:module");
    const req = createRequire(new URL("./anchor.cjs", import.meta.url));
    const mod = req("./dist-cjs/index.cjs");
    out({ ok: true, mode, keys: Object.keys(mod) });
    return;
  }

  if (mode === "register") {
    const mod = await import("./dist/index.js");
    const entry = mod.default;

    if (typeof entry.register !== "function") {
      fail("entry.register is not a function; got: " + typeof entry.register);
    }

    const calls = { registerChannel: [], registerCli: [] };
    const noop = () => {};
    const stubApi = {
      registrationMode: "full",
      registerChannel: (arg) => calls.registerChannel.push(arg),
      registerCli: (fn, opts) => calls.registerCli.push({ fn, opts }),
      logger: { info: noop, error: noop, warn: noop, debug: noop },
      runtime: {},
    };

    entry.register(stubApi);

    if (calls.registerChannel.length !== 1) {
      fail(
        `registerChannel called ${calls.registerChannel.length} time(s), expected exactly 1 ` +
        `(the SDK wrapper auto-registers; duplicate registration in registerFull? see index.ts)`,
      );
    }

    const plugin = calls.registerChannel[0]?.plugin;
    if (!plugin) fail("registerChannel was not given { plugin }");

    // `createChatChannelPlugin` flattens `base` into the plugin object, so
    // `gateway` is directly on the registered plugin — not nested under `.base`.
    if (typeof plugin.gateway?.startAccount !== "function") {
      fail("gateway.startAccount is not a function on the registered plugin", {
        shape: Object.keys(plugin).slice(0, 40),
        hasGateway: Boolean(plugin.gateway),
      });
    }

    // Behavioural guard: callbacks imported from a subpath that does not export
    // them are `undefined`, and only blow up when the HOST invokes them.
    const cfg = plugin.config ?? {};
    const invoked = [];
    const cfgStub = { channels: { zulip: { accounts: { default: {} } } } };

    for (const [name, args] of [
      ["setAccountEnabled", { cfg: cfgStub, accountId: "default", enabled: false }],
      ["deleteAccount", { cfg: cfgStub, accountId: "default" }],
    ]) {
      const fn = cfg[name];
      if (typeof fn !== "function") {
        fail(`config.${name} is not a function on the registered plugin`, {
          configKeys: Object.keys(cfg).slice(0, 40),
        });
      }
      try {
        fn(args);
        invoked.push(name);
      } catch (err) {
        fail(`config.${name} threw: ${err?.message}`, { name: err?.name });
      }
    }

    out({
      ok: true,
      mode,
      gatewayStartAccount: true,
      configCallbacks: invoked,
      configSchema: Boolean(plugin.configSchema),
      registerChannelCount: calls.registerChannel.length,
    });
    return;
  }

  fail(`unknown mode: ${String(mode)}`);
}

main().catch((err) => {
  fail(`${err?.name ?? "Error"}: ${err?.message}`, { stack: String(err?.stack).split("\n")[1]?.trim() });
});
