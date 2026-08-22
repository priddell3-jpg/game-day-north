/* Wraps the artifact page body into a standalone HTML document.
   The claude.ai artifact host supplies its own <!doctype>/<head>/<body>,
   so src/page.html has none. GitHub Pages needs the full document. */
const fs = require("fs");
const body = fs.readFileSync(__dirname + "/src/page.html", "utf8");
const title = (body.match(/<title>([^<]*)<\/title>/) || [, "Game Day North"])[1];
const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Which of your teams are playing, and which Canadian service each game is on.">
<meta name="color-scheme" content="light dark">
<meta property="og:title" content="${title}">
<meta property="og:description" content="Multi-team game tracker for Canada — fixtures, where to watch, and scores you can hide.">
</head>
<body>
${body}
</body>
</html>
`;
fs.writeFileSync(__dirname + "/index.html", doc);
console.log("built index.html (" + (doc.length / 1024).toFixed(1) + " KB)");
