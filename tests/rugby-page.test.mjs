import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage } from "./helpers/page.mjs";

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
const DAY = 86400000;

/* Rugby is followed as a competition and starred as a nation, and those
   two facts are what most of this file is about. Starring must change
   how a row looks and nothing about which rows exist — the question the
   page answers for rugby is "what internationals are on", not "when do
   my teams play". */

/* ---------------- the gate ---------------- */

function gateHarness(selected = [], stars = []){
  return loadFromPage(
    ["RUGBY_FOLLOW", "isMine", "isStarred"],
    `let selected = new Set(${JSON.stringify(selected)});
     let rugbyStars = new Set(${JSON.stringify(stars)});
     const rugbyOn = () => selected.has("rugby-intl");`);
}
const ruGame = (over = {}) => Object.assign({
  rugby:true, comp:"RUNC", start: Date.now() + DAY,
  home:{id:"ru:ireland", name:"Ireland", nation:"ireland"},
  away:{id:"ru:new-zealand", name:"New Zealand", nation:"new-zealand"}
}, over);

test("rugby is off for someone who never asked for it", () => {
  const p = gateHarness(["van-nhl", "liv"]);
  assert.equal(p.isMine(ruGame()), false);
});

test("the default team set contains no rugby", () => {
  const m = /const DEFAULT_TEAMS = (\[[^\]]*\])/.exec(SRC);
  assert.ok(m, "DEFAULT_TEAMS must exist");
  assert.equal(JSON.parse(m[1]).includes("rugby-intl"), false);
});

test("turning rugby on shows every supported international", () => {
  const p = gateHarness(["rugby-intl"]);
  assert.equal(p.isMine(ruGame()), true);
  assert.equal(p.isMine(ruGame({home:{id:"ru:fiji", name:"Fiji", nation:"fiji"},
                                away:{id:"ru:canada", name:"Canada", nation:"canada"}})), true);
});

test("starring a nation does not filter the schedule", () => {
  // The whole point. Ireland is starred; a match with neither Ireland
  // nor a starred side in it is still on the page.
  const p = gateHarness(["rugby-intl"], ["ireland"]);
  const other = ruGame({home:{id:"ru:fiji", name:"Fiji", nation:"fiji"},
                        away:{id:"ru:canada", name:"Canada", nation:"canada"}});
  assert.equal(p.isMine(other), true);
  assert.equal(p.isStarred(other.home), false);
  assert.equal(p.isStarred(other.away), false);
});

test("starring with rugby off still shows nothing", () => {
  const p = gateHarness(["van-nhl"], ["ireland"]);
  assert.equal(p.isMine(ruGame()), false);
});

test("a starred nation is marked, and a placeholder side never is", () => {
  const p = gateHarness(["rugby-intl"], ["ireland"]);
  assert.equal(p.isStarred({id:"ru:ireland", name:"Ireland", nation:"ireland"}), true);
  assert.equal(p.isStarred({id:"ru:wales", name:"Wales", nation:"wales"}), false);
  assert.equal(p.isStarred({id:"ru:tbd:winnerm1", name:"Winner M1", tbdSide:true}), false);
  assert.equal(p.isStarred(null), false);
});

test("a club fixture is still judged by the followed teams, not the rugby switch", () => {
  const p = gateHarness(["rugby-intl"]);
  assert.equal(p.isMine({comp:"EPL", home:{id:"liv"}, away:{id:"ars"}}), false);
  const q = gateHarness(["rugby-intl", "liv"]);
  assert.equal(q.isMine({comp:"EPL", home:{id:"liv"}, away:{id:"ars"}}), true);
});

/* ---------------- the results cutoff, as the page applies it ---------------- */

function windowHarness(){
  return loadFromPage(
    ["RUGBY_RESULT_DAYS", "rugbyCutoff", "RUGBY_TERMINAL", "RUGBY_ACTIVE",
     "rugbyIsTerminal", "rugbyIsActive", "rugbyInWindow"],
    "const DAY = 86400000;");
}

