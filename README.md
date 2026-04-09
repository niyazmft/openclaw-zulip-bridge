# OpenClaw Zulip Bridge

The OpenClaw Zulip Bridge is a high-performance channel plugin for OpenClaw that enables interaction with Zulip streams and private messages. It features a robust, persistent event queue system, flexible traffic policies, and comprehensive observability.

## Features

- **Persistent Event Polling**: Automatically resumes from where it left off using locally-persisted queue metadata, surviving restarts without missing messages.
- **Traffic Policies**: Granular control over who can interact with the bot in DMs (`pairing`, `allowlist`, `open`, `disabled`) and Streams (`allowlist`, `open`, `disabled`).
- **Multiple Accounts**: Support for multiple Zulip accounts and realms in a single instance.
- **Mention Gating**: Intelligent stream handling with `oncall` (mention required), `onmessage` (responds to all), and `onchar` (trigger-character based) modes.
- **Durable Deduplication**: Built-in persistent deduplication store to prevent duplicate message processing.
- **Media Support**: Automatically downloads and processes Zulip uploads and inline images.
- **Rich Feedback**: Optional reaction-based status indicators for request start, success, and errors.
- **Standardized Observability**: Machine-parseable logs for easy monitoring and troubleshooting.

## Prerequisites

Before installing the Zulip bridge, ensure you have:
- **OpenClaw**: Version `>=2026.3.23`
- **Node.js**: Latest LTS recommended
- **Zulip Bot**: A registered bot on your Zulip realm.
  1. Go to **Settings → Your Bots → Add a new bot**.
  2. Choose **Generic bot** type.
  3. Note your **Bot Email**, **API Key**, and **Zulip URL**.

## Quickstart: Enable Zulip on a New Device

Follow these steps to get Zulip running on a fresh OpenClaw setup.

### 1. Clone and Install
The extension must be installed inside your OpenClaw extensions directory. Navigate there first (creating it if necessary), then clone and install:

```bash
mkdir -p ~/.openclaw/extensions/
cd ~/.openclaw/extensions/
git clone https://github.com/niyazmft/openclaw-zulip-bridge.git
cd openclaw-zulip-bridge
npm install
openclaw plugins install ./ --link
openclaw plugins enable zulip
```



> **Note on Linked Plugins**: The `--link` flag creates a symbolic link from the OpenClaw extensions directory (typically `~/.openclaw/extensions/zulip`) back to your local repository checkout. This means the local repo **is** the source of truth for the installed plugin; any local code changes are reflected immediately after an OpenClaw restart without re-installing.

### 2. Configure OpenClaw
It is highly recommended to use **environment variables** for your Zulip credentials to avoid storing secrets in plaintext in your configuration file.

#### Recommended: Using Environment Variables
Set the following variables in your shell or `.env` file:
- `ZULIP_API_KEY`: Your bot's API key.
- `ZULIP_EMAIL`: Your bot's email address.
- `ZULIP_URL`: The base URL of your Zulip server.

Then, your `~/.openclaw/openclaw.json` can remain simple:
```json
{
  "channels": {
    "zulip": {
      "enabled": true,
      "dmPolicy": "allowlist",
      "allowFrom": [
        "user@example.com"
      ]
    }
  },
  "plugins": {
    "allow": ["zulip"],
    "entries": {
      "zulip": {
        "enabled": true
      }
    },
    "load": {
      "paths": [
        "~/.openclaw/extensions/zulip"
      ]
    }
  }
}
```

### 3. Restart and Verify
Restart OpenClaw to apply the changes.

**Verification Steps:**
- **Check Logs**: Confirm success by looking for the initialization marker:
  - `zulip queue registered [accountId=default queueId=... lastEventId=...]`
  - (Or `zulip queue loaded [...]` if resuming from a previous session)
