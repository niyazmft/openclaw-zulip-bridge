import { resolve as pathResolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const __dirname = pathResolve(fileURLToPath(import.meta.url), '..');
const rootDir = pathResolve(__dirname, '..');

const pkg = JSON.parse(readFileSync(pathResolve(rootDir, 'package.json'), 'utf8'));

async function runSmokeTest() {
  console.log('Running host-side smoke validation on built artifacts...');

  const extensions = pkg.openclaw?.extensions || [];
  const setupEntry = pkg.openclaw?.setupEntry;

  // 1. Validate Plugin Entry
  for (const extension of extensions) {
    const indexPath = pathResolve(rootDir, extension);
    if (!existsSync(indexPath)) {
      throw new Error(`Plugin entry point not found: ${extension}`);
    }

    console.log(`Checking entry point: ${extension}`);
    const mod = await import(pathToFileURL(indexPath).href);

    assert.ok(mod.default, `Entry point ${extension} must have a default export`);
    assert.equal(typeof mod.default.id, 'string', `Plugin in ${extension} must have an ID string`);
    console.log(`OK: Loaded plugin "${mod.default.id}" from ${extension}`);
  }

  // 2. Validate Setup Entry
  if (setupEntry) {
    const setupPath = pathResolve(rootDir, setupEntry);
    if (!existsSync(setupPath)) {
      throw new Error(`Setup entry point not found: ${setupEntry}`);
    }

    console.log(`Checking setup entry point: ${setupEntry}`);
    const mod = await import(pathToFileURL(setupPath).href);
    assert.ok(mod.default, `Setup entry point ${setupEntry} must have a default export`);
    console.log(`OK: Loaded setup entry from ${setupEntry}`);
  }

  console.log('\nHost-side smoke validation passed.');
}

runSmokeTest().catch(err => {
  console.error('\nHost-side smoke validation FAILED:');
  console.error(err);
  process.exit(1);
});
