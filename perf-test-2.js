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

function stripHtmlToTextNew(html) {
  let result = html;

  // Try to use string indexing to see if we have HTML or entities
  if (result.includes('<') || result.includes('&') || result.includes('@**')) {
    result = result.replace(/<[^>]+>/g, "");
    if (result.includes('&')) {
      result = result
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"');
    }
    if (result.includes('@**')) {
      result = result.replace(/@\*\*([^*]+)\*\*/g, "@$1");
    }
  }
  return result.trim();
}

const htmlMessages = [
  `<div class="message"><p>Hello @**User Name**! This is a &lt;test&gt; message with some &amp; characters and &quot;quotes&quot;.</p><p>Here is another line of text.</p><ul><li>Item 1</li><li>Item 2</li></ul></div>`,
  `Just a plain text message without any html or entities. It's relatively short.`,
  `A message with just <p>some basic tags</p>`,
  `Hello @**Someone**, how are you doing today?`
];

const N = 100000;

console.time("old");
for (let i = 0; i < N; i++) {
  for (const m of htmlMessages) stripHtmlToTextOld(m);
}
console.timeEnd("old");

console.time("new");
for (let i = 0; i < N; i++) {
  for (const m of htmlMessages) stripHtmlToTextNew(m);
}
console.timeEnd("new");

for (const m of htmlMessages) {
    if (stripHtmlToTextOld(m) !== stripHtmlToTextNew(m)) {
        console.error("Mismatch for", m);
    }
}
