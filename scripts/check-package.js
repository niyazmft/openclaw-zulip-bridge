import { readFileSync, existsSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('openclaw.plugin.json', 'utf8'));

let errors = [];

console.log('Validating package configuration and contents...');

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

// 4. Existence of built artifacts (local filesystem check)
const extensions = pkg.openclaw?.extensions || [];
const artifacts = [
  ...extensions,
  pkg.openclaw?.setupEntry
].filter(Boolean);

for (const artifact of artifacts) {
  if (!existsSync(artifact)) {
    errors.push(`Built artifact does not exist on disk: ${artifact}`);
  }
}

// 5. Verify entry points are in the files list
for (const artifact of artifacts) {
  const normalizedArtifact = artifact.startsWith('./') ? artifact.slice(2) : artifact;
  let found = false;
  for (const listed of (pkg.files || [])) {
    if (normalizedArtifact.startsWith(listed.replace(/\/$/, ''))) {
      found = true;
      break;
    }
  }
  if (!found) {
    errors.push(`Critical artifact ${normalizedArtifact} may not be included in package "files"`);
  }
}

// Verify essential metadata files are in files list
const essentialFiles = ['openclaw.plugin.json', 'README.md', 'package.json'];
for (const file of essentialFiles) {
  if (!(pkg.files || []).some(f => f === file || file.startsWith(f.replace(/\/$/, '')))) {
    errors.push(`Essential file may be missing from package "files": ${file}`);
  }
}

if ((pkg.files || []).includes('SKILL.md')) {
  console.log('OK: SKILL.md is included.');
} else {
  console.log('Note: SKILL.md is missing from package (optional but recommended).');
}

if (errors.length > 0) {
  console.error('\nPackage validation failed:');
  errors.forEach(err => console.error(`- ${err}`));
  process.exit(1);
}

console.log('\nPackage validation passed.');
