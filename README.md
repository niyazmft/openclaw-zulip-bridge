# OpenClaw Zulip Bridge

[![Version](https://img.shields.io/badge/version-2026.8.4-blue)](https://github.com/niyazmft/openclaw-zulip-bridge/releases)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-%3E%3D2026.6.0-green)](https://openclaw.ai)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-brightgreen)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-10.32.1-orange)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

High-performance OpenClaw channel plugin for Zulip streams and private messages with persistent event queues, traffic policies, and comprehensive observability.

## Table of Contents

- [Quick Start](#quick-start)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Verification](#verification)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)
- [Known Issues](#known-issues)
- [Development](#development)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

---

## Quick Start

> 💡 **The simplest way to get started:** Install from ClawHub, restart the gateway, then run the interactive onboarding wizard.

```bash
# 1. Install from ClawHub
openclaw plugins install clawhub:@niyazmft/openclaw-zulip

# 2. Restart the gateway
openclaw gateway restart

# 3. Run the interactive channel setup wizard
openclaw channels add
# → Select "Zulip (plugin)" → enter API key, email, URL → route to agent

# 4. Approve yourself for DMs (dmPolicy defaults to "pairing")
#    Send a DM to your bot first, then copy the pairing code and run:
openclaw pairing approve zulip <PAIRING_CODE>

# 5. Test
#    Send a DM to your bot or mention it in a stream
```

That's it — no manual config editing needed.

---

## Features

- **Context Metadata**: Every inbound message carries `conversationTurn`, `sessionGapSeconds`, and `topicChanged` metadata to help the AI agent understand conversation continuity.
- **Error Placeholder Cleanup**: When message dispatch fails, the orphaned "🤔 Thinking..." placeholder is edited to "❌ Error — could not generate response".
- **Persistent Event Polling**: Automatically resumes from where it left off using locally-persisted queue metadata.
- **Traffic Policies**: Granular control over who can interact with the bot in DMs and Streams.
- **Multiple Accounts**: Support for multiple Zulip accounts and realms in a single instance.
- **Mention Gating**: Intelligent stream handling with `oncall`, `onmessage`, and `onchar` modes.
- **Durable Deduplication**: Built-in persistent deduplication store to prevent duplicate message processing.
- **Media Support**: Automatically processes Zulip uploads and inline images.
- **Rich Feedback**: Optional reaction-based status indicators for request start, success, and errors.
- **Placeholder Editing**: Shows "🤔 Thinking..." placeholder while AI generates a response, then edits it in-place.
- **Mark as Read**: Automatically marks user messages as read after processing.
- **Typing Indicators**: Best-effort typing indicators during AI generation.
- **Bot Workspace**: Sandboxed file storage for generated/downloaded files under `data/zulip-workspace/`.
- **SSRF Protection**: Rejects internal IPs, localhost, and AWS metadata endpoints for base URLs.
- **Security Hardening**: URL encoding for all path parameters, path traversal sanitization, symlink rejection.
- **Standardized Observability**: Machine-parseable logs for easy monitoring and troubleshooting.

---

## Prerequisites

- **OpenClaw**: Version `>=2026.6.0`
- **Node.js**: Latest LTS recommended (Node 22+)
  - **Node 24 / CJS Gateway hosts**: A pre-built CommonJS entry point (`dist-cjs/index.cjs`) is shipped via `openclaw.runtimeExtensions` so hosts that `require()` plugin entries can load the channel without invoking a runtime TypeScript/ESM translator. This helps Node 24 CJS Gateway environments that would otherwise hit a jiti fallback crash. It does **not** resolve the Node.js ESM/CJS loader race condition on Termux, because the host-provided OpenClaw SDK modules remain ESM. See the troubleshooting section below for details.
- **Zulip Bot**: A registered bot on your Zulip realm

### Creating a Zulip Bot

1. Log into your Zulip server
2. Go to **Settings → Your Bots → Add a new bot**
3. Choose **Bot type:** "Generic bot"
4. Give it a name (e.g., "openclaw-bot")
5. Copy the **API key** shown — this is your `ZULIP_API_KEY`
6. The bot's email is your `ZULIP_EMAIL`

---

## Installation

### From ClawHub (Recommended)

The simplest path — install from ClawHub, restart, then use the built-in wizard:

```bash
# Install
openclaw plugins install clawhub:@niyazmft/openclaw-zulip

# Restart gateway (required for the host to load the new plugin)
openclaw gateway restart

# Run the interactive setup wizard
openclaw channels add
# → Select "Zulip (plugin)" → follow the prompts
```

### From Source (Development / Offline Machines)

> ⚠️ **Do NOT clone directly into `~/.openclaw/extensions/zulip`.** This creates a stale config entry that blocks reinstallation. Always clone to a neutral directory first.

1. **Pre-flight check** (verify your environment):

   ```bash
   # Check OpenClaw version (>= 2026.6.0 recommended)
   openclaw --version
   # Ensure no stale zulip config exists
   openclaw plugins list --json | grep zulip
   ```

   If you see a stale config warning, run cleanup first:

   ```bash
   openclaw plugins uninstall zulip --force
   ```

2. **Clone and build**:

```bash
# Clone to a neutral directory (NOT inside ~/.openclaw/extensions/)
git clone https://github.com/niyazmft/openclaw-zulip-bridge.git /tmp/openclaw-zulip-bridge
cd /tmp/openclaw-zulip-bridge
pnpm install
pnpm run build
```

3. **Install the built plugin**:

```bash
openclaw plugins install ./ --link
```

4. **Verify the installation**:

```bash
openclaw plugins doctor
openclaw plugins list --json | python3 -c "import json,sys; z=[p for p in json.load(sys.stdin).get('plugins',[]) if p['id']=='zulip']; print('OK' if z and z[0]['activated'] else 'FAIL')"
```

5. **Configure the plugin**:

```bash
openclaw channels add
# Select "Zulip (plugin)" and follow the prompts
```

#### Offline Installation

This plugin has **zero production npm dependencies**. You can build it on a connected machine, then copy the folder to an offline machine:

```bash
# On the connected machine:
git clone https://github.com/niyazmft/openclaw-zulip-bridge.git /tmp/zulip-bridge
cd /tmp/zulip-bridge
pnpm install
pnpm run build
```

Then on the offline machine, from the copied folder:

```bash
openclaw plugins install ./ --link
openclaw channels add
# Select "Zulip (plugin)" and follow the prompts
```

---

## Configuration

### Interactive Setup (Recommended)

Run the built-in channel onboarding wizard:

```bash
openclaw channels add
```

Then at the interactive prompts:

1. Select **"Set up a chat channel now?"** → Yes
2. Choose **"Zulip (plugin)"** from the channel list
3. Follow the guided prompts to enter your **API key**, **bot email**, and **site URL**
4. Choose to route messages to an agent (e.g., `main`)

After setup, if `dmPolicy` is `"pairing"`, send a DM to your bot and approve yourself:

```bash
openclaw pairing approve zulip <PAIRING_CODE_FROM_ZULIP_DM>
```

> **Tip**: If `ZULIP_API_KEY`, `ZULIP_EMAIL`, and `ZULIP_URL` are set as environment variables, the wizard uses them automatically.

### Manual Configuration

For advanced users, add to your `openclaw.json`:

```json
{
  "channels": {
    "zulip": {
      "enabled": true,
      "dmPolicy": "pairing",
      "streams": ["*"]
    }
  }
}
```

#### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable the Zulip channel |
| `dmPolicy` | string | `"pairing"` | Who can DM the bot: `"open"` (anyone), `"allowlist"` (specific users), `"pairing"` (must pair first), `"disabled"` (ignore DMs) |
| `streams` | string[] | `["*"]` | Streams to monitor (`"*"` = all) |
| `blockStreaming` | boolean | `false` | Enable block streaming for responses |
| `chatmode` | string | `"onmessage"` | Stream trigger mode: `"oncall"`, `"onmessage"`, `"onchar"` |
| `name` | string | - | Optional display name for the account |
| `email` | string | - | Bot email address |
| `apiKey` | string | - | Bot API key |
| `url` / `site` / `realm` | string | - | Zulip server URL |
| `allowFrom` | string[] | - | DM allowlist (user emails) |
| `groupAllowFrom` | string[] | - | Group/stream allowlist |
| `groupPolicy` | string | `"allowlist"` | Group policy: `"open"`, `"allowlist"` |
| `requireMention` | boolean | `true` | Require @mention in streams |
| `oncharPrefixes` | string[] | `[">", "!"]` | Trigger characters for onchar mode |
| `mediaMaxMb` | number | `5` | Maximum media upload size (MB) |
| `textChunkLimit` | number | `4000` | Text chunk size limit |
| `chunkMode` | string | `"length"` | Chunking mode: `"length"`, `"newline"` |
| `reactions` | boolean | `true` | Enable reaction-based status indicators |
| `streaming` | boolean | `true` | Enable receiving streaming messages |
| `responsePrefix` | string | - | Custom response prefix override |
| `showThinkingPlaceholder` | boolean | `false` | Post a "🤔 Thinking..." placeholder while generating. Disabled by default because it adds a Zulip API round-trip; typing indicators are shown either way. |
| `dmSessionTurnLimit` | number | `20` | Maximum inbound DM conversation turns before starting a fresh session. Prevents one long/broken conversation from bloating context for all future replies in the same DM. Set to `0` to disable rotation. |
| `enableSessionRecovery` | boolean | `false` | Scan recent DMs on startup for messages interrupted by a gateway restart and re-dispatch them. Opt-in for security. |
| `maxMessagesPerMinute` | number | `60` | Maximum inbound messages per minute from a single sender. Prevents flooding. Set to `0` to disable. |
| `autoSendOnMissingTool` | boolean | `true` | If the agent ends a run with text but never invoked the messaging tool, deliver the text to the channel anyway. |

#### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ZULIP_API_KEY` | Yes | Bot API key from Zulip |
| `ZULIP_EMAIL` | Yes | Bot email address |
| `ZULIP_URL` | Yes | Zulip server URL (e.g., `https://chat.example.com`) |

---

## Verification

After setup, verify the bridge works:

1. **Check plugin status**:

   ```bash
   openclaw plugins doctor
   ```

2. **Check Logs**: Look for success marker:

   ```
   zulip queue registered [accountId=default queueId=... lastEventId=...]
   ```

3. **Test Direct Message**: Send a DM to the bot
4. **Test Stream**: Mention `@bot-name` in a monitored stream

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        OpenClaw Gateway                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Zulip Plugin (index.ts)                   │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌─────────────┐    ┌────────────────┐   │
│  │   monitor   │───▶│   client    │───▶│  Zulip API     │   │
│  │  (polling)  │    │  (requests) │    │  (REST/WebSocket)│   │
│  └──────────────┘    └─────────────┘    └────────────────┘   │
│         │                   │                                  │
│         ▼                   ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │               reply-handler.ts                          │  │
│  │  - Markdown processing                                  │  │
│  │  - Text chunking                                        │  │
│  │  - Typing indicators                                    │  │
│  │  - Media handling                                       │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

- **monitor.ts**: Event loop that polls Zulip API, maintains event queue with persistence, handles placeholder editing and mark-read
- **client.ts**: HTTP client wrapping Zulip REST API with SSRF protection and URL encoding
- **reply-handler.ts**: Converts agent responses to Zulip format, handles chunking and placeholder editing
- **send.ts**: Message delivery with security validation and typing indicators
- **accounts.ts**: Multi-account configuration resolution
- **workspace.ts**: Sandboxed bot file storage for generated/downloaded files
- **policy.ts**: DM/group traffic policy enforcement
- **polling.ts**: Event polling with retry and backoff
- **queue-manager.ts**: Queue persistence and expiry handling
- **dedupe-store.ts**: Message deduplication with TTL
- **bootstrap.ts**: Monitor initialization with subscription logging
- **fs-utils.ts**: Safe file operations with path traversal and symlink protection
- **text-utils.ts**: Text processing utilities
- **reactions.ts**: Reaction handling for status indicators
- **uploads.ts**: Upload URL extraction and download security
- **media-utils.ts**: Media processing and sanitization

---

## Troubleshooting

### "plugin not found: zulip"

**Cause:** The plugin was installed but "zulip" is not in `plugins.allow`.

**Fix:**
```bash
openclaw config set plugins.allow '["zulip","telegram","memory-core","exa","ollama"]'
openclaw gateway restart
```

### openclaw plugins install ./ --link fails
Install from ClawHub:

```bash
openclaw plugins install clawhub:@niyazmft/openclaw-zulip
```

Or from source without `--link`:

```bash
rm -rf scripts/
openclaw plugins install ./ --force
```

### "plugin not found: zulip" after installing
1. Restart the gateway: `openclaw gateway restart`
2. Check that the plugin is in the extensions dir: `ls ~/.openclaw/extensions/zulip/`

### Health-monitor restarting every ~10 min with `reason: stopped`

**Fixed in v2026.8.3+.** The monitor now starts via `gateway.startAccount` inside the plugin's `base` parameter, so the host properly wires `statusSink` and `abortSignal`.

If you still see this on an older version, upgrade to the latest release.

### "registerFull already called, skipping duplicate monitor start"

**Status:** Harmless in v2026.8.3+. The plugin now has a module-level `registerFullCalled` guard.

### Queue Registration Fails
Verify credentials with `openclaw channels add` and re-enter them.

### No Response in Streams
Ensure the bot is a member of the stream and it's in your `streams` config.

### Logs show "mention required"
Default requires @mentions. Check your `chatmode` setting.

### Zulip plugin fails to load on Node 24 / Termux with `ERR_REQUIRE_ESM_RACE_CONDITION`

The plugin ships a CommonJS build (`dist-cjs/index.cjs`) through `openclaw.runtimeExtensions`, which lets CJS Gateway hosts load the plugin entry via `require()` without hitting a runtime ESM translator. However, this does **not** bypass the Node.js ESM/CJS loader race on Termux, because the OpenClaw host-provided SDK modules (`openclaw/plugin-sdk/*`) are still ESM and are synchronously `require()`d from the CJS bundle. The race happens inside Node's module loader when a synchronous `require()` and an asynchronous `import()` resolve the same ESM module concurrently.

**Recommended mitigation:** Use Node.js 22 if your platform supports it. Node 22.17.1 and earlier are known-good for this race. Termux currently only provides Node 24 LTS, so Termux users are blocked until OpenClaw resolves the upstream SDK loading race ([openclaw/openclaw#83035](https://github.com/openclaw/openclaw/issues/83035)).

If you still see the error on a non-Termux Node 24 host, verify that the installed package contains `dist-cjs/` and that `package.json` `openclaw.runtimeExtensions` lists `./dist-cjs/index.cjs` before `./dist/index.js`.

### Typing indicator TTL exceeded
The typing indicator auto-stops after 60 seconds if the response takes longer. This is expected behavior.

### Replies are sent via fallback instead of the `message` tool
The host's `tools.profile: "coding"` removes the `message` tool from the agent. The plugin still delivers replies through its `autoSendOnMissingTool` fallback, but for the cleanest chat UX use a profile that keeps `message` (e.g., `"chat"`) or add `message` to the profile allowlist. This affects all chat channels, not just Zulip.

### Zulip responses are slower than Telegram
Zulip API round-trips from the container take ~600ms each. To reduce latency, keep `showThinkingPlaceholder: false` (default) and avoid enabling the placeholder unless users need the extra visual feedback.

### `describeMessageTool` fails with "expected chat channel metadata: zulip to be defined"

**Fixed in v2026.8.4+.** The function was calling `getChatChannelMeta("zulip")` which only resolves first-party/bundled channel metadata. Since Zulip is a third-party plugin, it always returned `undefined`. The fix returns the plugin's own channel metadata directly.

**Severity:** Low — the error is caught gracefully and doesn't crash anything. It only affects profiles where the `message` tool is available (e.g., `full`, `messaging`). On the default `coding` profile, `describeMessageTool` is never called.

### Typing indicator never stops / replies not delivered

**Fixed in v2026.8.4+.** The SDK's `createTypingCallbacks.onIdle()` may return `undefined` in some host versions. Calling `.catch()` on `undefined` throws a `TypeError` that was silently swallowed by the dispatcher's `onError` handler, preventing `sendMessageZulip` from ever being called.

**Fix:** The deliver callback now guards `.catch()` with a type check and wraps the entire body in a try-catch with proper error logging.

### Fallback reader misses replies from local OSS models

**Fixed in v2026.8.4+.** The fallback reader (which reads assistant text from trajectory files when the `message` tool is not invoked) previously filtered files by filesystem `mtime` with a 30-second window. This was unreliable because session files are reused across multiple messages and buffered filesystem writes don't always update `mtime` synchronously.

**Fix:** The mtime filter was removed entirely. The fallback now uses event-time filtering (`event.ts >= dispatchStartTime`) which is deterministic and immune to filesystem race conditions.

### `humanDelay` adds ~16s delay before typing indicator

**Fixed in v2026.8.4+.** The SDK's `resolveHumanDelayConfig` has a built-in default of ~14-16 seconds even when not configured in gateway settings. The plugin now sets `humanDelay: 0` to disable this delay.

**Result:** Typing indicator now starts within 0.3-5 seconds of dispatch (down from ~16s).

---

## Security & Permissions

### Destructive Actions

The following actions require **explicit confirmation** (`confirm: true`) to prevent accidental execution by AI agents:

| Action | Confirmation Required | Admin Privilege Required | Description |
|--------|----------------------|-------------------------|-------------|
| `delete` | ✅ `confirm: true` | ❌ No | Permanently deletes a Zulip message |
| `channel-delete` | ✅ `confirm: true` | ✅ Yes | Deletes a Zulip stream/channel |
| `user-deactivate` | ✅ `confirm: true` | ✅ Yes | Deactivates a Zulip user account |
| `user-reactivate` | ✅ `confirm: true` | ✅ Yes | Reactivates a Zulip user account |
| `org-settings-edit` | ✅ `confirm: true` | ✅ Yes | Updates organization settings |

### Admin Actions Gate

Actions marked "Admin Privilege Required" are additionally protected by:

1. **`enableAdminActions: true`** in your Zulip channel config
2. **The bot account must have Zulip admin privileges** on the server

Without both safeguards, admin actions will throw an error. This prevents accidental delegation of destructive operations to agents that should not have them.

### Best Practices

- Use a **least-privilege bot account** (Generic Bot, not Admin Bot)
- Keep `enableAdminActions: false` unless you explicitly need stream management or user lifecycle operations
- Restrict `streams` and `allowFrom` to minimize exposure
- Avoid delegating this plugin to agents that should not delete messages/channels or alter users and organization settings

---

## Known Issues

### Bot Presence (Online Status)

**Status:** Platform limitation (Zulip API restriction)

**Problem:** The bot does not show as 🟢 online in Zulip's user list.

**Root Cause:** Zulip's `POST /users/me/presence` endpoint explicitly rejects bot requests with:
```json
{"result":"error","msg":"This endpoint does not accept bot requests.","code":"BAD_REQUEST"}
```

**Workaround:** None available. Bot accounts cannot update presence status in Zulip.

---

### Performance: First Message After Startup is Slower

**Status:** Expected behavior

**Problem:** The first Zulip message after gateway startup takes ~5–8s to get a reply.

**Root Cause:** Model warmup + cold inference for the first agent run. Subsequent messages reply in ~2–4s.

**Mitigation:** None needed. This is normal for external model providers.

---

### Legacy Skill Packages

Two old skill packages exist on ClawHub under the same namespace:
- `@niyazmft/zulip-bridge` (deprecated, redirects to canonical)
- `@niyazmft/openclaw-zulip-bridge` (deprecated, merged into zulip-bridge)

These are **skill** (text bundle) packages, not code plugins. The active, maintained package is `@niyazmft/openclaw-zulip` (this repo).

## Development

### Local Setup

```bash
pnpm install
pnpm run check
```

This runs: bootstrap → typecheck → build → smoke test → unit tests → package check

### Project Structure

```
src/
├── channel.ts            # Plugin entry point & channel config
├── setup-core.ts         # Interactive setup wizard
├── setup-surface.ts      # Setup wizard UI
├── config-schema.ts      # Configuration validation
├── types.ts              # Type definitions
├── zulip/
│   ├── auth.ts           # Authentication utilities
│   ├── bootstrap.ts      # Monitor initialization
│   ├── client.ts         # Zulip API client
│   ├── dedupe-store.ts   # Deduplication store
│   ├── media-utils.ts    # Media processing
│   ├── monitor-helpers.ts # Logging helpers
│   ├── monitor.ts       # Event polling & queue management
│   ├── policy.ts         # DM/group policy logic
│   ├── polling.ts       # Event polling
│   ├── probe.ts          # Connection probing
│   ├── queue-manager.ts  # Queue persistence
│   ├── reactions.ts      # Reaction handling
│   ├── reply-handler.ts  # Response processing
│   ├── send.ts           # Message sending with security
│   ├── text-utils.ts     # Text processing
│   ├── uploads.ts        # Upload handling
│   └── accounts.ts       # Multi-account config resolution
```

---

## Contributing

Contributions are welcome! Please read our contribution guidelines before submitting PRs.

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Run `pnpm run check` to validate
5. Submit a pull request

### Running Tests

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test -- test/policy.test.ts
```

---

## Security

See [SECURITY.md](SECURITY.md) for the full security policy, including:

- **Credential handling** — how API keys, emails, and URLs are resolved, used, and protected
- **Data access** — what files the plugin reads from the local filesystem and why
- **Network communication** — what servers the plugin connects to and over what protocol
- **Audit logging** — persistent security event logging
- **Rate limiting** — per-sender rate limits to prevent abuse
- **Dependency management** — pinned dev dependencies and host-provided runtime

For security vulnerabilities, please **do not** open a public issue. Contact the maintainer directly through GitHub or email (see [SECURITY.md](SECURITY.md#reporting-a-vulnerability)).

## License

MIT License - see [LICENSE](LICENSE) file for details.