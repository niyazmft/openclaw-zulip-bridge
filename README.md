# OpenClaw Zulip Bridge

The OpenClaw Zulip Bridge is a high-performance channel plugin for OpenClaw that enables interaction with Zulip streams and private messages. It features a robust, persistent event queue system, flexible traffic policies, and comprehensive observability.

## Features

- **Persistent Event Polling**: Automatically resumes from where it left off using locally-persisted queue metadata.
- **Traffic Policies**: Granular control over who can interact with the bot in DMs and Streams.
- **Multiple Accounts**: Support for multiple Zulip accounts and realms in a single instance.
- **Mention Gating**: Intelligent stream handling with `oncall`, `onmessage`, and `onchar` modes.
- **Durable Deduplication**: Built-in persistent deduplication store to prevent duplicate message processing.
- **Media Support**: Automatically processes Zulip uploads and inline images.
- **Rich Feedback**: Optional reaction-based status indicators for request start, success, and errors.
- **Standardized Observability**: Machine-parseable logs for easy monitoring and troubleshooting.

## Prerequisites

- **OpenClaw**: Version `>=2026.4.29` (recommended)
- **Node.js**: Latest LTS recommended (Node 22+)
- **Zulip Bot**: A registered bot on your Zulip realm (Settings -> Your Bots -> Add a new bot).
- **plugins.allow**: Your OpenClaw config must include `"zulip"` in `plugins.allow` for the plugin to be recognized:

  ```bash
  # Check current allow list
  openclaw config get plugins.allow --json
  # If "zulip" is missing, add it
  openclaw config set plugins.allow '["zulip","telegram","memory-core","exa","ollama"]'
  ```

## Installation

### From ClawHub (Recommended)

The easiest way to install the Zulip plugin is via ClawHub. This also ensures you get the latest version and avoids any security scanner issues that can occur with `--link` installs from source.

```bash
openclaw plugins install clawhub:@openclaw/zulip
```

Then configure it:
```bash
openclaw plugins setup zulip
```

### From Source (Development / Offline Machines)

> ⚠️ **Do NOT clone directly into `~/.openclaw/extensions/zulip`.** This creates a stale config entry that blocks reinstallation. Always clone to a neutral directory first.

1. **Pre-flight check** (verify your environment):
   ```bash
   # Check Node.js version (>= 22 recommended)
   node --version
# Check OpenClaw version (>= 2026.4.29 recommended)
    openclaw --version
    # Check plugins.allow includes "zulip"
   openclaw config get plugins.allow --json
   # Ensure no stale zulip config exists
   openclaw plugins list --json | grep zulip
   ```
   If you see a stale config warning, run cleanup first:
   ```bash
   openclaw plugins uninstall zulip --force
   ```

2. **Clone and build**:
   ```bash
   # Clone to a neutral directory (NOT inside ~/.openclaw/extensions/)
   git clone https://github.com/niyazmft/openclaw-zulip-bridge.git /tmp/openclaw-zulip-bridge
   cd /tmp/openclaw-zulip-bridge
   npm install
   npm run build
   ```

3. **Install the built plugin**:
   ```bash
   openclaw plugins install ./ --link
   ```

4. **Verify the installation**:
   ```bash
   openclaw plugins doctor
   openclaw plugins list --json | python3 -c "import json,sys; z=[p for p in json.load(sys.stdin).get('plugins',[]) if p['id']=='zulip']; print('OK' if z and z[0]['activated'] else 'FAIL')"
   ```

5. **Configure the plugin**:
   ```bash
   openclaw plugins setup zulip
   ```

#### Offline Installation

This plugin has **zero production npm dependencies**. You can build it on a connected machine, then copy the folder to an offline machine:

```bash
# On the connected machine:
git clone https://github.com/niyazmft/openclaw-zulip-bridge.git /tmp/zulip-bridge
cd /tmp/zulip-bridge
npm install
npm run build
# Copy the entire folder to your offline machine:
scp -r /tmp/zulip-bridge user@offline-machine:/path/to/zulip-bridge
```

Then on the offline machine, from the copied folder:
```bash
openclaw plugins install ./ --link
openclaw plugins setup zulip
```

## Setup: Use OpenClaw Onboarding (Preferred)

The Zulip plugin supports OpenClaw's **interactive channel onboarding wizard**. After installation, run:

```bash
openclaw configure
```

Then at the interactive prompts:
1. Select **"Configure chat channels now?"** → Yes
2. Choose **"Zulip (plugin)"** from the channel list
3. Follow the guided prompts to enter:
   - Zulip site URL (e.g., `https://chat.example.com`)
   - Bot email address
   - API key
4. (Optional) Choose which streams the bot should monitor

> **Tip**: If `ZULIP_API_KEY`, `ZULIP_EMAIL`, and `ZULIP_URL` are already set as environment variables, the wizard will offer to use them automatically.

