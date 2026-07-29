#!/usr/bin/env node
/**
 * Builds a CommonJS bundle from the already-compiled ESM `dist/` artifacts.
 *
 * This is required for OpenClaw hosts running on Node.js 24 / Termux, where a
 * Node.js core ESM/CJS loader race condition (nodejs/node#62432) can cause
 * `ERR_REQUIRE_ESM_RACE_CONDITION` when the host `require()`s the plugin while
 * dynamic `import()`s resolve the same ESM SDK modules. A CJS entry point lets
 * CJS hosts load the plugin without hitting the ESM translator race path.
 *
 * Host-provided modules are kept external so the plugin still relies on the
 * OpenClaw host for runtime SDK and zod.
 */
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = dirname(dirname(new URL(import.meta.url).pathname));
const outdir = join(root, "dist-cjs");

/**
 * Injects a synchronous retry wrapper around require() calls to openclaw/* modules.
 *
 * Node.js 22.18+ / 24.x can throw ERR_REQUIRE_ESM_RACE_CONDITION when require()
 * and import() resolve the same ESM module concurrently. The race is transient:
 * the module is "not yet fully loaded" for only a few milliseconds. A bounded
 * synchronous retry with a short spin-loop allows the concurrent loader to finish.
 *
 * This is intentionally limited to openclaw/* modules to avoid affecting any other
 * dependencies. It is a workaround for nodejs/node#62432 and should be removed
 * once upstream resolves the race.
 *
 * See: https://github.com/niyazmft/openclaw-zulip-bridge/issues/231
 */
function injectRequireRetryWrapper(cjsSource) {
  const retryHelper = `function __requireWithRetry(id) {
  if (typeof require === "undefined") throw new Error('Dynamic require of "' + id + '" is not supported');
  if (typeof id !== "string" || !id.startsWith("openclaw/")) return require(id);
  const MAX_RETRIES = 5;
  const DELAY_MS = 20;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      return require(id);
    } catch (err) {
      if (err && err.code === "ERR_REQUIRE_ESM_RACE_CONDITION" && i < MAX_RETRIES - 1) {
        const start = Date.now();
        while (Date.now() - start < DELAY_MS) {}
        continue;
      }
      throw err;
    }
  }
}
`;
  // Replace all require("openclaw/...") with __requireWithRetry("openclaw/...")
  const patched = cjsSource.replace(
    /require\("openclaw\//g,
    '__requireWithRetry("openclaw/'
  );
  // Prepend the helper so it is available before any module code runs
  return retryHelper + patched;
}

async function buildCjs(entry, out) {
  await build({
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    external: ["openclaw/*"],
    sourcemap: true,
    logLevel: "info",
    entryPoints: [entry],
    outfile: out,
  });

  const raw = readFileSync(out, "utf-8");
  const wrapped = injectRequireRetryWrapper(raw);
  writeFileSync(out, wrapped, "utf-8");
  console.log(`Injected retry wrapper into: ${out}`);
}

await mkdir(outdir, { recursive: true });

await Promise.all([
  buildCjs(join(root, "dist", "index.js"), join(outdir, "index.cjs")),
  buildCjs(join(root, "dist", "setup-entry.js"), join(outdir, "setup-entry.cjs")),
]);

console.log("CJS build complete:", outdir);
