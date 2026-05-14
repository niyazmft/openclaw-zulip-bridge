export const DEFAULT_ONCHAR_PREFIXES = [">", "!"];

const HTML_TAG_REGEX = /<[^>]+>/g;
const MENTION_REGEX = /@\*\*([^*]+)\*\*/g;

// ⚡ Bolt Optimization: Single-pass HTML entity replacement
// Combined regex for all common entities - avoids 4 separate .replace() passes
const HTML_ENTITY_REGEX = /&(lt|gt|amp|quot);/g;
const HTML_ENTITY_MAP: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
};

// ⚡ Bolt Optimization: Pre-compile regex for bot mention matching
// Exported for callers who want to cache the regex at initialization time
export function createBotMentionRegex(botUsername: string): RegExp {
  const escaped = botUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`@${escaped}\\b`, "gi");
}

/**
 * Strips HTML tags and unescapes common HTML entities from Zulip message content.
 * ⚡ Bolt Optimization: Single-pass entity replacement reduces string processing
 */
export function stripHtmlToText(html: string): string {
  if (!html.includes('<') && !html.includes('&') && !html.includes('@**')) {
    return html.trim();
  }
  return html
    .replace(HTML_TAG_REGEX, "")
    // ⚡ Bolt: Single-pass entity replacement instead of 4 separate replaces
    .replace(HTML_ENTITY_REGEX, (match) => HTML_ENTITY_MAP[match] ?? match)
    .replace(MENTION_REGEX, "@$1")
    .trim();
}

/**
 * Removes a mention of the bot from the text.
 * @param text - The text to process
 * @param mention - The bot username as a string (will be escaped) OR a pre-compiled RegExp for performance
 * @returns The text with the mention removed and whitespace normalized
 */
export function normalizeMention(text: string, mention: string | RegExp | undefined): string {
  if (!mention) {
    return text.replace(/\s+/g, " ").trim();
  }
  if (!text.includes('@')) {
    return text.replace(/\s+/g, " ").trim();
  }
  
  // ⚡ Bolt Optimization: Use pre-compiled regex if provided (avoids per-message allocation)
  // Falls back to creating regex from string for backward compatibility
  const re = mention instanceof RegExp 
    ? mention 
    : createBotMentionRegex(mention);
  
  return text.replace(re, " ").replace(/\s+/g, " ").trim();
}

/**
 * Resolves the prefixes used for "onchar" chat mode.
 */
export function resolveOncharPrefixes(prefixes: string[] | undefined): string[] {
  const cleaned = prefixes?.map((entry) => entry.trim()).filter(Boolean) ?? DEFAULT_ONCHAR_PREFIXES;
  return cleaned.length > 0 ? cleaned : DEFAULT_ONCHAR_PREFIXES;
}

/**
 * Checks if the text starts with any of the given prefixes and strips it if so.
 */
export function stripOncharPrefix(
  text: string,
  prefixes: string[],
): { triggered: boolean; stripped: string } {
  const trimmed = text.trimStart();
  for (const prefix of prefixes) {
    if (!prefix) {
      continue;
    }
    if (trimmed.startsWith(prefix)) {
      return {
        triggered: true,
        stripped: trimmed.slice(prefix.length).trimStart(),
      };
    }
  }
  return { triggered: false, stripped: text };
}

/**
 * Extracts a topic directive (e.g. [[zulip_topic: Topic Name]]) from the text.
 */
export function extractZulipTopicDirective(text: string): { text: string; topic?: string } {
  const match = text.match(/^\s*\[\[zulip_topic:\s*([^]]+?)\s*\]\]\s*/i);
  if (!match) {
    return { text };
  }
  const topic = match[1]?.trim();
  if (!topic) {
    return { text: text.slice(match[0].length).trimStart() };
  }
  return {
    text: text.slice(match[0].length).trimStart(),
    topic,
  };
}
