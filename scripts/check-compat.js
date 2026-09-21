#!/usr/bin/env node
/**
 * Tier 1 host-compatibility check (`npm run check:compat`).
 *
 * Verifies that this plugin actually works against the OpenClaw host versions we
 * CLAIM to support — by loading it against a real, pinned host instead of the
 * permissive stub the smoke test uses.
 *
 * Why this exists: `test/smoke-loader.js` redirects EVERY `openclaw/plugin-sdk/*`
 * specifier to a single hand-written stub that exports everything as a no-op. A
 * subpath that does not exist on a real host, or a named export the host does not
 * provide, therefore cannot fail the smoke test — it registers as a silent
 * `undefined`. That is precisely how `deleteAccountFromConfigSection`,
 * `setAccountEnabledInConfigSection` and `applyAccountNameToChannelSection` came
 * to be imported from subpaths that have never exported them, breaking the ESM
 * entry outright on every host version.
 *
 * What it checks, per host version:
 *   1. the pinned version exists and is what actually got installed
 *   2. every runtime symbol the built plugin imports from the host is a real value
 *   3. the ESM entry imports (Node's own linker validates every named import)
 *   4. the CJS runtime entry loads (`openclaw.runtimeExtensions` path)
 *   5. the entry registers, exposes `gateway.startAccount`, and its
 *      `setAccountEnabled` / `deleteAccount` callbacks actually run
 *   6. manifest/package version sync
 *
 * It is deliberately NOT part of `npm run check`: it needs the network and a
 * ~390MB host install. It runs as its own CI job across a version matrix.
 *
 * Usage:
 *   node scripts/check-compat.js                    # floor + build version
 *   node scripts/check-compat.js 2026.7.1 2026.9.4  # explicit versions
 *   COMPAT_VERSIONS=2026.7.1,latest node scripts/check-compat.js
 *   node scripts/check-compat.js --keep             # keep temp workspaces
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));

const argv = process.argv.slice(2);
const keep = argv.includes("--keep");
const explicit = argv.filter((a) => !a.startsWith("--"));

/** ">=2026.7.0" -> "2026.7.0" */
function versionFromRange(range) {
  if (!range || typeof range !== "string") return undefined;
  const m = range.match(/\d+\.\d+\.\d+(?:-[\w.]+)?/);
  return m ? m[0] : undefined;
}

const floorVersion = versionFromRange(pkg.openclaw?.install?.minHostVersion);
const buildVersion = versionFromRange(pkg.openclaw?.build?.openclawVersion);

const versions = explicit.length
  ? explicit
  : process.env.COMPAT_VERSIONS
    ? process.env.COMPAT_VERSIONS.split(",").map((v) => v.trim()).filter(Boolean)
    : [floorVersion, buildVersion].filter(Boolean);

if (versions.length === 0) {
  console.error("check-compat: no host versions to test.");
  process.exit(1);
}

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

function walk(dir, filter, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, filter, acc);
    else if (filter(p)) acc.push(p);
  }
  return acc;
}

/**
 * Derive (subpath -> [names]) from the BUILT ESM output, not from source, so the
 * check tracks what actually ships. Type-only imports are erased in dist and so
 * never appear — which is correct: only real runtime bindings can be `undefined`.
 */
function collectRuntimeHostImports(distDir) {
  const map = new Map();
  for (const file of walk(distDir, (p) => p.endsWith(".js"))) {
    const src = readFileSync(file, "utf8");
    const re = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']openclaw\/plugin-sdk\/([a-z0-9-]+)["']/gs;
    for (const [, names, sub] of src.matchAll(re)) {
      const set = map.get(sub) ?? new Set();
      for (const raw of names.split(",")) {
        const n = raw.trim().replace(/^type\s+/, "").trim();
        if (n) set.add(n);
      }
      map.set(sub, set);
    }
  }
  return map;
}

function npm(args, cwd) {
  return execFileSync("npm", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, npm_config_update_notifier: "false" },
  });
}

