# OpenClaw Zulip Bridge

Staging-first repository for the OpenClaw Zulip channel bridge.

## Scope
- ZULIP-1: bootstrap repository and normalize service entrypoint
- ZULIP-2: fix inbound runtime compatibility failure

## Current status
This repo was bootstrapped from the live device-local Zulip extension for safe staging work. Production/device wiring was not modified by this repo bootstrap.

## Key known issue fixed here
The inbound handler had drifted against the current OpenClaw runtime and attempted to call a removed SDK helper: `clearHistoryEntriesIfEnabled`. The staging copy in this repo removes that runtime-incompatible call path.

## Local development
```bash
npm install
npm run check
```

This now performs:
- standalone TypeScript validation for the repo working copy
- local regression tests for the Zulip event retry/failure path
- local JS build emission into `dist/`

## CI
A GitHub Actions workflow is included at `.github/workflows/ci.yml` and runs `npm ci` + `npm run check` on pushes and pull requests.

## Layout
- `index.ts`, `src/` — plugin source
- `docs/` — audit and fix notes
- `test/fixtures/` — reserved for inbound regression fixtures

## Configuration
This bridge supports environment-based configuration for Zulip secrets. This is the recommended approach for staging and production environments to avoid plaintext credential storage in the repository or main configuration files.

The following environment variables are supported for the **default account**:
- `ZULIP_API_KEY`: Zulip API key for the bot.
- `ZULIP_EMAIL`: Zulip bot email address.
- `ZULIP_URL` (or `ZULIP_SITE`, `ZULIP_REALM`): Base URL for the Zulip server.

Environment variables take precedence over configuration file fields for the default account. Non-default accounts must be configured via the configuration file.

See [docs/config.md](docs/config.md) for more details.

## Notes
- This bootstrap is intended for staging validation before any production cutover.
