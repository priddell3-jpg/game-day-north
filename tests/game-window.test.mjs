/* The game window for the two sports that are not two teams: tennis and
   a cycling race. They use the same frame as every other sport (league
   and round on top, the two sides or the race, the status, the result,
   the facts, Save), and the same spoiler rule as their rows. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFromPage } from "./helpers/page.mjs";

const PREAMBLE = `
  const DAY = 86400000;
  let showScores = false;
  let revealed = new Set(), alerts = new Set();
  /* Rights have their own tests; a window here has no carriers. */
  const visibleRights = () => ({carriers:[]});
  const carrierHtml = () => "";
  let SPOILED_PLAYERS = new Map();
  const TENNIS_RANKS = {WTA:new Map([["p1", 4]])};
  const rankOfPlayer = (p, tour) => (TENNIS_RANKS[tour] && TENNIS_RANKS[tour].get(p.id)) || null;
  const TENNIS_RANKED_AT = {WTA:"2026-11-23"};
  const RANK_STALE_DAYS = 21;
  const tourneyOf = g => ({name:"Argentina Open", major:false});
  globalThis.__set = (k, v) => { if(k === "showScores") showScores = v; if(k === "reveal") revealed.add(v); if(k === "spoil") SPOILED_PLAYERS = v; };
`;
const W = loadFromPage(["COMPS", "esc", "pad", "ymd", "localKey", "fmtTime", "fmtLongDay", "BELL", "startsIn",
  "midScore", "setsWon", "setText", "TENNIS_STATE", "TBD_PLAYER", "playerSpoiled", "rankLine",
  "sheetHead", "sheetFacts", "sheetSave", "sheetWatch", "sheetWhen", "tennisDetail", "eventDetail"], PREAMBLE);

const NOW = Date.parse("2026-11-25T20:00:00Z");
const MATCH = {id:"m1", tour:"WTA", tid:"t1", round:"Round 1", court:"Cancha Central", venue:"Buenos Aires, Argentina",
  start:NOW - 3 * 3600000, timeKnown:true, status:"final", label:"Final",
  players:[{id:"p1", name:"Nadia Podoroska", short:"N. Podoroska", country:"ARG"},
           {id:"p2", name:"Leyre Romero Gormaz", short:"L. Romero Gormaz", country:"ESP"}],
  sets:[[7, 6], [6, 0]], tiebreaks:[[7, 4], null], setWins:[0, 0], winner:0};
const tennis = (over = {}) => ({id:"t-m1", comp:"WTA", start:over.start || MATCH.start, match:Object.assign({}, MATCH, over)});

test("tennis: the same frame as a team game, with country and ranking where a record sits", () => {
  globalThis.__set("showScores", true);
  const html = W.tennisDetail(tennis(), NOW);
  assert.match(html, /<span class="lg-tag"[^>]*>WTA<\/span><span class="sd-stage">Round 1<\/span>/, "tour and round on top");
  assert.match(html, /<h2 class="vh" id="sheetTitle">Nadia Podoroska v Leyre Romero Gormaz<\/h2>/);
  assert.match(html, /<span class="sd-rec">ARG · No\. 4<\/span>/, "country and ranking under the name");
  assert.match(html, /<span class="sd-rec">ESP<\/span>/, "a player outside the list we hold shows the country alone");
  assert.match(html, /<dt>Event<\/dt><dd>Argentina Open<\/dd>/);
  assert.match(html, /<dt>Where<\/dt><dd>Cancha Central, Buenos Aires, Argentina<\/dd>/);
  assert.match(html, /class="sd-save" data-alert="t-m1"/);
});

test("tennis: sets won in the middle and the sets where the periods sit, the tiebreak beside its set", () => {
  globalThis.__set("showScores", true);
  const html = W.tennisDetail(tennis(), NOW);
  assert.match(html, /<div class="sd-teams scored">/);
  assert.match(html, /<b class="win">2<\/b><i>&ndash;<\/i><b>0<\/b>/, "2-0 in sets, the winner's count marked");
  assert.match(html, /<th scope="col">Set 1<\/th><th scope="col">Set 2<\/th>/);
  assert.match(html, /<td>6<sup>4<\/sup><\/td>/, "6-7(4): the loser's tiebreak points beside the set");
  assert.match(html, /<div class="sd-side lost">/, "the loser's name drops back, as a team sport's losing score does");
});

test("tennis: with scores hidden the window keeps the result behind the same Reveal as the row", () => {
  globalThis.__set("showScores", false);
  const html = W.tennisDetail(tennis({id:"m2"}), NOW);
  assert.match(html, /data-reveal="t-m1">Reveal score<\/button>/);
  assert.doesNotMatch(html, /mid-score|sd-line|sd-side lost/, "no sets, no count, nothing to say who won");
  assert.match(html, /<span class="at">v<\/span>/);
});

test("tennis: a player whose earlier match is still hidden is TBD in the window too", () => {
  globalThis.__set("showScores", false);
  globalThis.__set("spoil", new Map([["t1|p2", NOW - 86400000]]));
  const html = W.tennisDetail(tennis({status:"scheduled", winner:null, sets:[], setWins:[], start:NOW + 3600000}), NOW);
  assert.doesNotMatch(html, /Romero Gormaz/, "the name that would give away the earlier result");
  assert.match(html, /<h2 class="vh" id="sheetTitle">Nadia Podoroska v TBD<\/h2>/);
  assert.match(html, /<p class="sd-status">Starts in 1 h<\/p>/);
  globalThis.__set("spoil", new Map());
});

const STAGE = {id:"UCI-6", comp:"UCI", event:true, race:"Tour of Guangxi", stage:"Stage 6", route:"Yizhou – NongLa", km:165.8,
  start:Date.parse("2026-10-18T05:00:00Z"), timeKnown:true, finishUtc:Date.parse("2026-10-18T09:00:00Z"),
  podium:["Jarno Widar", "Tom Pidcock", "Louis Barré"], leader:"Jarno Widar", leaderStage:6};
const AFTER = Date.parse("2026-10-18T15:00:00Z");

test("a race: one name instead of two sides, the stage result where the scoring goes", () => {
  const html = W.eventDetail(Object.assign({}, STAGE), AFTER);
  assert.match(html, /<span class="sd-stage">Stage 6<\/span>/);
  assert.match(html, /<div class="sd-teams sd-solo">/);
  assert.match(html, /Yizhou – NongLa/);
  assert.match(html, /<dt>Distance<\/dt><dd>165\.8 km<\/dd>/);
  assert.match(html, /Reveal result/, "scores off: the podium waits, as on the row");
  assert.doesNotMatch(html, /Widar/, "neither the winner nor the leader");
  globalThis.__set("reveal", "UCI-6");
  const shown = W.eventDetail(Object.assign({}, STAGE), AFTER);
  assert.match(shown, /<h3 class="sd-h">Stage result<\/h3>/);
  assert.match(shown, /Jarno Widar &middot; after stage 6/);
});

test("a race before the start counts down like any other window", () => {
  const html = W.eventDetail(Object.assign({}, STAGE, {id:"UCI-7", podium:null}), Date.parse("2026-10-18T02:30:00Z"));
  assert.match(html, /<p class="sd-status">Starts in 2 h 30 min<\/p>/);
});