test("the page's cutoff is three whole local calendar days", () => {
  const p = windowHarness();
  const now = Date.now();
  const cut = p.rugbyCutoff(now);
  const d = new Date(cut);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getSeconds(), 0);
  const today = new Date(now); today.setHours(0,0,0,0);
  assert.equal(Math.round((today.getTime() - cut) / DAY), 3);
});

test("a completed match inside the cutoff is kept and one outside is dropped", () => {
  const p = windowHarness();
  const now = Date.now(), cut = p.rugbyCutoff(now);
  assert.equal(p.rugbyInWindow({start: cut, status:"final"}, now), true);
  assert.equal(p.rugbyInWindow({start: cut - 1, status:"final"}, now), false);
  assert.equal(p.rugbyInWindow({start: cut - 30*DAY, status:"final"}, now), false);
});

test("an unresolved match survives the cutoff however old it is", () => {
  const p = windowHarness();
  const now = Date.now(), old = now - 40*DAY;
  for(const st of ["live", "halftime", "delayed", "suspended", "unknown", "postponed"]){
    assert.equal(p.rugbyInWindow({start: old, status: st}, now), true, st);
  }
  for(const st of ["final", "cancelled", "abandoned"]){
    assert.equal(p.rugbyInWindow({start: old, status: st}, now), false, st);
  }
});

test("nothing beyond ninety days is carried", () => {
  const p = windowHarness();
  const now = Date.now();
  assert.equal(p.rugbyInWindow({start: now + 89*DAY, status:"scheduled"}, now), true);
  assert.equal(p.rugbyInWindow({start: now + 91*DAY, status:"scheduled"}, now), false);
});

test("a malformed row is not carried", () => {
  const p = windowHarness();
  const now = Date.now();
  for(const bad of [null, undefined, {}, {start:"soon", status:"final"}]){
    assert.equal(p.rugbyInWindow(bad, now), false);
  }
});

/* ---------------- polling ---------------- */

function pollHarness(rugby = true, showScores = true){
  globalThis.__ru = {games: [], asked: []};
  return loadFromPage(
    ["ZONE_IANA", "_zoneFmt", "zoneParts", "espnDate", "POLL_WINDOW",
     "RUGBY_TERMINAL", "RUGBY_ACTIVE", "rugbyIsTerminal", "rugbyIsActive",
     "RUGBY_ESPN_LEAGUE", "RUGBY_ESPN", "RUGBY_WR",
     "rugbyActiveNow", "fillRugbyScores"],
    `const DAY = 86400000;
     let showScores = ${showScores};
     const rugbyOn = () => ${rugby};
     const GAMES = globalThis.__ru.games;
     let rugbyLiveErr = "";
     const jget = async (url) => { globalThis.__ru.asked.push(url); return {events:[], content:[]}; };
     const parseRugbyEspn = () => null;
     const parseRugbyWr = () => null;
     const findRugby = () => null;
     const applyRugby = () => false;`);
}
const liveRu = (over = {}) => ruGame(Object.assign({
  start: Date.now() - 40*60000,
  ru:{state:"live", label:"52'", timeTBD:false},
  result:{status:"live", label:"52'", score:[10, 7]}
}, over));

test("a live rugby match is worth asking about", () => {
  const p = pollHarness();
  assert.equal(p.rugbyActiveNow(liveRu(), Date.now()), true);
});

test("half-time, a delay and a suspension all keep the poll running", () => {
  const p = pollHarness(), now = Date.now();
  for(const st of ["halftime", "delayed", "suspended", "live"]){
    assert.equal(p.rugbyActiveNow(liveRu({ru:{state:st}}), now), true, st);
  }
});

