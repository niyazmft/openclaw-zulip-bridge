# OpenClaw Zulip Bridge

[![Version](https://img.shields.io/badge/version-2026.9.1-blue)](https://github.com/niyazmft/openclaw-zulip-bridge/releases)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-%3E%3D2026.7.1-green)](https://openclaw.ai)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-brightgreen)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-10.32.1-orange)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

High-performance OpenClaw channel plugin for Zulip streams and private messages with persistent event queues, traffic policies, and comprehensive observability.

> 🔗 **Part of a single Zulip adapter family for open-source AI agents.**
> This repo is the **OpenClaw** adapter (TypeScript). Its sibling,
> [`zulip-hermes-integration`](https://github.com/niyazmft/zulip-hermes-integration), does the
> same thing for the **Hermes (Nous Research)** agent (Python). Same thesis, two runtimes:
> bring a self-hosted AI agent into threaded, topic-first Zulip chat as a full teammate —
> sovereign, no chat-vendor lock-in. The pattern Slack and Block's Buzz are racing to
> productize, delivered **open source** and **self-hosted**.

## Table of Contents

- [Quick Start](#quick-start)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Progressive Activity Trace](#progressive-activity-trace)
- [History-aware Context](#history-aware-context)
- [Verification](#verification)
- [Attaching Local Files](#attaching-local-files)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)

## Quick Start

```bash
# 1. Install from ClawHub
openclaw plugins install clawhub:@niyazmft/openclaw-zulip

# 2. Restart the gateway
openclaw gateway restart

# 3. Run the interactive setup wizard
openclaw channels add
# → Select "Zulip (plugin)" → enter API key, email, URL → route to agent

# 4. Approve yourself for DMs (dmPolicy defaults to "pairing")
#    Send a DM to your bot first, then copy the pairing code and run:
openclaw channels allow-from zulip <your-email>

# 5. Test
#    Send a DM to your bot or mention it in a stream
```

## Features

- **Streams & Topics**: Full Zulip stream/topic support with mention gating (`oncall`, `onmessage`, `onchar` modes)
- **DMs with Pairing**: Private messages with per-user session isolation and traffic policy controls
- **Reactions & Typing Indicators**: Optional reaction-based status indicators and typing indicators
- **File Attachments**: Upload generated files via `upload-file` action or reference sandboxed local paths
- **Progressive Activity Trace**: An optional, in-place-updated status message that shows work in the topic while the agent runs (opt-in)
- **History-aware Context**: Optionally harvest bounded past stream/topic history into the agent's context so it can answer "have we seen this before?" with real evidence from the topic
- **Persistent Event Polling**: Automatically resumes from where it left off using locally-persisted queue metadata
- **Durable Deduplication**: Persistent deduplication store prevents duplicate message processing
- **Bot Workspace**: Sandboxed file storage under `data/zulip-workspace/`
- **SSRF Protection**: Rejects internal IPs, localhost, and AWS metadata endpoints
- **Security Hardening**: URL encoding, path traversal sanitization, symlink rejection
- **Multiple Accounts**: Support for multiple Zulip accounts and realms in a single instance

## Prerequisites

- **OpenClaw**: Version `>=2026.7.1`
- **Node.js**: Latest LTS recommended (Node 22+)
- **Zulip Bot**: A registered bot on your Zulip realm

See [AGENTS.md](AGENTS.md) for Node 24 / CJS Gateway host compatibility notes and runtime requirements.

### Creating a Zulip Bot

1. Go to your Zulip realm settings → **Bots** → **Add a new bot**
2. Choose **Generic bot** type
3. Copy the **Bot email** and **API key** — you'll need these during setup

## Installation

### From ClawHub (Recommended)

```bash
openclaw plugins install clawhub:@niyazmft/openclaw-zulip
```

Then restart the gateway and run the interactive setup wizard:

```bash
openclaw gateway restart
openclaw channels add
```

### From Source

See [CONTRIBUTING.md](CONTRIBUTING.md#development-setup) for development setup instructions.

## Configuration

### Interactive Setup (Recommended)

Run `openclaw channels add` and select "Zulip (plugin)". The wizard will guide you through:

- **Site URL**: Your Zulip realm URL (e.g., `https://your-org.zulipchat.com`)
- **Bot email**: The email address of your Zulip bot
- **API key**: The API key from your Zulip bot settings
- **Allow list**: Who can DM the bot (pairing required by default)

### Manual Configuration

Edit `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "zulip": {
      "accounts": [
        {
          "id": "default",
          "siteUrl": "https://your-org.zulipchat.com",
          "apiKey": "your-api-key",
          "email": "your-bot@your-org.zulipchat.com"
        }
      ],
      "streams": ["general", "dev"],
      "chatmode": "onmessage",
      "dmPolicy": "pairing"
    }
  }
}
```

#### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `siteUrl` | string | required | Zulip realm URL |
| `apiKey` | string | required | Bot API key |
| `email` | string | required | Bot email address |
| `streams` | string[] | `["general"]` | Streams to monitor |
| `chatmode` | `"oncall"` \| `"onmessage"` \| `"onchar"` | `"onmessage"` | When the bot responds in streams |
| `dmPolicy` | `"open"` \| `"pairing"` \| `"closed"` | `"pairing"` | Who can DM the bot |
| `allowFrom` | string[] | `[]` | Allowed sender emails (for pairing) |
| `groupAllowFrom` | string[] | `[]` | Allowed group IDs |
| `enableAdminActions` | boolean | `false` | Enable destructive admin actions |
| `maxMessagesPerMinute` | number | `60` | Rate limit per sender |
| `showThinkingPlaceholder` | boolean | `false` | Show "Thinking..." placeholder |
| `maxMessageLength` | number | `20000` | Max outbound message length |
| `enableSessionRecovery` | boolean | `false` | Recover interrupted messages |
| `sessionArchiveRepair` | boolean | `auto` | Repair stuck session archives |
| `blockSecretLeaks` | boolean | `true` | Block messages containing credentials |
| `activityTrace` | boolean | `false` | Post one live, in-place-edited status message per work item |
| `traceCoalesceMs` | number | `400` | Coalescing window for trace edits (ms) |
| `traceMaxRate` | number | `2` | Hard ceiling on trace edits per second |
| `historyContext` | `"off"` \| `"on-demand"` \| `"always"` | `"off"` | Harvest bounded past stream/topic history into context |
| `historyMaxMessages` | number | `8` | Max earlier messages injected as history |
| `historyWindowHours` | number | `72` | How far back history is considered |
| `historyMaxChars` | number | `4000` | Hard cap on the rendered history block |

#### Environment Variables

All config options can be overridden via environment variables:

| Variable | Purpose |
|----------|---------|
| `ZULIP_API_KEY` | Bot API key |
| `ZULIP_EMAIL` | Bot email |
| `ZULIP_URL` | Zulip realm URL |
| `ZULIP_SITE` | Alternative URL variable |
| `ZULIP_REALM` | Realm name |
| `ZULIP_ALLOW_INSECURE_HTTP` | Allow plain HTTP (LAN only) |

## Verification

Send a test message to verify the bot is responding:

```bash
# In a stream (if chatmode allows)
@**bot-name** hello

# Or in a DM
hello bot
```

The bot should respond with a helpful message. Check `openclaw logs` if it doesn't.

## Attaching Local Files

The agent can attach files to replies in one step using the core `message` tool's **`upload-file`** action:

```json
{
  "type": "action",
  "name": "upload-file",
  "params": {
    "source": "/path/to/file.pdf",
    "caption": "Here is the report"
  }
}
```

Or reference sandboxed local paths in the `media` field:

```json
{
  "type": "message",
  "content": "Here is the image",
  "media": ["data/zulip-workspace/default/image.png"]
}
```

Files are staged in the bot workspace (`data/zulip-workspace/{accountId}/`) with path-traversal rejection.

## Progressive Activity Trace

By default the room only sees the agent's **final reply**, so a run that takes a while (or ends
without a reply at all) is invisible. With `activityTrace: true`, the plugin keeps **one
dedicated bot-owned status message per work item** and edits it in place as the run progresses:

```
zulip-bot · **Working** — fix the failing auth test
          - ✅ $ git status --short (0.2s)
          - ✅ $ npm test (12s)
          - 💬 switching to a rebase instead of a merge
          - ⏳ $ git push
```

When the run ends, the block collapses to one compact line (`✅ **Done** — run finished in 18s`).
The message is never deleted, so the topic keeps an audit trail (Zulip also keeps its own edit
history).

### The rule

**Status detail edits the trace. Actionable results are posted as new messages.** That keeps the
topic readable while still producing a durable record, instead of one message per tool call.

### Two trigger modes

| Mode | Source | Notes |
|------|--------|-------|
| **A — plugin-driven** | The host's `after_tool_call` hook, filtered to `exec` | Automatic; no agent cooperation needed. Best-effort per runtime/harness. |
| **B — agent-driven** | The `zulip_progress` tool | Lets the agent narrate intent the plugin cannot infer ("about to ask a clarifying question", "switching approach"). No-op when no trace is active. |

Mode A never registers `before_tool_call` (it is a fail-closed gate that could block the agent's own
tool call). Mode B is unaffected when the host's tool profile strips plugin tools — the run-boundary
trace still appears.

### Coalescing and rate limits

Zulip edits are ~600ms round-trips, so the trace is a status board, not a metronome:

- `traceCoalesceMs` (default `400`) collapses bursty updates into a single edit.
- `traceMaxRate` (default `2`) is a hard ceiling on edits per second, in addition to coalescing.
- An unchanged render never spends an edit at all.

### Failure policy

Tracing is **best-effort and never blocking**. A failed post drops that trace; a failed edit is
logged and dropped — there is no retry loop (unbounded retries against Zulip are how you flood the
gateway log) and no user-visible error. A dead trace can never turn a successful reply into a failed
dispatch. Trace writes are also credential-redacted, because trace edits do not pass through the
normal outbound secret guard.

`activityTrace` defaults to **off**: the feature adds outbound writes, so it ships opt-in. With it
off, behaviour is identical to a build without it.

## History-aware Context

The plugin's only durable record of a topic is Zulip itself, but by default the agent sees just the
current message plus whatever survived in its own runtime memory — so "have we seen this error
before?" gets answered from vibes rather than the team's actual history.

With `historyContext` enabled, the bridge harvests a **bounded** slice of the current stream/topic
and adds it to the agent's prompt as evidence:

```
[Zulip history — 3 earlier message(s) in #main / deploys]
- Dana (3d ago): same 502 on the auth service, it was the connection pool limit
- Bot (3d ago): raised max_connections to 50 in commit 4f2c1ab
- Niyaz (1h ago): it is back after the config revert
[end history]
```

- **`off` (default)** — never harvest.
- **`on-demand`** — only when the message looks like a "do we know this?" question (the intent
  patterns are deliberately narrow). Recommended: a harvest is one extra Zulip round-trip (~600ms)
  on the reply path and costs context budget.
- **`always`** — every inbound stream message carries the block.

**Bounded on every axis.** `historyMaxMessages` (8), `historyWindowHours` (72) and
`historyMaxChars` (4000) cap the block, and the selection keeps the *newest* lines, so a topic with
months of history can never blow up the context window.

**Best-effort.** A slow or failing harvest is logged and dropped — it can never fail a dispatch —
and it is wrapped in a 2s timeout so a retrying API call cannot stall a reply.

**Streams/topics only.** This applies to stream messages: DMs keep their per-user session continuity
and strict isolation, so harvesting them would add privacy surface for little gain. The block is
appended to the agent-facing prompt only; commands are unaffected.

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

**Fixed in v2026.8.3+.** The monitor now starts via `gateway.startAccount` inside the plugin's `base` parameter. Upgrade to the latest release.

### "registerFull already called, skipping duplicate monitor start"

**Status:** Harmless in v2026.8.3+. The plugin has a module-level `registerFullCalled` guard.

### No Response in Streams

Ensure the bot is a member of the stream and it's in your `streams` config.

### Logs show "mention required"

Default requires @mentions. Check your `chatmode` setting.

For all other runtime issues (typing indicators, fallback reader, humanDelay, status message leaks, session conflation, Node 24 / ESM race, etc.), see [AGENTS.md#troubleshooting](AGENTS.md#troubleshooting).

## Documentation

- **[AGENTS.md](AGENTS.md)** — Architecture, build/test details, CI, SDK migration notes, full troubleshooting, security & permissions, known issues
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — Development setup, project structure, testing, PR process
- **[SECURITY.md](SECURITY.md)** — Security policy, credential handling, data access, audit logging
- **[CHANGELOG.md](CHANGELOG.md)** — Release history

## Related

- [zulip-hermes-integration](https://github.com/niyazmft/zulip-hermes-integration) — the Hermes (Python) sibling adapter in the same Zulip agent family

## License

MIT License - see [LICENSE](LICENSE) file for details.
