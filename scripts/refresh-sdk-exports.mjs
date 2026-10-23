#!/usr/bin/env node
// Refresh `test/fixtures/plugin-sdk-exports.json` — the snapshot of which
// `openclaw/plugin-sdk/*` subpaths each host version actually publishes.
//
// Why this exists (issue #324): the plugin imports SDK helpers by subpath, and the
// host removes/renames subpaths between releases without any deprecation period.
// On 2026.10.6 `plugin-sdk/command-auth` and `plugin-sdk/channel-reply-pipeline`
// simply disappeared from the host `exports` map, and because the host resolves a
// plugin's imports at link time, the result was not a broken helper — the whole
// plugin was rejected and the channel went silently dead. The unit tests cannot see
// this (test-loader.js maps every `openclaw/plugin-sdk/*` specifier onto a catch-all
// shim), so `test/sdk-subpath-compat.test.ts` checks the recorded snapshots instead.
//
// Usage:
//   node scripts/refresh-sdk-exports.mjs 2026.10.6               # download from npm
//   node scripts/refresh-sdk-exports.mjs 2026.10.6 --tarball f.tgz
//   node scripts/refresh-sdk-exports.mjs --from-host <container>  # read an installed host
//
// After refreshing, run `node --test --experimental-strip-types --loader ./test-loader.js \
// test/sdk-subpath-compat.test.ts` and fix any import the new snapshot shows as missing.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as pathResolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = pathResolve(fileURLToPath(import.meta.url), "..");
const FIXTURE = pathResolve(__dirname, "../test/fixtures/plugin-sdk-exports.json");

function readExportsFromPackageJson(json) {
  const pkg = JSON.parse(json);
  const exportsMap = pkg.exports ?? {};
  return Object.keys(exportsMap)
    .filter((key) => key.startsWith("./plugin-sdk/"))
    .map((key) => key.slice("./plugin-sdk/".length))
    .sort();
}

function fromTarball(tarballPath) {
  const json = execFileSync("tar", ["-xzOf", tarballPath, "package/package.json"], {
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
  return readExportsFromPackageJson(json);
}

function fromHost(container) {
  const json = execFileSync(
    "docker",
    [
      "exec",
      container,
      "sh",
      "-c",
      'node -e "process.stdout.write(JSON.stringify(require(String(process.argv[1])+\'/package.json\')))" /usr/local/lib/node_modules/openclaw',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  ).toString();
  return readExportsFromPackageJson(json);
}

function downloadTarball(version) {
  const dir = mkdtempSync(join(tmpdir(), "openclaw-sdk-exports-"));
  const target = join(dir, `openclaw-${version}.tgz`);
  const url = `https://registry.npmjs.org/openclaw/-/openclaw-${version}.tgz`;
  process.stderr.write(`downloading ${url}\n`);
  execFileSync("curl", ["-sS", "--max-time", "900", "-o", target, url], { stdio: "inherit" });
  return { target, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const args = process.argv.slice(2);
let version;
let subpaths;

if (args[0] === "--from-host") {
  const container = args[1];
  if (!container) throw new Error("usage: --from-host <container>");
  version = execFileSync("docker", ["exec", container, "openclaw", "--version"])
    .toString()
    .trim()
    .split(/\s+/)[1];
  subpaths = fromHost(container);
} else {
  version = args[0];
  if (!version) throw new Error("usage: refresh-sdk-exports.mjs <host-version> [--tarball <path>]");
  const tarballFlag = args.indexOf("--tarball");
  if (tarballFlag !== -1) {
    subpaths = fromTarball(args[tarballFlag + 1]);
  } else {
    const { target, cleanup } = downloadTarball(version);
    try {
      subpaths = fromTarball(target);
    } finally {
      cleanup();
    }
  }
}

let fixture = { versions: {} };
try {
  fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
} catch {
  // first run: start empty
}

fixture.versions[version] = subpaths;
fixture.versions = Object.fromEntries(
  Object.entries(fixture.versions).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })),
);
writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);

process.stderr.write(`recorded ${subpaths.length} plugin-sdk subpaths for host ${version}\n`);
process.stderr.write(`fixture: ${FIXTURE}\n`);
