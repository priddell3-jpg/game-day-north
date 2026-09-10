/* Wraps src/page.html, which is a fragment, into the standalone
   document GitHub Pages serves. */
const fs = require("fs");
const crypto = require("crypto");
const { inlineManifest } = require("./scripts/lib/inline.cjs");
/* The team manifest is substituted in here rather than fetched at run
   time, so the page stays a single self-contained file. */
const manifest = fs.readFileSync(__dirname + "/data/teams.json", "utf8");
const body = inlineManifest(fs.readFileSync(__dirname + "/src/page.html", "utf8"), manifest);
const title = (body.match(/<title>([^<]*)<\/title>/) || [, "Game Day North"])[1];
/* Keep the app as a self-contained page without granting every inline
   script permission to run. The hash authorises the one script we built;
   an injected script does not share it and is blocked by the browser. */
const inlineScripts = [...body.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
if(inlineScripts.length !== 1) throw new Error("Expected exactly one inline application script");
const scriptHash = crypto.createHash("sha256").update(inlineScripts[0][1], "utf8").digest("base64");
const csp = [
  "default-src 'self'",
  "script-src 'self' 'sha256-" + scriptHash + "'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "connect-src 'self' https://game-day-north.vercel.app https://site.api.espn.com https://api.wr-rims-prod.pulselive.com",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "form-action 'none'"
].join("; ");
const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Which of your teams are playing, and which Canadian service each game is on.">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="${csp}">
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
