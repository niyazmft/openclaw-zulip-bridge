/**
 * Normalizes an allowlist entry by removing prefixes and converting to lowercase.
 */
export function normalizeAllowEntry(entry: string): string {
  const trimmed = entry.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed === "*") {
    return "*";
  }
  return trimmed
    .replace(/^(zulip|user):/i, "")
    .replace(/^@/, "")
    .toLowerCase();
}

/**
 * Normalizes a list of allowlist entries.
 */
export function normalizeAllowList(entries: Array<string | number>): string[] {
  const normalized = entries.map((entry) => normalizeAllowEntry(String(entry))).filter(Boolean);
  return Array.from(new Set(normalized));
}

/**
 * Checks if a sender is allowed based on an allowlist.
 */
export function isSenderAllowed(params: {
  senderId: string;
  senderName?: string;
  allowFrom: string[];
}): boolean {
  const allowFrom = params.allowFrom;
  if (allowFrom.length === 0) {
    return false;
  }
  if (allowFrom.includes("*")) {
    return true;
  }
  const normalizedSenderId = normalizeAllowEntry(params.senderId);
  const normalizedSenderName = params.senderName ? normalizeAllowEntry(params.senderName) : "";
  return allowFrom.some(
    (entry) =>
      entry === normalizedSenderId || (normalizedSenderName && entry === normalizedSenderName),
  );
}
