/**
 * Outbound secret guard.
 *
 * The plugin owns the last hop before a message reaches Zulip, so this is the
 * one place a deterministic control can stop a credential from leaving.
 *
 * Why it exists: an agent that can read the host config can simply *type* a
 * secret into chat. A path allowlist on file uploads does not cover that — it
 * only stops a file from being attached, not its contents from being pasted.
 * Reported after a live leak: the agent read `openclaw.json` and posted six
 * credential values into a Zulip DM.
 *
 * This module never stops a file from being read (that is the host's tool
 * policy). It stops the plugin from *transmitting* known credential values.
 */

/** Values shorter than this are ignored, to avoid matching innocuous strings. */
const MIN_SECRET_LENGTH = 12;

/** Config keys whose string values are treated as credentials. */
const SECRET_KEY_PATTERN = /(api[_-]?key|apikey|token|secret|passwd|password|credential)/i;

/** Depth limit for walking the config tree. */
const MAX_WALK_DEPTH = 6;

export type KnownSecret = {
  /** Dotted config path the value came from, e.g. `channels.zulip.apiKey`. */
  name: string;
  value: string;
};

/** Memoised per config object, so repeated sends do not re-walk the tree. */
const secretsByConfig = new WeakMap<object, KnownSecret[]>();

/**
 * Collects credential-shaped string values from a config tree.
 *
 * Only values matching a credential-ish key *and* long enough to be a real
 * secret are collected, so short innocuous strings are not treated as secrets.
 */
export function collectKnownSecrets(cfg: unknown, extra?: KnownSecret[]): KnownSecret[] {
  const cached = cfg && typeof cfg === "object" ? secretsByConfig.get(cfg as object) : undefined;
  if (cached && !extra?.length) {
    return cached;
  }

  // value -> name (first wins), so the same secret in two places is reported once
  const byValue = new Map<string, string>();
  const add = (name: string, value: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (trimmed.length < MIN_SECRET_LENGTH) {
      return;
    }
    if (!byValue.has(trimmed)) {
      byValue.set(trimmed, name);
    }
  };

  const walk = (node: unknown, pathParts: string[], depth: number) => {
    if (depth > MAX_WALK_DEPTH || node === null || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, [...pathParts, String(index)], depth + 1));
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const here = [...pathParts, key];
      if (typeof value === "string" && SECRET_KEY_PATTERN.test(key)) {
        add(here.join("."), value);
      }
      walk(value, here, depth + 1);
    }
  };
  walk(cfg, [], 0);
  for (const entry of extra ?? []) {
    add(entry.name, entry.value);
  }

  const result: KnownSecret[] = Array.from(byValue.entries()).map(([value, name]) => ({
    name,
    value,
  }));
  if (cfg && typeof cfg === "object") {
    secretsByConfig.set(cfg as object, result);
  }
  return result;
}

/** Returns the known secrets whose value appears verbatim in `text`. */
export function findLeakedSecrets(text: string, secrets: KnownSecret[]): KnownSecret[] {
  if (!text || secrets.length === 0) {
    return [];
  }
  return secrets.filter((secret) => text.includes(secret.value));
}

/**
 * Human-readable summary that names *where* the credentials came from without
 * ever echoing their values — the message describing a leak must not be a leak.
 */
export function describeLeakedSecrets(hits: KnownSecret[]): string {
  const names = hits.map((hit) => hit.name).join(", ");
  return `${hits.length} credential value(s) from the host config (${names})`;
}
