import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

// Regression guard for issue #324.
//
// The host resolves a plugin's `openclaw/plugin-sdk/*` imports at link time and
// validates the subpath against its own `exports` map. Host 2026.10.6 removed
// `plugin-sdk/command-auth` and `plugin-sdk/channel-reply-pipeline` outright, so the
// plugin was rejected wholesale — `zulip` simply vanished from the gateway's loaded
// plugin set while `openclaw status` still reported the channel as `ON / OK`
// (it only validates config). The channel stayed dead and silent for days.
//
// Nothing else in `npm run check` can see this: `test-loader.js` maps *every*
// `openclaw/plugin-sdk/*` specifier onto a catch-all shim, so a subpath that does not
// exist on any real host still resolves in tests. `check:compat` does catch it, but
// only for the host versions declared in package.json — which is why the declared
// build target has to be a version that exists.
//
// This test compares the plugin's import surface against a recorded snapshot of each
// host version's real `exports` map (test/fixtures/plugin-sdk-exports.json, refreshed
// with scripts/refresh-sdk-exports.mjs).

const __dirname = pathResolve(fileURLToPath(import.meta.url), "..");
const repoRoot = pathResolve(__dirname, "..");
const fixturePath = pathResolve(__dirname, "fixtures/plugin-sdk-exports.json");

const pkg = JSON.parse(readFileSync(pathResolve(repoRoot, "package.json"), "utf8"));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const hostSnapshots = fixture.versions as Record<string, string[]>;

const SPECIFIER_RE = /openclaw\/plugin-sdk\/([a-z0-9-]+)/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = pathResolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Every `plugin-sdk/<subpath>` specifier the shipped code imports, with its first source location. */
function collectImportedSubpaths(): Map<string, string> {
  const roots = [
    pathResolve(repoRoot, "src"),
    pathResolve(repoRoot, "index.ts"),
    pathResolve(repoRoot, "setup-entry.ts"),
  ];
  const found = new Map<string, string>();
  const files: string[] = [];
  for (const root of roots) {
    if (root.endsWith(".ts")) {
      files.push(root);
    } else {
      files.push(...sourceFiles(root));
    }
  }
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(SPECIFIER_RE)) {
      const subpath = match[1];
      if (!found.has(subpath)) {
        found.set(subpath, `${file.slice(repoRoot.length + 1)}`);
      }
    }
  }
  return found;
}

function declaredHostVersions(): { floor: string; build: string } {
  const floorRaw = pkg?.openclaw?.install?.minHostVersion ?? "";
  const floor = String(floorRaw).replace(/^[>=^~ ]+/, "").trim();
  const build = String(pkg?.openclaw?.build?.openclawVersion ?? "").trim();
  return { floor, build };
}

test("every imported plugin-sdk subpath exists on every recorded host version", () => {
  const imported = collectImportedSubpaths();
  assert.ok(imported.size > 0, "expected to find at least one openclaw/plugin-sdk/* import");

  const recorded = Object.keys(hostSnapshots);
  assert.ok(recorded.length > 0, "fixture has no recorded host versions");

  const failures: string[] = [];
  for (const [subpath, location] of imported) {
    for (const version of recorded) {
      const exported = hostSnapshots[version];
      if (!exported.includes(subpath)) {
        failures.push(
          `openclaw/plugin-sdk/${subpath} (imported in ${location}) is NOT exported by host ${version}`,
        );
      }
    }
  }

  assert.deepEqual(
    failures,
    [],
    [
      "The plugin imports SDK subpaths that some supported host version does not export.",
      "The host rejects the whole plugin at link time when a subpath is missing, so this is a",
      "total channel outage, not a degraded helper.",
      "",
      ...failures,
      "",
      "Fix the import to a subpath exported by ALL recorded versions, or if the subpath was",
      "renamed, update both the import and the shim in types/openclaw-plugin-sdk.d.ts.",
    ].join("\n"),
  );
});

test("fixture covers the declared host floor and build target", () => {
  const { floor, build } = declaredHostVersions();
  assert.ok(floor, "package.json#openclaw.install.minHostVersion must declare a floor host version");
  assert.ok(build, "package.json#openclaw.build.openclawVersion must declare a build target host version");

  const recorded = Object.keys(hostSnapshots);
  assert.ok(
    recorded.includes(floor),
    `no recorded SDK export snapshot for the declared floor host ${floor}; run:\n` +
      `  node scripts/refresh-sdk-exports.mjs ${floor}`,
  );
  assert.ok(
    recorded.includes(build),
    `no recorded SDK export snapshot for the declared build target host ${build}; run:\n` +
      `  node scripts/refresh-sdk-exports.mjs ${build}\n` +
      `then re-run this test and fix any subpath the new snapshot shows as missing.`,
  );
});

test("subpaths that broke the plugin once are not reintroduced", () => {
  // 2026.10.6 silently dropped both of these; they are the exact regression this
  // guard exists for, so assert on them directly (a fixture refresh must not be
  // able to make this pass by accident).
  const imported = collectImportedSubpaths();
  for (const retired of ["command-auth", "channel-reply-pipeline"]) {
    assert.ok(
      !imported.has(retired),
      `openclaw/plugin-sdk/${retired} was removed from the host exports map in 2026.10.6 ` +
        `(imported in ${imported.get(retired)}); use the durable replacement instead`,
    );
  }
});
