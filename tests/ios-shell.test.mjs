import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage } from "./helpers/page.mjs";

const PAGE = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
const CONFIG = readFileSync(new URL("../capacitor.config.json", import.meta.url), "utf8");
const BRIDGE = readFileSync(new URL("../src/native-bridge.js", import.meta.url), "utf8");
const IOS_BUILD = readFileSync(new URL("../scripts/build-ios.mjs", import.meta.url), "utf8");

test("the native shell bundles dist and never points its WebView at a server", () => {
  assert.match(CONFIG, /"webDir":\s*"dist"/);
  assert.match(CONFIG, /"appId":\s*"com\.priddell\.gamedaynorth"/);
  assert.doesNotMatch(CONFIG, /\burl\s*:/);
  assert.match(IOS_BUILD, /copyFile\(join\(root, "data\.json"\)/);
  assert.match(IOS_BUILD, /cp\(join\(root, "fonts"\)/);
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

const native = {
  isNative: true,
  dataUrl: "https://game-day-north.vercel.app/data.json",
  writeCachedSchedule: async data => globalThis.__gdnSaved = data,
  readCachedSchedule: async () => globalThis.__gdnCached()
};
globalThis.__gdnWindow = {GDNNative:native};
globalThis.__gdnFetch = async () => { throw new Error("not configured"); };
globalThis.__gdnCached = async () => { throw new Error("no cache"); };
const { validStaticPayload, readStaticPayload } = loadFromPage(
  ["validStaticPayload", "readStaticPayload"],
  `const window=globalThis.__gdnWindow;
   const location={href:"capacitor://localhost/index.html"};
   const jget=(...args)=>globalThis.__gdnFetch(...args);
   let staticFetchError="";`
);

test("the committed schedule satisfies the native cache validator", () => {
  const data = JSON.parse(readFileSync(new URL("../data.json", import.meta.url), "utf8"));
  assert.equal(validStaticPayload(data), true);
});

test("an invalid remote schedule never replaces the last good cache", async () => {
  globalThis.__gdnSaved = null;
  globalThis.__gdnFetch = async url => {
    if(url.startsWith("https://")) return {generated:"not-a-date", fixtures:[]};
    throw new Error("bundled copy should not be needed");
  };
  const cached = fixture();
  globalThis.__gdnCached = async () => cached;
  const loaded = await readStaticPayload();
  assert.equal(loaded.source, "cache");
  assert.equal(loaded.data, cached);
  assert.equal(globalThis.__gdnSaved, null);
});

test("first-launch offline falls back to the bundled schedule", async () => {
  const bundled = fixture();
  globalThis.__gdnFetch = async url => {
    if(url.startsWith("https://")) throw new Error("offline");
    return bundled;
  };
  globalThis.__gdnCached = async () => { throw new Error("no cache yet"); };
  const loaded = await readStaticPayload();
  assert.equal(loaded.source, "bundle");
  assert.equal(loaded.data, bundled);
});

test("a successful remote schedule becomes the last-known-good copy", async () => {
  const remote = fixture();
  globalThis.__gdnSaved = null;
  globalThis.__gdnFetch = async url => {
    assert.match(url, /^https:\/\//);
    return remote;
  };
  const loaded = await readStaticPayload();
  assert.equal(loaded.source, "remote");
  assert.equal(globalThis.__gdnSaved, remote);
});
