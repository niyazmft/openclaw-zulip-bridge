import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

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

try {
  // Use npx to ensure we're trying to run the local one if possible,
  // or just exec 'node_modules/.bin/tsc' directly.
  const tscPath = join(process.cwd(), 'node_modules', '.bin', 'tsc');
  const output = execSync(`"${tscPath}" --version`, { encoding: 'utf8' });
  console.log(`OK: tsc is functional (${output.trim()})`);
} catch (err) {
  errors.push(`Failed to execute tsc: ${err.message}`);
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
