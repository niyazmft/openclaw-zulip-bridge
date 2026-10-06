#!/usr/bin/env node
/**
 * Plugin Inspector gate — the engine behind `clawhub package validate`.
 *
 * Why this exists: `check:clawscan` vendors ClawHub's *moderation* engine, which
 * only looks for malicious/suspicious patterns. It cannot see manifest-schema
 * findings (`manifest-unknown-contracts`, `manifest-unknown-fields`) or
 * SDK-compatibility findings (`sdk-export-missing`) — those come from the
 * Plugin Inspector, a different tool that ClawHub runs server-side. This gate
 * runs that tool locally/CI so a publish-time surprise becomes a PR-time failure.
 *
 * Targets are derived from `package.json#openclaw` — the same source
 * `check:compat` uses — so a host-version bump keeps this gate in sync with the
 * release without editing CI:
 *   - floor     = openclaw.install.minHostVersion        (lowest supported)
 *   - primary   = openclaw.build.openclawVersion         (built/tested against)
 *
 * Override the targets with positional args (`node scripts/check-inspector.js beta`)
 * or `INSPECTOR_VERSIONS=beta,latest`. `latest`/`beta` resolve via the npm dist-tags.
 *
 * Core-owned findings (`issues[].owner === "core"`, e.g. a host alias gap the
 * plugin cannot fix) are reported but do not fail the gate, matching ClawHub's
 * PASS verdict. Set `INSPECTOR_STRICT=1` to fail on them too.
 *
 * Separate from `npm run check` on purpose: it needs network access and downloads
 * an OpenClaw host tarball (~100 MB, cached under PLUGIN_INSPECTOR_CACHE_DIR or
 * ~/.cache/plugin-inspector).
 *
 * Usage:
 *   node scripts/check-inspector.js                      # floor + build target
 *   node scripts/check-inspector.js 2026.9.1 beta        # explicit targets
 *   INSPECTOR_VERSIONS=beta,latest node scripts/check-inspector.js
 *   INSPECTOR_STRICT=1 node scripts/check-inspector.js
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));

/** ">=2026.7.1" -> "2026.7.1" (mirrors scripts/check-compat.js). */
function versionFromRange(range) {
  if (!range || typeof range !== "string") return undefined;
  const m = range.match(/\d+\.\d+\.\d+(?:-[\w.]+)?/);
  return m ? m[0] : undefined;
}

const floorVersion = versionFromRange(pkg.openclaw?.install?.minHostVersion);
const buildVersion = versionFromRange(pkg.openclaw?.build?.openclawVersion);

const argv = process.argv.slice(2);
const strict = argv.includes("--strict") || process.env.INSPECTOR_STRICT === "1";
const explicit = argv.filter((a) => !a.startsWith("--"));

const versions = [
  ...new Set(
    (explicit.length
      ? explicit
      : process.env.INSPECTOR_VERSIONS
        ? process.env.INSPECTOR_VERSIONS.split(",").map((v) => v.trim()).filter(Boolean)
        : [floorVersion, buildVersion]
    ).filter(Boolean),
  ),
];

if (versions.length === 0) {
  console.error("check-inspector: no target versions to test.");
  process.exit(1);
}

/** Resolve the installed inspector CLI (a direct devDependency). */
function resolveInspectorCli() {
  const candidates = [
    join(rootDir, "node_modules", "@openclaw", "plugin-inspector", "src", "cli.js"),
    join(rootDir, "node_modules", ".bin", "plugin-inspector"),
  ];
  return candidates.find(existsSync);
}

const cliPath = resolveInspectorCli();
if (!cliPath) {
  console.error(
    "check-inspector: @openclaw/plugin-inspector is not installed. Run `pnpm install` first.",
  );
  process.exit(1);
}

function runInspector(version) {
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "check",
      "--plugin-root",
      rootDir,
      "--openclaw-version",
      version,
      "--author-facing",
      "--json",
    ],
    { encoding: "utf8", maxBuffer: 128 * 1024 * 1024, cwd: rootDir },
  );

  const stdout = result.stdout ?? "";
  const start = stdout.indexOf("{");
  if (start === -1) {
    const detail = (result.stderr ?? "").trim().split("\n").slice(-3).join(" | ");
    return { version, error: `no report produced (exit ${result.status}): ${detail || "no output"}` };
  }

  let report;
  try {
    report = JSON.parse(stdout.slice(start));
  } catch (error) {
    return { version, error: `unreadable report: ${error.message}` };
  }

  const warnings = report.warnings ?? [];
  const issues = report.issues ?? [];
  const pluginIssues = issues.filter((issue) => issue.owner !== "core");
  const coreIssues = issues.filter((issue) => issue.owner === "core");
  const fatal = [...warnings, ...pluginIssues, ...(strict ? coreIssues : [])];

  return {
    version,
    target: report.targetOpenClaw?.version ?? version,
    warnings,
    pluginIssues,
    coreIssues,
    ok: fatal.length === 0,
  };
}

let failed = 0;
for (const version of versions) {
  const result = runInspector(version);
  const label = result.target && result.target !== version ? `${version} → ${result.target}` : version;

  if (result.error) {
    failed += 1;
    console.error(`✗ ${label}: ${result.error}`);
    continue;
  }

  if (result.ok) {
    const ignored =
      result.coreIssues.length > 0
        ? ` (${result.coreIssues.length} core-owned issue(s) ignored: ${result.coreIssues.map((i) => i.code).join(", ")})`
        : "";
    console.log(`✓ ${label}: plugin-clean${ignored}`);
    for (const issue of result.coreIssues) {
      console.log(`    [core-owned, non-blocking] ${issue.code}: ${issue.title ?? ""}`);
    }
    continue;
  }

  failed += 1;
  console.error(`✗ ${label}: plugin findings`);
  for (const warning of result.warnings) {
    console.error(`    warning ${warning.code}: ${warning.message ?? ""}`);
  }
  for (const issue of result.pluginIssues) {
    console.error(
      `    ${issue.severity ?? ""} ${issue.code} (${issue.owner ?? "unknown"}): ${issue.title ?? ""}`,
    );
  }
  for (const issue of result.coreIssues) {
    console.error(`    [core-owned, non-blocking] ${issue.code}: ${issue.title ?? ""}`);
  }
}

if (failed > 0) {
  console.error(`check-inspector: ${failed}/${versions.length} target version(s) failed.`);
  process.exit(1);
}
console.log(`check-inspector: all ${versions.length} target version(s) plugin-clean.`);
