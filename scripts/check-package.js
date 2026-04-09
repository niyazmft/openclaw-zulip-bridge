import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('openclaw.plugin.json', 'utf8'));

let errors = [];

// 1. Version consistency
if (pkg.version !== manifest.version) {
  errors.push(`Version mismatch: package.json has ${pkg.version}, openclaw.plugin.json has ${manifest.version}`);
}

// 2. Presence of required OpenClaw fields in package.json
const requiredOpenClawFields = ['compat', 'extensions', 'setupEntry'];
for (const field of requiredOpenClawFields) {
  if (!pkg.openclaw || !pkg.openclaw[field]) {
    errors.push(`Missing required OpenClaw field in package.json: openclaw.${field}`);
  }
}

// 3. Existence of all files listed in package.json "files" field
if (pkg.files) {
  for (const file of pkg.files) {
    if (!existsSync(file)) {
      errors.push(`Listed file/directory does not exist: ${file}`);
    }
  }
}

// 4. Existence of built artifacts
const artifacts = [
  pkg.openclaw?.extensions?.[0],
  pkg.openclaw?.setupEntry
].filter(Boolean);

for (const artifact of artifacts) {
  if (!existsSync(artifact)) {
    errors.push(`Built artifact does not exist: ${artifact}`);
  }
}

if (errors.length > 0) {
  console.error('Package validation failed:');
  errors.forEach(err => console.error(`- ${err}`));
  process.exit(1);
}

console.log('Package validation passed.');
