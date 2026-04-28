import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const requiredPaths = [
  'node_modules/.bin/tsc',
  'node_modules/typescript/package.json'
];

let errors = [];

console.log('Verifying dev toolchain...');

for (const relPath of requiredPaths) {
  const fullPath = join(process.cwd(), relPath);
  if (!existsSync(fullPath)) {
    errors.push(`Missing required path: ${relPath}`);
  } else {
    console.log(`OK: ${relPath} exists.`);
  }
}

// Verify TypeScript version from package.json instead of spawning tsc
try {
  const tsPkgPath = join(process.cwd(), 'node_modules', 'typescript', 'package.json');
  const tsPkg = JSON.parse(readFileSync(tsPkgPath, 'utf8'));
  console.log(`OK: typescript package present (v${tsPkg.version})`);
} catch (err) {
  errors.push(`Failed to read typescript package info: ${err.message}`);
}

if (errors.length > 0) {
  console.error('\nBootstrap validation failed:');
  errors.forEach(err => console.error(`- ${err}`));

  if (process.env.NODE_ENV === 'production') {
    console.error('\nHINT: NODE_ENV is set to "production", which may cause npm to skip installing devDependencies.');
    console.error('Try running: NODE_ENV=development npm install');
  }

  console.error('\nTry running "npm install" or "npm ci" again.');
  process.exit(1);
}

console.log('\nBootstrap validation passed.');