- **Test DM**: Send a Direct Message to the bot. If `dmPolicy` is `pairing` (default), it should respond with a pairing code.
- **Test Stream**: Mention the bot in the configured stream (e.g., `@bot-name hello`). The bot should receive the message and respond.

Success is confirmed when the bot is both **registered** in logs and **responding** to messages.

## ClawHub Resources

The bridge is published and maintained on [ClawHub](https://clawhub.ai):

- **Plugin**: [OpenClaw Zulip Bridge](https://clawhub.ai/plugins/%40openclaw%2Fzulip) (`@openclaw/zulip`) — The core channel engine.
- **Skill**: [Zulip Bridge](https://clawhub.ai/niyazmft/zulip-bridge) (`zulip-bridge`) — The AI agent instructions.

To install via ClawHub:
```bash
openclaw plugins install clawhub:@openclaw/zulip
```

## Configuration Fields

The setup is designed to work within `~/.openclaw/openclaw.json`. Here are the core fields you can configure:

- **`enabled`**: (boolean) Set to `true` to enable the Zulip channel.
- **`site`**: (string) The base URL of your Zulip server. These are interchangeable aliases.
- **`email`**: (string) The email address of your Zulip bot.
- **`apiKey`**: (string) The API key for your Zulip bot.
- **`streams`**: (string[]) List of streams to monitor. Use `["*"]` for all.
- **`dmPolicy`**: (string) Controls who can DM the bot. Options: `pairing`, `allowlist`, `open`, `disabled`.
- **`groupPolicy`**: (string) Controls stream access. Options: `allowlist`, `open`, `disabled`.
- **`allowFrom`**: (string[]) Authorized Zulip emails or user IDs (for DMs and commands).
- **`chatmode`**: (enum) `oncall` (default), `onmessage`, or `onchar`.
- **`streaming`**: (boolean) Core OpenClaw field to enable/disable response streaming.

For a full list of over 20+ configuration options (reactions, media limits, etc.), see [docs/config.md](docs/config.md).

## Troubleshooting

- **Plugin Not Recognized**: Run `openclaw plugins list` to verify `zulip` is installed and enabled.
  - Check the symlink: `ls -l ~/.openclaw/extensions/zulip` should point to your repo checkout.
- **Queue Registration Fails**: Verify `ZULIP_URL` is reachable, and that `ZULIP_API_KEY` and `ZULIP_EMAIL` match exactly.
- **Bot Not Responding in Streams**: Ensure the bot is a member of the stream and that the stream name is in the `streams` array.
- **Logs show `mention required`**: By default, the bot only responds to @mentions in streams. Mention the bot or change `chatmode` to `onmessage`.

## Advanced Configuration

The bridge supports complex setups, including multiple accounts and custom traffic policies.

- **Multiple Accounts**: See [docs/config.md](docs/config.md) for how to define additional accounts.
- **Traffic Policies**: Detailed info on `dmPolicy` and `groupPolicy` is available in [docs/config.md](docs/config.md).
- **Observability**: For machine-parseable log schemas and monitoring tips, see [docs/observability.md](docs/observability.md).
- **Smoke Testing**: Step-by-step verification guide in [docs/smoke-test.md](docs/smoke-test.md).

## Development

### Prerequisites

- Node.js (Latest LTS recommended)
- `npm`

### Local Setup

1. Install dependencies for plugin development:
   ```bash
   npm install
   ```

2. Run tests and type checks:
   ```bash
   npm run check
   ```

This `npm install` step is for **contributing to or testing the plugin codebase**; it is not the command for installing the plugin into your OpenClaw runtime.

> **Note on `devDependencies`**: This project requires `typescript` and other dev tools for its build and validation steps. A `.npmrc` file is included to ensure these are installed even if `NODE_ENV=production` is set in your environment.

### Project Structure

- `src/` — Plugin source code
  - `zulip/` — Zulip-specific client, monitoring, and policy logic
- `test/` — Local regression tests
- `docs/` — Supporting documentation

## License

Refer to the root project license for terms and conditions.
