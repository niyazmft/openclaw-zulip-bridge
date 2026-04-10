const openclawShimUrl = new URL('./openclaw-plugin-sdk-shim.js', import.meta.url).href;

/**
 * A minimal ESM loader for smoke-testing built artifacts.
 * It only shims 'openclaw/plugin-sdk' and does NOT perform
 * source redirection (e.g. .js -> .ts), ensuring we test
 * the actual built files in dist/.
 */
export function resolve(specifier, context, nextResolve) {
  if (specifier === 'openclaw/plugin-sdk' || specifier.startsWith('openclaw/plugin-sdk/')) {
    return {
      url: openclawShimUrl,
      shortCircuit: true,
    };
  }

  return nextResolve(specifier, context);
}
