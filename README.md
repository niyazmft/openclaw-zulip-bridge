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
- [Actionable Refs](#actionable-refs)
- [In-Channel Action Triggers](#in-channel-action-triggers)
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
#    DM the bot first; it replies with a pairing code and the exact approval
#    command to run on your host

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
- **Actionable Refs**: Optionally let the agent emit `[[zulip_ref: …]]` markers that the plugin **validates** against the GitHub API and renders as clickable links (opt-in)
- **In-Channel Action Triggers**: Optionally let a reaction on the bot's own message act as "go" — the configured instruction is dispatched as a turn in the same stream/topic, so work happens in the room (opt-in)
- **Per-Session Queue**: Optionally hold a message that arrives while that topic's run is in progress until the run finishes, so a second person cannot steer the first person's work (opt-in, Zulip-only)
- **Persistent Event Polling**: Automatically resumes from where it left off using locally-persisted queue metadata
- **Durable Deduplication**: Persistent deduplication store prevents duplicate message processing
- **Bot Workspace**: Sandboxed file storage under `{dataDir}/workspace/`
- **SSRF Protection**: Rejects internal IPs, localhost, and AWS metadata endpoints unless `allowInsecureHttp` is opted in
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

Then restart the gateway and run `openclaw channels add` — see [Quick Start](#quick-start) for the full sequence.

### From Source

See [CONTRIBUTING.md](CONTRIBUTING.md#development-setup) for development setup instructions.

## Configuration

### Interactive Setup (Recommended)

Run `openclaw channels add` and select "Zulip (plugin)". The wizard will guide you through:

- **Site URL**: Your Zulip realm URL (e.g., `https://your-org.zulipchat.com`)
- **Bot email**: The email address of your Zulip bot
- **API key**: The API key from your Zulip bot settings
- **DM policy**: who can DM the bot — `pairing` (default), `open`, `allowlist` or `disabled`

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
      "dmPolicy": "pairing",
      "groupAllowFrom": ["you@your-org.zulipchat.com"]
    }
  }
}
```

`streams` and `chatmode` only decide *when* the bot answers: `groupPolicy` defaults to `"allowlist"`, so stream senders must also be named in `groupAllowFrom` (or `allowFrom`) or stream messages are dropped.

#### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `siteUrl` | string | required | Zulip realm URL |
| `apiKey` | string | required | Bot API key |
| `email` | string | required | Bot email address |
| `streams` | string[] | `["*"]` | Streams to monitor (`"*"` = all public streams) |
| `chatmode` | `"oncall"` \| `"onmessage"` \| `"onchar"` | — | When the bot responds in streams: `oncall` needs a mention, `onmessage` replies to every message, `onchar` needs a prefix (`oncharPrefixes`, default `[">", "!"]`). Unset leaves it to `requireMention` |
| `requireMention` | boolean | `true` | Require an @mention in streams; `chatmode` overrides it |
| `dmPolicy` | `"open"` \| `"pairing"` \| `"allowlist"` \| `"disabled"` | `"pairing"` | Who can DM the bot (`"open"` requires `allowFrom` to include `"*"`) |
| `allowFrom` | string[] | `[]` | Allowed DM senders (bot email or numeric user id; only static config may contain `"*"`) |
| `groupPolicy` | `"allowlist"` \| `"open"` \| `"disabled"` | `"allowlist"` | Who can trigger the bot in streams |
| `groupAllowFrom` | string[] | `[]` | Allowed stream senders (falls back to `allowFrom` when empty) |
| `allowInsecureHttp` | boolean | `false` | Allow a plain `http://` site URL and private/internal addresses |
| `enableAdminActions` | boolean | `false` | Enable destructive admin actions |
| `maxMessagesPerMinute` | number | `60` | Rate limit per sender (`0` disables) |
| `showThinkingPlaceholder` | boolean | `false` | Show "Thinking..." placeholder |
| `maxMessageLength` | number | `20000` | Max outbound message length (`0` disables) |
| `dmSessionTurnLimit` | number | `20` | Inbound turns in one DM session before a fresh session starts (`0` disables) |
| `enableSessionRecovery` | boolean | `false` | Recover interrupted messages |
| `sessionArchiveRepair` | boolean | unset (automatic) | Publish stuck session transcript archives; `true` always, `false` never |
| `blockSecretLeaks` | boolean | `true` | Block messages containing credentials |
| `activityTrace` | boolean | `false` | Post one live, in-place-edited status message per work item |
| `traceCoalesceMs` | number | `400` | Coalescing window for trace edits (ms), clamped 0–60000 |
| `traceMaxRate` | number | `2` | Hard ceiling on trace edits per second, clamped 0.1–50 |
| `historyContext` | `"off"` \| `"on-demand"` \| `"always"` | `"off"` | Harvest bounded past stream/topic history into context |
| `historyMaxMessages` | number | `8` | Max earlier messages injected as history (clamped 1–50) |
| `historyWindowHours` | number | `72` | How far back history is considered (clamped 1–8760) |
| `historyMaxChars` | number | `4000` | Hard cap on the rendered history block (clamped 200–20000) |
| `renderRefs` | boolean | `false` | Validate `[[zulip_ref: …]]` markers and render them as links |
| `reactionTriggers` | object | — | Emoji → instruction map; a reaction then dispatches that instruction in-thread |
| `reactionTriggerAnyMessage` | boolean | `false` | Allow triggers on messages the bot did not author |
| `queueMode` | `"off"` \| `"followup"` | `"off"` | Hold a message arriving mid-run until that session's active run finishes |
| `queueCap` | number | `20` | Max messages waiting behind a run, clamped 1–500 (past it, dispatch immediately) |
| `reactions.onQueued` | string | `"hourglass"` | Emoji added to a message waiting in the queue |

#### Environment Variables

Credentials and the site URL can be set through environment variables instead of config. They take precedence over config for the default account only — non-default accounts are config-only.

| Variable | Purpose |
|----------|---------|
| `ZULIP_API_KEY` | Bot API key |
| `ZULIP_EMAIL` | Bot email |
| `ZULIP_URL` | Zulip realm URL |
| `ZULIP_SITE` | Alternative URL variable |
| `ZULIP_REALM` | Realm name |
| `ZULIP_ALLOW_INSECURE_HTTP` | Allow plain HTTP and private/internal addresses (default account only) |

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

The agent can attach files to replies in one step using the core `message` tool's **`upload-file`** action. The host resolves `media` (a local path or an http(s) URL) into the file bytes:

```json
{
  "type": "action",
  "name": "upload-file",
  "params": {
    "to": "stream:general:deploys",
    "media": "/path/to/report.pdf",
    "caption": "Here is the report"
  }
}
```

Or reference sandboxed local paths from a `send` action's `media` field:

```json
{
  "type": "action",
  "name": "send",
  "params": {
    "to": "stream:general:deploys",
    "message": "Here is the image",
    "media": ["workspace/image.png"]
  }
}
```

`upload-file` stages the bytes in the bot workspace (`{dataDir}/workspace/`, path-traversal rejected, pruned after an hour) before uploading. Attachments are read only from the system temp directory, the data dir or the bot workspace, symlinks are refused, and config, credential and session files are refused explicitly even though they sit under the data dir. A relative path (e.g. `workspace/image.png`) is tried against the agent workspace, then the data dir, then the process working directory.

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
history). If the gateway restarts mid-run (deploy, crash, OOM), the next start closes that trace out
as `⚪ **Cancelled** — run interrupted by a gateway restart`, so a topic never keeps a stale
"Working" line.

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

