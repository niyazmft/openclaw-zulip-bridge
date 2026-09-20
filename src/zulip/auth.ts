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
 *
 * Security: authorization matches the sender's stable identity only. An earlier
 * version also accepted an entry equal to `senderName`, which is Zulip's
 * user-settable `sender_full_name`: any user could rename their profile to an
 * allowlisted address and bypass pairing/command authorization.
 */
export function isSenderAllowed(params: {
  senderId: string;
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
  return allowFrom.some((entry) => entry === normalizedSenderId);
}
