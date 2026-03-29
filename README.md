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

```bash
# Command depends on your environment, e.g.:
# openclaw start
```

**Verification Steps:**
- **Check Logs**: Look for `[zulip] queue registered` or `[zulip] queue loaded` to confirm a successful connection.
- **Test DM**: Send a Direct Message to the bot. If `dmPolicy` is `pairing`, it should respond with a pairing code.
- **Test Stream**: Mention the bot in the configured stream (e.g., `@bot-name hello`). The bot should receive the message and respond.

## Troubleshooting

- **Queue Registration Fails**: Verify your `ZULIP_URL` is correct and reachable, and that `ZULIP_API_KEY` and `ZULIP_EMAIL` match exactly what is in your Zulip bot settings.
- **Bot Not Responding in Streams**: Ensure the bot is a member of the stream and that the stream name is included in the `streams` array in your config.
- **Plugin Not Recognized**: Run `openclaw plugins list` to verify `zulip` is installed and enabled. If not, re-run the `install` and `enable` commands from Step 1.
- **Logs show `mention required`**: By default, the bot only responds to @mentions in streams. Ensure you are actually mentioning the bot or change `chatmode` to `onmessage`.

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
