/**
 * Tier 2 test loader — only remaps `.js` imports to `.ts` when the `.ts`
 * exists and the `.js` does not. This is needed because the test files are
 * run directly as `.ts` via `--experimental-strip-types`, and their intra-test
 * imports use `.js` extensions (matching the repo's NodeNext convention).
 *
 * Does NOT shim `openclaw/plugin-sdk/*` — the real host is installed in the
 * workspace node_modules.
 */

import { statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

export function resolve(specifier, context, nextResolve) {
  // Only relative imports from .ts files need the remap
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL?.endsWith(".ts")
  ) {
    const parentPath = fileURLToPath(context.parentURL);
    const baseDir = dirname(parentPath);
    const resolved = join(baseDir, specifier);
    if (resolved.endsWith(".js")) {
      const tsPath = resolved.slice(0, -3) + ".ts";
      try {
        statSync(tsPath); // throws if missing
        return nextResolve(pathToFileURL(tsPath).href, context);
      } catch {
        // .ts doesn't exist either — fall through to normal resolution
      }
    }
  }
  return nextResolve(specifier, context);
}
