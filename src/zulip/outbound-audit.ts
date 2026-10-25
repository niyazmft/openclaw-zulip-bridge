import { getZulipRuntime } from "../runtime.js";
import { getAuditLogger } from "./audit-log.js";
import { maskPII } from "./monitor-helpers.js";

/**
 * Audits a send that did **not** go through the monitor's reply path (#326, cause 2).
 *
 * The agent's `message` tool (the normal way an agent replies when
 * `tools.profile: "full"`) reaches the host through the channel's outbound adapter
 * (`outbound.sendText` / `sendMedia` in `../channel.ts`), not through the reply
 * dispatcher. That path calls `sendMessageZulip` directly and previously wrote no
 * audit event at all, so from the audit log a successful `message`-tool reply and a
 * run that produced nothing were indistinguishable — the file could not tell a
 * working channel from a silently broken one.
 *
 * Invariants:
 * - **Never throws and never blocks the send.** The caller has already delivered;
 *   auditing is diagnostics, so a failure must not turn a good send into an error.
 * - **The target is masked** (`maskPII`) exactly like every other audit field; the
 *   message body is never recorded, only its length.
 */

export type OutboundAuditInput = {
  accountId?: string;
  to: string;
  kind: "text" | "media";
  text?: string;
  hasMedia?: boolean;
  /** Message id returned by Zulip, when the send succeeded. */
  messageId?: string | number;
  topic?: string;
};

/** Derives the target shape without parsing (and without echoing) the address. */
export function outboundTargetKind(to: string): "stream" | "dm" | "unknown" {
  const trimmed = to?.trim() ?? "";
  if (!trimmed) return "unknown";
  if (trimmed.startsWith("stream:") || trimmed.startsWith("#")) return "stream";
  if (trimmed.startsWith("user:") || trimmed.startsWith("@")) return "dm";
  return "unknown";
}

export function auditOutboundSend(input: OutboundAuditInput): void {
  try {
    const accountId = input.accountId?.trim() || "default";
    // Resolve the data dir from the live runtime when there is one: in a gateway
    // the host provides `paths.dataDir`, and the monitor has usually registered this
    // same logger already. In the CLI fallback there is no runtime, and the shared
    // resolver's `~/.openclaw` is the right answer.
    const logger = getAuditLogger(accountId, { runtime: getZulipRuntime() });
    void logger.log({
      ts: new Date().toISOString(),
      event: "outbound_send",
      accountId,
      direction: "outbound",
      // Distinguishes this from `deliver_payload`, which is the reply-dispatcher path.
      source: "channel-outbound",
      kind: input.kind,
      targetKind: outboundTargetKind(input.to),
      target: maskPII(input.to),
      textLen: (input.text ?? "").length,
      hasMedia: String(input.hasMedia === true),
      ...(input.messageId !== undefined ? { messageId: String(input.messageId) } : {}),
    });
  } catch {
    // Diagnostics only — a broken audit write must never fail a delivered message.
  }
}
