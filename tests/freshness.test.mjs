import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage } from "./helpers/page.mjs";

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
const BUILD = readFileSync(new URL("../scripts/fetch-data.mjs", import.meta.url), "utf8");
const REFRESH = readFileSync(new URL("../.github/workflows/refresh-data.yml", import.meta.url), "utf8");
const SENTINEL = readFileSync(new URL("../.github/workflows/freshness-sentinel.yml", import.meta.url), "utf8");

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

test("nothing else has caching turned off with it", () => {
  // the API calls are the page's expensive ones and are allowed to cache;
  // only the file the scheduled job rewrites needs revalidating
  const withCache = SRC.match(/jget\([^;]*?cache\s*:[^;]*?\)/g) || [];
  assert.equal(withCache.length, 1);
  assert.match(withCache[0], /data\.json/);
});

/* ================= the sentinel that watches the clock =================
   The refresh schedule stopped firing for a day and nothing said so: the
   workflows that did run were green, the site was up, and the only
   symptom was a person noticing a finished game still reading
   "scheduled". A sentinel now checks the served file's age hourly.

   Its threshold is only meaningful next to the things that set it. Too
   low and a single skipped slot opens an issue every day until nobody
   reads them; too high and a dead cron goes unnamed for another day.
   These assert the numbers still agree with each other rather than that
   any one of them is 7 — change the cadence and this should be the
   thing that objects.
   ====================================================================== */

const hours = re => { const m = re.exec(SENTINEL); return m ? Number(m[1]) : null; };
const SENTINEL_MAX = hours(/MAX_AGE_HOURS:\s*"(\d+)"/);

test("the sentinel has a threshold at all", () => {
  assert.ok(SENTINEL_MAX, "MAX_AGE_HOURS must be set in freshness-sentinel.yml");
});

test("the threshold clears the age at which the build refreshes the stamp", () => {
  /* The build rewrites `generated` once the file is MAX_AGE old even
     when no fixture moved, so a healthy site never exceeds that by more
     than one run. A sentinel that fired below it would be reporting the
     build working as designed. */
  const m = /const MAX_AGE = (\d+)\*3600000;/.exec(BUILD);
  assert.ok(m, "scripts/fetch-data.mjs must state its MAX_AGE in hours");
  assert.ok(SENTINEL_MAX > Number(m[1]),
    "the sentinel must not fire on a file the build considers current");
});

test("the threshold allows at least one missed refresh", () => {
  // "20 */3 * * *" — every three hours
  const m = /- cron: "\d+ \*\/(\d+) \* \* \*"/.exec(REFRESH);
  assert.ok(m, "refresh-data.yml must schedule itself on an hourly interval");
  const every = Number(m[1]);
  assert.ok(SENTINEL_MAX >= 2 * every,
    "one skipped slot must not be enough to open an issue");
  assert.ok(SENTINEL_MAX < 4 * every,
    "a dead cron must be named the same day, not the next one");
});

test("the sentinel runs more often than the thing it watches", () => {
  const m = /- cron: "\d+ (\S+) \* \* \*"/.exec(SENTINEL);
  assert.ok(m, "freshness-sentinel.yml must schedule itself");
  assert.equal(m[1], "*", "hourly — a check as coarse as the refresh reports too late");
});

test("the sentinel asks the deployed site, not the repository", () => {
  /* A build that commits but never deploys is the same outage from the
     outside, and reading the committed file would miss it entirely. */
  assert.match(SENTINEL, /github\.io|SITE_URL/);
  assert.doesNotMatch(SENTINEL, /actions\/checkout/);
});

test("the drill can only be asked for by hand", () => {
  /* An alert nobody has watched fire is a hope, not a safety net, so the
     stale path can be triggered deliberately. That must never be
     something the hourly schedule can do to itself: `inputs.drill` is
     empty on a scheduled run, and the comparison is against the string
     "true", so an empty value takes the ordinary threshold. */
  assert.match(SENTINEL, /DRILL: \$\{\{ inputs\.drill \}\}/);
  assert.match(SENTINEL, /drill = process\.env\.DRILL === "true"/);
  assert.match(SENTINEL, /default: false/);
});

test("a drill says so in the title as well as the body", () => {
  /* The issue history outlives everyone's memory of running the drill.
     A deliberate test that reads like a real outage six months later is
     worse than not having tested. */
  assert.match(SENTINEL, /DRILL — a deliberate test, not an outage/);
  assert.match(SENTINEL, /This is a drill/);
});

test("a drill issue reused by a real outage stops calling itself a drill", () => {
  // the title is rewritten on every check, not only when the issue opens
  assert.match(SENTINEL, /gh issue edit "\$number" --title/);
});

test("gh is told which repository it is working on", () => {
  /* Which follows directly from the test above: gh reads the repository
     off a git remote, and there is no checkout here to read one from.
     The first real run failed on exactly this — "fatal: not a git
     repository" — after the freshness check itself had passed. */
  assert.match(SENTINEL, /GH_REPO: \$\{\{ github\.repository \}\}/);
});

test("nothing fetched over the network reaches a command line", () => {
  // the issue body is written by node from the environment; the detail
  // string carries text from a file this workflow did not write
  assert.match(SENTINEL, /DETAIL: \$\{\{ steps\.check\.outputs\.detail \}\}/);
  assert.doesNotMatch(SENTINEL, /"\$\{\{ steps\.check\.outputs\.detail \}\}"/);
});
