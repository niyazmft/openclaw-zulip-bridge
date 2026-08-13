// ClawScan loader: remaps .js -> .ts for the vendored scanner directory so the
// upstream TypeScript can run under `node --experimental-strip-types`.
import { resolve as pathResolve } from "node:path";
import { existsSync } from "node:fs";

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    if (specifier.endsWith(".js")) {
      const tsSpecifier = specifier.slice(0, -3) + ".ts";
      const parentURL = new URL(context.parentURL);
      if (existsSync(pathResolve(parentURL.pathname, "..", tsSpecifier))) {
        return nextResolve(tsSpecifier, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