## Actionable Refs

"I opened a PR" is readable but not *actionable*. With `renderRefs: true`, the agent can emit a
structured marker and the plugin turns it into a validated, clickable link:

```
Shipped it in [[zulip_ref: https://github.com/owner/repo/pull/128 | PR #128]] — CI is
[[zulip_ref: https://github.com/owner/repo/actions/runs/12345 | green]].
```

becomes

```
Shipped it in [PR #128](https://github.com/owner/repo/pull/128) — CI is [green](https://github.com/owner/repo/actions/runs/12345).
```

**Validation is real, not cosmetic.** Each ref is checked against the GitHub API before it is
rendered as a link, so the reply is evidence rather than a claim:

| Ref | Validated as |
|---|---|
| `github.com/<owner>/<repo>/pull/<n>` | a pull request |
| `github.com/<owner>/<repo>/issues/<n>` | an issue |
| `github.com/<owner>/<repo>/commit/<sha>` | a commit |
| `github.com/<owner>/<repo>/actions/runs/<id>` | an Actions run |

Anything that cannot be confirmed — a malformed URL, a 404, a rate limit, a timeout, a network
error — renders as plain text (in backticks, so it is not auto-linked) and **the reply still
sends**. A label is optional; without one, the plugin derives one (`owner/repo#128`).

