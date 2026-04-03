# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The OpenClaw Zulip Bridge is a channel plugin for OpenClaw that enables interaction with Zulip streams and private messages. It implements a persistent event queue system, flexible traffic policies, and comprehensive observability.

**Key Constraints:**
- Requires OpenClaw >=2026.3.23
- Must be installed as a linked plugin in `~/.openclaw/extensions/` for development
- Configuration lives in `~/.openclaw/openclaw.json` (not in this repo)
- Queue state and deduplication data are persisted in `~/.openclaw/data/`

## Development Commands

**Build the plugin (required before installation):**
```bash
npm run build
```

**Type checking:**
```bash
npm run typecheck
```

**Run tests:**
```bash
npm run test
```

**Run a single test:**
```bash
node --test --experimental-strip-types --loader ./test-loader.js test/<test-name>.test.ts
```

**Full validation (recommended before commits):**
```bash
npm run check
```

**Enable the plugin after building:**
```bash
openclaw plugins enable zulip
```

**Note on Installation:**
The `openclaw plugins install ./ --link` command may be blocked by OpenClaw's security scanner due to environment variable access detection. However, if the plugin is in `~/.openclaw/extensions/openclaw-zulip-bridge/`, it will be automatically discovered and can be enabled with the command above. The plugin is already in the `plugins.allow` list in the config.

## Plugin Architecture

### Build System

The plugin is written in TypeScript but OpenClaw loads compiled JavaScript. The build process:
- TypeScript source in project root and `src/`
- Compiled output goes to `dist/`
- `package.json` points to `dist/index.js` and `dist/setup-entry.js`
- **Always run `npm run build` after making changes** before testing

### Entry Points

- **`index.ts`**: Main plugin entry point. Exports `zulipPlugin` and registers the channel with OpenClaw via `definePluginEntry()`. Compiles to `dist/index.js`.
- **`setup-entry.ts`**: Setup wizard entry point. Used by OpenClaw's interactive setup flow. Compiles to `dist/setup-entry.js`.

### Core Components

**Channel Plugin (`src/channel.ts`):**
The main plugin definition using `createChatChannelPlugin()` from the OpenClaw Plugin SDK. Defines:
- Account resolution and multi-account support
- DM/group policy enforcement
- Message routing and delivery
- Status management and health probing
- Security policies and pairing workflows

**Runtime Singleton (`src/runtime.ts`):**
Manages the global `PluginRuntime` instance provided by OpenClaw. Used throughout the codebase to access OpenClaw's runtime APIs (logging, config, channel primitives, etc.).

**Configuration (`src/config-schema.ts`, `src/types.ts`):**
- Zod schemas for validating Zulip configuration
- TypeScript types for `ZulipConfig` and `ZulipAccountConfig`
- Multi-account support via `accounts` map in config
- Environment variable support for secrets (ZULIP_API_KEY, ZULIP_EMAIL, ZULIP_URL)

**Account Resolution (`src/zulip/accounts.ts`):**
- Resolves account configuration from the OpenClaw config tree
- Supports both single-account (top-level fields) and multi-account (accounts map) configurations
- Merges environment variables with config values
- Returns `ResolvedZulipAccount` with credentials and settings

### Event System

**Queue Manager (`src/zulip/queue-manager.ts`):**
- Manages Zulip event queue lifecycle (register, poll, recover)
- Persists queue metadata to `~/.openclaw/data/zulip-queue-{accountId}.json`
- Automatic recovery after restarts (resumes from last processed event ID)
- Exponential backoff for registration failures

**Monitor (`src/zulip/monitor.ts`):**
- Main event polling loop (`monitorZulipProvider()`)
- Processes incoming Zulip messages and events
- Enforces traffic policies (DM/group allowlists, mention gating)
- Handles message deduplication, media downloads, reaction feedback
- Routes messages to OpenClaw's reply engine
- Manages typing indicators and streaming responses

**Dedupe Store (`src/zulip/dedupe-store.ts`):**
- Persistent deduplication store to prevent duplicate message processing
- Stores processed message IDs in `~/.openclaw/data/zulip-dedupe-{accountId}.json`
- TTL-based expiry and LRU eviction

**Client (`src/zulip/client.ts`):**
- Thin wrapper around Zulip REST API
- Functions for queue registration, event polling, sending messages, reactions, typing indicators
- Retry logic for transient failures

### Security & Policy

**Policy Engine (`src/zulip/policy.ts`):**
- Decides whether to accept, reject, or pair for incoming messages
- Enforces `dmPolicy` (pairing/allowlist/open/disabled)
- Enforces `groupPolicy` (allowlist/open/disabled)
- Supports wildcards and mention-gating in streams

**Path Traversal Protection:**
See `test/path-traversal.test.ts` for validation that media downloads cannot escape the media directory.

**Send Security:**
See `test/send-security.test.ts` for validation that admin actions (e.g., sending on behalf of others) require explicit opt-in.

### Message Flow

1. **Inbound**: `monitor.ts` polls events → checks policy → deduplicates → downloads media → sends to OpenClaw reply engine
2. **Outbound**: OpenClaw sends via `sendMessageZulip()` in `src/zulip/send.ts` → chunks text if needed → posts to Zulip API

### Testing

- **`test/smoke.test.ts`**: Basic sanity checks (config parsing, account resolution)
- **`test/queue-manager.test.ts`**: Queue persistence and recovery
- **`test/policy.test.ts`**: Traffic policy enforcement
- **`test/dedupe-store.test.ts`**: Deduplication logic
- **`test/send-security.test.ts`**: Admin action safeguards
- **`test/path-traversal.test.ts`**: Media download security

