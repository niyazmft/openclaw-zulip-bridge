import test from "node:test";
import assert from "node:assert/strict";
import { resolve as pathResolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Use a dynamic import to verify that the built artifacts can be loaded.
// Since we are using ESM and have a test-loader that shims the SDK,
// this should work even if 'openclaw/plugin-sdk' isn't actually installed.

const __dirname = pathResolve(fileURLToPath(import.meta.url), '..');
const rootDir = pathResolve(__dirname, '..');

test("dist-import smoke test: index.js", async () => {
  const indexPath = pathResolve(rootDir, 'dist/index.js');
  const mod = await import(pathToFileURL(indexPath).href);
  assert.ok(mod.default, "dist/index.js should have a default export");
  assert.equal(mod.default.id, "zulip", "Plugin ID should be 'zulip'");
});

test("dist-import smoke test: setup-entry.js", async () => {
  const setupPath = pathResolve(rootDir, 'dist/setup-entry.js');
  const mod = await import(pathToFileURL(setupPath).href);
  assert.ok(mod.default, "dist/setup-entry.js should have a default export");
});
