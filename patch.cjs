const fs = require('fs');
let content = fs.readFileSync('test-loader.js', 'utf8');

if (!content.includes('import { fileURLToPath } from')) {
    content = content.replace("import { existsSync } from 'node:fs';", "import { existsSync } from 'node:fs';\nimport { fileURLToPath } from 'node:url';");
}

content = content.replace(`    if (specifier.endsWith('.js')) {
      const tsSpecifier = specifier.slice(0, -3) + '.ts';
      const parentURL = new URL(context.parentURL);
      if (existsSync(pathResolve(parentURL.pathname, '..', tsSpecifier))) {
          return nextResolve(tsSpecifier, context);
      }
    }`, `    if (specifier.endsWith('.js')) {
      const tsSpecifier = specifier.slice(0, -3) + '.ts';
      const parentURL = new URL(context.parentURL);
      if (existsSync(pathResolve(fileURLToPath(parentURL), '..', tsSpecifier))) {
          return nextResolve(tsSpecifier, context);
      }
    }`);

fs.writeFileSync('test-loader.js', content);
