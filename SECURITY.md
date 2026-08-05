# Security Policy

## Supported Versions

This project is published as an OpenClaw channel plugin. Security patches are applied to the latest release. Users should always run the most recent version available on [ClawHub](https://clawhub.com/packages/@niyazmft/openclaw-zulip).

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities. Contact the maintainer directly:

- **GitHub**: [@niyazmft](https://github.com/niyazmft)
- **Email**: niyaz@example.com (replace with actual contact)

You should receive a response within 48 hours. If you do not, please follow up.

---

## Security Model

### Credential Handling

The Zulip Bridge plugin requires three credentials to authenticate with the Zulip API:

| Credential | Environment Variable | Config Field | Purpose |
|---|---|---|---|
| API Key | `ZULIP_API_KEY` | `apiKey` | Authenticates all Zulip API requests |
| Bot Email | `ZULIP_EMAIL` | `email` | Identifies the bot account |
| Server URL | `ZULIP_URL` | `url` / `site` / `realm` | Zulip server endpoint |

**How credentials are resolved** (in order of precedence):

1. Environment variables (default account only)
2. Plugin configuration (`openclaw.json`)

**How credentials are used:**

- Credentials are sent to the Zulip server over **HTTPS only** using HTTP Basic Authentication (`Authorization: Basic base64(email:apiKey)`)
- Credentials are never sent to any third-party server
- Credentials are never logged or written to disk by the plugin (beyond the user's own config file)
- The API key is masked in all log output using `maskPII()`
- Error messages reference field names (e.g., "apiKey is required") but never include the actual values

**Security hardening:**

- `normalizeZulipBaseUrl()` rejects non-HTTPS protocols and internal/private IP addresses (SSRF protection)
- `isInternalHost()` blocks localhost, 127.0.0.1, ::1, 0.0.0.0, AWS metadata endpoint, and RFC 1918 private ranges
- Credential resolution is isolated to `getZulipEnvSecret()` which only reads the specific env vars needed

### Data Access

The plugin reads the following data from the local filesystem:

| Data | Path | Purpose | Configurable |
|---|---|---|---|
| Session files | `~/.openclaw/sessions/` | Recovery of interrupted messages after gateway restart | `enableSessionRecovery` (default: `false`) |
| Allowlist store | `{dataDir}/credentials/zulip-{accountId}-allowFrom.json` | Cached DM allowlist from pairing store | N/A (read-only, 30s TTL cache) |
| Deduplication store | `{dataDir}/zulip-dedupe-{accountId}.json` | Prevents duplicate message processing | N/A (internal) |
| Queue state | `{dataDir}/zulip-queue-{accountId}.json` | Persists Zulip event queue ID across restarts | N/A (internal) |

**Session recovery** (when enabled via `enableSessionRecovery: true`):
- Scans the last 50 DMs for messages with a 👀 reaction from the bot but no ✅/⚠️ reaction and no bot response
- Re-dispatches interrupted messages with a fresh session key
- Only runs once on monitor startup
- Logs all recovery events to the audit log

### Network Communication

All network communication is with the user-configured Zulip server only:

| Endpoint | Protocol | Purpose |
|---|---|---|
| `{baseUrl}/api/v1/...` | HTTPS | All Zulip API operations (messages, reactions, streams, users) |
| `{baseUrl}/user_uploads/...` | HTTPS | Media uploads and downloads |

- **No telemetry**: The plugin does not send any telemetry, usage data, or analytics to any third party
- **No external dependencies**: All API calls go directly to the user's Zulip server
- **HTTPS only**: Non-HTTPS URLs are rejected by `normalizeZulipBaseUrl()`
- **SSRF protected**: Internal/private IP addresses are rejected

### Audit Logging

When the monitor is running, security-relevant events are written to a persistent audit log:

- **Location**: `{dataDir}/audit/{accountId}.audit.log`
- **Format**: JSON lines (one event per line)
- **Rotation**: Log files are rotated at 1MB; the last 3 rotated files are retained
- **Events logged**: monitor start/stop, recovery attempts, auth failures, rate limit exceeded

### Rate Limiting

The plugin includes a configurable per-sender rate limiter:

- **Config option**: `maxMessagesPerMinute` (default: `60`, `0` disables)
- **Scope**: Per sender (by email or user ID)
- **Behavior**: Messages exceeding the limit are silently dropped with a warning log and audit event
- **Window**: Sliding 60-second window

### Dependency Management

- **Runtime dependencies**: The plugin has no runtime npm dependencies. All required modules (`openclaw/plugin-sdk/*`) are provided by the OpenClaw host at runtime.
- **Dev dependencies**: Pinned to exact versions to prevent supply-chain attacks via malicious package updates.
- **Lockfile**: `pnpm-lock.yaml` is committed to the repository for reproducible builds.

### Security Best Practices

1. **Use a dedicated bot account**: Create a Zulip bot specifically for this plugin. Do not use a personal account.
2. **Restrict API key access**: The `ZULIP_API_KEY` environment variable should only be accessible to the OpenClaw gateway process.
3. **Use HTTPS**: Ensure your Zulip server is accessible over HTTPS. The plugin rejects non-HTTPS URLs.
4. **Enable session recovery cautiously**: The session recovery feature (`enableSessionRecovery`) is opt-in and disabled by default. Only enable it if you understand the implications.
5. **Set rate limits**: The default `maxMessagesPerMinute` of 60 is reasonable for most use cases. Adjust based on your expected message volume.
6. **Review audit logs**: Periodically check the audit log at `{dataDir}/audit/` for unexpected events.
