#!/usr/bin/env node
/**
 * Tier 2 test runner.
 *
 * Creates a throwaway workspace with a real pinned OpenClaw host installed,
 * copies the built artifacts and test files, starts a fake Zulip server
 * implicitly (each test starts its own), and runs the behaviour tests.
 *
 * Why a workspace? The test files import from `../dist/src/zulip/client.js`,
 * which in turn imports `openclaw/plugin-sdk/*`. Those subpaths only resolve
 * when openclaw is present in node_modules — which the repo intentionally does
 * NOT ship (the host provides them at runtime). The workspace installs the host.
 */

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));

const versions = process.env.TIER2_OPENCLAW_VERSION
  ? [process.env.TIER2_OPENCLAW_VERSION]
  : [pkg.openclaw?.build?.openclawVersion ?? "latest"];

const keep = process.argv.includes("--keep");

function npm(args, cwd) {
  return execFileSync("npm", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, npm_config_update_notifier: "false" },
  });
}

let anyFailed = false;

for (const version of versions) {
  const dir = mkdtempSync(join(tmpdir(), `zulip-tier2-${version}-`));
  console.log(`\n[Tier 2] openclaw@${version}  workspace: ${dir}`);

  try {
    // copy artifacts + tests
    for (const entry of ["dist", "dist-cjs", "package.json", "openclaw.plugin.json"]) {
      const src = join(rootDir, entry);
      if (!existsSync(src)) throw new Error(`missing ${entry} — run \`npm run build\` first`);
      cpSync(src, join(dir, entry), { recursive: true });
    }
    cpSync(join(rootDir, "test", "tier2"), join(dir, "test", "tier2"), { recursive: true });

    // install plugin deps (zod) + pinned host
    npm(["install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], dir);
    npm(
      ["install", "--no-save", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error", `openclaw@${version}`],
      dir,
    );

    const installed = JSON.parse(
      readFileSync(join(dir, "node_modules/openclaw/package.json"), "utf8"),
    ).version;
    console.log(`  host resolved: openclaw@${installed}`);

    // run tests with the tier2 loader (remaps .js→.ts for intra-test imports)
    execFileSync(
      "node",
      ["--test", "--experimental-strip-types", "--loader", "./test/tier2/tier2-loader.js", "test/tier2/tier2-outbound.test.ts"],
      { cwd: dir, stdio: "inherit", timeout: 30_000 },
    );
    console.log(`  ${version}: PASS`);
  } catch (err) {
    anyFailed = true;
    console.error(`  ${version}: FAIL`);
  } finally {
    if (!keep) rmSync(dir, { recursive: true, force: true });
    else console.log(`  kept: ${dir}`);
  }
}

if (anyFailed) {
  console.error("\n[Tier 2] one or more versions failed.");
  process.exit(1);
}
console.log("\n[Tier 2] all versions passed.");
