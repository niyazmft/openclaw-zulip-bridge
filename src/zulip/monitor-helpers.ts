export function formatInboundFromLabel(params: {
  isGroup: boolean;
  groupLabel?: string;
  groupId?: string;
  directLabel: string;
  directId?: string;
  groupFallback?: string;
}): string {
  if (params.isGroup) {
    const label = params.groupLabel?.trim() || params.groupFallback || "Group";
    const id = params.groupId?.trim();
    return id ? `${label} id:${id}` : label;
  }

  const directLabel = params.directLabel.trim();
  const directId = params.directId?.trim();
  if (!directId || directId === directLabel) {
    return directLabel;
  }
  return `${directLabel} id:${directId}`;
}

export function resolveThreadSessionKeys(params: {
  baseSessionKey: string;
  threadId?: string | null;
  parentSessionKey?: string;
  useSuffix?: boolean;
}): { sessionKey: string; parentSessionKey?: string } {
  const threadId = (params.threadId ?? "").trim();
  if (!threadId) {
    return { sessionKey: params.baseSessionKey, parentSessionKey: undefined };
  }
  const useSuffix = params.useSuffix ?? true;
  const sessionKey = useSuffix
    ? `${params.baseSessionKey}:thread:${threadId}`
    : params.baseSessionKey;
  return { sessionKey, parentSessionKey: params.parentSessionKey };
}

/**
 * Formats a log message with standardized, machine-parseable identifiers.
 */
export function formatZulipLog(message: string, fields: Record<string, unknown>): string {
  const parts = Object.entries(fields)
    .filter(([_, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${v}`);
  return parts.length > 0 ? `${message} [${parts.join(" ")}]` : message;
}

/**
 * Masks sensitive information (PII) like emails and numeric IDs for safe logging.
 */
export function maskPII(value: string | number | undefined | null): string {
  const str = String(value ?? "").trim();
  if (!str) {
    return "";
  }

  // Handle prefixed targets like user:email, dm:email, zulip:email, or stream:name
  if (str.startsWith("user:")) {
    return `user:${maskPII(str.slice(5))}`;
  }
  if (str.startsWith("dm:")) {
    return `dm:${maskPII(str.slice(3))}`;
  }
  if (str.startsWith("zulip:")) {
    const rest = str.slice(6);
    if (rest.startsWith("channel:")) {
      return `zulip:channel:${maskPII(rest.slice(8))}`;
    }
    return `zulip:${maskPII(rest)}`;
  }
  if (str.startsWith("stream:")) {
    const rest = str.slice(7);
    const parts = rest.split(/[:#/]/);
    const streamName = parts[0];
    const maskedStream = streamName.length > 2 ? `${streamName.slice(0, 2)}***` : "***";
    if (parts.length > 1) {
      const topic = parts.slice(1).join(":");
      return `stream:${maskedStream}:${maskPII(topic)}`;
    }
    return `stream:${maskedStream}`;
  }

  // Handle email
  if (str.includes("@")) {
    const [user, domain] = str.split("@");
    if (user && domain) {
      const maskedUser = user.length > 1 ? `${user[0]}***` : "***";
      return `${maskedUser}@${domain}`;
    }
  }

  // Handle numeric ID
  if (/^\d+$/.test(str)) {
    if (str.length <= 2) {
      return "**";
    }
    if (str.length <= 5) {
      return `${str[0]}***${str[str.length - 1]}`;
    }
    return `${str.slice(0, 2)}***${str.slice(-2)}`;
  }

  // Fallback for other strings that might be sensitive
  if (str.length <= 2) {
    return "**";
  }
  return `${str.slice(0, 2)}***${str.slice(-2)}`;
}

/**
 * Delays execution for a given number of milliseconds.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
