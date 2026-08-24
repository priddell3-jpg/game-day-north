import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage } from "./helpers/page.mjs";

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");

/* The minute poll exists to follow a game that is on. It should follow
   nothing else: not a finished match, not a fixture in a competition
   nobody here follows, not cycling, and not anything at all while the
   tab is in the background or the viewer has scores switched off. */

function pollHarness(){
  globalThis.__p = {games: []};
  const page = loadFromPage(
    ["ZONE_IANA", "_zoneFmt", "zoneParts", "normName", "idKey", "ESPN_PATH",
     "stateOf", "POLL_WINDOW", "needsScore", "activeNow", "pollDue"],
    `let liveMode = true, showScores = true;
     const myGames = () => globalThis.__p.games;
     globalThis.__p.set = (m, s) => { liveMode = m; showScores = s; };`);
  return page;
}

const live = (over = {}) => ({
  comp:"EPL", start: Date.now() - 45*60000,
  home:{id:"ful", name:"Fulham"}, away:{id:"che", name:"Chelsea"},
  result:{status:"live", label:"62'", score:[2, 3]},
  ...over
});

test("a live fixture makes the poll due", () => {
  const page = pollHarness();
  globalThis.__p.games = [live()];
  assert.equal(page.pollDue(), true);
});

test("nothing is due with scores switched off", () => {
  const page = pollHarness();
  globalThis.__p.games = [live()];
  globalThis.__p.set(true, false);
  assert.equal(page.pollDue(), false);
});

test("nothing is due when the live source is known to be blocked", () => {
  const page = pollHarness();
  globalThis.__p.games = [live()];
  globalThis.__p.set(false, true);
  assert.equal(page.pollDue(), false);
});

test("a finished match does not keep the poll running", () => {
  const page = pollHarness();
  globalThis.__p.games = [live({result:{status:"final", label:"FT", score:[2, 3]}})];
  assert.equal(page.pollDue(), false);
});

test("a fixture yet to kick off does not start the minute poll", () => {
  const page = pollHarness();
  globalThis.__p.games = [live({start: Date.now() + 90*60000,
    result:{status:"scheduled", label:"", score:null}})];
  assert.equal(page.pollDue(), false);
});

test("one live match among finished ones is enough", () => {
  const page = pollHarness();
  globalThis.__p.games = [
    live({result:{status:"final", label:"FT", score:[1, 0]}}),
    live({result:{status:"final", label:"FT", score:[2, 2]}}),
    live()
  ];
  assert.equal(page.pollDue(), true);
});

test("an empty board polls nothing", () => {
  const page = pollHarness();
  globalThis.__p.games = [];
  assert.equal(page.pollDue(), false);
});

/* --- one refresh at a time --- */

function mutexHarness(){
  globalThis.__r = {calls: 0, release: null};
  return loadFromPage(["refreshLive"],
    `let refreshing = null;
     const runRefresh = () => { globalThis.__r.calls++;
       return new Promise(res => { globalThis.__r.release = res; }); };`);
}

test("a second refresh joins the one already running instead of starting another", async () => {
  const page = mutexHarness();
  const a = page.refreshLive();
  const b = page.refreshLive();
  assert.equal(globalThis.__r.calls, 1, "only one pass was started");
  assert.equal(a, b, "the second caller was handed the pass already running");
  globalThis.__r.release();
  await a;
});

test("a refresh can start again once the previous one has finished", async () => {
  const page = mutexHarness();
  const a = page.refreshLive();
  globalThis.__r.release();
  await a;
  page.refreshLive();
  assert.equal(globalThis.__r.calls, 2);
});

test("a failed refresh does not wedge the next one", async () => {
  globalThis.__r = {calls: 0};
  const page = loadFromPage(["refreshLive"],
    `let refreshing = null;
     const runRefresh = async () => { globalThis.__r.calls++; throw new Error("network"); };`);
  await page.refreshLive().catch(()=>{});
  await page.refreshLive().catch(()=>{});
  assert.equal(globalThis.__r.calls, 2, "the guard was released after the failure");
});

/* --- the parts that live in an interval body, asserted where they ship --- */

test("the minute poll stands down while the tab is hidden", () => {
  const body = /setInterval\(\(\)=>\{([\s\S]*?)\}, 60000\);/.exec(SRC);
  assert.ok(body, "could not find the minute poll");
  assert.match(body[1], /document\.hidden/);
  assert.match(body[1], /pollDue\(\)/);
});

test("coming back to the tab refreshes straight away", () => {
  const at = SRC.indexOf('addEventListener("visibilitychange"');
  assert.ok(at > 0, "no visibilitychange listener");
  const body = SRC.slice(at, at + 500);
  assert.match(body, /!document\.hidden/);
  assert.match(body, /refreshLive\(\)/);
});

test("the slow schedule refresh is still there for post-final corrections", () => {
  assert.match(SRC, /setInterval\(\(\)=>\{ if\(liveMode!==false\) refreshLive\(\); \}, 15\*60000\);/);
});
