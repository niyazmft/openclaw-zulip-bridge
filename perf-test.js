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
  return html
    .replace(/<[^>]+>|&lt;|&gt;|&amp;|&quot;|@\*\*([^*]+)\*\*/g, (match, p1) => {
      if (match[0] === "<") return "";
      if (match === "&lt;") return "<";
      if (match === "&gt;") return ">";
      if (match === "&amp;") return "&";
      if (match === "&quot;") return '"';
      if (match.startsWith("@**")) return `@${p1}`;
      return match;
    })
    .trim();
}

const largeHtml = `<div class="message"><p>Hello @**User Name**! This is a &lt;test&gt; message with some &amp; characters and &quot;quotes&quot;.</p><p>Here is another line of text.</p><ul><li>Item 1</li><li>Item 2</li></ul></div>`.repeat(10);

const N = 100000;

console.time("old");
for (let i = 0; i < N; i++) {
  stripHtmlToTextOld(largeHtml);
}
console.timeEnd("old");

console.time("new");
for (let i = 0; i < N; i++) {
  stripHtmlToTextNew(largeHtml);
}
console.timeEnd("new");
