// ClawScan replica runner — scans source + built output with the exact
// ClawHub moderation engine (vendored from openclaw/clawhub).
//
// Usage: node --experimental-strip-types --loader ./scripts/clawscan/loader.js scripts/clawscan/run.mjs
// Exits non-zero on any finding (strict gate).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runStaticModerationScan } from "./vendor/moderationEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

// Mirrors the upstream scanner's extension filters.
const CODE_EXTENSION = /\.(js|ts|mjs|cjs|mts|cts|jsx|tsx|py|sh|bash|zsh|rb|go)$/i;
const MARKDOWN_EXTENSION = /\.(md|markdown|mdx)$/i;
const MANIFEST_EXTENSION = /\.(json|yaml|yml|toml)$/i;

// Directories/files to scan. Source + built output (what ClawHub sees in the
// published package), plus the manifest and docs.
const SCAN_DIRS = ["src", "dist", "dist-cjs"];
const SCAN_FILES = [
  "index.ts",
  "setup-entry.ts",
  "openclaw.plugin.json",
  "package.json",
  "SKILL.md",
  "README.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
];

const SKIP_DIRS = new Set(["node_modules", ".git", "vendor", "clawscan"]);

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (
      CODE_EXTENSION.test(entry.name) ||
      MARKDOWN_EXTENSION.test(entry.name) ||
      MANIFEST_EXTENSION.test(entry.name)
    ) {
      out.push(full);
    }
  }
}

function collectFiles() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    walk(path.join(repoRoot, dir), files);
  }
  for (const name of SCAN_FILES) {
    const full = path.join(repoRoot, name);
    if (fs.existsSync(full)) files.push(full);
  }
  return files.sort();
}

function readManifestMetadata() {
  // The upstream scanner reads declared env names from `primaryEnv`, `envVars`,
  // `env`, and `requires.env` in frontmatter/metadata (including nested
  // `openclaw` blocks). Pass the package.json (which declares
  // `openclaw.envVars`) as the primary metadata so the env_credential_access
  // exemption applies for the ZULIP_* variables.
  const metadata = {};
  for (const name of ["package.json", "openclaw.plugin.json"]) {
    const full = path.join(repoRoot, name);
    try {
      const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
      // Merge top-level fields so the scanner sees envVars/primaryEnv/env
      // regardless of which manifest ClawHub passes as metadata.
      for (const [key, value] of Object.entries(parsed)) {
        if (key === "openclaw" && metadata.openclaw) {
          metadata.openclaw = { ...metadata.openclaw, ...value };
        } else if (metadata[key] === undefined) {
          metadata[key] = value;
        }
      }
    } catch {
      // ignore
    }
  }
  return metadata;
}

function readFrontmatter() {
  // SKILL.md frontmatter (YAML-ish). The upstream scanner reads `always`,
  // `primaryEnv`, `envVars`, `env`, `requires.env` from it.
  const skillPath = path.join(repoRoot, "SKILL.md");
  try {
    const content = fs.readFileSync(skillPath, "utf8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const frontmatter = {};
    for (const line of match[1].split("\n")) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (value === "true") frontmatter[key] = true;
      else if (value === "false") frontmatter[key] = false;
      else frontmatter[key] = value.replace(/^["']|["']$/g, "");
    }
    return frontmatter;
  } catch {
    return {};
  }
}

function main() {
  const files = collectFiles();
  const fileContents = files.map((full) => ({
    path: path.relative(repoRoot, full),
    content: fs.readFileSync(full, "utf8"),
  }));

  const result = runStaticModerationScan({
    slug: "zulip",
    displayName: "Zulip",
    summary: "OpenClaw Zulip channel plugin",
    frontmatter: readFrontmatter(),
    metadata: readManifestMetadata(),
    files: fileContents.map((f) => ({ path: f.path, size: f.content.length })),
    fileContents,
  });

  console.log(`ClawScan replica (${result.engineVersion}) — scanned ${files.length} files`);
  console.log(`Verdict: ${result.status}`);
  if (result.reasonCodes.length > 0) {
    console.log(`Reason codes: ${result.reasonCodes.join(", ")}`);
  }
  console.log(`Summary: ${result.summary}`);

  if (result.findings.length > 0) {
    console.log("\nFindings:");
    for (const finding of result.findings) {
      console.log(
        `  [${finding.severity}] ${finding.code} — ${finding.message}`,
      );
      console.log(`    ${finding.file}:${finding.line}`);
      console.log(`    ${finding.evidence}`);
    }
  }

  if (result.status !== "clean") {
    console.error("\nClawScan replica FAILED: findings detected (strict gate).");
    process.exit(1);
  }
  console.log("\nClawScan replica PASSED: no findings.");
}

main();
