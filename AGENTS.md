# AGENTS.md — OpenClaw Zulip Bridge

## Essential Commands

```bash
npm run check              # Full validation: bootstrap → typecheck → build → smoke → test → package
npm run typecheck          # tsc -p tsconfig.json (noEmit, type-checking only)
npm run build              # tsc -p tsconfig.build.json (emits to dist/)
npm run test               # node --test --experimental-strip-types --loader ./test-loader.js test/*.test.ts
npm run check:bootstrap    # Verifies tsc is installed (skips devDeps if NODE_ENV=production)
npm run check:smoke        # Validates built dist/ artifacts with a loader that does NOT remap .js→.ts
npm run check:package      # Validates version sync, required fields, and npm pack integrity
```

**Command order matters**: `npm run check` runs steps sequentially. Building must precede smoke tests and package checks.

## Architecture

- **Entry points**: `index.ts` (plugin) and `setup-entry.ts` (onboarding wizard). Both emit to `dist/`.
- **Core wiring**: `src/channel.ts` — the single file that glues config, accounts, messaging, security, and monitoring together via `createChatChannelPlugin`.
- **Host dependency**: `openclaw/plugin-sdk` subpaths are **not npm packages**. They are provided at runtime by the OpenClaw host. Type shims live in `types/openclaw-plugin-sdk.d.ts`; runtime test shims in `test/openclaw-plugin-sdk-shim.js`.
  - Channel plugins should import from `openclaw/plugin-sdk/channel-core` (not the legacy `openclaw/plugin-sdk/core` umbrella).

## TypeScript Conventions

- **ESM only**: `"type": "module"` in package.json. All imports use `.js` extensions (NodeNext resolution) even though source files are `.ts`.
- **Lenient config**: `strict: false`, `noImplicitAny: false` — don't add strictness flags without asking.
- **Two tsconfigs**: `tsconfig.json` for typechecking (noEmit, includes `test/`); `tsconfig.build.json` extends it, enables emit, disables `allowImportingTsExtensions`, excludes `test/`.

## Testing

- Uses Node.js built-in test runner (`--test` flag), not Jest/Vitest.
- Custom loader (`test-loader.js`) remaps `openclaw/plugin-sdk` imports to the shim and resolves `.ts` from `.js` imports.
- Run a single test: `node --test --experimental-strip-types --loader ./test-loader.js test/policy.test.ts`
- No test fixtures or external services required.

## CI

CI runs on Node 22, uses `npm ci`, runs `npm run check:bootstrap` followed by `npm run check`, then enforces a clean working directory (`git diff --exit-code`). If check modifies any generated files, CI will fail.

## Build Artifacts

`dist/` is gitignored and must be built locally. The smoke test imports from `dist/`, so `npm run build` must succeed before `check:smoke` or `check:package` can pass.

- The **smoke test** (`scripts/smoke-test-dist.js`) is executed via `test/smoke-loader.js`, which **only** shims `openclaw/plugin-sdk` and deliberately does **not** redirect `.js` imports to `.ts`. This ensures the test exercises actual built artifacts in `dist/`, not source files.
- The **package check** (`scripts/check-package.js`) verifies version sync between `package.json` and `openclaw.plugin.json`, confirms every file in `package.json` `"files"` exists, and validates that critical artifacts and metadata are included in `npm pack --dry-run` output.

## Plugin Manifest

`openclaw.plugin.json` version must stay in sync with `package.json` version. `npm run check:package` validates this.

## Environment

Dev dependencies must be installed. `.npmrc` sets `include=dev` to prevent npm from skipping devDeps. If bootstrap fails, check that `NODE_ENV` is not set to `production`.

## Deployment

This plugin targets **any OpenClaw host** running `>=2026.6.0`. It is not limited to a specific device or platform.

### Install via package manager (recommended)

If published to ClawHub or npm:
```bash
openclaw plugins install @openclaw/zulip
```

### Manual deployment

1. Build: `npm run build`
2. Copy `dist/` and `openclaw.plugin.json` into the host's extensions directory (default: `~/.openclaw/extensions/zulip/`).
3. Restart the OpenClaw gateway.

Example — local host:
```bash
npm run build
rsync -avh --delete dist/ ~/.openclaw/extensions/zulip/
rsync -avh openclaw.plugin.json ~/.openclaw/extensions/zulip/
# Restart the gateway
```

Example — remote host:
```bash
npm run build
ssh remote "mkdir -p ~/.openclaw/extensions/zulip/"
rsync -avh --delete dist/ remote:.openclaw/extensions/zulip/
rsync -avh openclaw.plugin.json remote:.openclaw/extensions/zulip/
# Restart the gateway on the remote host
```

The plugin requires no external runtime dependencies; the host provides the `openclaw/plugin-sdk/*` modules.

## SDK Migration Notes

### 2026.4.29 → 2026.5.x
Migration complete as of v2026.5.1:
- `openclaw/plugin-sdk/irc` → `channel-inbound` + `command-auth` subpaths
- `channel-runtime` → `channel-reply-options-runtime`
- Manifest uses `channelConfigs` (cold-path config schema) + `channelEnvVars` (env var mapping)

### 2026.5.x → 2026.6.x / 2026.7.x
Migration complete as of v2026.7.0:
- `openclaw/plugin-sdk/core` → `openclaw/plugin-sdk/channel-core` for all channel plugin imports
- `openclaw/plugin-sdk/zod` → import `z` from `zod` directly (add `zod` to devDependencies)
- Removed redundant root `configSchema` from manifest; `channelConfigs` is now the sole cold-path schema
- Manifest `uiHints` synced with runtime schema for full cold-path label coverage
- `minGatewayVersion` / `minHostVersion` bumped to `>=2026.6.0`

## Troubleshooting

- **Health-monitor restarts every ~5 min** with `reason: stopped**: Call `statusSink({ running: true, connected: true })` at the START of your monitor function, not conditionally inside event handlers. The host checks `snapshot.running` to decide if channel is alive.
- **Missing channelConfigs warning**: Ensure openclaw.plugin.json has `channelConfigs` section with `schema` and `uiHints`.
- **Deprecated providerAuthEnvVars**: Migrate to `channelEnvVars` in manifest and package.json.
- **No startup logs** for your channel? Verify host calls `startAccount` and `listAccountIds` returns expected account IDs.
- **Telegram fetch timeouts**: Separate network issue on y6, not related to your plugin.

**Note**: `AGENTS.md` itself is listed in `.gitignore` (line 11); it is maintained locally for agent sessions and should not be committed.
