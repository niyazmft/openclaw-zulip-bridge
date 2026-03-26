/**
 * Interface representing the context needed to make a policy decision.
 */
export interface PolicyContext {
  kind: "dm" | "channel";
  senderId: string;
  senderName: string;
  dmPolicy: string;
  groupPolicy: string;
  senderAllowedForCommands: boolean;
  groupAllowedForCommands: boolean;
  effectiveGroupAllowFromLength: number;
  shouldRequireMention: boolean;
  wasMentioned: boolean;
  isControlCommand: boolean;
  commandAuthorized: boolean;
  oncharTriggered: boolean;
  canDetectMention: boolean;
}

/**
 * Result of the policy decision.
 */
export interface PolicyResult {
  shouldDrop: boolean;
  reason?: string;
  shouldPair?: boolean;
}

/**
 * Decides whether a message should be processed based on the current policy configuration.
 */
export function decidePolicy(ctx: PolicyContext): PolicyResult {
  if (ctx.kind === "dm") {
    if (ctx.dmPolicy === "disabled") {
      return { shouldDrop: true, reason: "dmPolicy=disabled" };
    }
    if (ctx.dmPolicy !== "open" && !ctx.senderAllowedForCommands) {
      if (ctx.dmPolicy === "pairing") {
        return { shouldDrop: true, shouldPair: true, reason: "pairing" };
      }
      return { shouldDrop: true, reason: `dmPolicy=${ctx.dmPolicy}` };
    }
  } else {
    if (ctx.groupPolicy === "disabled") {
      return { shouldDrop: true, reason: "groupPolicy=disabled" };
    }
    if (ctx.groupPolicy === "allowlist") {
      if (ctx.effectiveGroupAllowFromLength === 0) {
        return { shouldDrop: true, reason: "no group allowlist" };
      }
      if (!ctx.groupAllowedForCommands) {
        return { shouldDrop: true, reason: "not in groupAllowFrom" };
      }
    }

    // Inbound drop for unauthorized control commands in channels
    if (ctx.isControlCommand && !ctx.commandAuthorized) {
      return { shouldDrop: true, reason: "control command (unauthorized)" };
    }

    // Mention gating for channels
    if (ctx.shouldRequireMention && ctx.canDetectMention) {
      const effectiveWasMentioned =
        ctx.wasMentioned || (ctx.isControlCommand && ctx.commandAuthorized) || ctx.oncharTriggered;
      if (!effectiveWasMentioned) {
        return { shouldDrop: true, reason: "mention required" };
      }
    }
  }

  return { shouldDrop: false };
}
