# OpenClaw Zulip Bridge

The OpenClaw Zulip Bridge is a high-performance channel plugin for OpenClaw that enables interaction with Zulip streams and private messages. It features a robust, persistent event queue system, flexible traffic policies, and comprehensive observability.

## Features

- **Persistent Event Polling**: Automatically resumes from where it left off using locally-persisted queue metadata.
- **Traffic Policies**: Granular control over who can interact with the bot in DMs and Streams.
- **Multiple Accounts**: Support for multiple Zulip accounts and realms in a single instance.
- **Mention Gating**: Intelligent stream handling with `oncall`, `onmessage`, and `onchar` modes.
- **Durable Deduplication**: Built-in persistent deduplication store to prevent duplicate message processing.
- **Media Support**: Automatically processes Zulip uploads and inline images.
- **Rich Feedback**: Optional reaction-based status indicators for request start, success, and errors.
- **Standardized Observability**: Machine-parseable logs for easy monitoring and troubleshooting.

## Prerequisites

- **OpenClaw**: Version `>=2026.3.28`
- **Node.js**: Latest LTS recommended (Node 22+)
- **Zulip Bot**: A registered bot on your Zulip realm (Settings -> Your Bots -> Add a new bot).

## Installation

The bridge can be installed via ClawHub or from source:

### From ClawHub (Recommended)
```bash
openclaw plugins install clawhub:@openclaw/zulip
```

### From Source
```bash
git clone https://github.com/niyazmft/openclaw-zulip-bridge.git ~/.openclaw/extensions/zulip
cd ~/.openclaw/extensions/zulip
npm install
openclaw plugins install ./ --link
```

## Setup: Use OpenClaw Onboarding (Preferred)

Once installed, the preferred way to configure the Zulip bridge is using the OpenClaw onboarding wizard. This interactive setup handles credential validation and stream discovery.

Run the setup command:
```bash
openclaw plugins setup zulip
```

### Onboarding Features
- **Environment Variable Detection**: Automatically detects `ZULIP_API_KEY`, `ZULIP_EMAIL`, and `ZULIP_URL` if they are already set in your environment.
- **Credential Validation**: Probes the Zulip API to verify your bot's credentials before saving.
- **Stream Discovery**: Fetches the list of streams your bot is subscribed to and lets you choose which ones to monitor.
- **DM Policy Configuration**: Easily set your preferred DM policy (pairing, open, allowlist, or disabled).

## Manual Configuration (Fallback)

While onboarding is recommended, you can also manually configure the bridge in your `openclaw.json`.

### Recommended: Use Environment Variables
To keep secrets out of your configuration file, set these in your environment:
- `ZULIP_API_KEY`: Your bot's API key.
- `ZULIP_EMAIL`: Your bot's email address.
- `ZULIP_URL`: The base URL of your Zulip server.

### Example `openclaw.json` entry:
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

## Verification & First-Time Test

After completing the setup, verify the bridge is working correctly:

1. **Check Logs**: Look for the registration success marker:
   `zulip queue registered [accountId=default queueId=... lastEventId=...]`
2. **Test Direct Message**: Send a private message to the bot. If using the default `pairing` policy, it should respond with a pairing code.
3. **Test Stream Mention**: Mention the bot in a monitored stream (e.g., `@bot-name hello`). It should receive the message and respond.

## Troubleshooting

- **Queue Registration Fails**: Verify `ZULIP_URL` is reachable and credentials are correct. Use `openclaw plugins setup zulip` to re-verify.
- **No Response in Streams**: Ensure the bot is a member of the stream and that the stream is listed in your `streams` config (or use `["*"]`).
- **Logs show "mention required"**: By default, the bot only responds to @mentions in streams. Check your `chatmode` setting.

## Development

### Local Setup
1. `npm install`
2. `npm run check` (Runs type-checks, build, and tests)

### Project Structure
- `src/` — Plugin source code.
  - `zulip/` — Zulip client and monitoring logic.
- `test/` — Unit and integration tests.
- `types/` — SDK type definitions and shims.
- `openclaw.plugin.json` — Plugin manifest.

## License

Refer to the root project license for terms and conditions.
