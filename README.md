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

## Getting Started

### Installation

This repository is currently distributed as a **sideloaded local OpenClaw plugin**, not as a published npm package.

Do **not** run:

```bash
npm install @openclaw/zulip
```

That package is not currently published to the npm registry, and this repo is marked `private`, which matches the current sideload-only distribution model.

Instead, install the plugin from a local checkout/path:

```bash
openclaw plugins install /path/to/openclaw-zulip-bridge --link
openclaw plugins enable zulip
```

Notes:
- `--link` keeps the plugin connected to your working tree, which is useful for staging and sideload setups.
- You can also install from a local path without `--link` if you want OpenClaw to copy the plugin into its managed extensions area.
- This repo ships `openclaw.plugin.json`, so OpenClaw can discover it as a native local plugin.

### Basic Configuration

For the **default account**, you can quickly set up the bridge using environment variables:

```bash
ZULIP_EMAIL="bot@your-zulip.com"
ZULIP_API_KEY="your-api-key"
ZULIP_URL="https://chat.your-zulip.com"
```

Environment variables always take precedence over configuration file fields for the default account.

### Configuration File (`openclaw.config.json`)

Enable the bridge in your OpenClaw configuration:

```json
{
  "channels": {
    "zulip": {
      "enabled": true,
      "streams": ["bot-testing", "announcements"],
      "dmPolicy": "pairing"
    }
  }
}
```

See [docs/config.md](docs/config.md) for a full reference of all available configuration options, including multi-account setups and policy details.

## Observability

The bridge uses standardized logging patterns to simplify troubleshooting. You can monitor the health of the connection by watching for `zulip queue` and `zulip inbound arrival` events.

Detailed observability documentation is available in [docs/observability.md](docs/observability.md).

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

This `npm install` step is for **working on the plugin itself**, not for installing the plugin into OpenClaw from npm.

### Project Structure

- `src/` — Plugin source code
  - `zulip/` — Zulip-specific client, monitoring, and policy logic
- `test/` — Local regression tests
- `docs/` — Supporting documentation

## License

Refer to the root project license for terms and conditions.
