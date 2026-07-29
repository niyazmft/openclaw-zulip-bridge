import { resolve as pathResolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';

const __dirname = pathResolve(fileURLToPath(import.meta.url), '..');
const rootDir = pathResolve(__dirname, '..');

const pkg = JSON.parse(readFileSync(pathResolve(rootDir, 'package.json'), 'utf8'));

function isCjsPath(p) {
  return p.endsWith('.cjs');
}

async function runSmokeTest() {
  console.log('Running host-side smoke validation on built artifacts...');

  const extensions = pkg.openclaw?.extensions || [];
  const runtimeExtensions = pkg.openclaw?.runtimeExtensions || [];
  const setupEntry = pkg.openclaw?.setupEntry;
  const runtimeSetupEntry = pkg.openclaw?.runtimeSetupEntry;

  // 1. Validate source extension entries exist (used by host for install-time validation)
  for (const extension of extensions) {
    const indexPath = pathResolve(rootDir, extension);
    if (!existsSync(indexPath)) {
      throw new Error(`Plugin source entry point not found: ${extension}`);
    }
    console.log(`OK: Plugin source entry point exists: ${extension}`);
  }

  // 2. Validate runtime extension entries (what the host actually loads)
  const runtimeEntries = runtimeExtensions.length > 0 ? runtimeExtensions : extensions;
  for (const extension of runtimeEntries) {
    const indexPath = pathResolve(rootDir, extension);
    if (!existsSync(indexPath)) {
      throw new Error(`Plugin runtime entry point not found: ${extension}`);
    }

    console.log(`Checking runtime entry point: ${extension}`);
    if (isCjsPath(extension)) {
      // CJS entries cannot be fully loaded without the OpenClaw host runtime,
      // but we can syntax-check them and verify they resolve to a CommonJS file.
      execSync(`node --check ${JSON.stringify(indexPath)}`, { stdio: 'inherit' });
      console.log(`OK: CJS runtime entry point parses: ${extension}`);

      // Verify the ERR_REQUIRE_ESM_RACE_CONDITION retry wrapper is present
      const cjsSource = readFileSync(indexPath, 'utf-8');
      assert.ok(
        cjsSource.includes('function __requireWithRetry(id)'),
        `CJS entry ${extension} must contain __requireWithRetry helper (see issue #231)`
      );
      assert.ok(
        cjsSource.includes('ERR_REQUIRE_ESM_RACE_CONDITION'),
        `CJS entry ${extension} must handle ERR_REQUIRE_ESM_RACE_CONDITION (see issue #231)`
      );
      assert.ok(
        cjsSource.includes('__requireWithRetry("openclaw/'),
        `CJS entry ${extension} must wrap openclaw/* requires with retry`
      );
      console.log(`OK: CJS retry wrapper present in: ${extension}`);
    } else {
      const mod = await import(pathToFileURL(indexPath).href);
      assert.ok(mod.default, `Entry point ${extension} must have a default export`);
      assert.equal(typeof mod.default.id, 'string', `Plugin in ${extension} must have an ID string`);
      console.log(`OK: Loaded plugin "${mod.default.id}" from ${extension}`);
    }
  }

  // 3. Validate setup source entry exists
  if (setupEntry) {
    const setupPath = pathResolve(rootDir, setupEntry);
    if (!existsSync(setupPath)) {
      throw new Error(`Setup source entry point not found: ${setupEntry}`);
    }
    console.log(`OK: Setup source entry point exists: ${setupEntry}`);
  }

  // 4. Validate setup runtime entry
  const setupRuntime = runtimeSetupEntry || setupEntry;
  if (setupRuntime) {
    const setupPath = pathResolve(rootDir, setupRuntime);
    if (!existsSync(setupPath)) {
      throw new Error(`Setup runtime entry point not found: ${setupRuntime}`);
    }

    console.log(`Checking setup runtime entry point: ${setupRuntime}`);
    if (isCjsPath(setupRuntime)) {
      execSync(`node --check ${JSON.stringify(setupPath)}`, { stdio: 'inherit' });
      console.log(`OK: CJS setup runtime entry point parses: ${setupRuntime}`);
    } else {
      const mod = await import(pathToFileURL(setupPath).href);
      assert.ok(mod.default, `Setup entry point ${setupRuntime} must have a default export`);
      console.log(`OK: Loaded setup entry from ${setupRuntime}`);
    }
  }

  console.log('\nHost-side smoke validation passed.');
}

runSmokeTest().catch(err => {
  console.error('\nHost-side smoke validation FAILED:');
  console.error(err);
  process.exit(1);
});
