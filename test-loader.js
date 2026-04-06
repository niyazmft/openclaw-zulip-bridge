import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve as pathResolve } from 'node:path';
import { existsSync } from 'node:fs';

const openclawShimUrl = pathToFileURL(pathResolve('./test/openclaw-plugin-sdk-shim.js')).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier === 'openclaw/plugin-sdk' || specifier.startsWith('openclaw/plugin-sdk/')) {
    return {
      url: openclawShimUrl,
      shortCircuit: true,
    };
  }

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    if (specifier.endsWith('.js')) {
      const tsSpecifier = specifier.slice(0, -3) + '.ts';
      const parentURL = new URL(context.parentURL);
      const tsURL = new URL(tsSpecifier, parentURL);
      if (existsSync(pathResolve(parentURL.pathname, '..', tsSpecifier))) {
         return nextResolve(tsSpecifier, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
