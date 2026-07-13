# OpenClaw Zulip Bridge

[![Version](https://img.shields.io/badge/version-2026.7.4-blue)](https://github.com/niyazmft/openclaw-zulip-bridge/releases)
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

- **Persistent Event Polling**: Automatically resumes from where it left off using locally-persisted queue metadata.
- **Traffic Policies**: Granular control over who can interact with the bot in DMs and Streams.
- **Multiple Accounts**: Support for multiple Zulip accounts and realms in a single instance.
- **Mention Gating**: Intelligent stream handling with `oncall`, `onmessage`, and `onchar` modes.
- **Durable Deduplication**: Built-in persistent deduplication store to prevent duplicate message processing.
- **Media Support**: Automatically processes Zulip uploads and inline images.
- **Rich Feedback**: Optional reaction-based status indicators for request start, success, and errors.
- **Standardized Observability**: Machine-parseable logs for easy monitoring and troubleshooting.

---

## Prerequisites

- **OpenClaw**: Version `>=2026.6.0`
- **Node.js**: Latest LTS recommended (Node 22+)
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

- **monitor.ts**: Event loop that polls Zulip API, maintains event queue with persistence
- **client.ts**: HTTP client wrapping Zulip REST API
- **reply-handler.ts**: Converts agent responses to Zulip format, handles chunking
- **send.ts**: Message delivery with security validation
- **accounts.ts**: Multi-account configuration resolution

---

## Troubleshooting

### "plugin not found: zulip"

**Cause:** The plugin was installed but "zulip" is not in `plugins.allow`.

**Fix:**
```bash
openclaw config set plugins.allow '["zulip","telegram","memory-core","exa","ollama"]'
openclaw gateway restart
```

### "registerFull already called, skipping duplicate monitor start"

**Status:** Harmless — the host calls `registerFull` twice during startup. The plugin deduplicates this.

### "Health-monitor restarting (reason: stopped)"

**Cause:** The monitor's `statusSink({ running: true })` wasn't called at the start of the monitor loop, so the host thinks the channel is dead.

**Fix:** Ensure `statusSink` is called at the **top** of the monitor function, not conditionally inside event handlers.

### "Invalid config: must not have additional properties: streaming"

**Cause:** The manifest JSON Schema in `openclaw.plugin.json` was missing the `streaming` property that the host wizard writes.

**Fix:** Add `"streaming": { "type": "boolean" }` to both `configSchema` and `channelConfigs.schema` in the manifest.

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

### "not a valid hook pack"
Ensure you cloned to a neutral directory and ran `pnpm install && pnpm run build`.

### Queue Registration Fails
Verify credentials with `openclaw channels add` and re-enter them.

### No Response in Streams
Ensure the bot is a member of the stream and it's in your `streams` config.

### Logs show "mention required"
Default requires @mentions. Check your `chatmode` setting.

---

## Known Issues

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

For security vulnerabilities, please **do not** open a public issue. Contact the maintainer directly through GitHub or email.

---

## License

MIT License - see [LICENSE](LICENSE) file for details.