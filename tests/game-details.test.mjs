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
  "lastName", "ordinalWord", "parseDetails", "RUGBY_WR", "RUGBY_POINTS", "parseRugby", "detailsSource", "preHtml", "detailsHtml"], "let sheetShowAll = false; globalThis.__showAll = v => { sheetShowAll = v; };");

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
                             {label:"Faceoffs", away:"49%", home:"51%"}]);
});

test("soccer: halves like any other sport's periods, goals with assists, keepers, three numbers", () => {
  const m = P.parseDetails("soccer", fixture("summary-ucl-401915292.json"));
  assert.deepEqual(m.line, {labels:["1st", "2nd"], away:["1", "2"], home:["0", "0"], extra:null});
  assert.deepEqual(m.notes, []);
  assert.deepEqual(m.stand, [{side:"away", abbr:"LIV", text:"Becker 5 saves"}, {side:"home", abbr:"BRU", text:"Sommer 1 save"}]);
  assert.deepEqual(m.events.map(e => [e.when, e.abbr, e.text, e.tag]), [
    ["13'", "LIV", "Alexander Isak (Szoboszlai)", ""],
    ["79'", "LIV", "Florian Wirtz (Ngumoha)", ""],
    ["82'", "LIV", "Alexander Isak (Becker)", ""]]);
  assert.deepEqual(m.stats, [{label:"Possession", away:"47%", home:"53%"},
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

test("before the game: the season series and each side's last five, oldest first", () => {
  const soccer = P.parseDetails("soccer", fixture("summary-ucl-401915292.json"));
  assert.deepEqual(soccer.pre.form, [{side:"away", abbr:"LIV", results:["W", "L", "L", "W", "W"]},
                                     {side:"home", abbr:"BRU", results:["W", "W", "W", "D", "W"]}]);
  const hockey = P.parseDetails("hockey", fixture("summary-nhl-401892789.json"));
  assert.deepEqual(hockey.pre, {series:"DET wins series 2-0", form:[]});
  const html = P.preHtml(soccer.pre);
  assert.match(html, /<h3 class="sd-h">Before the game<\/h3>/);
  assert.match(html, /aria-label="Last five, oldest first: W L L W W"/);
  assert.match(html, /<b class="d">D<\/b>/);
  assert.match(P.preHtml(hockey.pre), /<li><span class="sd-abbr">Series<\/span><span>DET wins series 2-0<\/span><\/li>/,
    "the series is a row of the same list, not a note set apart");
});

test("rugby: every point accounted for, conversions beside their tries, cards, kickers, three numbers", () => {
  // Australia 29-26 at Wales, 2026-11-21, from World Rugby's summary and stats
  const f = fixture("summary-rugby-e7552a9b.json");
  const m = P.parseRugby(f.summary, f.stats);
  assert.equal(m.final, true);
  assert.equal(m.awayAbbr, "AUS"); assert.equal(m.homeAbbr, "WAL");
  assert.deepEqual(m.line, {labels:["1st", "2nd"], away:["12", "17"], home:["7", "19"]}, "halves summed from the scoring add up to 29-26");
  assert.deepEqual(m.events.map(e => [e.when, e.abbr, e.text, e.tag]), [
    ["2'", "WAL", "Max Llewellyn", "yellow card"],
    ["21'", "AUS", "Taniela Tupou", "try"],
    ["33'", "AUS", "Brandon Paenga-Amosa (con Lonergan)", "try"],
    ["41'", "WAL", "Dewi Lake (con Costelow)", "try"],
    ["47'", "AUS", "Max Jorgensen (con Lonergan)", "try"],
    ["50'", "WAL", "Dewi Lake (con Costelow)", "try"],
    ["55'", "WAL", "Blair Murray (con Costelow)", "try"],
    ["64'", "AUS", "Len Ikitau (con Gordon)", "try"],
    ["74'", "AUS", "Carter Gordon", "pen"],
    ["78'", "AUS", "Harry Wilson", "yellow card"],
    ["79'", "WAL", "Ryan Elias", "try"]]);
  assert.deepEqual(m.stand, [{side:"away", abbr:"AUS", text:"Lonergan 2 con \u00b7 Gordon 1 con, 1 pen"},
                             {side:"home", abbr:"WAL", text:"Costelow 3 con"}]);
  assert.deepEqual(m.stats, [{label:"Possession", away:"49%", home:"51%"}, {label:"Territory", away:"47%", home:"53%"},
                             {label:"Tackles", away:"156", home:"165"}]);
});

test("rugby: when the halves do not add up to the score, the table is left out rather than shown wrong", () => {
  const f = JSON.parse(JSON.stringify(fixture("summary-rugby-e7552a9b.json")));
  f.summary.match.scores = [30, 29];
  assert.equal(P.parseRugby(f.summary, f.stats).line, null);
  assert.equal(P.parseRugby({}, null), null);
});

test("a rugby game's details come from World Rugby, by its wr: id", () => {
  assert.deepEqual(P.detailsSource({rugby:true, ids:["espn:604010", "wr:e7552a9b-439f-4141-8a47-14bb57279e46"]}).urls, [
    "https://api.wr-rims-prod.pulselive.com/rugby/v3/match/e7552a9b-439f-4141-8a47-14bb57279e46/summary",
    "https://api.wr-rims-prod.pulselive.com/rugby/v3/match/e7552a9b-439f-4141-8a47-14bb57279e46/stats"]);
  assert.equal(P.detailsSource({rugby:true, ids:["espn:604010"]}), null);
  assert.equal(P.detailsSource({comp:"NHL", eid:"401892789"}).sport, "hockey");
});
