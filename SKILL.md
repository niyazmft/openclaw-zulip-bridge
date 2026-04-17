---
name: zulip-bridge
version: 2026.4.13
description: 💬 High-performance Zulip bridge skill. Enables messaging, stream monitoring, and administrative actions on Zulip servers.
user-invocable: true
metadata: {
  "openclaw": {
    "requires": {
      "plugins": ["zulip"]
    }
  }
}
---
# 💬 Zulip Bridge Skill

This skill provides the intelligence and instructions for interacting with the Zulip communication platform through the OpenClaw Zulip Bridge plugin.

## Capabilities
- **Messaging**: Send messages to Zulip streams, topics, or direct messages.
- **Stream Management**: Create, edit, and list Zulip streams.
- **User Actions**: Invite users to streams and check user presence.
- **Reactions**: Add or remove emoji reactions to messages.
- **Monitoring**: Real-time arrival of messages with durable deduplication.

## Usage Guide

### Messaging Targets
- **Streams**: Use `stream:STREAM_NAME` (e.g., `stream:bot-testing`).
- **Topics**: Use `stream:STREAM_NAME:TOPIC_NAME` (e.g., `stream:bot-testing:alerts`).
- **Direct Messages**: Use `user:EMAIL` (e.g., `user:alice@example.com`).

### Workflow
1. **Setup**: Ensure the Zulip plugin is installed and credentials (`email`, `apiKey`, `site`) are configured inside `~/.openclaw/openclaw.json`.
2. **Context**: When an event arrives from Zulip, the agent will automatically have context including the `messageId`, `senderId`, and `stream`/`topic`.
3. **Response**: Use the `messaging` tool to respond. The bridge will handle chunking, markdown conversion, and media uploads automatically.

## Constraints
- **Admin Actions**: Actions like deactivating users require `enableAdminActions: true` in the configuration.
- **Mention Gating**: By default, the bot only responds to @mentions in streams unless `chatmode` is changed.
