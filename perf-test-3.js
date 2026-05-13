function normalizeMentionOld(text, mention) {
  if (!mention) {
    return text.trim();
  }
  const escaped = mention.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`@${escaped}\\b`, "gi");
  return text.replace(re, " ").replace(/\s+/g, " ").trim();
}

function normalizeMentionNew(text, mention) {
  if (!mention) {
    return text.trim();
  }

  if (!text.includes('@')) {
    return text.trim();
  }

  const escaped = mention.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`@${escaped}\\b`, "gi");
  return text.replace(re, " ").replace(/\s+/g, " ").trim();
}

const messages = [
  "Hello @**User Name**!",
  "Just a plain text message without any html or entities. It's relatively short.",
  "Hello @botName, how are you?",
  "@botName can you help me?",
  "This is a message about @botName."
];

const N = 100000;
const mention = "botName";

console.time("old");
for (let i = 0; i < N; i++) {
  for (const m of messages) normalizeMentionOld(m, mention);
}
console.timeEnd("old");

console.time("new");
for (let i = 0; i < N; i++) {
  for (const m of messages) normalizeMentionNew(m, mention);
}
console.timeEnd("new");