Safety properties worth knowing:

- **Only `https://github.com/...` refs are handled.** Anything else (including internal/private
  hosts and lookalike domains like `github.com.evil.com`) is rejected *before any network request*,
  and the API origin is a hardcoded `https://api.github.com` — there is no configurable host that
  could be widened into an SSRF primitive.
- **No credentials are sent.** Validation is unauthenticated, so private refs simply 404 and degrade
  to plain text. GitHub allows 60 such requests/hour/IP; outcomes are cached for 10 minutes and at
  most 3 refs per message are validated, so a busy topic cannot exhaust that budget.
- **Best effort.** Rendering never throws and is bounded by a 1.5s timeout per message, so it cannot
  break or stall a send.

`renderRefs` defaults to **off**, because it changes how agent prose is interpreted.

## In-Channel Action Triggers

The bridge is otherwise read/send only: a human can reply, but cannot say "go" from inside the topic
and have the agent act there. With `reactionTriggers`, a **reaction becomes an action**:

```json
{
  "channels": {
    "zulip": {
      "reactionTriggers": {
        "+1": "Proceed with the proposed step.",
        "check": "Ship it and open the PR."
      }
    }
  }
}
```

When an authorised user reacts 👍 on the bot's own message in a monitored stream, the mapped
instruction is dispatched as a normal turn for **that same stream/topic session** — so the agent
acts where the discussion already is, and its reply (and activity trace) land in the same topic.

**A reaction is a trigger, not an authorisation bypass.** The synthetic turn carries the reacting
human as its sender, so every existing decision is made about *them*: `dmPolicy`/`groupPolicy`, the
static and persisted allowlists, the control-command gate and the per-sender rate limit all still
apply. A stranger's reaction does nothing.

Safety rules:

- **Only the bot's own messages are actionable by default.** A reaction is an approval of the agent's
  proposal; reacting to someone else's message should not make the agent act on it. Set
  `reactionTriggerAnyMessage: true` deliberately if you want that.
- **The bot must be subscribed to the stream.** Zulip delivers `reaction` events only to
  *subscribers* of the stream, while `message` events arrive anyway (the queue uses
  `all_public_streams`) — so an unsubscribed stream fails **silently**: the trigger simply never fires.
  The plugin checks at startup and warns with the streams you are missing (or, with `streams: ["*"]`,
  prints the subscribed list so you can compare). To fix it, subscribe the bot in Zulip's
  stream settings, or `POST /api/v1/users/me/subscriptions`.
- **Streams only**, and only streams this account monitors.
- **Fired once per (message, emoji, user)** — repeated taps, reaction toggles and replayed events use
  the existing on-disk dedupe store, so a restart cannot re-trigger work.
- **Audited**: each dispatch writes a `reaction_trigger` audit event.
- **Off by default.** With no `reactionTriggers` map, no trigger emoji is recognised and the
  `reaction` event type is not even requested from Zulip.

What this deliberately is **not**: it does not launch arbitrary named workflows or scripts. The
trigger is an instruction to the agent that is already in this conversation, so its blast radius is
the same as someone typing that sentence.

**Emoji names** are the Zulip API names, not glyphs: 👍 is `+1`, 👀 is `eyes`. A name that does not
match a Zulip emoji name never fires.

### Reaction trigger does nothing

Work through these in order — the plugin logs (or audit-logs) each stage:

1. **Is the bot subscribed to that stream?** This is the most common cause, and it is silent by
   nature. Check the startup warning ("will not fire in monitored streams the bot is not subscribed
   to") or `GET /api/v1/users/me/subscriptions`.
2. **Is the emoji in `reactionTriggers`?** The map is keyed by the Zulip emoji name (`+1`, `check`, …).
3. **Did the trigger fire?** A fired trigger writes a `reaction_trigger` event to
   `{dataDir}/audit/{accountId}.audit.log`, so the audit log tells you whether the plugin saw it.
4. **Was the reaction on the bot's own message?** A reaction on someone else's message is ignored
   unless `reactionTriggerAnyMessage: true`.
5. **Could the reacting user's email be resolved?** The plugin resolves it from `user_id` (the event
   carries no user object) and drops the trigger with a warning if that fails, so a broken sender
   never reaches the allowlist as an un-authorizable numeric id.

