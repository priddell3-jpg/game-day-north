import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage } from "./helpers/page.mjs";

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");

/* GitHub Pages serves data.json with max-age=600. The page re-reads that
   file every minute while a game is on, but a browser holding a copy
   answers from it for ten minutes — so a score the scheduled job had
   already committed stayed off the screen for cycle after cycle, with
   nothing failing anywhere to show for it. The fetch has to revalidate. */

const { jget } = loadFromPage(["jget"]);

test("a fetch option reaches the request, and the timeout still applies", async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({url, init});
    return {ok:true, json: async () => ({fixtures:[]})};
  };
  try{
    await jget("https://example.test/data.json", 5000, {cache:"no-cache"});
  } finally { globalThis.fetch = realFetch; }
  assert.equal(seen.length, 1);
  assert.equal(seen[0].init.cache, "no-cache");
  assert.ok(seen[0].init.signal, "the abort signal survives the caller's options");
});

test("no options still makes an ordinary request", async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push(init); return {ok:true, json: async () => ({})}; };
  try{ await jget("https://example.test/x", 5000); }
  finally { globalThis.fetch = realFetch; }
  assert.equal(seen[0].cache, undefined);
  assert.equal(seen[0].mode, "cors");
});

test("a caller cannot drop the timeout by passing its own signal", async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push(init); return {ok:true, json: async () => ({})}; };
  try{ await jget("https://example.test/x", 5000, {signal: null}); }
  finally { globalThis.fetch = realFetch; }
  assert.ok(seen[0].signal, "the timeout's own signal wins");
});

test("data.json is fetched with revalidation", () => {
  const call = /jget\(\s*new URL\("data\.json"[^;]*?\);/.exec(SRC);
  assert.ok(call, "could not find the data.json fetch");
  assert.match(call[0], /cache\s*:\s*"(no-cache|no-store|reload)"/,
    "data.json must not be answered from the browser's own copy");
});

test("only our own endpoints ask to revalidate", () => {
  /* Revalidation is for the two things this repo publishes and rewrites:
     the committed schedule file, and the tennis endpoint that normalises
     a live source. ESPN's own calls are the expensive ones and are left
     to cache normally. */
  const withCache = SRC.match(/jget\([^;]*?cache\s*:[^;]*?\)/g) || [];
  assert.equal(withCache.length, 2);
  const targets = withCache.map(c => /data\.json/.test(c) ? "data.json"
                                   : /api\/tennis|url\.href/.test(c) ? "tennis" : "OTHER: " + c);
  assert.deepEqual(targets.sort(), ["data.json", "tennis"]);
  for(const call of withCache) assert.doesNotMatch(call, /site\.api\.espn\.com|ESPN\s*\+/);
});
