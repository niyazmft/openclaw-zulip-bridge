# Zulip Bridge Smoke Test

This document provides a manual smoke testing checklist for the OpenClaw Zulip Bridge to ensure staging validation is successful before deploying to production.

## Prerequisites

1. A staging OpenClaw runtime environment.
2. A test Zulip organization (realm) where you have administrative access or can create bots.
3. A dedicated Zulip bot account for staging (`ZULIP_EMAIL`, `ZULIP_API_KEY`, `ZULIP_URL`).
4. At least two test user accounts in the Zulip organization.
5. A dedicated test stream (e.g., `#staging-test`).
6. A local checkout of this repository for sideload installation.

## Checklist

### 1. Installation, Configuration & Startup
- [ ] Install the plugin from a local checkout:
  ```bash
  openclaw plugins install "$HOME/.openclaw/workspace/specialists/tech/openclaw-zulip-bridge" --link
  openclaw plugins enable zulip
  ```
- [ ] Configure the bridge in the staging OpenClaw environment using environment variables (`ZULIP_EMAIL`, `ZULIP_API_KEY`, `ZULIP_URL`).
- [ ] Start the OpenClaw runtime.
- [ ] Verify the bridge initializes without errors in the logs.
- [ ] Check logs for `zulip queue registered` indicating a successful connection to the Zulip events API.

### 2. Direct Messages (DM) Policy
- [ ] Send a DM from a test user to the bot.
- [ ] Verify the message appears in the OpenClaw runtime.
- [ ] Verify the bot responds correctly back to the user via DM.
- [ ] Check logs for `zulip inbound arrival` and `zulip inbound dispatch`.

### 3. Stream/Group Policy (Mention Handling)
- [ ] Add the bot to the test stream.
- [ ] Post a message in the stream *without* mentioning the bot.
- [ ] Verify the message is ignored by the bridge and confirm the drop is reflected in policy-related logs.
- [ ] Post a message in the stream *mentioning* the bot (e.g., `@bot-name hello`).
- [ ] Verify the message appears in the OpenClaw runtime.
- [ ] Verify the bot responds in the same stream, optionally creating or continuing a topic.

### 4. Deduplication & Recovery
- [ ] Send a message to the bot (DM or stream).
- [ ] Quickly restart the OpenClaw runtime.
- [ ] Verify the bot does not process the same message twice upon restart.
- [ ] Check logs for `zulip inbound dedupe hit` or verify the dedupe store restored state from the filesystem.

### 5. Attachment Handling
- [ ] Send a DM to the bot containing an image attachment.
- [ ] Verify the OpenClaw runtime receives the message and the attachment URL/metadata.

### 6. Outbound Formatting
- [ ] Trigger an OpenClaw action that sends formatted text (bold, italics, links, code blocks) to Zulip.
- [ ] Verify the formatting renders correctly in the Zulip client.

### 7. Queue Expiry & Re-registration
- [ ] Leave the bridge running idle for an extended period (e.g., > 15 minutes).
- [ ] Send a new message to the bot.
- [ ] Verify the message is received and processed.
- [ ] Check logs for `zulip queue expired` and a subsequent `zulip queue registered` to ensure graceful recovery.

## Troubleshooting

- **Queue churn:** If logs show constant re-registration, check network connectivity between the runtime and the Zulip server.
- **Missing messages:** Check the `ZULIP_EMAIL` configuration to ensure the bot is not filtering out its own messages. Verify DM/Group policy settings in the OpenClaw configuration.
- **Install confusion:** If someone tries `npm install @openclaw/zulip`, redirect them to the local sideload flow above; this repository is currently intended for sideload installation rather than npm registry distribution.
