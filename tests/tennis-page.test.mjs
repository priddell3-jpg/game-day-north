import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage, styleText, mediaBlock, ruleFor } from "./helpers/page.mjs";
import { SETTLED, normalizeTennis } from "../scripts/lib/tennis.mjs";

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
const fx = n => JSON.parse(readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8"));
const REAL = normalizeTennis([fx("tennis-atp-scoreboard.json"), fx("tennis-wta-scoreboard.json")],
  {now: Date.parse("2026-08-24T20:00:00Z")}).matches;

/* The page side of tennis: which matches are mine, what gets polled,
   what a row says, and what a viewer who has never picked a player sees
   — which must be exactly nothing, including no requests. */

const PREAMBLE = `
  const GAMES = globalThis.__t.GAMES;
  const players = globalThis.__t.players;
  const selected = globalThis.__t.selected;
  const hiddenComps = globalThis.__t.hidden;
  let showScores = true, liveMode = true;
  globalThis.__t.setScores = v => { showScores = v; };
  const PLAYER_DIR = globalThis.__t.dir;
  const jget = (...a) => globalThis.__t.jget(...a);
  const location = {href: "https://example.test/game-day-north/"};
  const hash = () => 0;
  const render = () => { globalThis.__t.renders++; };
`;

function harness(){
  globalThis.__t = {
    GAMES: [], players: new Set(), selected: new Set(), hidden: new Set(),
    dir: [], asked: [], renders: 0,
    reply: null,
    jget: async (url, ms, init) => {
      globalThis.__t.asked.push({url, init});
      if(globalThis.__t.reply instanceof Error) throw globalThis.__t.reply;
      return globalThis.__t.reply;
    }
  };
  const page = loadFromPage(
    ["DAY", "POLL_WINDOW", "TENNIS_TOURS", "TENNIS_SETTLED", "normName",
     "tennisGame", "mergeTennis", "tennisActive", "toursOf", "loadTennis",
     "isMine", "myGames", "tennisPollDue", "COMPS"], PREAMBLE);
  return {page, t: globalThis.__t};
}

const match = (over = {}) => ({
  id: "184503", tour: "ATP", tid: "363-2026", tournament: "Winston-Salem Open",
  short: "Winston-Salem", major: false, round: "Round 1", court: "Stadium Court",
  venue: "Winston-Salem, USA", start: Date.now() - 45 * 60000, timeKnown: true,
  status: "live", label: "3rd Set",
  players: [{id: "11399", name: "Sebastian Gorzny", short: "S. Gorzny", country: "USA", tbd: false},
            {id: "15548", name: "Cruz Hewitt", short: "C. Hewitt", country: "AUS", tbd: false}],
  sets: [[6, 1], [6, 7], [2, 2]], tiebreaks: [null, [3, 7], null], winner: null, ...over
});

/* ---------------- nobody followed ---------------- */

test("a viewer who follows no player makes no tennis request at all", async () => {
  const {page, t} = harness();
  assert.equal(await page.loadTennis(false), 0);
  assert.equal(t.asked.length, 0, "the endpoint was called for a viewer with no players");
});

test("a viewer who follows no player has no tennis rows and no tennis poll", () => {
  const {page, t} = harness();
  t.GAMES.push(page.tennisGame(match()));
  assert.equal(page.myGames().length, 0, "a tennis row showed for someone following nobody");
  assert.equal(page.tennisPollDue(), false);
});

test("unfollowing the last player clears the rows", async () => {
  const {page, t} = harness();
  t.players.add("11399");
  t.GAMES.push(page.tennisGame(match()));
  assert.equal(page.myGames().length, 1);
  t.players.delete("11399");
  await page.loadTennis(false);
  assert.equal(t.GAMES.filter(g => g.tennis).length, 0);
});

/* ---------------- following ---------------- */

test("a match is mine when I follow either player", () => {
  const {page, t} = harness();
  const g = page.tennisGame(match());
  t.GAMES.push(g);
  assert.equal(page.isMine(g), false);
  t.players.add("15548");                       // the second player
  assert.equal(page.isMine(g), true);
  t.players.clear(); t.players.add("11399");    // the first
  assert.equal(page.isMine(g), true);
});

test("following a player I am not in a match with shows nothing", () => {
  const {page, t} = harness();
  t.players.add("999999");
  t.GAMES.push(page.tennisGame(match()));
  assert.equal(page.myGames().length, 0);
});

test("an unfilled draw slot can never make a match mine", () => {
  const {page, t} = harness();
  const g = page.tennisGame(match({
    players: [{id: "11399", name: "Sebastian Gorzny", tbd: false},
              {id: null, name: "TBD", tbd: true}]
  }));
  t.GAMES.push(g);
  t.players.add("11399");
  assert.equal(page.isMine(g), true, "the real player still counts");
  t.players.clear();
  assert.equal(page.isMine(g), false);
});

test("hiding the ATP chip hides ATP matches", () => {
  const {page, t} = harness();
  t.players.add("11399");
  t.GAMES.push(page.tennisGame(match()));
  assert.equal(page.myGames().length, 1);
  t.hidden.add("ATP");
  assert.equal(page.myGames().length, 0);
});

/* ---------------- the request ---------------- */

test("the request carries sorted player ids, so viewers share a cached answer", async () => {
  const {page, t} = harness();
  ["15548", "11399", "2980"].forEach(id => t.players.add(id));
  t.reply = {generated: new Date().toISOString(), matches: []};
  await page.loadTennis(false);
  const u = new URL(t.asked[0].url);
  assert.equal(u.searchParams.get("players"), "11399.15548.2980");
});

test("the request revalidates rather than reading a cached copy", async () => {
  const {page, t} = harness();
  t.players.add("11399");
  t.reply = {generated: new Date().toISOString(), matches: []};
  await page.loadTennis(false);
  assert.equal(t.asked[0].init.cache, "no-cache");
});

test("only the tours with a live match are polled", async () => {
  const {page, t} = harness();
  t.players.add("11399");
  t.GAMES.push(page.tennisGame(match({tour: "ATP", status: "live"})));
  t.GAMES.push(page.tennisGame(match({id: "9", tour: "WTA", status: "final",
    players: [{id: "11399", name: "A"}, {id: "2", name: "B"}]})));
  t.reply = {generated: new Date().toISOString(), matches: []};
  await page.loadTennis(true);                  // true = only what is active
  assert.equal(new URL(t.asked[0].url).searchParams.get("tours"), "atp");
});

test("both tours are asked for when both have something on", async () => {
  const {page, t} = harness();
  t.players.add("11399");
  t.GAMES.push(page.tennisGame(match({tour: "ATP", status: "live"})));
  t.GAMES.push(page.tennisGame(match({id: "9", tour: "WTA", status: "live",
    players: [{id: "11399", name: "A"}, {id: "2", name: "B"}]})));
  t.reply = {generated: new Date().toISOString(), matches: []};
  await page.loadTennis(true);
  assert.equal(new URL(t.asked[0].url).searchParams.get("tours"), null,
    "no tours filter means ask for everything");
});

test("a failing endpoint leaves the matches already on screen alone", async () => {
  const {page, t} = harness();
  t.players.add("11399");
  t.GAMES.push(page.tennisGame(match()));
  t.reply = new Error("HTTP 503");
  await assert.rejects(() => page.loadTennis(false));
  assert.equal(t.GAMES.filter(g => g.tennis).length, 1, "a failure emptied the board");
  assert.deepEqual(t.GAMES[0].match.sets, [[6, 1], [6, 7], [2, 2]]);
});

test("an unusable response is refused rather than rendered", async () => {
  const {page, t} = harness();
  t.players.add("11399");
  t.GAMES.push(page.tennisGame(match()));
  for(const bad of [null, {}, {matches: null}, {matches: "nope"}]){
    t.reply = bad;
    await assert.rejects(() => page.loadTennis(false));
  }
  assert.equal(t.GAMES.filter(g => g.tennis).length, 1);
});

/* ---------------- what keeps polling ---------------- */

test("live and suspended keep polling; settled states stop it", () => {
  const {page} = harness();
  const now = Date.now();
  for(const status of ["live", "suspended", "unknown"]){
    assert.equal(page.tennisActive(match({status}), now), true, status);
  }
  for(const status of ["final", "retired", "walkover", "canceled", "postponed"]){
    assert.equal(page.tennisActive(match({status}), now), false, status);
  }
});

test("a match past its start that the source still calls scheduled is chased", () => {
  const {page} = harness();
  const now = Date.now();
  assert.equal(page.tennisActive(match({status: "scheduled", start: now - 30 * 60000}), now), true);
  assert.equal(page.tennisActive(match({status: "scheduled", start: now + 30 * 60000}), now), false);
});

test("a match that never resolved stops being chased every minute", () => {
  const {page} = harness();
  const now = Date.now();
  assert.equal(page.tennisActive(match({status: "scheduled", start: now - 20 * 3600000}), now), false);
  // but one that is genuinely still live is chased however old
  assert.equal(page.tennisActive(match({status: "live", start: now - 20 * 3600000}), now), true);
});

test("the poll stops when the match finishes", () => {
  const {page, t} = harness();
  t.players.add("11399");
  const g = page.tennisGame(match({status: "live"}));
  t.GAMES.push(g);
  assert.equal(page.tennisPollDue(), true);
  g.match = match({status: "final", winner: 0});
  assert.equal(page.tennisPollDue(), false);
});

test("the poll stops with scores switched off", () => {
  const {page, t} = harness();
  t.players.add("11399");
  t.GAMES.push(page.tennisGame(match({status: "live"})));
  assert.equal(page.tennisPollDue(), true);
  t.setScores(false);
  assert.equal(page.tennisPollDue(), false);
});

test("the page and the parser agree on what counts as settled", () => {
  const {page} = harness();
  assert.deepEqual(Object.keys(page.TENNIS_SETTLED).sort(), Object.keys(SETTLED).sort());
});

/* ---------------- rows ---------------- */

test("a tennis row keeps home and away empty, so no team path claims it", () => {
  const {page} = harness();
  const g = page.tennisGame(match());
  assert.equal(g.home, null);
  assert.equal(g.away, null);
  assert.equal(g.tennis, true);
  assert.equal(g.comp, "ATP");
});

test("matches are replaced wholesale, never accumulated", () => {
  const {page, t} = harness();
  page.mergeTennis([match(), match({id: "2"})]);
  assert.equal(t.GAMES.length, 2);
  page.mergeTennis([match()]);
  assert.equal(t.GAMES.length, 1, "a stale match survived the replacement");
  page.mergeTennis([match(), match({id: "2"}), match({id: "3"})]);
  assert.equal(new Set(t.GAMES.map(g => g.id)).size, 3, "duplicate rows were created");
});

test("rows carry ATP and WTA competitions the chips know about", () => {
  const {page} = harness();
  assert.ok(page.COMPS.ATP && page.COMPS.WTA);
  assert.equal(page.tennisGame(match({tour: "WTA"})).comp, "WTA");
});

test("every real fixture match becomes a placeable row", () => {
  const {page} = harness();
  for(const m of REAL){
    const g = page.tennisGame(m);
    assert.ok(Number.isFinite(g.start), "a row without a start: " + m.id);
    assert.ok(page.COMPS[g.comp], "a row in an unknown competition: " + g.comp);
    assert.equal(typeof g.timeKnown, "boolean");
  }
});

/* ---------------- the row's own markup rules ---------------- */

test("the row says v, never at or home", () => {
  const at = SRC.indexOf("function tennisRow");
  const body = SRC.slice(at, SRC.indexOf("\nfunction gameRow", at));
  assert.ok(body.length > 200, "could not isolate tennisRow");
  assert.match(body, /class="vs">v</, "players should be separated by v");
  // .at is the team row's "Toronto at Boston" separator; a tennis row must not use it
  assert.doesNotMatch(body, /class="at"|homeAway|orderedTeams/, "team home/away language in a tennis row");
});

test("a match with no usable time says so rather than printing one", () => {
  const at = SRC.indexOf("function tennisRow");
  const body = SRC.slice(at, SRC.indexOf("\nfunction gameRow", at));
  assert.match(body, /m\.timeKnown \? esc\(fmtTime\(g\.start\)\)/, "a clock is only shown when it is real");
  assert.match(body, /Time TBD/);
});

test("set scores are rendered as sets, not as one scoreline", () => {
  const at = SRC.indexOf("function setText");
  const body = SRC.slice(at, SRC.indexOf("\nfunction gameRow", at));
  assert.match(body, /class="sets"/);
  assert.match(body, /class="set"/);
  // the tiebreak is shown beside its set rather than folded into the games
  assert.match(body, /m\.tiebreaks/);
});

test("the row honours the scores toggle, with a per-match reveal", () => {
  const at = SRC.indexOf("function tennisRow");
  const body = SRC.slice(at, SRC.indexOf("\nfunction gameRow", at));
  assert.match(body, /showScores \|\| revealed\.has\(g\.id\)/);
  assert.match(body, /hidden-score/);
});

test("uncertain Canadian coverage is stated, not guessed", () => {
  const at = SRC.indexOf("function tennisRow");
  const body = SRC.slice(at, SRC.indexOf("\nfunction gameRow", at));
  assert.match(body, /Coverage TBD/);
});

test("every tennis lifecycle state has words of its own", () => {
  const {page} = harness();
  const at = SRC.indexOf("const TENNIS_STATE");
  const body = SRC.slice(at, SRC.indexOf("};", at));
  for(const status of ["live", "suspended", "final", "retired", "walkover", "canceled", "postponed"]){
    assert.match(body, new RegExp("\\b" + status + "\\s*:"), status + " has no display state");
  }
});

/* ---------------- layout ---------------- */

test("a set list can wrap instead of pushing the row wide", () => {
  const css = styleText();
  assert.match(ruleFor(css, ".sets"), /flex-wrap\s*:\s*wrap/);
  assert.match(ruleFor(css, ".set"), /white-space\s*:\s*nowrap/);
});

test("the narrow breakpoint tightens the set list rather than dropping it", () => {
  const narrow = mediaBlock("(max-width:360px)");
  const rule = ruleFor(narrow, ".sets");
  assert.ok(rule, ".sets must be addressed at the narrow breakpoint");
  assert.doesNotMatch(rule, /display\s*:\s*none/);
});

test("a player name obeys the same wrapping guarantees a club name does", () => {
  // the row reuses .g-team, so the 320px overlap fix already covers it
  const at = SRC.indexOf("function tennisRow");
  const body = SRC.slice(at, SRC.indexOf("\nfunction gameRow", at));
  assert.match(body, /class="g-team pl/, "a player name must carry .g-team");
});

/* ---------------- saying when the source is down ---------------- */

test("a tennis outage is stated rather than shown as an empty day", () => {
  const at = SRC.indexOf("const tennisNote");
  const body = SRC.slice(at, SRC.indexOf("const liveLine", at));
  assert.ok(body.length > 100, "could not isolate tennisNote");
  assert.match(body, /if\(!players\.size\) return ""/, "silent for anyone following nobody");
  assert.match(body, /tennisErr/);
  assert.match(body, /unreachable/i);
  assert.match(body, /agoText\(tennisAt\)/, "an old answer must say how old it is");
});

/* ---------------- surviving a contract that has moved ---------------- */

test("a match missing the optional parts of the contract still renders", () => {
  /* The page and the endpoint deploy together, but a cached page being
     answered by a newer endpoint — or the reverse — is a real state, and
     it must degrade rather than throw the whole render away. */
  const {page} = harness();
  const thin = {id: "1", tour: "ATP", tournament: "X", round: "", court: "", venue: "",
    start: Date.now(), timeKnown: true, status: "final", label: "Final",
    players: [{id: "1", name: "A"}, {id: "2", name: "B"}], winner: 0};
  assert.doesNotThrow(() => page.tennisGame(thin));
  const g = page.tennisGame(thin);
  assert.equal(page.tennisActive(g.match, Date.now()), false);
});

test("the set helpers tolerate a match with no sets at all", () => {
  const {setsWon, setText} = loadFromPage(["setsWon", "setText"]);
  for(const m of [{}, {sets: null}, {sets: [], tiebreaks: null}, {setWins: undefined}]){
    assert.doesNotThrow(() => setsWon(m, 0));
    assert.doesNotThrow(() => setText(m, 0));
    assert.equal(setsWon(m, 0), 0);
    assert.equal(setText(m, 0), "");
  }
});

test("one unrenderable card does not take the whole rail with it", () => {
  const at = SRC.indexOf("const card = g =>");
  const body = SRC.slice(at, at + 200);
  assert.match(body, /try\{[\s\S]*railCard\(g, now\)[\s\S]*catch/,
    "the rail must not be left showing whatever it said before");
});

test("the picker's count uses characters, not HTML entities", () => {
  // it is assigned with textContent, where an entity would render literally
  const at = SRC.indexOf('getElementById("drawerCount")');
  const body = SRC.slice(at, at + 260);
  assert.match(body, /textContent/);
  assert.doesNotMatch(body, /&[a-z]+;/, "an HTML entity in a textContent assignment");
});

test("a country code is never broken between its letters", () => {
  /* .pl-flag lives inside .g-team, which the narrow breakpoint lets break
     anywhere so a long name cannot overflow into the score column. A
     three-letter code is not a word to break — without this it stacks one
     letter per line at 320px. */
  const rule = ruleFor(styleText(), ".pl-flag");
  assert.ok(rule, ".pl-flag must be styled");
  assert.match(rule, /white-space\s*:\s*nowrap/);
  assert.match(rule, /overflow-wrap\s*:\s*normal/);
});

test("a calendar cell names the players rather than reaching for team codes", () => {
  const at = SRC.indexOf("function renderCalendar");
  const body = SRC.slice(at, SRC.indexOf("function renderRail", at));
  const tennisAt = body.indexOf("if(g.tennis){");
  assert.ok(tennisAt > 0, "the calendar cell must handle tennis before the team path");
  const branch = body.slice(tennisAt, body.indexOf("const s=stateOf", tennisAt));
  assert.match(branch, /m\.players\[0\]/);
  assert.match(branch, /m\.players\[1\]/);
  assert.doesNotMatch(branch, /\.abbr/, "a player has no team abbreviation");
  // and the team branch must be reached only after tennis is handled
  assert.ok(body.indexOf("if(g.tennis){") < body.indexOf('" @ "'),
    "the team @ notation must not be applied to a tennis match");
});

test("the rail names the players too", () => {
  const at = SRC.indexOf("function matchupLabel");
  const body = SRC.slice(at, at + 400);
  assert.match(body, /g\.tennis/);
  assert.match(body, /g\.match\.players/);
});
