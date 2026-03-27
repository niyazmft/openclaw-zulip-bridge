# Zulip Bridge Observability

This document describes the observability baseline for the Zulip bridge, including standardized logging formats, machine-parseable identifiers, and recommended operator checks.

## Logging Schema

Logs from the Zulip plugin use a standardized format for key identifiers to ensure traceability across the inbound and outbound message lifecycles.

Standard fields included in log events (using `[key=value]` format):

- `accountId`: The internal OpenClaw account ID (e.g., `default`).
- `queueId`: The Zulip event queue ID for the current session.
- `lastEventId`: The last processed event ID in the queue.
- `messageId`: The Zulip-assigned ID for the message.
- `senderId`: The email or ID of the message sender.
- `kind`: `dm` (Direct Message) or `channel` (Stream).
- `stream`: The stream name or ID (for `channel` messages).
- `topic`: The topic name (for `channel` messages).
- `sessionKey`: The OpenClaw session key associated with the message/thread.
- `error`: Details of any failure encountered.

## Key Traceability Events

### Inbound Lifecycle

1. **`zulip inbound arrival`**: Emitted as soon as a message is received from the Zulip event queue.
2. **`zulip inbound dedupe hit`**: Emitted if the message was already processed recently (using the persistent dedupe store).
3. **`zulip inbound dispatch`**: Emitted when the message is successfully handed off to the agent for processing. Includes `sessionKey`.
4. **`zulip pairing request`**: Emitted when a new pairing request is created for an unauthorized DM sender.

### Outbound Lifecycle

1. **`zulip outbound attempt`**: Emitted when the bridge starts sending a reply or outbound message.
2. **`zulip outbound success`**: Emitted after the message is accepted by the Zulip API. Includes the new Zulip `messageId`.

### Queue Management

1. **`zulip queue registering`**: Emitted when starting the registration process for a new event queue.
2. **`zulip queue registered`**: Emitted when a new event queue is successfully created.
3. **`zulip queue loaded`**: Emitted when a queue is restored from local persistence (surviving restarts).
4. **`zulip queue expired`**: Emitted when the bridge detects that the queue has been invalidated by the server.

## Operator Checks & Alerting

### Health Signals

- **Queue Expiry Frequency**: Frequent `zulip queue expired` followed by registration might indicate network instability or Zulip server-side issues.
- **Polling Errors**: Look for `zulip polling error` with `status=429` (Rate Limiting) or `status=5xx` (Server error).
- **Registration Failures**: `zulip queue registration failed final` indicates the bot cannot connect to Zulip and has exhausted retries.

### Debugging Message Drops

If a user reports that the bot is not responding:
1. Search logs for `[senderId=user@example.com]`.
2. Look for `logInboundDrop` (standard SDK log) or Zulip-specific arrival logs.
3. Common reasons for drops: `mention required`, `not in groupAllowFrom`, `dmPolicy=allowlist`.

### Correlating Replies

To trace a bot's reply back to an inbound message:
1. Find the `zulip inbound dispatch` log for the inbound message and note the `sessionKey`.
2. Search for `zulip outbound success` logs with the same `sessionKey`.
