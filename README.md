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

## Quickstart: Enable Zulip on a New Device

Follow these steps to get Zulip running on a fresh OpenClaw setup.

### 1. Clone and Install
Clone this repository to your device and install it as a linked plugin:

```bash
git clone https://github.com/niyazmft/openclaw-zulip-bridge.git
cd openclaw-zulip-bridge
openclaw plugins install ./ --link
openclaw plugins enable zulip
```

> **Note on Linked Plugins**: The `--link` flag creates a symbolic link from the OpenClaw extensions directory (typically `~/.openclaw/extensions/zulip`) back to your local repository checkout. This means the local repo **is** the source of truth for the installed plugin; any local code changes are reflected immediately after an OpenClaw restart without re-installing.

### 2. Set Credentials
Set the required environment variables for your Zulip bot. These take precedence over configuration file fields for the default account.

```bash
export ZULIP_EMAIL="bot@example.com"
export ZULIP_API_KEY="your-api-key"
export ZULIP_URL="https://chat.example.com"
```

### 3. Configure OpenClaw
Add the Zulip channel to your `openclaw.config.json`. This minimal setup enables the bridge and monitors a specific stream.

```json
{
  "channels": {
    "zulip": {
      "enabled": true,
      "streams": ["bot-testing"],
      "dmPolicy": "pairing"
    }
  }
}
```

### 4. Restart and Verify
Restart OpenClaw to apply the changes.

| Environment | Restart Command |
| --- | --- |
| **Systemd** | `systemctl restart openclaw` |
| **PM2** | `pm2 restart openclaw` |
| **Manual/CLI** | `Ctrl+C` then restart (e.g., `openclaw start`) |

**Verification Steps:**
- **Check Logs**: Confirm success by looking for the initialization marker:
  - `zulip queue registered [accountId=default queueId=... lastEventId=...]`
  - (Or `zulip queue loaded [...]` if resuming from a previous session)
- **Test DM**: Send a Direct Message to the bot. If `dmPolicy` is `pairing` (default), it should respond with a pairing code.
- **Test Stream**: Mention the bot in the configured stream (e.g., `@bot-name hello`). The bot should receive the message and respond.

Success is confirmed when the bot is both **registered** in logs and **responding** to messages.

## Configure Zulip in openclaw.json

While environment variables are great for secrets in the default account, you can also configure Zulip directly in your `openclaw.json` (or `openclaw.config.json`). This is required for multi-account setups or when using advanced policies.

### Reference Configuration

```json
{
  "channels": {
    "zulip": {
      "enabled": true,
      "site": "https://<your-realm>.zulipchat.com/",
      "email": "<bot-email>",
      "apiKey": "<bot-api-key>",
      "dmPolicy": "allowlist",
      "allowFrom": ["<authorized-user@example.com>"],
      "blockStreaming": true
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
        "/data/data/com.termux/files/home/.openclaw/extensions/zulip"
      ]
    }
  }
}
```

### Configuration Fields

- **`enabled`**: (boolean) Set to `true` to enable the Zulip channel.
- **`site` / `url` / `realm`**: (string) The base URL of your Zulip server. These are interchangeable aliases.
- **`email`**: (string) The email address of your Zulip bot.
- **`apiKey`**: (string) The API key for your Zulip bot.
- **`dmPolicy`**: (string) Controls who can DM the bot. Options: `pairing`, `allowlist`, `open`, `disabled`.
- **`allowFrom`**: (string[]) A list of authorized Zulip emails or user IDs allowed to interact with the bot (used by `allowlist` and `pairing` policies).
- **`blockStreaming`**: (boolean) Enable or disable block-based streaming for responses.

For more advanced options like multi-account support, custom reactions, and stream-specific policies, see [docs/config.md](docs/config.md).

## Troubleshooting

- **Plugin Not Recognized**: Run `openclaw plugins list` to verify `zulip` is installed and enabled.
  - Check the symlink: `ls -l ~/.openclaw/extensions/zulip` should point to your repo checkout.
- **Queue Registration Fails**: Verify `ZULIP_URL` is reachable, and `ZULIP_API_KEY` matches exactly.
- **Bot Not Responding in Streams**: Ensure the bot is a member of the stream and that the stream name is in the `streams` array.
- **Logs show `mention required`**: By default, the bot only responds to @mentions in streams. Mention the bot or change `chatmode` to `onmessage`.

## Advanced Configuration

The bridge supports complex setups, including multiple accounts and custom traffic policies.

- **Multiple Accounts**: See [docs/config.md](docs/config.md) for how to define additional accounts.
- **Traffic Policies**: Detailed info on `dmPolicy` and `groupPolicy` is available in [docs/config.md](docs/config.md).
- **Observability**: For machine-parseable log schemas and monitoring tips, see [docs/observability.md](docs/observability.md).

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

### Project Structure

- `src/` — Plugin source code
  - `zulip/` — Zulip-specific client, monitoring, and policy logic
- `test/` — Local regression tests
- `docs/` — Supporting documentation

## License

Refer to the root project license for terms and conditions.
