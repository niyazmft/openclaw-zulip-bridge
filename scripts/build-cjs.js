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
import { dirname, join } from "node:path";

const root = dirname(dirname(new URL(import.meta.url).pathname));
const outdir = join(root, "dist-cjs");

await mkdir(outdir, { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  external: ["openclaw/*"],
  sourcemap: true,
  logLevel: "info",
};

await Promise.all([
  build({
    ...common,
    entryPoints: [join(root, "dist", "index.js")],
    outfile: join(outdir, "index.cjs"),
  }),
  build({
    ...common,
    entryPoints: [join(root, "dist", "setup-entry.js")],
    outfile: join(outdir, "setup-entry.cjs"),
  }),
]);

console.log("CJS build complete:", outdir);