Tests use Node.js native test runner with `--experimental-strip-types` for direct TypeScript execution.

## Configuration Schema

The plugin reads configuration from `~/.openclaw/openclaw.json` under `channels.zulip`. Key fields:

- **Multi-account support**: Use `channels.zulip.accounts.{accountId}` for multiple Zulip accounts
- **Single-account legacy**: Top-level fields like `channels.zulip.email`, `channels.zulip.apiKey`, etc.
- **Traffic policies**: `dmPolicy`, `groupPolicy`, `allowFrom`, `groupAllowFrom`
- **Mention modes**: `chatmode` (oncall/onmessage/onchar), `requireMention`, `oncharPrefixes`
- **Reactions**: `reactions.enabled`, `reactions.onStart`, `reactions.onSuccess`, `reactions.onError`

See `docs/config.md` for complete reference.

## Working with OpenClaw Plugin SDK

This plugin uses the OpenClaw Plugin SDK (`openclaw/plugin-sdk/core`, `openclaw/plugin-sdk/irc`, etc.). Key SDK concepts:

- **`createChatChannelPlugin()`**: Factory for creating channel plugins
- **`definePluginEntry()`**: Wraps plugin for OpenClaw registration
- **`PluginRuntime`**: Provides logging, config access, channel primitives
- **`ChannelAccountSnapshot`**: Status structure for account health
- **Account resolution pattern**: Multi-account config with environment variable support

## Common Tasks

**Testing configuration changes:**
1. Edit `~/.openclaw/openclaw.json`
2. Restart OpenClaw or reload config (if supported)
3. Check logs for `zulip queue registered` or `zulip queue loaded`

**Adding a new configuration field:**
1. Add to `ZulipAccountConfig` type in `src/types.ts`
2. Add to `ZulipAccountSchema` in `src/config-schema.ts`
3. Update resolution logic in `src/zulip/accounts.ts` if needed
4. Add UI hints in `src/config-ui-hints.ts` if the field should appear in setup wizards
5. Document in `docs/config.md`

**Adding a new test:**
Create `test/my-feature.test.ts` with:
```typescript
import { describe, it } from "node:test";
import assert from "node:assert";

describe("my feature", () => {
  it("should do something", () => {
    assert.strictEqual(1, 1);
  });
});
```

**Debugging event queue issues:**
- Check `~/.openclaw/data/zulip-queue-{accountId}.json` for queue state
- Check OpenClaw logs for `zulip queue` events
- Check Zulip's server logs for API errors

**Working with local plugin development:**
1. Make changes to TypeScript source files
2. Run `npm run build` to compile to `dist/`
3. Restart OpenClaw to load the new code
4. No need to reinstall - OpenClaw loads directly from the `~/.openclaw/extensions/openclaw-zulip-bridge` directory

**Security Scanner Note:**
OpenClaw's security scanner may block `openclaw plugins install` due to detection of environment variable access combined with network requests. This is expected behavior for the Zulip plugin, which legitimately reads credentials from environment variables (ZULIP_API_KEY, ZULIP_EMAIL, ZULIP_URL) before connecting to Zulip servers. The `providerAuthEnvVars` field in both `package.json` and `openclaw.plugin.json` declares these as safe, but the scanner currently runs before checking these declarations. The workaround is to use `openclaw plugins enable zulip` instead of install.

## File Organization

```
src/
  channel.ts              # Main plugin definition
  runtime.ts              # Runtime singleton
  types.ts                # TypeScript types
  config-schema.ts        # Zod schemas
  normalize.ts            # Message target normalization
  actions.ts              # Message action handlers
  group-mentions.ts       # Mention resolution for streams
  onboarding.ts           # First-run setup logic
  onboarding-helpers.ts   # Setup utilities
  setup-core.ts           # Setup adapter
  setup-surface.ts        # Setup wizard UI
  config-ui-hints.ts      # UI hints for config fields
  zulip/
    accounts.ts           # Account resolution
    client.ts             # Zulip REST API wrapper
    monitor.ts            # Event polling loop
    monitor-helpers.ts    # Monitor utilities
    queue-manager.ts      # Queue lifecycle management
    dedupe-store.ts       # Message deduplication
    policy.ts             # Traffic policy enforcement
    send.ts               # Outbound message delivery
    uploads.ts            # Media download handling
    probe.ts              # Health check

test/
  smoke.test.ts           # Basic sanity tests
  queue-manager.test.ts   # Queue persistence
  policy.test.ts          # Policy enforcement
  dedupe-store.test.ts    # Deduplication
  send-security.test.ts   # Admin action security
  path-traversal.test.ts  # Media download security
  accounts.test.ts        # Account resolution
  client.test.ts          # Client utilities
  monitor-regression.test.ts  # Monitor edge cases

docs/
  config.md               # Configuration reference
  observability.md        # Log schema and monitoring
  smoke-test.md           # Manual verification steps
```

## Observability

The plugin emits machine-parseable JSON logs via OpenClaw's logger:

- `formatZulipLog()` in `src/zulip/monitor-helpers.ts` creates structured log entries
- All logs include `accountId` and event type
- PII (emails, user IDs) is masked in logs using `maskPII()`
- See `docs/observability.md` for log schemas

## Notes on Security

- **Never commit API keys or credentials**: Use environment variables (ZULIP_API_KEY, ZULIP_EMAIL, ZULIP_URL)
- **Admin actions are opt-in**: Sending messages on behalf of other users requires `enableAdminActions: true`
- **Media downloads are sandboxed**: All downloads go to `~/.openclaw/data/media/` and cannot escape via path traversal
- **Traffic policies are enforced before processing**: DM/group policies gate all inbound messages
