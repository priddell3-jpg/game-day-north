import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* The App Store listing needs a privacy policy URL and a support URL, and
   App Review reads both. They are plain pages on the website. These tests
   keep the privacy policy true to the code: a new host, a new dependency
   or a script on the page means the policy has to be looked at again. */

const read = rel => readFileSync(new URL(rel, import.meta.url), "utf8");
const privacy = read("../privacy.html");
const support = read("../support.html");
const page = read("../src/page.html");

test("both pages are self-contained documents with no script", () => {
  for(const [name, html] of [["privacy", privacy], ["support", support]]){
    assert.match(html, /^<!doctype html>/i, name);
    assert.match(html, /<title>[^<]+<\/title>/, name);
    assert.doesNotMatch(html, /<script\b/i, name + " runs no script");
    assert.match(html, /Content-Security-Policy" content="default-src 'none'/, name + " forbids everything it does not need");
    for(const url of html.match(/url\("[^"]+"\)/g) || []) assert.match(url, /url\("\.\/fonts\//, name + " loads fonts from this site only");
    assert.match(html, /not affiliated with or endorsed by any league, team or broadcaster/i, name);
  }
});

test("the privacy policy names every host the app can contact", () => {
  const bridge = read("../src/native-bridge.js");
  const hosts = [...bridge.match(/JSON_HOSTS = new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  assert.ok(hosts.length >= 3);
  for(const h of hosts) assert.ok(privacy.includes(h), "privacy.html does not name " + h);

  /* The website's own connect-src, which is the same list for the web build. */
  const build = read("../build.js");
  const connect = build.match(/"connect-src ([^"]+)"/)[1].split(/\s+/).filter(s => s.startsWith("https://"));
  for(const origin of connect) assert.ok(privacy.includes(new URL(origin).host), "privacy.html does not name " + origin);
});

test("the policy's \"collects nothing\" still matches what the app ships", () => {
  assert.match(privacy, /collects no personal data/);
  const pkg = JSON.parse(read("../package.json"));
  /* Analytics, crash reporting and ads all arrive as a dependency. Anything
     outside Capacitor's own packages is a reason to revisit the policy and
     the App Store privacy answers before it ships. */
  for(const dep of Object.keys(pkg.dependencies)) assert.match(dep, /^@capacitor\//, dep);
  const manifest = read("../ios/App/App/PrivacyInfo.xcprivacy");
  assert.match(manifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(manifest, /<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/);
});

test("the support page gives a way to reach a person and links the policy", () => {
  assert.match(support, /href="https:\/\/github\.com\/priddell3-jpg\/game-day-north\/issues\/new"/);
  assert.match(support, /href="\.\/privacy\.html"/);
  assert.match(privacy, /href="\.\/support\.html"/);
});

test("the website publishes both pages", () => {
  const web = read("../scripts/build-web.mjs");
  assert.match(web, /"privacy\.html"/);
  assert.match(web, /"support\.html"/);
});

test("the app links both pages from its footer note, beside the affiliation line", () => {
  const note = /function noteBlock\(\)\{[\s\S]*?\n\}/.exec(page)[0];
  assert.match(note, /Not affiliated with or endorsed by any league, team or broadcaster/);
  assert.match(note, /sitePage\("privacy\.html"\)/);
  assert.match(note, /sitePage\("support\.html"\)/);
});

test("on iOS the links point at the website, which the bridge opens in the browser", () => {
  const sitePage = new Function("window", "location",
    /function sitePage\(path\)\{[\s\S]*?\n\}/.exec(page)[0] + "\nreturn sitePage;");
  const native = { GDNNative: { isNative: true, webUrl: "https://game-day-north.vercel.app/" } };
  assert.equal(sitePage(native, {})("privacy.html"), "https://game-day-north.vercel.app/privacy.html");
  /* GitHub Pages serves the site from a subfolder; the link stays beside the page. */
  const pages = { href: "https://priddell3-jpg.github.io/game-day-north/#t=liv" };
  assert.equal(sitePage({}, pages)("support.html"), "https://priddell3-jpg.github.io/game-day-north/support.html");
});
