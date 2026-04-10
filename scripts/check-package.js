import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

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

// 5. Packaged files validation (npm pack --dry-run)
try {
  console.log('Running npm pack --dry-run to verify packaged artifacts...');
  const packOutput = execSync('npm pack --dry-run --json', { encoding: 'utf8' });
  const packData = JSON.parse(packOutput)[0];
  const packagedFiles = new Set(packData.files.map(f => f.path));

  // Verify entry points are packaged
  for (const artifact of artifacts) {
    // npm pack output uses paths relative to package root without leading ./
    const normalizedArtifact = artifact.startsWith('./') ? artifact.slice(2) : artifact;
    if (!packagedFiles.has(normalizedArtifact)) {
      errors.push(`Critical artifact missing from package: ${normalizedArtifact}`);
    }
  }

  // Verify essential metadata files are packaged
  const essentialFiles = ['openclaw.plugin.json', 'README.md', 'package.json'];
  for (const file of essentialFiles) {
    if (!packagedFiles.has(file)) {
      errors.push(`Essential file missing from package: ${file}`);
    }
  }

  // Verify SKILL.md (optional but encouraged)
  if (!packagedFiles.has('SKILL.md')) {
    console.log('Note: SKILL.md is missing from package (optional but recommended).');
  } else {
    console.log('OK: SKILL.md is included.');
  }

  console.log(`OK: ${packagedFiles.size} files will be packaged.`);
} catch (err) {
  errors.push(`Failed to run npm pack or parse output: ${err.message}`);
}

if (errors.length > 0) {
  console.error('\nPackage validation failed:');
  errors.forEach(err => console.error(`- ${err}`));
  process.exit(1);
}

console.log('\nPackage validation passed.');
