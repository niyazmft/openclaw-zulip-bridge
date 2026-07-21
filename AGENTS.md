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
- **Monitor lifecycle**: The monitor must be started via `gateway.startAccount` inside the `base` parameter of `createChatChannelPlugin`. Putting `gateway` at the top level of the returned object causes `createChatChannelPlugin` to strip it during destructuring, resulting in the host throwing "Channel zulip does not support runtime start".
  - `gateway.startAccount(ctx)` receives `ctx.setStatus`, `ctx.abortSignal`, `ctx.account`, `ctx.accountId`, `ctx.cfg`, `ctx.runtime`, `ctx.log`.
- **Bot workspace**: `src/zulip/workspace.ts` provides sandboxed file storage under `data/zulip-workspace/{accountId}/` with path-traversal rejection, automatic cleanup, and optional Zulip upload integration.

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

### Install via ClawHub (recommended)

```bash
openclaw plugins install clawhub:@niyazmft/openclaw-zulip
```

Then restart the gateway and run `openclaw channels add` to configure.

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
- `openclaw/plugin-sdk/core` → `openclaw/plugin-sdk/channel-core` for all channel plugin imports **except**:
  - `normalizeAccountId` must remain on `openclaw/plugin-sdk/core` (not exported from `channel-core` in host 2026.6.x)
- `openclaw/plugin-sdk/zod` → do **not** migrate; host 2026.6.x does not bundle `zod` as an npm dependency. Keep importing from `openclaw/plugin-sdk/zod`
- Keep both root `configSchema` and `channelConfigs` in the manifest. OpenClaw 2026.6.x still validates the root schema at load time
- Manifest `uiHints` synced with runtime schema for full cold-path label coverage
- `minGatewayVersion` / `minHostVersion` bumped to `>=2026.6.0`

## Troubleshooting

- **Health-monitor restarts every ~5 min** with `reason: stopped`: Fixed in v2026.8.1+. `gateway.startAccount` must be placed inside the `base` parameter of `createChatChannelPlugin`, not at the top level. The host checks `snapshot.running` to decide if channel is alive.
- **Monitor never starts after hot reload / wizard config**: If `startZulipMonitor` creates an `AbortController` before validating credentials, and credentials are missing at startup, the controller blocks all future starts. Only create the controller **after** credential validation, right before launching the actual monitor loop.
- **Host calls `registerFull` twice**: Fixed in v2026.8.1+ with a module-level `registerFullCalled` guard. This is normal host behavior.
- **"Invalid config: must not have additional properties: streaming"**: The host's `openclaw channels add` wizard writes `"streaming": true` to the config. If your manifest JSON Schema has `"additionalProperties": false` and `streaming` isn't in `properties`, config validation fails. Add `streaming` to BOTH `configSchema` and `channelConfigs.schema` in `openclaw.plugin.json`.
- **`readAllowFromStore(channelName)` throws** "invalid pairing channel: expected non-empty string; got undefined": SDK bug in host `2026.7.1`. Workaround: read `credentials/zulip-{accountId}-allowFrom.json` directly from the data directory.
- **Dedupe store blocks re-processing across restarts**: The dedupe file at `/tmp/openclaw-zulip/zulip_dedupe_default.json` survives container restarts. Clear it when testing fresh message flows.
- **Env vars override config**: The host resolves credentials from env vars first, then config. If `ZULIP_EMAIL` or `ZULIP_API_KEY` are set in the host environment, they override `openclaw.json` values.
- **Missing channelConfigs warning**: Ensure openclaw.plugin.json has `channelConfigs` section with `schema` and `uiHints`.
- **Deprecated providerAuthEnvVars**: Migrate to `channelEnvVars` in manifest and package.json.
- **No startup logs** for your channel? Verify host calls `startAccount` and `listAccountIds` returns expected account IDs.
- **Telegram fetch timeouts**: Separate network issue on the test device, not related to your plugin.
- **Bot presence not showing online**: Zulip API rejects `POST /users/me/presence` for bot accounts. This is a platform limitation, not a bug.

**Note**: This file is maintained as project documentation and is safe to commit.