**If you cannot see any of that**: plugin child-logger output does not necessarily reach the host
log — on Termux the gateway log contained **zero** plugin lines while the host's own lines were all
present. Use the audit log (`{dataDir}/audit/{accountId}.audit.log`, which records
`reaction_trigger` and `reaction_trigger_subscription_gap`) and the Zulip API for verification
instead of assuming the plugin is silent.

### Two People in One Topic

A Zulip topic is **one conversation**: everyone in it shares one session, so the bot works one request
at a time there. What happens to a second request that arrives mid-run is the host's decision, and
the default is not friendly to a shared room — `steer` pushes the new message *into* the running
turn, so teammate B can redirect teammate A's work.

The host can be configured to wait instead (`messages.queue.mode: "followup"`), but:

- the per-channel form (`messages.queue.byChannel.zulip`) is rejected — `byChannel` accepts only
  *known/bundled* channel ids, and Zulip is a third-party plugin channel (`Unrecognized key:
  "zulip"`);
- there is no global mode that affects only Zulip, and changing `messages.queue.mode` would also
  change your other channels (e.g. Telegram).

So the plugin queues for itself, Zulip-only (`queueMode: "followup"`):

```json
{ "channels": { "zulip": { "queueMode": "followup" } } }
```

- A message arriving while a run is active for that topic (or DM) **waits its turn** instead of
  being steered into it. Separate topics are unaffected — they are separate sessions, so they still
  run in parallel.
- The waiting message gets a reaction — **⏳**, because `reactions.onQueued` defaults to the
  Zulip emoji name `hourglass` — since Zulip has no "queued input" surface. 👀 still means received
  and ✅ still means finished.
- Past `queueCap` a message is dispatched **immediately rather than dropped**.
- Each transition is **audit-logged** as `message_queued` / `message_dequeued` (with the message id and
  how many were waiting): the reaction is transient — it disappears the moment the turn starts — and
  plugin logs do not surface on every host, so the audit file is the durable proof that the queue
  engaged.

For genuinely parallel work use separate topics; for private work use DMs (per-user sessions).

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

Or from source without `--link` (this deletes the repo's own build and check scripts, so work in a
copy or restore them afterwards):
```bash
rm -rf scripts/
openclaw plugins install ./ --force
```

### "plugin not found: zulip" after installing

1. Restart the gateway: `openclaw gateway restart`
2. Check that the plugin is in the extensions dir: `ls ~/.openclaw/extensions/zulip/`

### No Response in Streams

Check three things: the bot is subscribed to the stream and `streams` includes it (or is `["*"]`);
the sender is named in `groupAllowFrom` (or `allowFrom`), because the default `groupPolicy` is
`"allowlist"` and an empty allowlist drops every stream message; and the message satisfies the
mention rule for your `chatmode`.

### Logs show "mention required"

Streams require an @mention unless `chatmode: "onmessage"` (or `requireMention: false`) is set.

For everything else — health-monitor restarts, duplicate `registerFull` calls, typing indicators,
fallback reader, humanDelay, status message leaks, session conflation, the Node 24 / ESM race, and
the rest — see [AGENTS.md#troubleshooting](AGENTS.md#troubleshooting).

## Documentation

- **[AGENTS.md](AGENTS.md)** — Architecture, build/test details, CI, SDK migration notes, full troubleshooting, security & permissions, known issues
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — Development setup, project structure, testing, PR process
- **[SECURITY.md](SECURITY.md)** — Security policy, credential handling, data access, audit logging
- **[CHANGELOG.md](CHANGELOG.md)** — Release history

## Related

- [zulip-hermes-integration](https://github.com/niyazmft/zulip-hermes-integration) — the Hermes (Python) sibling adapter in the same Zulip agent family

## License

MIT License - see [LICENSE](LICENSE) file for details.
