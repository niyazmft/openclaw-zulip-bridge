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

The Zulip bridge is typically installed as part of the OpenClaw plugin suite or via NPM:

```bash
npm install @openclaw/zulip
```

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

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run tests and type checks:
   ```bash
   npm run check
   ```

### Project Structure

- `src/` — Plugin source code
  - `zulip/` — Zulip-specific client, monitoring, and policy logic
- `test/` — Local regression tests
- `docs/` — Supporting documentation

## License

Refer to the root project license for terms and conditions.
