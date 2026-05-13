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

const cases = [
  "<p>Hello &lt;b&gt; world &amp;lt;</p>",
  "&lt;@**User**&gt;",
  "Just text",
  "<a href='&lt;'>link</a>&quot;quote&quot;",
  "Nested <div><span>@**Mention**</span></div>"
];

for (const c of cases) {
  const oldRes = stripHtmlToTextOld(c);
  const newRes = stripHtmlToTextNew(c);
  if (oldRes !== newRes) {
    console.error("Mismatch for", c);
    console.error("Old:", oldRes);
    console.error("New:", newRes);
  } else {
    console.log("Match:", c, "->", oldRes);
  }
}
