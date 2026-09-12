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
     const whatsOnGames = () => globalThis.__p.games;
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
  globalThis.__r = {calls: 0, scopes: [], release: null};
  return loadFromPage(["refreshLive"],
    `let refreshing = null, refreshingFull = false, fullWanted = false;
     const runRefresh = (scope) => { globalThis.__r.calls++; globalThis.__r.scopes.push(scope);
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
    `let refreshing = null, refreshingFull = false, fullWanted = false;
     const runRefresh = async () => { globalThis.__r.calls++; throw new Error("network"); };`);
  await page.refreshLive().catch(()=>{});
  await page.refreshLive().catch(()=>{});
  assert.equal(globalThis.__r.calls, 2, "the guard was released after the failure");
});

test("a full pass asked for during a scores-only pass runs right after it, not never", async () => {
  const page = mutexHarness();
  const a = page.refreshLive("scores");
  const b = page.refreshLive();
  assert.equal(b, a, "it joined, as every caller does while a pass is running");
  assert.equal(globalThis.__r.calls, 1);
  globalThis.__r.release();
  await a;
  await new Promise(r => setTimeout(r, 0));
  assert.equal(globalThis.__r.calls, 2, "the full pass started once the scores pass finished");
  assert.deepEqual(globalThis.__r.scopes, ["scores", undefined]);
  globalThis.__r.release();
});

test("a scores pass asked for during a full pass simply joins it — a full pass already tops up", async () => {
  const page = mutexHarness();
  const a = page.refreshLive();
  page.refreshLive("scores");
  globalThis.__r.release();
  await a;
  await new Promise(r => setTimeout(r, 0));
  assert.equal(globalThis.__r.calls, 1);
});

/* --- what each kind of pass reads --- */

/* runRefresh with everything it touches stubbed: the point is only which
   readers it calls, so each stub records the call and does nothing. */
function passHarness(over = {}){
  const calls = {loadStatic: 0, fillScores: 0, fillRugbyScores: 0, loadLive: 0, renders: 0};
  globalThis.__pass = {calls, staticCount: 12, staticAt: Date.now() - 60000, ...over};
  const page = loadFromPage(["runRefresh", "nextLivePoll", "LIVE_POLL_MIN", "LIVE_POLL_MAX"],
    `const C = globalThis.__pass.calls;
     let rugbyCount = 0, staticCount = globalThis.__pass.staticCount, staticAt = globalThis.__pass.staticAt;
     const STALE_AFTER = 12*60*60*1000;
     let liveMode = null, liveErr = "", liveOK = null, liveNote = "", rugbyLiveErr = "";
     let dataAge = null, dataStale = false, staticSource = "remote";
     let livePollEvery = 60000;
     const scoreReqs = {asked: 0, failed: 0};
     const drawer = {hasAttribute: () => true};
     const racePickerKey = () => "";
     const renderDrawer = () => {};
     const tennisPollDue = () => false;
     const refreshTennis = () => {};
     const rememberResults = () => {};
     const render = () => { C.renders++; };
     const agoText = () => "just now";
     const loadStatic = async () => { C.loadStatic++; return staticCount; };
     const fillScores = async () => { C.fillScores++; return 0; };
     const fillRugbyScores = async () => { C.fillRugbyScores++; return 0; };
     const loadLive = async () => { C.loadLive++; };
     globalThis.__pass.state = () => ({liveMode, dataAge, dataStale, liveOK, livePollEvery});`);
  return {page, calls};
}

test("the minute pass tops up scores and reads no schedule file", async () => {
  const {page, calls} = passHarness();
  await page.runRefresh("scores");
  assert.equal(calls.loadStatic, 0, "data.json was not re-read");
  assert.equal(calls.loadLive, 0, "and the direct fetch was not run either");
  assert.equal(calls.fillScores, 1);
  assert.equal(calls.fillRugbyScores, 1);
});

test("a full pass reads the schedule first, then tops up", async () => {
  const {page, calls} = passHarness();
  await page.runRefresh();
  assert.equal(calls.loadStatic, 1);
  assert.equal(calls.fillScores, 1);
  assert.equal(calls.fillRugbyScores, 1);
  assert.equal(calls.loadLive, 0, "a fresh file means no direct fetch");
  assert.equal(globalThis.__pass.state().liveMode, true);
});

test("a stale file sends a full pass to the direct fetch, and a minute pass still only tops up", async () => {
  const stale = {staticAt: Date.now() - 13*60*60*1000};
  const full = passHarness(stale);
  await full.page.runRefresh();
  assert.equal(full.calls.loadLive, 1, "the full pass fell back to ESPN");
  const minute = passHarness(stale);
  await minute.page.runRefresh("scores");
  assert.equal(minute.calls.loadLive, 0, "the minute pass never runs the heavy fallback");
  assert.equal(minute.calls.fillScores, 1, "it tops up whatever is on the board");
});

test("a minute pass does not touch the page's claims about the schedule", async () => {
  const {page} = passHarness();
  await page.runRefresh("scores");
  const st = globalThis.__pass.state();
  assert.equal(st.liveMode, null, "liveMode is a full pass's finding, not a top-up's");
  assert.equal(st.dataAge, null);
});

/* --- backing off a failing source --- */

test("a pass with a failed request doubles the interval, to at most a quarter-hour", () => {
  const {page} = passHarness();
  const MIN = page.LIVE_POLL_MIN, MAX = page.LIVE_POLL_MAX;
  assert.equal(MIN, 60000);
  assert.equal(MAX, 15*60000);
  let every = MIN;
  const seen = [];
  for(let i = 0; i < 6; i++){ every = page.nextLivePoll(every, {asked: 2, failed: 1}); seen.push(every); }
  assert.deepEqual(seen, [2*MIN, 4*MIN, 8*MIN, MAX, MAX, MAX]);
});

test("the next answered pass puts the interval back to a minute", () => {
  const {page} = passHarness();
  assert.equal(page.nextLivePoll(8*60000, {asked: 1, failed: 0}), 60000);
});

test("a pass that asked nothing leaves the interval where it is", () => {
  const {page} = passHarness();
  assert.equal(page.nextLivePoll(4*60000, {asked: 0, failed: 0}), 4*60000);
  assert.equal(page.nextLivePoll(60000, {asked: 0, failed: 0}), 60000);
});

test("the interval is recomputed from the score pass inside runRefresh, so every kind of pass counts", async () => {
  const {page} = passHarness();
  const run = /async function runRefresh\(scope\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(run, /livePollEvery = nextLivePoll\(livePollEvery, scoreReqs\)/);
  assert.ok(run.indexOf("await fillScores()") < run.indexOf("livePollEvery = nextLivePoll"),
    "computed from the pass that just ran");
  await page.runRefresh("scores");
});

/* --- the minute tick: hidden tab, nothing due, and the backed-off interval --- */

function tickHarness(){
  globalThis.__tick = {hidden: false, due: true, refreshes: []};
  const page = loadFromPage(["liveTick", "LIVE_POLL_MIN"],
    `const document = {get hidden(){ return globalThis.__tick.hidden; }};
     const pollDue = () => globalThis.__tick.due;
     let livePollEvery = 60000, livePollAt = 0;
     const refreshLive = (scope) => { globalThis.__tick.refreshes.push(scope); return Promise.resolve(); };
     globalThis.__tick.set = (every, at) => { livePollEvery = every; livePollAt = at; };`);
  return page;
}

test("the minute tick asks for a scores-only pass", () => {
  const page = tickHarness();
  page.liveTick();
  assert.deepEqual(globalThis.__tick.refreshes, ["scores"]);
});

test("the minute tick stands down while the tab is hidden and when nothing is due", () => {
  const page = tickHarness();
  globalThis.__tick.hidden = true;
  page.liveTick();
  globalThis.__tick.hidden = false; globalThis.__tick.due = false;
  page.liveTick();
  assert.deepEqual(globalThis.__tick.refreshes, []);
});

test("a backed-off interval is honoured by the tick, with half a tick of slack for timer drift", () => {
  const page = tickHarness();
  const now = Date.now();
  globalThis.__tick.set(4*60000, now - 2*60000);
  page.liveTick();
  assert.deepEqual(globalThis.__tick.refreshes, [], "two minutes into a four-minute wait");
  globalThis.__tick.set(4*60000, now - 4*60000 + 20000);
  page.liveTick();
  assert.deepEqual(globalThis.__tick.refreshes, ["scores"], "twenty seconds early is within the slack");
  globalThis.__tick.set(60000, now - 59990);
  page.liveTick();
  assert.equal(globalThis.__tick.refreshes.length, 2, "a one-minute tick landing ten milliseconds early still fires");
});

/* --- the parts that live in an interval body, asserted where they ship --- */

test("the sixty-second timer runs the tick, and only the tick", () => {
  assert.match(SRC, /setInterval\(\(\)=>\{ liveTick\(\); \}, 60000\);/);
  const tick = /function liveTick\(\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(tick, /document\.hidden/);
  assert.match(tick, /pollDue\(\)/);
  assert.match(tick, /refreshLive\("scores"\)/);
  assert.doesNotMatch(tick, /refreshLive\(\)/, "the minute tick never asks for the schedule");
});

test("tennis's ten-minute poll also stands down while hidden and when nothing is due", () => {
  const body = (SRC.match(/setInterval\(\(\)=>\{[\s\S]*?\}, 10\*60000\);/g) || [])
    .find(x=>x.includes("tennisPollDue"));
  assert.ok(body, "could not find the tennis refresh interval");
  assert.match(body, /document\.hidden/);
  assert.match(body, /if\(tennisPollDue\(Date\.now\(\)\)\) refreshTennis\(\)/);
  const refresh = /function refreshTennis\([\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(refresh, /now-tennisLastAskedAt < TENNIS_REFRESH_INTERVAL/,
    "other refresh paths must not turn the ten-minute poll into a minute poll");
});

test("coming back to the tab refreshes straight away, schedule included", () => {
  const at = SRC.indexOf('addEventListener("visibilitychange"');
  assert.ok(at > 0, "no visibilitychange listener");
  const body = SRC.slice(at, at + 500);
  assert.match(body, /document\.hidden/);
  assert.match(body, /refreshLive\(\)/, "a full pass: the file may have moved while away");
  assert.match(body, /refreshTennis\(true\)/);
});

test("startup and a changed pick ask for a full pass", () => {
  assert.match(SRC, /^refreshLive\(\);$/m, "the pass at load");
  const picks = /function refreshAfterPicks\(\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(picks, /refreshLive\(\)/);
  assert.doesNotMatch(picks, /refreshLive\("scores"\)/);
});

test("the slow schedule refresh is still there for post-final corrections", () => {
  assert.match(SRC, /setInterval\(\(\)=>\{ if\(liveMode!==false\) refreshLive\(\); \}, 15\*60000\);/);
});