test("extra time keeps the poll running past eighty minutes", () => {
  const p = pollHarness();
  // kicked off two and a half hours ago and still live
  const g = liveRu({start: Date.now() - 150*60000, ru:{state:"live", label:"ET 88'"}});
  assert.equal(p.rugbyActiveNow(g, Date.now()), true);
});

test("a final is asked about once and then left alone", () => {
  const p = pollHarness(), now = Date.now();
  for(const st of ["final", "cancelled", "abandoned", "postponed"]){
    assert.equal(p.rugbyActiveNow(liveRu({ru:{state:st}}), now), false, st);
  }
});

test("a fixture yet to kick off is not polled every minute", () => {
  const p = pollHarness();
  const g = ruGame({start: Date.now() + 3*3600000, ru:{state:"scheduled"}});
  assert.equal(p.rugbyActiveNow(g, Date.now()), false);
});

test("a fixture past its kickoff that the source still calls scheduled IS polled", () => {
  // Unresolved, which is exactly the case worth asking about again.
  const p = pollHarness();
  const g = ruGame({start: Date.now() - 20*60000, ru:{state:"scheduled"}});
  assert.equal(p.rugbyActiveNow(g, Date.now()), true);
});

test("an unreadable status is polled rather than retired", () => {
  const p = pollHarness();
  assert.equal(p.rugbyActiveNow(liveRu({ru:{state:"unknown"}}), Date.now()), true);
});

test("a match that never resolved stops being asked about eventually", () => {
  // This paces requests; it never decides a match has finished.
  const p = pollHarness();
  const g = liveRu({start: Date.now() - 20*3600000});
  assert.equal(p.rugbyActiveNow(g, Date.now()), false);
});

test("with rugby switched off nothing rugby is ever active", () => {
  const p = pollHarness(false);
  assert.equal(p.rugbyActiveNow(liveRu(), Date.now()), false);
});

test("a rugby-disabled viewer makes no rugby request at all", async () => {
  const p = pollHarness(false);
  globalThis.__ru.games.push(liveRu());
  const n = await p.fillRugbyScores();
  assert.equal(n, 0);
  assert.deepEqual(globalThis.__ru.asked, [], "not one request may be made");
});

test("a rugby-enabled viewer with nothing live makes no request either", async () => {
  const p = pollHarness(true);
  globalThis.__ru.games.push(ruGame({start: Date.now() + 5*DAY, ru:{state:"scheduled"}}));
  await p.fillRugbyScores();
  assert.deepEqual(globalThis.__ru.asked, []);
});

test("a live fixture asks its own league, on the US Eastern date", async () => {
  // ESPN files a rugby event under its Eastern date, exactly as it does
  // the other sports: a 00:00 UTC kickoff answers to the previous day.
  const p = pollHarness(true);
  globalThis.__ru.games.push(liveRu({comp:"RUNC", start: Date.parse("2026-11-14T00:00:00Z")}));
  await p.fillRugbyScores();
  assert.equal(globalThis.__ru.asked.length, 1);
  assert.match(globalThis.__ru.asked[0], /rugby\/17567\/scoreboard\?dates=20261113/);
});

test("a competition ESPN has no league for is followed through World Rugby", async () => {
  const p = pollHarness(true);
  globalThis.__ru.games.push(liveRu({comp:"RUPNC"}));
  await p.fillRugbyScores();
  assert.equal(globalThis.__ru.asked.length, 1);
  assert.match(globalThis.__ru.asked[0], /wr-rims-prod\.pulselive\.com/);
});

test("the two sources are asked separately, so one can fail alone", async () => {
  const p = pollHarness(true);
  globalThis.__ru.games.push(liveRu({comp:"RUNC"}), liveRu({comp:"RUPNC"}));
  await p.fillRugbyScores();
  assert.equal(globalThis.__ru.asked.filter(u => /site\.api\.espn/.test(u)).length, 1);
  assert.equal(globalThis.__ru.asked.filter(u => /pulselive/.test(u)).length, 1);
});

