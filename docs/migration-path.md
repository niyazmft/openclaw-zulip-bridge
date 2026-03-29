# Zulip Bridge Migration & Alignment Path

This guide outlines the steps for migrating from a legacy Zulip bridge installation to the current repository state, ensuring parity between your running code and the repository source.

## 1. Backup Current Configuration

Before making changes, back up your current OpenClaw configuration file (usually `openclaw.json` or `openclaw.config.json`).

```bash
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak
```

## 2. Migrate Secrets to Environment Variables (Recommended)

To improve security and take advantage of the repository's improved secret handling, move your Zulip credentials out of the configuration file and into environment variables.

**Remove these from `openclaw.json`:**
- `apiKey`
- `email`
- `url` (or `site`, `realm`)

**Set them in your environment (e.g., `.bashrc`, `.env`, or systemd service):**
```bash
export ZULIP_EMAIL="bot@example.com"
export ZULIP_API_KEY="your-api-key"
export ZULIP_URL="https://chat.example.com"
```

## 3. Uninstall Legacy Extension

If you have a legacy extension installed as a standalone package or older linked version, uninstall it to ensure a clean slate.

```bash
openclaw plugins uninstall zulip
```

## 4. Install Current Repo as a Linked Plugin

The most reliable way to maintain parity is to install the plugin directly from your local repository checkout using the `--link` flag. This creates a symbolic link, ensuring any changes in the repository are immediately reflected in the running extension.

```bash
cd ~/.openclaw/workspace/specialists/tech/openclaw-zulip-bridge # Path to your local repo
openclaw plugins install ./ --link
openclaw plugins enable zulip
```

## 5. Verify Active Plugin Version

After restarting OpenClaw, verify that the current version is active by checking the logs for new patterns:

- **Queue Registration**: Look for the log marker `zulip queue registered [accountId=...]`. Legacy versions likely lacked this structured log.
- **PII Masking**: Send a message to the bot. Logs should show `senderId: user:********` or similar masked values instead of full emails or IDs.
- **Persistent Files**: Check for the existence of state files in your temporary directory:
  ```bash
  ls /tmp/openclaw-zulip-*.json
  ```

## 6. Restart OpenClaw

Restart your OpenClaw instance to apply the changes.

| Environment | Restart Command |
| --- | --- |
| **Systemd** | `systemctl restart openclaw` |
| **PM2** | `pm2 restart openclaw` |
| **Manual/CLI** | `Ctrl+C` then restart (e.g., `openclaw start`) |

Following this path ensures that the repository code is the live source of truth for your Zulip bridge, resolving drift issues and aligning with the latest robustness improvements.
