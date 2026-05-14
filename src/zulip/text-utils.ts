export const DEFAULT_ONCHAR_PREFIXES = [">", "!"];

const HTML_TAG_REGEX = /<[^>]+>/g;
const MENTION_REGEX = /@\*\*([^*]+)\*\*/g;

/**
 * Strips HTML tags and unescapes common HTML entities from Zulip message content.
 */
export function stripHtmlToText(html: string): string {
  if (!html.includes('<') && !html.includes('&') && !html.includes('@**')) {
    return html.trim();
  }
  return html
    .replace(HTML_TAG_REGEX, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
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
  const re = mention instanceof RegExp 
    ? mention 
    : new RegExp(`@${mention.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
  
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