test("the minute poll asks rugby through the rugby gate", () => {
  const src = /function pollDue\(\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(src, /g\.rugby \? rugbyActiveNow/,
    "rugby must not be judged by the team-shaped activeNow");
  assert.match(src, /!showScores/, "the existing scores-off rule still applies");
});

test("the tab-hidden pause and the visibility refresh are untouched", () => {
  assert.match(SRC, /if\(document\.hidden\) return;/);
  assert.match(SRC, /addEventListener\("visibilitychange"/);
  assert.match(SRC, /\}, 60000\);/, "still a sixty-second poll");
});

test("a rugby failure cannot set the page's liveOK claim", () => {
  // liveOK is the page's statement about whether the sports API answered.
  // A rugby outage is not evidence about that.
  const run = /async function runRefresh\(\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  const ruCatch = /try\{ ruFilled = await fillRugbyScores\(\); \}\s*\n?\s*catch\(e\)\{([^}]*)\}/.exec(run);
  assert.ok(ruCatch, "fillRugbyScores must have a catch of its own");
  assert.doesNotMatch(ruCatch[1], /liveOK/);
  assert.doesNotMatch(ruCatch[1], /liveMode/);
});

test("no Vercel cron was added; the GitHub Actions refresh still stands", () => {
  const wf = readFileSync(new URL("../.github/workflows/refresh-data.yml", import.meta.url), "utf8");
  assert.match(wf, /schedule:/);
  assert.match(wf, /node scripts\/fetch-data\.mjs/);
  let vercel = null;
  try{ vercel = readFileSync(new URL("../vercel.json", import.meta.url), "utf8"); }catch(e){}
  if(vercel) assert.doesNotMatch(vercel, /"crons"/);
});

test("the star control is wired to the panel it is rendered into", () => {
  /* This shipped broken once. renderRugbyPicker writes the nation
     buttons into #teamGroups, and the handler was attached to #main, so
     every click fell on the floor: the schedule was right, the stored
     preference never changed, and nothing threw. Assert the two ends
     match rather than trusting them to. */
  const picker = /function renderRugbyPicker\(\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(picker, /data-nation=/, "the buttons carry data-nation");

  const target = /document\.getElementById\("(\w+)"\)\.innerHTML = /.exec(
    /function renderDrawer\(\)\{[\s\S]*?\n\}/.exec(SRC)[0]);
  assert.ok(target, "renderDrawer must write into a known element");
  const container = target[1];

  const listener = new RegExp(
    'document\\.getElementById\\("' + container + '"\\)\\.addEventListener\\("click"[\\s\\S]*?\\n\\}\\);'
  ).exec(SRC);
  assert.ok(listener, "the container must have a click listener");
  assert.match(listener[0], /data-nation/,
    "the data-nation handler must live in the listener on #" + container);
  assert.match(listener[0], /rugbyStars/);
});

test("starring persists and re-renders both the drawer and the page", () => {
  const listener = /document\.getElementById\("teamGroups"\)\.addEventListener\("click"[\s\S]*?\n\}\);/.exec(SRC)[0];
  const branch = /const nat=e\.target\.closest\("\[data-nation\]"\);[\s\S]*?\n  \}/.exec(listener);
  assert.ok(branch, "the star branch must exist in that listener");
  assert.match(branch[0], /persist\(\)/);
  assert.match(branch[0], /renderDrawer\(\)/);
  assert.match(branch[0], /render\(\)/);
});

