import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage } from "./helpers/page.mjs";

/* Game details in the game's window, read from ESPN's game summary. The
   fixtures are real summaries fetched on 2026-11-27, cut to the fields
   the window reads (paths are ESPN's own):
     NHL  Canucks at Red Wings, 1-5        UCL  Liverpool at Club Brugge, 3-0
     NBA  Bucks at Raptors, 116-111        NFL  Colts at Texans, 3-26
     MLB  Royals at Blue Jays, 0-3                                          */

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
const fixture = name => JSON.parse(readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8"));
const P = loadFromPage(["ESPN", "ESPN_PATH", "esc", "DETAIL_ROWS", "detailSport", "detailsUrl",
  "lastName", "ordinalWord", "parseDetails", "detailsHtml"], "let sheetShowAll = false; globalThis.__showAll = v => { sheetShowAll = v; };");

test("each league maps to the sport whose details it gets", () => {
  assert.equal(P.detailSport("NHL"), "hockey");
  assert.equal(P.detailSport("UCL"), "soccer");
  assert.equal(P.detailSport("MLS"), "soccer");
  assert.equal(P.detailSport("NBA"), "basketball");
  assert.equal(P.detailSport("NFL"), "football");
  assert.equal(P.detailSport("MLB"), "baseball");
  assert.equal(P.detailSport("RUNC"), null, "rugby comes later, from World Rugby");
});

test("a summary is asked for by ESPN event id, never for a rugby or World Rugby id", () => {
  assert.equal(P.detailsUrl({comp:"NHL", eid:"401892789"}),
    "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=401892789");
  assert.equal(P.detailsUrl({comp:"NHL", eid:null}), null);
  assert.equal(P.detailsUrl({comp:"RUNC", eid:"espn:604010"}), null);
  assert.equal(P.detailsUrl({comp:"NHL", eid:"wr:abc"}), null);
});

test("hockey: goals with assists and strength, goalies, three numbers", () => {
  const m = P.parseDetails("hockey", fixture("summary-nhl-401892789.json"));
  assert.equal(m.final, true);
  assert.deepEqual(m.line, {labels:["1st", "2nd", "3rd"], away:["0", "0", "1"], home:["3", "1", "1"]});
  assert.equal(m.events.length, 6);
  assert.deepEqual(m.events[0], {when:"1st 1:16", side:"home", abbr:"DET", text:"Emmitt Finnie (Arvidsson)", tag:""});
  assert.deepEqual(m.events[2], {when:"1st 19:03", side:"home", abbr:"DET", text:"Lucas Raymond (Seider, Arvidsson)", tag:"PP"});
  assert.deepEqual(m.events[4], {when:"3rd 7:26", side:"away", abbr:"VAN", text:"Paul Cotter (Reinhardt, Quillan)", tag:""});
  assert.equal(m.events[3].text, "J.T. Compher (Brandsegg-Nygard)", "a two-part first name keeps the surname whole");
  assert.deepEqual(m.stand, [{side:"away", abbr:"VAN", text:"Merilainen 21 saves on 26"},
                             {side:"home", abbr:"DET", text:"Tarasov 25 saves on 26"}]);
  assert.deepEqual(m.stats, [{label:"Shots", away:"26", home:"26"},
                             {label:"Power play", away:"0/2", home:"1/1"},
                             {label:"Faceoffs", away:"48.9%", home:"51.1%"}]);
});

test("soccer: goals with assists, the half-time score, three numbers", () => {
  const m = P.parseDetails("soccer", fixture("summary-ucl-401915292.json"));
  assert.equal(m.line, null, "soccer reads by half-time, not a line score");
  assert.deepEqual(m.notes, ["Half-time: LIV 1–0 BRU"]);
  assert.deepEqual(m.events.map(e => [e.when, e.abbr, e.text, e.tag]), [
    ["13'", "LIV", "Alexander Isak (Szoboszlai)", ""],
    ["79'", "LIV", "Florian Wirtz (Ngumoha)", ""],
    ["82'", "LIV", "Alexander Isak (Becker)", ""]]);
  assert.deepEqual(m.stats, [{label:"Possession", away:"46.5%", home:"53.5%"},
                             {label:"Shots on target", away:"4", home:"5"},
                             {label:"Corners", away:"4", home:"8"}]);
});

test("soccer: an own goal counts for the other side, a penalty and a red card are marked", () => {
  // Shapes as ESPN sent them for Coventry 3-2 Crystal Palace (event 401879235): an own
  // goal is filed under the team it counts for, naming the player who put it in.
  const sample = {header:{competitions:[{status:{type:{completed:true}}, competitors:[
      {homeAway:"home", score:"3", team:{id:"388", abbreviation:"COV"}, linescores:[{displayValue:"1"}, {displayValue:"2"}]},
      {homeAway:"away", score:"2", team:{id:"384", abbreviation:"CRY"}, linescores:[{displayValue:"1"}, {displayValue:"1"}]}]}]},
    keyEvents:[
      {type:{text:"Own Goal"}, scoringPlay:true, clock:{displayValue:"85'"}, team:{id:"388"}, participants:[{athlete:{displayName:"Dwight McNeil"}}]},
      {type:{text:"Penalty - Scored"}, scoringPlay:true, clock:{displayValue:"53'"}, team:{id:"384"}, participants:[{athlete:{displayName:"Dominic Calvert-Lewin"}}]},
      {type:{text:"Red Card"}, scoringPlay:false, clock:{displayValue:"60'"}, team:{id:"384"}, participants:[{athlete:{displayName:"Adam Wharton"}}]},
      {type:{text:"Yellow Card"}, scoringPlay:false, clock:{displayValue:"30'"}, team:{id:"388"}, participants:[{athlete:{displayName:"Someone"}}]}]};
  const m = P.parseDetails("soccer", sample);
  assert.deepEqual(m.events.map(e => [e.when, e.abbr, e.text, e.tag]), [
    ["85'", "COV", "Dwight McNeil", "own goal"],
    ["53'", "CRY", "Dominic Calvert-Lewin", "pen"],
    ["60'", "CRY", "Adam Wharton", "red card"]], "yellow cards are left out");
});

test("basketball: quarters, each side's leaders, three numbers", () => {
  const m = P.parseDetails("basketball", fixture("summary-nba-401910039.json"));
  assert.deepEqual(m.line, {labels:["Q1", "Q2", "Q3", "Q4"], away:["28", "21", "36", "31"], home:["28", "25", "27", "31"]});
  assert.deepEqual(m.events, [], "no scoring list: hundreds of baskets");
  assert.deepEqual(m.stand, [{side:"away", abbr:"MIL", text:"Herro 32 pts · Turner 11 reb · Herro 8 ast"},
                             {side:"home", abbr:"TOR", text:"Barnes 31 pts · Poeltl 10 reb · Barnes 8 ast"}]);
  assert.deepEqual(m.stats, [{label:"Field goals", away:"51%", home:"43%"},
                             {label:"3-pointers", away:"14-28", home:"14-38"},
                             {label:"Turnovers", away:"17", home:"12"}]);
});

test("football: quarters, every scoring play, leaders, three numbers", () => {
  const m = P.parseDetails("football", fixture("summary-nfl-401873066.json"));
  assert.deepEqual(m.line, {labels:["Q1", "Q2", "Q3", "Q4"], away:["3", "0", "0", "0"], home:["7", "10", "9", "0"]});
  assert.equal(m.events.length, 6);
  assert.deepEqual(m.events[0], {when:"Q1 10:43", side:"away", abbr:"IND", text:"Spencer Shrader 34 Yd Field Goal", tag:"FG"});
  assert.deepEqual(m.events[4], {when:"Q3 10:22", side:"home", abbr:"HOU",
    text:"Daniel Jones Sacked by Will Anderson Jr. For 7 Yd Loss for Safety", tag:"SF"});
  assert.deepEqual(m.stand, [{side:"away", abbr:"IND", text:"Jones 144 pass · Taylor 21 rush · Gould 48 rec"},
                             {side:"home", abbr:"HOU", text:"Stroud 194 pass · Montgomery 107 rush · Collins 58 rec"}]);
  assert.deepEqual(m.stats, [{label:"Total yards", away:"167", home:"354"},
                             {label:"Turnovers", away:"1", home:"1"},
                             {label:"Possession", away:"22:14", home:"37:46"}]);
});

test("baseball: a line score with R H E, the scoring, the pitchers of record", () => {
  const m = P.parseDetails("baseball", fixture("summary-mlb-401816683.json"));
  assert.deepEqual(m.line.labels, ["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  assert.deepEqual(m.line.away, ["0", "0", "0", "0", "0", "0", "0", "0", "0"]);
  assert.deepEqual(m.line.home, ["0", "0", "0", "3", "0", "0", "0", "0", "x"], "the home side's unplayed ninth is an x");
  assert.deepEqual(m.line.extra, {labels:["R", "H", "E"], away:["0", "6", "0"], home:["3", "6", "0"]});
  assert.deepEqual(m.events, [{when:"Bot 4th", side:"home", abbr:"TOR",
    text:"Lukes homered to right center (390 feet), Sánchez scored and Okamoto scored.", tag:"HR"}]);
  assert.deepEqual(m.stand, [{side:null, abbr:"", text:"W Dallas (2-1) · L Dobnak (2-2) · S Varland"}]);
});

test("the window lists the first six scoring rows, then a Show all button", () => {
  const m = P.parseDetails("hockey", fixture("summary-nhl-401892789.json"));
  m.events = m.events.concat(m.events);   // twelve
  globalThis.__showAll(false);
  const html = P.detailsHtml(m);
  assert.equal((html.match(/<li class="(away|home)">/g) || []).length, 6);
  assert.match(html, /<button type="button" class="sd-more" data-sheet-all>Show all 12<\/button>/);
  globalThis.__showAll(true);
  assert.equal((P.detailsHtml(m).match(/<li class="(away|home)">/g) || []).length, 12);
  globalThis.__showAll(false);
});

test("the window draws the line score, the scoring, the stand-outs and the stats, away first", () => {
  const html = P.detailsHtml(P.parseDetails("hockey", fixture("summary-nhl-401892789.json")));
  assert.match(html, /<table class="sd-line">/);
  assert.ok(html.indexOf('<th scope="row">VAN</th>') < html.indexOf('<th scope="row">DET</th>'), "away row first");
  assert.match(html, /<h3 class="sd-h">Goals<\/h3>/);
  assert.match(html, /Lucas Raymond \(Seider, Arvidsson\) <span class="sd-tag">PP<\/span>/);
  assert.match(html, /<h3 class="sd-h">Goalies<\/h3>/);
  assert.match(html, /<td>0\/2<\/td><th scope="row">Power play<\/th><td>1\/1<\/td>/);
  assert.doesNotMatch(P.detailsHtml(null), /./);
});

test("a summary missing its header gives no details rather than a broken block", () => {
  assert.equal(P.parseDetails("hockey", {}), null);
  assert.equal(P.parseDetails("hockey", {header:{competitions:[{competitors:[]}]}}), null);
  assert.equal(P.parseDetails(null, fixture("summary-nhl-401892789.json")), null);
});

test("details are fetched only for an open window, only once the score may be shown, then every 30 s while live", () => {
  const block = SRC.slice(SRC.indexOf("function detailsBlock("), SRC.indexOf("function ensureDetails("));
  assert.match(block, /if\(st !== "live" && st !== "final"\) return "";/, "nothing before a game");
  assert.match(block, /if\(!\(showScores \|\| revealed\.has\(g\.id\)\)\) return "";/, "nothing with scores off");
  const ensure = SRC.slice(SRC.indexOf("function ensureDetails("), SRC.indexOf("\n}\n", SRC.indexOf("function ensureDetails(")));
  assert.match(ensure, /\(d\.model && d\.model\.final\)/, "a final is asked for once");
  assert.match(ensure, /now - d\.at < DETAIL_TTL/, "a live game at most every 30 s");
  assert.match(SRC, /const DETAIL_TTL = 30000;/);
  assert.match(SRC, /sheetTimer = setInterval\(\(\) => \{ if\(sheetGame\) paintSheet\(\); \}, DETAIL_TTL\);/);
  assert.match(SRC, /if\(sheetTimer\)\{ clearInterval\(sheetTimer\); sheetTimer = null; \}/, "and stops when the window closes");
  assert.match(SRC.slice(SRC.indexOf("function paintSheet("), SRC.indexOf("function openGame(")), /ensureDetails\(g, now\);/);
});