**Screenshot of what you'll see:**
```
◆  Zulip bot setup
│  1) In Zulip: Settings -> Bots -> Add a new bot
│  2) Bot type: 'Generic bot' is recommended
│  3) Copy the bot's Email and API Key from 'Active bots'
│  4) Site URL: the base URL (e.g., https://chat.example.com)
│
◇  Select a channel
│  ● Zulip (plugin) — needs setup
│
◇  Enter Zulip site URL
│  https://chat.example.com
│
◇  Enter Zulip bot email
│  mybot@chat.example.com
│
◇  Enter Zulip API key
│  [hidden]
```

This interactive setup validates your credentials against the Zulip API before saving, so you know immediately if anything is wrong.

## Manual Configuration (Fallback)

While onboarding is recommended, you can also manually configure the bridge in your `openclaw.json`.

### Recommended: Use Environment Variables
To keep secrets out of your configuration file, set these in your environment:
- `ZULIP_API_KEY`: Your bot's API key.
- `ZULIP_EMAIL`: Your bot's email address.
- `ZULIP_URL`: The base URL of your Zulip server.

### Example `openclaw.json` entry:
```json
{
  "channels": {
    "zulip": {
      "enabled": true,
      "dmPolicy": "pairing",
      "streams": ["*"]
    }
  }
}
```

## Verification & First-Time Test

After completing the setup, verify the bridge is working correctly:

1. **Check plugin status**:
   ```bash
   openclaw plugins doctor
   openclaw plugins list --json | python3 -c "
import json,sys
z=[p for p in json.load(sys.stdin).get('plugins',[]) if p['id']=='zulip']
print('Zulip plugin:', z[0]['status'] if z else 'NOT FOUND')
"
   ```
2. **Check Logs**: Look for the registration success marker:
   `zulip queue registered [accountId=default queueId=... lastEventId=...]`
3. **Test Direct Message**: Send a private message to the bot. If using the default `pairing` policy, it should respond with a pairing code.
4. **Test Stream Mention**: Mention the bot in a monitored stream (e.g., `@bot-name hello`). It should receive the message and respond.

## Troubleshooting

### "zulip does not support guided setup yet."
This means the OpenClaw host did not recognize the plugin's setup wizard. This was a known issue in earlier versions (fixed in this repo by adding `credentials: []` to the setup wizard). 

Make sure you have the **latest plugin version** installed from ClawHub (not `--link` from an old repo clone):
```bash
# Uninstall old copy
openclaw plugins uninstall zulip --force
rm -rf ~/.openclaw/extensions/zulip

# Install fresh from ClawHub
openclaw plugins install clawhub:@openclaw/zulip
```

Then restart the OpenClaw gateway to pick up the new metadata:
```bash
openclaw gateway stop
openclaw gateway start
```

### openclaw plugins install ./ --link fails with "dangerous code patterns" or "not a valid hook pack"
The OpenClaw security scanner blocks `--link` installs when the repo contains `child_process` usage in `scripts/`. This is a false positive for build/dev scripts. **Workaround**: install from ClawHub instead of source:
```bash
openclaw plugins install clawhub:@openclaw/zulip
```

If you must install from source, avoid `--link` and use a regular install:
```bash
# Remove scripts/ first
rm -rf scripts/
openclaw plugins install ./ --force
```

### "plugin not found: zulip" after installing
1. Check `plugins.allow` includes `"channel"` (see [Prerequisites](#prerequisites)).
2. Run `openclaw plugins doctor` to check for load errors.
3. Try re-enabling: `openclaw plugins enable zulip`.

### "not a valid hook pack: Error: package.json missing openclaw.hooks"
This error appears when installing from a path that doesn't have the right package metadata or when the build artifacts are missing. Make sure you:
1. Cloned to a neutral directory (not `~/.openclaw/extensions/zulip`)
2. Ran `npm install` and `npm run build`
3. Are installing from the repo root containing `openclaw.plugin.json`

### Plugin not showing in dashboard channels
Ensure your OpenClaw config has `"channel"` in `plugins.allow`:
```bash
openclaw config get plugins.allow --json
# Add if missing:
openclaw config set plugins.allow '["channel"]'   # or merge with your existing list
```

### Queue Registration Fails
Verify `ZULIP_URL` is reachable and credentials are correct. Use `openclaw plugins setup zulip` to re-verify.

### No Response in Streams
Ensure the bot is a member of the stream and that the stream is listed in your `streams` config (or use `["*"]`).

### Logs show "mention required"
By default, the bot only responds to @mentions in streams. Check your `chatmode` setting.

## Development

### Local Setup
1. `npm install`
2. `npm run check` (Runs type-checks, build, and tests)

### Project Structure
- `src/` — Plugin source code.
  - `zulip/` — Zulip client and monitoring logic.
- `test/` — Unit and integration tests.
- `types/` — SDK type definitions and shims.
- `scripts/` — Build helpers, smoke tests, install pre-flight, and verification.
- `openclaw.plugin.json` — Plugin manifest.

## License

Refer to the root project license for terms and conditions.