test("the nation picker is redrawn when rugby fixtures actually arrive", () => {
  /* Switching rugby on renders the drawer immediately, but the fixtures
     the picker is built from arrive 700ms later on the refresh. Without
     a redraw the first thing a new rugby follower saw was a picker with
     no nations in it — the schedule was right, the star list was empty.
     Guarded on a change so an open drawer is not redrawn every minute,
     which would throw away focus. */
  const run = /async function runRefresh\(\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(run, /const rugbyBefore = rugbyCount;/);
  assert.match(run, /rugbyCount !== rugbyBefore/);
  assert.match(run, /renderDrawer\(\)/);
  assert.match(run, /!drawer\.hasAttribute\("hidden"\)/,
    "a closed drawer needs no redraw");
  // and the count it keys on is actually maintained by the loader
  assert.match(SRC, /rugbyCount = built\.length;/);
});

/* ---------------- scores from a source ---------------- */

function applyHarness(){
  return loadFromPage(
    ["RUGBY_TERMINAL", "RUGBY_ACTIVE", "rugbyIsTerminal", "rugbyIsActive",
     "rugbyPageStatus", "RUGBY_SAME", "findRugby", "applyRugby"], "");
}

test("a score is turned round when the source lists the sides the other way", () => {
  const p = applyHarness();
  const g = ruGame({ru:{state:"live"}, result:{status:"live", label:"", score:null}});
  const changed = p.applyRugby(g, {eid:"espn:1", home:"new-zealand", away:"ireland",
    state:"live", label:"52'", score:[24, 10]});      // NZ 24, Ireland 10
  assert.equal(changed, true);
  assert.deepEqual(g.result.score, [10, 24], "printed Ireland first, as the row lists them");
});

test("a score in the same orientation is left alone", () => {
  const p = applyHarness();
  const g = ruGame({ru:{state:"live"}, result:{status:"live", label:"", score:null}});
  p.applyRugby(g, {eid:"espn:1", home:"ireland", away:"new-zealand",
    state:"live", label:"52'", score:[10, 24]});
  assert.deepEqual(g.result.score, [10, 24]);
});

test("an update that knows nothing does not un-report what was known", () => {
  const p = applyHarness();
  const g = ruGame({ru:{state:"live", label:"52'"},
    result:{status:"live", label:"52'", score:[10, 7]}});
  p.applyRugby(g, {eid:"espn:1", home:"ireland", away:"new-zealand",
    state:"unknown", label:"", score:null});
  assert.equal(g.ru.state, "live");
  assert.deepEqual(g.result.score, [10, 7]);
});

test("a fixture is matched on the source's own id first", () => {
  const p = applyHarness();
  const a = ruGame({ids:["espn:100", "wr:aaa"], start: Date.parse("2026-11-06T20:10Z")});
  const b = ruGame({ids:["espn:200"], start: Date.parse("2026-11-06T20:10Z")});
  const hit = p.findRugby({eid:"espn:200", home:"ireland", away:"new-zealand",
    start: Date.parse("2026-11-06T20:10Z")}, [a, b]);
  assert.equal(hit, b);
});

test("without a matching id, both nations and a close kickoff are required", () => {
  const p = applyHarness();
  const g = ruGame({ids:["espn:100"], start: Date.parse("2026-11-06T20:10Z")});
  const near = p.findRugby({eid:"wr:zzz", home:"new-zealand", away:"ireland",
    start: Date.parse("2026-11-06T21:00Z")}, [g]);
  assert.equal(near, g, "reversed sides, an hour apart: the same match");
  const far = p.findRugby({eid:"wr:zzz", home:"new-zealand", away:"ireland",
    start: Date.parse("2026-11-13T20:10Z")}, [g]);
  assert.equal(far, null, "a week later is a different match");
});

test("a page status is derived from the rugby state, never from a clock", () => {
  const p = applyHarness();
  assert.equal(p.rugbyPageStatus("final"), "final");
  assert.equal(p.rugbyPageStatus("live"), "live");
  assert.equal(p.rugbyPageStatus("halftime"), "live");
  assert.equal(p.rugbyPageStatus("unknown"), "unknown");
  assert.equal(p.rugbyPageStatus("postponed"), "scheduled");
  assert.equal(p.rugbyPageStatus("scheduled"), "scheduled");
});
