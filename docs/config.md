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

### Default Account
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

### Multi-Account Setup
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
