import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
const built = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

test("the generated CSP permits only the application inline script", () => {
  const scripts = [...built.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1);
  const hash = createHash("sha256").update(scripts[0][1], "utf8").digest("base64");
  const csp = built.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/i)?.[1] || "";
  assert.match(csp, new RegExp("script-src 'self' 'sha256-" + hash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "'"));
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /form-action 'none'/);
});

test("Vercel sends the browser hardening headers", () => {
  const all = vercel.headers.find(rule => rule.source === "/(.*)")?.headers || [];
  const headers = Object.fromEntries(all.map(({key, value}) => [key.toLowerCase(), value]));
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["referrer-policy"], "no-referrer");
  assert.match(headers["permissions-policy"], /camera=\(\)/);
  assert.match(headers["permissions-policy"], /microphone=\(\)/);
  assert.match(headers["permissions-policy"], /geolocation=\(\)/);
});

test("Vercel publishes only the staged web bundle", () => {
  assert.equal(vercel.outputDirectory, "public");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts.build, /scripts\/build-web\.mjs/);

  const webBuild = readFileSync(new URL("../scripts/build-web.mjs", import.meta.url), "utf8");
  assert.match(webBuild, /join\(root, "public"\)/);
  assert.match(webBuild, /"index\.html"/);
  assert.match(webBuild, /"data\.json"/);
  assert.match(webBuild, /"fonts"/);
  assert.doesNotMatch(webBuild, /"ios"/);
  assert.doesNotMatch(webBuild, /"src"/);
});

test("new-tab links cannot retain an opener or send a referrer", () => {
  for(const tag of source.match(/<a\b[^>]*target="_blank"[^>]*>/gi) || []){
    assert.match(tag, /rel="[^"]*noopener[^"]*"/i);
    assert.match(tag, /rel="[^"]*noreferrer[^"]*"/i);
  }
});
