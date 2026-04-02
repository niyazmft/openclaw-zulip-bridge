# Zulip Bridge Configuration

The OpenClaw Zulip Bridge can be configured using environment variables or the standard OpenClaw configuration file. Environment variables are recommended for sensitive information (secrets).

## Environment-Based Secrets (Recommended)

To improve security and follow the "secrets-out-of-the-repo" policy, use environment variables for the bot's credentials. This is currently supported for the **default account**.

### Supported Variables
| Variable | Description |
| --- | --- |
| `ZULIP_API_KEY` | The API key for your Zulip bot. |
| `ZULIP_EMAIL` | The email address associated with your Zulip bot. |
| `ZULIP_URL` | The base URL of your Zulip server (e.g., `https://chat.example.com`). |
| `ZULIP_SITE` | Alias for `ZULIP_URL`. |
| `ZULIP_REALM` | Alias for `ZULIP_URL`. |

### Precedence
For the **default account**, environment variables **always take precedence** over fields in the configuration file. This ensures that you can override hardcoded (or placeholder) values during staging or production by simply setting the corresponding environment variable.

## Configuration File Setup

If you need to configure multiple Zulip accounts or other settings (like streams, DM policy, etc.), you can use the `channels.zulip` section in your OpenClaw configuration file.

### Account Settings

The following settings are available for each Zulip account (and as top-level defaults for the `zulip` channel):

| Setting | Type | Description |
| --- | --- | --- |
| `url` | string | Zulip base URL. |
| `site` | string | Alias for `url`. |
| `realm` | string | Alias for `url`. |
| `email` | string | Zulip bot email. |
| `apiKey` | string | Zulip bot API key. |
| `streams` | string[] | List of streams to monitor. Use `["*"]` for all (default). |
| `chatmode` | enum | `oncall` (default), `onmessage`, or `onchar`. |
| `oncharPrefixes`| string[] | Trigger characters for `onchar` mode (default: `[">", "!"]`). |
| `requireMention`| boolean | Explicit override for @mention requirement in streams. |
| `dmPolicy` | enum | `pairing` (default), `allowlist`, `open`, or `disabled`. |
| `allowFrom` | string[] | Authorized user IDs/emails for DMs and general commands. |
| `groupAllowFrom`| string[] | Authorized user IDs/emails for Stream messages (falls back to `allowFrom`). |
| `groupPolicy` | enum | `allowlist` (default), `open`, or `disabled`. |
| `mediaMaxMb` | number | Maximum size in MB for incoming media (default: 5). |
| `reactions` | object | Configure reaction behavior (see below). |
| `blockStreaming`| boolean | Enable/disable block-based streaming responses. |
| `enableAdminActions`| boolean | Require explicit opt-in for high-privilege actions (e.g., user deactivation, channel management). Default: `false`. |

### Policy Configuration

The bridge supports both Direct Message (DM) and Stream (Group) traffic. The behavior is controlled by several settings:

#### Direct Message (DM) Policy (`dmPolicy`)
| Policy | Behavior |
| --- | --- |
| `pairing` (default) | If the sender is not in `allowFrom`, a pairing code is sent. Once approved, the user is added to `allowFrom`. |
| `allowlist` | Only users explicitly listed in `allowFrom` (or the persistent store) can trigger the agent. |
| `open` | Anyone can send a DM to the bot. |
| `disabled` | All DMs are ignored. |

#### Stream/Group Policy (`groupPolicy`)
| Policy | Behavior |
| --- | --- |
| `allowlist` (default) | Only messages from senders in `groupAllowFrom` (or `allowFrom` if `groupAllowFrom` is empty) are processed. |
| `open` | Anyone in a monitored stream can trigger the agent, provided the mention/trigger requirements are met. |
| `disabled` | All stream messages are ignored. |

#### Mention & Trigger Settings
- `requireMention` (boolean, default: `true`): If `true`, the bot must be @mentioned in streams to respond.
- `chatmode`:
  - `oncall` (default): Responds only when @mentioned. Sets `requireMention` to `true`.
  - `onmessage`: Responds to every message in a stream. Sets `requireMention` to `false`.
  - `onchar`: Responds only when a message starts with a trigger character (e.g., `>` or `!`). Sets `requireMention` to `true`, but the trigger character bypasses the @mention requirement.

> **Note:** Control commands from authorized users always bypass the `requireMention` gate in streams.

### Reaction Configuration

```json
"reactions": {
  "enabled": true,
  "clearOnFinish": true,
  "onStart": "eyes",
  "onSuccess": "check_mark",
  "onError": "warning"
}
```

### Examples

#### Simple Default Account
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

#### Allowlist-based DM Setup
In this setup, only explicitly authorized users can interact with the bot in DMs. Other users will be ignored (not even prompted for pairing).

```json
{
  "channels": {
    "zulip": {
      "enabled": true,
      "site": "https://chat.example.com",
      "email": "bot@example.com",
      "apiKey": "your-api-key",
      "dmPolicy": "allowlist",
      "allowFrom": ["authorized-user@example.com", "admin@example.com"]
    }
  }
}
```

#### Multi-Account Setup
Non-default accounts must be defined in the `accounts` map and **require** credentials in the configuration file. To prevent accidental secret leakage and ensure predictable behavior, non-default accounts **do not support** environment-based resolution or fallbacks.

```json
{
  "channels": {
    "zulip": {
      "enabled": true,
      "accounts": {
        "production": {
          "enabled": true,
          "apiKey": "PROD_API_KEY",
          "email": "prod-bot@example.com",
          "url": "https://chat.example.com",
          "streams": ["*"]
        },
        "staging": {
          "enabled": true,
          "apiKey": "STAGING_API_KEY",
          "email": "staging-bot@example.com",
          "url": "https://staging.example.com"
        }
      }
    }
  }
}
```

## Security Best Practices
- **Do not commit secrets** to your repository. Use `.env.example` as a template for your local or server environment.
- **Prefer environment variables** for the default account's `apiKey`.
- If using multi-account config, ensure your configuration file is properly protected and not part of the source control.
- Use the least-privileged bot type in Zulip where possible.
