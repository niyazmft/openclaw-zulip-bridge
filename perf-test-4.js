function stripHtmlToTextOld(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/@\*\*([^*]+)\*\*/g, "@$1")
    .trim();
}

const HTML_TAG_REGEX = /<[^>]+>/g;
const MENTION_REGEX = /@\*\*([^*]+)\*\*/g;

function stripHtmlToTextNew(html) {
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

const messages = [
  "Hello @**User Name**!",
  "Just a plain text message without any html or entities. It's relatively short.",
  "A message with just <p>some basic tags</p>",
  "Hello @botName, how are you?",
  "This is a message about @botName."
];

const N = 100000;

console.time("old");
for (let i = 0; i < N; i++) {
  for (const m of messages) stripHtmlToTextOld(m);
}
console.timeEnd("old");

console.time("new");
for (let i = 0; i < N; i++) {
  for (const m of messages) stripHtmlToTextNew(m);
}
console.timeEnd("new");
