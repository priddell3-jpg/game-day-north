import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage } from "./helpers/page.mjs";

const PAGE = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
const CONFIG = readFileSync(new URL("../capacitor.config.json", import.meta.url), "utf8");
const BRIDGE = readFileSync(new URL("../src/native-bridge.js", import.meta.url), "utf8");
const IOS_BUILD = readFileSync(new URL("../scripts/build-ios.mjs", import.meta.url), "utf8");
const SPM = readFileSync(new URL("../ios/App/CapApp-SPM/Package.swift", import.meta.url), "utf8");

test("the native shell bundles dist and never points its WebView at a server", () => {
  assert.match(CONFIG, /"webDir":\s*"dist"/);
  assert.match(CONFIG, /"appId":\s*"com\.priddell\.gamedaynorth"/);
  assert.doesNotMatch(CONFIG, /\burl\s*:/);
  assert.match(IOS_BUILD, /copyFile\(join\(root, "data\.json"\)/);
  assert.match(IOS_BUILD, /cp\(join\(root, "fonts"\)/);
});

test("the Swift package points at plain node_modules paths, never a pnpm store", () => {
  /* `cap sync` writes the real path of each plugin into Package.swift. A
     pnpm install resolves to node_modules/.pnpm/<hashed name>/..., which
     only exists on the machine that ran pnpm. `npm ci` keeps the paths
     portable. */
  assert.doesNotMatch(SPM, /\.pnpm/);
  assert.match(SPM, /path: "\.\.\/\.\.\/\.\.\/node_modules\/@capacitor\/browser"/);
  assert.match(SPM, /path: "\.\.\/\.\.\/\.\.\/node_modules\/@capacitor\/filesystem"/);
});

test("fonts are local assets, not requests to Google", () => {
  assert.doesNotMatch(PAGE, /fonts\.(googleapis|gstatic)\.com/);
  assert.match(PAGE, /\.\/fonts\/archivo-latin-variable\.woff2/);
  assert.match(PAGE, /\.\/fonts\/ibm-plex-mono-latin-600\.woff2/);
});

test("native JSON is HTTPS-only and restricted to the required hosts", () => {
  assert.match(BRIDGE, /url\.protocol !== "https:"/);
  for(const host of [
    "game-day-north.vercel.app",
    "site.api.espn.com",
    "api.wr-rims-prod.pulselive.com"
  ]) assert.match(BRIDGE, new RegExp(host.replaceAll(".", "\\.")));
  assert.doesNotMatch(CONFIG, /allowNavigation|NSAllowsArbitraryLoads/);
});

test("external navigation uses the native browser and blocks unsafe schemes", () => {
  assert.match(BRIDGE, /Browser\.open/);
  assert.match(BRIDGE, /event\.preventDefault\(\)/);
  assert.match(BRIDGE, /if \(url\.protocol !== "https:"\)/);
  assert.doesNotMatch(BRIDGE, /url\.protocol === "http:"/);
});

const fixture = () => ({
  generated: new Date().toISOString(),
  fixtures: [{comp:"NHL", home:{id:"home"}, away:{id:"away"}, start:Date.now()}],
  rugby: [], cycling: [], tennis: {matches:[], tournaments:[]}
});

/* The bridge as the page sees it. getSchedule stands in for the native
   conditional request: the test decides whether the server answers with
   a changed file, "not modified", or a failure. */
const native = {
  isNative: true,
  dataUrl: "https://game-day-north.vercel.app/data.json",
  getSchedule: async () => globalThis.__gdnRemote(),
  writeCachedSchedule: async (data, etag) => { globalThis.__gdnSaved = data; globalThis.__gdnSavedTag = etag; },
  readCachedSchedule: async () => globalThis.__gdnCached(),
  forgetScheduleTag: async () => { globalThis.__gdnForgot = (globalThis.__gdnForgot || 0) + 1; }
};
globalThis.__gdnWindow = {GDNNative:native};
globalThis.__gdnFetch = async () => { throw new Error("not configured"); };
globalThis.__gdnRemote = async () => { throw new Error("not configured"); };
globalThis.__gdnCached = async () => { throw new Error("no cache"); };
function nativePage(){
  return loadFromPage(
    ["validStaticPayload", "readStaticPayload"],
    `const window=globalThis.__gdnWindow;
     const location={href:"capacitor://localhost/index.html"};
     const jget=(...args)=>globalThis.__gdnFetch(...args);
     let staticFetchError="", lastRemoteSchedule=null;`
  );
}
const { validStaticPayload, readStaticPayload } = nativePage();

test("the committed schedule satisfies the native cache validator", () => {
  const data = JSON.parse(readFileSync(new URL("../data.json", import.meta.url), "utf8"));
  assert.equal(validStaticPayload(data), true);
});

test("an invalid remote schedule never replaces the last good cache", async () => {
  globalThis.__gdnSaved = null;
  globalThis.__gdnRemote = async () => ({data:{generated:"not-a-date", fixtures:[]}, etag:'"bad"'});
  globalThis.__gdnFetch = async () => { throw new Error("bundled copy should not be needed"); };
  const cached = fixture();
  globalThis.__gdnCached = async () => cached;
  const loaded = await readStaticPayload();
  assert.equal(loaded.source, "cache");
  assert.equal(loaded.data, cached);
  assert.equal(globalThis.__gdnSaved, null);
});

test("first-launch offline falls back to the bundled schedule", async () => {
  const bundled = fixture();
  globalThis.__gdnRemote = async () => { throw new Error("offline"); };
  globalThis.__gdnFetch = async url => {
    if(url.startsWith("https://")) throw new Error("the page must not fetch data.json itself on iOS");
    return bundled;
  };
  globalThis.__gdnCached = async () => { throw new Error("no cache yet"); };
  const loaded = await readStaticPayload();
  assert.equal(loaded.source, "bundle");
  assert.equal(loaded.data, bundled);
});

test("a successful remote schedule becomes the last-known-good copy, tag and all", async () => {
  const remote = fixture();
  globalThis.__gdnSaved = null; globalThis.__gdnSavedTag = null;
  globalThis.__gdnRemote = async () => ({data:remote, etag:'"abc123"'});
  globalThis.__gdnFetch = async () => { throw new Error("bundled copy should not be needed"); };
  const loaded = await readStaticPayload();
  assert.equal(loaded.source, "remote");
  assert.equal(globalThis.__gdnSaved, remote);
  assert.equal(globalThis.__gdnSavedTag, '"abc123"', "the validator is saved beside the file it validates");
});

/* --- 304: the file the server has is the one already held --- */

test("not-modified after a successful pass reuses the copy in memory, with no parse and no write", async () => {
  const page = nativePage();
  const remote = fixture();
  globalThis.__gdnRemote = async () => ({data:remote, etag:'"v1"'});
  const first = await page.readStaticPayload();
  assert.equal(first.source, "remote");
  globalThis.__gdnSaved = null;
  let readBack = 0;
  globalThis.__gdnCached = async () => { readBack++; return fixture(); };
  globalThis.__gdnRemote = async () => ({unchanged:true});
  const again = await page.readStaticPayload();
  assert.equal(again.source, "remote", "unchanged on the server is still the server's copy");
  assert.equal(again.data, remote, "the very object from the last pass");
  assert.equal(readBack, 0, "the saved file was not read back");
  assert.equal(globalThis.__gdnSaved, null, "and not rewritten");
});

test("not-modified on the first pass of a launch is answered from the saved copy", async () => {
  const page = nativePage();
  const saved = fixture();
  globalThis.__gdnSaved = null;
  globalThis.__gdnRemote = async () => ({unchanged:true});
  globalThis.__gdnCached = async () => saved;
  const loaded = await page.readStaticPayload();
  assert.equal(loaded.source, "remote");
  assert.equal(loaded.data, saved);
  assert.equal(globalThis.__gdnSaved, null);
});

test("a tag with no good file behind it is forgotten, so the next pass asks for the whole file", async () => {
  const page = nativePage();
  const bundled = fixture();
  globalThis.__gdnForgot = 0;
  globalThis.__gdnRemote = async () => ({unchanged:true});
  globalThis.__gdnCached = async () => ({generated:"not-a-date", fixtures:[]});
  globalThis.__gdnFetch = async () => bundled;
  const loaded = await page.readStaticPayload();
  assert.equal(loaded.source, "bundle", "shown from the bundle rather than a broken save");
  assert.equal(globalThis.__gdnForgot, 1);
});

test("the bridge sends the saved tag and treats 304 as unchanged, never as an error", () => {
  assert.match(BRIDGE, /headers\["if-none-match"\] = tag/);
  assert.match(BRIDGE, /response\.status === 304/);
  assert.match(BRIDGE, /return \{ unchanged: true \}/);
  assert.match(BRIDGE, /data\.etag/, "the tag lives beside the saved file");
  const write = /async function writeCachedSchedule\(data, etag\) \{[\s\S]*?\n\}/.exec(BRIDGE)[0];
  assert.ok(write.indexOf("path: CACHE_PATH") < write.indexOf("path: CACHE_TAG_PATH"),
    "the file is written before the tag that vouches for it");
  assert.match(write, /else \{\s*await forgetScheduleTag\(\);/, "no tag on the answer means no tag on disk");
  const get = /async function getSchedule\(timeout\) \{[\s\S]*?\n\}/.exec(BRIDGE)[0];
  assert.match(get, /if \(!tag\) throw new Error\("HTTP 304"\)/, "a 304 nobody asked for is not an answer");
  assert.match(get, /checkedJsonUrl\(DATA_URL\)/, "the same host check as every other request");
});