function runNode(mode, cwd) {
  let raw;
  try {
    raw = execFileSync("node", ["./compat-probe.mjs", mode], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // The probe reports structured failures on stdout before exiting non-zero,
    // so prefer that over the opaque "Command failed" from execFileSync.
    const stdout = String(err.stdout ?? "");
    const stderr = String(err.stderr ?? "").trim();
    const line = stdout.trim().split("\n").filter(Boolean).pop();
    try {
      const parsed = JSON.parse(line);
      if (parsed?.error) return parsed;
    } catch {
      /* fall through to raw diagnostics */
    }
    return {
      ok: false,
      error: [err.message, stdout.trim(), stderr].filter(Boolean).join(" | ").slice(0, 500),
    };
  }
  const line = raw.trim().split("\n").filter(Boolean).pop();
  try {
    return JSON.parse(line);
  } catch {
    return { ok: false, error: `unparseable probe output: ${raw.slice(0, 300)}` };
  }
}

async function checkVersion(version) {
  const label = `openclaw@${version}`;
  const dir = mkdtempSync(join(tmpdir(), `zulip-compat-${version}-`));
  const result = { version, steps: [], failures: [] };

  const step = (name, fn, note) => {
    const value = fn();
    result.steps.push({ name, note: note ?? value });
    return value;
  };

  try {
    // --- workspace: built artifacts only, no source ---
    for (const entry of ["dist", "dist-cjs", "package.json", "openclaw.plugin.json"]) {
      const from = join(rootDir, entry);
      if (!existsSync(from)) {
        throw new Error(`missing build input: ${entry} (run \`npm run build\` first)`);
      }
      cpSync(from, join(dir, entry), { recursive: true });
    }
    cpSync(join(rootDir, "scripts/compat-probe.mjs"), join(dir, "compat-probe.mjs"));

    // --- plugin's own staged deps (a real host installs these; bare `zod` needs them) ---
    npm(["install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], dir);
    const zodVersion = existsSync(join(dir, "node_modules/zod/package.json"))
      ? JSON.parse(readFileSync(join(dir, "node_modules/zod/package.json"), "utf8")).version
      : null;
    step("plugin deps staged", () => (zodVersion ? `zod@${zodVersion}` : "none"));

    // --- pinned host ---
    try {
      npm(
        ["install", "--no-save", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error", `openclaw@${version}`],
        dir,
      );
    } catch (err) {
      const text = `${err.stderr ?? ""}${err.stdout ?? ""}`;
      if (/E404|No match found for version|ETARGET/i.test(text)) {
        throw new Error(
          `version ${version} does not exist on npm — a declared compatibility floor must name a published release`,
        );
      }
      throw err;
    }

    const installed = JSON.parse(
      readFileSync(join(dir, "node_modules/openclaw/package.json"), "utf8"),
    ).version;
    if (installed !== version) {
      throw new Error(`resolved ${installed}, expected exactly ${version} (refusing to test a different host)`);
    }
    step("host installed", () => `openclaw@${installed}`);

    // --- 2. runtime symbol presence (catches the CJS-lenient `undefined` case) ---
    const need = collectRuntimeHostImports(join(dir, "dist"));
    const req = createRequire(join(dir, "anchor.cjs"));
    const missing = [];
    let total = 0;
    for (const [sub, names] of need) {
      let mod;
      try {
        mod = req(`openclaw/plugin-sdk/${sub}`);
      } catch (err) {
        for (const n of names) missing.push(`${n} (subpath ${sub} not exported)`);
        total += names.size;
        continue;
      }
      for (const n of names) {
        total += 1;
        if (!(n in mod) || mod[n] === undefined) missing.push(`${n} (from ${sub})`);
      }
    }
    result.steps.push({
      name: "sdk symbols",
      note: `${total - missing.length}/${total} present`,
    });
    if (missing.length) result.failures.push(`missing host exports: ${missing.join(", ")}`);

    // --- 3/4/5. behavioural probes, each in its own process ---
    for (const [mode, name] of [
      ["esm", "esm entry"],
      ["cjs", "cjs entry"],
      ["register", "registration"],
    ]) {
      const r = runNode(mode, dir);
      if (r.ok) {
        result.steps.push({
          name,
          note:
            mode === "register"
              ? `gateway.startAccount ok; config callbacks ran (${(r.configCallbacks ?? []).join(", ")})`
              : "loaded ok",
        });
      } else {
        result.steps.push({ name, note: "FAILED" });
        result.failures.push(`${mode}: ${r.error}`);
      }
    }

    // --- 6. manifest / package version sync ---
    const manifest = JSON.parse(readFileSync(join(dir, "openclaw.plugin.json"), "utf8"));
    if (manifest.version !== pkg.version) {
      result.failures.push(`manifest version ${manifest.version} != package.json ${pkg.version}`);
      result.steps.push({ name: "manifest sync", note: "FAILED" });
    } else {
      result.steps.push({ name: "manifest sync", note: `v${manifest.version}` });
    }
  } catch (err) {
    result.failures.push(err.message);
  } finally {
    if (!keep) rmSync(dir, { recursive: true, force: true });
    else result.steps.push({ name: "workspace kept", note: dir });
  }

  result.ok = result.failures.length === 0;
  result.label = label;
  return result;
}

console.log(`\n${C.dim("host compatibility (tier 1)")}`);
if (floorVersion) console.log(`  ${C.dim("declared floor:")} ${floorVersion}`);
if (buildVersion) console.log(`  ${C.dim("build version:")}  ${buildVersion}`);
console.log(`  ${C.dim("testing:")}        ${versions.join(", ")}`);

const results = [];
for (const v of versions) {
  const r = await checkVersion(v);
  results.push(r);
  console.log(`\n── ${r.label} ${"─".repeat(Math.max(0, 44 - r.label.length))}`);
  for (const s of r.steps) console.log(`  ${s.name.padEnd(22)} ${s.note}`);
  if (r.ok) console.log(`  ${C.green("PASS")}`);
  else {
    console.log(`  ${C.red("FAIL")}`);
    for (const f of r.failures) console.log(`    ${C.red("•")} ${f}`);
  }
}

const failed = results.filter((r) => !r.ok);
console.log("");
if (failed.length) {
  console.error(
    C.red(`check-compat: ${failed.length}/${results.length} host version(s) failed: ${failed.map((r) => r.version).join(", ")}`),
  );
  process.exit(1);
}
console.log(C.green(`check-compat: all ${results.length} host version(s) compatible.`));
if (floorVersion && !versions.includes(floorVersion)) {
  console.log(C.yellow(`note: declared floor ${floorVersion} was not among the tested versions.`));
}
