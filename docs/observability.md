# Zulip Bridge Observability

This document describes the observability baseline for the Zulip bridge, including standardized logging formats, machine-parseable identifiers, and recommended operator checks.

## Logging Schema

Logs from the Zulip plugin use a standardized format for key identifiers to ensure traceability across the inbound and outbound message lifecycles.

Standard fields included in log events (where applicable):

- `accountId`: The internal OpenClaw account ID (e.g., `default`).
- `queueId`: The Zulip event queue ID for the current session.
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
2. **`zulip inbound dedupe hit`**: Emitted if the message was already processed recently.
3. **`logInboundDrop`**: Emitted if a policy decision (e.g., `dmPolicy` or `groupPolicy`) blocks the message. Includes `reason`.
4. **`zulip inbound dispatch`**: Emitted when the message is successfully handed off to the agent for processing. Includes `sessionKey`.

### Outbound Lifecycle

1. **`zulip outbound attempt`**: Emitted when the bridge starts sending a reply or outbound message.
2. **`zulip outbound success`**: Emitted after the message is accepted by the Zulip API. Includes the new Zulip `messageId`.

### Queue Management

1. **`zulip queue registered`**: Emitted when a new event queue is created.
2. **`zulip queue loaded`**: Emitted when a queue is restored from local persistence.
3. **`zulip queue expired`**: Emitted when the bridge detects that the queue has been invalidated by the server.

## Operator Checks & Alerting

### Health Signals

- **Queue Expiry Frequency**: Frequent `zulip queue expired` followed by registration might indicate network instability or Zulip server-side issues.
- **Polling Errors**: Look for `zulip polling error` with `status=429` (Rate Limiting) or `status=5xx` (Server error).
- **Inbound/Outbound Drift**: Compare `lastInboundAt` and `lastOutboundAt` in the account status. A large gap while the bridge is "connected" might suggest an issue with message handling.

### Debugging Message Drops

If a user reports that the bot is not responding:
1. Search logs for `[senderId=user@example.com]`.
2. Look for `logInboundDrop` with `reason="mention required"` or `reason="not in groupAllowFrom"`.
3. If no arrival log is found, verify the account status and check for polling errors.

### Correlating Replies

To trace a bot's reply back to an inbound message:
1. Find the `zulip inbound dispatch` log for the inbound message and note the `sessionKey`.
2. Search for `zulip outbound success` logs with the same `sessionKey`.
