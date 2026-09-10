import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage, styleText, ruleFor } from "./helpers/page.mjs";

/* What a tennis row says once a match has been played: who won, who is
 * ahead while it is still on, and who the winner meets next.
 *
 * All three are results, and a draw gives results away in a way team
 * sport does not. The moment a fourth round finishes, the quarterfinal
 * row names the winner — so hiding the fourth round's score hides
 * nothing unless the name comes down too. That is the case this file is
 * mostly about.
 */

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");

const NOW = Date.parse("2026-09-09T20:00:00Z");
const DAY = 86400000;

const PREAMBLE = `
  const DAY = 86400000;
  let showScores = false, liveMode = true, dataStale = false;
  let services = new Set(), revealed = new Set(), alerts = new Set(), selected = new Set();
  let hiddenComps = new Set();
  const crest = t => "";
  const fmtDayLong = k => k;
  const isNarrow = () => false;
  const isStarredPlayer = () => false;
  let TENNIS_RANKS = {}, TENNIS_RANKED_AT = {};
  globalThis.__games = [];
  const GAMES = globalThis.__games;
  const myGames = () => globalThis.__games;
  let TOURNEYS = new Map([["t1", {id:"t1", name:"US Open", short:"US Open", major:true}]]);
  let SPOILED = new Set(), SPOILED_PLAYERS = new Map();
  globalThis.__spoil = now => { SPOILED_PLAYERS = spoiledPlayers(now); return SPOILED_PLAYERS; };
  globalThis.__setScores = v => { showScores = v; };
  globalThis.__reveal = id => { revealed.add(id); };
`;
const NAMES = ["COMPS","SERVICES","CARRIER_SERVICE","SRC","CHECKED","tv","st","CDN_MLS","RIGHTS",
  "US_OPEN","resolveRights","SOCCER","esc","inkOn","pad","ymd","normName","fmtTime","fmtShortDate",
  "countdownText","BELL","saveButton","servicesFor","covered","RESULTS_DAYS","TENNIS_SETTLED",
  "visibleRights","carrierHtml","TENNIS_STATE","setText","setHtml","setTally","tourneyOf","spoiledPlayers","playerSpoiled",
  "TBD_PLAYER","nextMatchFor","nextOpponentLine","RANK_STALE_DAYS","attachRankings",
  "rankOfPlayer","rankLine","tennisRow"];

const player = (id, name, short) => ({id, name, short, country:"USA", tbd:false});
const PAUL   = player("2964", "Tommy Paul", "T. Paul");
const ALCARAZ= player("3782", "Carlos Alcaraz", "C. Alcaraz");
const SHELTON= player("4231", "Ben Shelton", "B. Shelton");
const TBD    = {id:null, name:"TBD", short:"TBD", country:"", tbd:true};

const match = (over = {}) => Object.assign({
  id:"m1", tour:"ATP", tid:"t1", round:"Round 4", court:"Arthur Ashe Stadium",
  venue:"New York, USA", start: NOW - 6*3600000, timeKnown:true,
  status:"final", label:"Final", players:[PAUL, ALCARAZ],
  sets:[[4,6],[3,6],[4,6]], tiebreaks:[null,null,null], setWins:[1,1,1], winner:1
}, over);
const asGame = m => ({id:"tennis:"+m.id, tennis:true, comp:m.tour, match:m, start:m.start,
  home:null, away:null, result:{status:m.status, label:m.label, score:null}});

/* The board, then the same step render() takes before drawing anything. */
function harness(matches = [], tweak = x => x){
  const p = loadFromPage(NAMES, tweak(PREAMBLE));
  globalThis.__games.length = 0;
  matches.forEach(m => globalThis.__games.push(asGame(m)));
  globalThis.__spoil(NOW);
  return p;
}

/* ============ the winner, and only once it may be shown ============ */

test("a finished match greys the loser and leaves the winner alone", () => {
  const m = match();
  const p = harness([m], s => s.replace("showScores = false", "showScores = true"));
  const html = p.tennisRow(asGame(m), NOW);
  assert.match(html, /class="g-team pl pl-lost"[^>]*>Tommy Paul/, "the beaten player is greyed");
  assert.match(html, /class="g-team pl pl-win"[^>]*>Carlos Alcaraz/);
});

test("greying a name IS the result, so a hidden final greys nobody", () => {
  const m = match();
  const p = harness([m]);
  const html = p.tennisRow(asGame(m), NOW);
  assert.match(html, /hidden-score/, "the score is hidden");
  assert.doesNotMatch(html, /pl-lost/, "and so is which of them lost");
  assert.doesNotMatch(html, /pl-win/);
  assert.match(html, /Tommy Paul/, "both names still render, unchanged");
  assert.match(html, /Carlos Alcaraz/);
});

test("a live match marks nobody, because nothing has been decided", () => {
  const m = match({status:"live", label:"3rd", winner:null, setWins:[0,1,null],
    sets:[[6,3],[1,6],[4,3]]});
  const p = harness([m], s => s.replace("showScores = false", "showScores = true"));
  const html = p.tennisRow(asGame(m), NOW);
  assert.doesNotMatch(html, /pl-win|pl-lost/);
});

/* ============ "def", and the winner on top ============ */

test("a settled match puts the winner first and says def", () => {
  const m = match();                       // Alcaraz, players[1], beat Paul
  const p = harness([m], s => s.replace("showScores = false", "showScores = true"));
  const html = p.tennisRow(asGame(m), NOW);
  assert.match(html, /class="vs">def</, "the way a result has always been written");
  assert.ok(html.indexOf("Carlos Alcaraz") < html.indexOf("Tommy Paul"), "winner on top");
  /* And the greying stays. The redundancy is the point: order, word and
     weight all say the same thing, so a glance cannot misread it. */
  assert.match(html, /pl-win[^>]*>Carlos Alcaraz/);
  assert.match(html, /pl-lost[^>]*>Tommy Paul/);
});

test("a winner already on top is left where the feed put them", () => {
  const m = match({winner: 0, setWins: [0, 0], sets: [[6, 3], [6, 4]], tiebreaks: [null, null]});
  const p = harness([m], s => s.replace("showScores = false", "showScores = true"));
  const html = p.tennisRow(asGame(m), NOW);
  assert.ok(html.indexOf("Tommy Paul") < html.indexOf("Carlos Alcaraz"));
  assert.match(html, /class="vs">def</);
});

test("live and scheduled matches keep v, in the order the feed billed them", () => {
  for(const over of [{status:"live", label:"3rd", winner:null, setWins:[0,1,null]},
                     {status:"scheduled", label:"", winner:null, sets:[], setWins:[], tiebreaks:[]}]){
    const m = match(over);
    const p = harness([m], s => s.replace("showScores = false", "showScores = true"));
    const html = p.tennisRow(asGame(m), NOW);
    assert.match(html, /class="vs">v</, over.status + " must say v");
    assert.ok(html.indexOf("Tommy Paul") < html.indexOf("Carlos Alcaraz"), over.status + " keeps feed order");
  }
});

test("reordering leaks the winner as loudly as the word, so a hidden final does neither", () => {
  const m = match();
  const p = harness([m]);
  const html = p.tennisRow(asGame(m), NOW);
  assert.match(html, /class="vs">v</, "not def");
  assert.ok(html.indexOf("Tommy Paul") < html.indexOf("Carlos Alcaraz"), "feed order");
  assert.doesNotMatch(html, /pl-win|pl-lost/, "and nobody greyed");
  assert.match(html, /hidden-score/);
});

test("revealing brings the order, the word and the greying back together", () => {
  const m = match();
  const p = harness([m], s => s.replace('revealed = new Set()', 'revealed = new Set(["tennis:m1"])'));
  const html = p.tennisRow(asGame(m), NOW);
  assert.match(html, /class="vs">def</);
  assert.ok(html.indexOf("Carlos Alcaraz") < html.indexOf("Tommy Paul"));
  assert.match(html, /pl-lost[^>]*>Tommy Paul/);
});

test("the set scores turn round with the names", () => {
  /* A row reading "Alcaraz def Paul" over "4-6 3-6 4-6" would be
     contradicting itself: those numbers are Paul's first. */
  const m = match();
  const p = harness([m], s => s.replace("showScores = false", "showScores = true"));
  const html = p.tennisRow(asGame(m), NOW);
  assert.match(html, /<b>6<\/b>-4/, "the winner's games first, and marked as the set winner's");
  assert.doesNotMatch(html, /4-<b>6<\/b>/);

  /* Directly, both ways round. */
  assert.equal(p.setText(m, 0), "4-6");
  assert.equal(p.setText(m, 0, true), "6-4");
  assert.equal(p.setHtml(m, 0, true), '<span class="set"><b>6</b>-4</span>');
  assert.equal(p.setTally(match({setWins:[0,0,1]})), "2–1");
  assert.equal(p.setTally(match({setWins:[0,0,1]}), true), "1–2");
});

/* ============ a retirement, a walkover, and a result with no sets ============

   None of the three is in the committed file today: it holds 85 finals,
   2 live matches and 26 scheduled, and no retirement, walkover,
   cancellation or postponement at all. So these are built from the shape
   the normaliser produces rather than observed, and that is stated
   rather than implied. `winner` is read from the competitor's own winner
   flag and does not depend on the status, so all three carry one. */

test("a retirement is a result: winner first, def, and the sets that were played", () => {
  const m = match({status:"retired", label:"Retired", winner:1,
    sets:[[4,6],[1,2]], tiebreaks:[null,null], setWins:[1,null]});
  const semi = match({id:"m2", round:"Semifinal", start:NOW + DAY,
    status:"scheduled", label:"", winner:null, players:[ALCARAZ, SHELTON],
    sets:[], tiebreaks:[], setWins:[]});
  const p = harness([m, semi], s => s.replace("showScores = false", "showScores = true"));
  const html = p.tennisRow(asGame(m), NOW);
  assert.match(html, /class="vs">def</);
  assert.ok(html.indexOf("Carlos Alcaraz") < html.indexOf("Tommy Paul"));
  assert.match(html, /<b>6<\/b>-4/, "the completed set, turned round");
  assert.match(html, /2-1/, "and the one abandoned, unmarked");
  assert.match(html, /class="conf-note match-note"/, "the unusual ending gets its own message row");
  assert.match(html, />Opponent retired<\/span>/);
  assert.doesNotMatch(html, /Ended early/);
  assert.ok(html.indexOf('class="next-up"') < html.indexOf('class="conf-note match-note"'),
    "what comes next is read before the special notice explaining the result");
});

test("a walkover has a winner and no sets, and can still be hidden and revealed", () => {
  /* The trap this closes: the Reveal button used to appear only when
     sets had been played, so a walkover could never be opened — and its
     players would stay blanked out of every later round for good. */
  const m = match({status:"walkover", label:"Walkover", winner:1,
    sets:[], tiebreaks:[], setWins:[]});
  const hidden = harness([m]);
  const shut = hidden.tennisRow(asGame(m), NOW);
  assert.match(shut, /hidden-score/, "there is a result, so there is a way to open it");
  assert.match(shut, /class="vs">v</);
  assert.doesNotMatch(shut, /pl-win|pl-lost/);

  const open = harness([m], s => s.replace("showScores = false", "showScores = true"));
  const html = open.tennisRow(asGame(m), NOW);
  assert.match(html, /class="vs">def</);
  assert.ok(html.indexOf("Carlos Alcaraz") < html.indexOf("Tommy Paul"));
  assert.doesNotMatch(html, /class="set"/, "no sets were played and none are invented");
  assert.match(html, />Opponent withdrew<\/span>/);
  assert.doesNotMatch(html, /Not played/);
});

test("a finished match with no score published still reads as a result", () => {
  const m = match({status:"final", label:"Final", winner:0,
    sets:[], tiebreaks:[], setWins:[]});
  const p = harness([m], s => s.replace("showScores = false", "showScores = true"));
  const html = p.tennisRow(asGame(m), NOW);
  assert.match(html, /class="vs">def</);
  assert.doesNotMatch(html, /class="set"/);
});

test("a cancelled match has no winner, so nothing is reordered and nothing is said", () => {
  const m = match({status:"canceled", label:"Canceled", winner:null,
    sets:[], tiebreaks:[], setWins:[]});
  const p = harness([m], s => s.replace("showScores = false", "showScores = true"));
  const html = p.tennisRow(asGame(m), NOW);
  assert.match(html, /class="vs">v</);
  assert.doesNotMatch(html, /pl-win|pl-lost|hidden-score/);
});

/* ============ the ranking, in the slot a record occupies ============ */

test("a ranked player carries their place under their name", () => {
  const m = match({status:"scheduled", label:"", winner:null, sets:[], tiebreaks:[], setWins:[]});
  const p = harness([m]);
  p.attachRankings({ATP: {"3782": 3}}, {ATP: new Date(NOW).toISOString()});
  const html = p.tennisRow(asGame(m), NOW);
  assert.match(html, /<span class="g-rec">No\. 3<\/span>/, "the same slot a team's record sits in");
  assert.equal((html.match(/g-rec/g) || []).length, 1, "and nothing for the player who has none");
});

test("an unranked player gets nothing, not the word unranked", () => {
  /* Real today: the live WTA match in the file has two players outside
     the top hundred, so this is the ordinary case rather than an edge. */
  const p = harness([]);
  p.attachRankings({ATP: {"3782": 3}}, {ATP: new Date(NOW).toISOString()});
  assert.equal(p.rankLine(PAUL, "ATP", NOW), null);
  assert.equal(p.rankLine(ALCARAZ, "ATP", NOW), "No. 3");
  assert.equal(p.rankLine(ALCARAZ, "WTA", NOW), null, "the other tour's list is not theirs");
  assert.equal(p.rankLine(TBD, "ATP", NOW), null);
});

test("a ranking is a weekly figure, not a result, so it is not gated on the reveal", () => {
  /* The tours publish on Mondays. A place does not move when a match
     finishes, so it cannot say how one went — which is why a hidden
     final still shows both players' rankings while showing nothing else
     about them. */
  const m = match();
  const p = harness([m]);
  p.attachRankings({ATP: {"3782": 3, "2964": 12}}, {ATP: new Date(NOW).toISOString()});
  const html = p.tennisRow(asGame(m), NOW);
  assert.match(html, /hidden-score/, "the result is hidden");
  assert.doesNotMatch(html, /pl-win|pl-lost/);
  assert.match(html, /No\. 3/);
  assert.match(html, /No\. 12/, "both places, on a row saying nothing about the match");
});

test("a name being withheld takes its ranking with it", () => {
  /* A place beside a blanked name identifies the player as surely as the
     name would. */
  const p = harness([R4, QF]);
  p.attachRankings({ATP: {"3782": 3, "4231": 7}}, {ATP: new Date(NOW).toISOString()});
  const qf = p.tennisRow(asGame(QF), NOW);
  assert.match(qf, /tbd-slot/);
  assert.doesNotMatch(qf, /No\. 3/, "Alcaraz is being withheld, and so is his place");
  assert.match(qf, /No\. 7/, "Shelton is not, and keeps his");
});

test("a place from a list nobody could refresh for over a week is not printed", () => {
  /* It still filters — a slightly old idea of the top twenty-five beats
     none, and the filter's failure mode is more tennis rather than
     less. It stops being SHOWN, because a place beside a name is a
     claim. */
  const p = harness([]);
  const stale = new Date(NOW - 9 * DAY).toISOString();
  p.attachRankings({ATP: {"3782": 3}}, {ATP: stale});
  assert.equal(p.rankLine(ALCARAZ, "ATP", NOW), null);
  assert.equal(p.rankOfPlayer(ALCARAZ, "ATP"), 3, "but the filter can still read it");

  const fresh = new Date(NOW - 6 * DAY).toISOString();
  p.attachRankings({ATP: {"3782": 3}}, {ATP: fresh});
  assert.equal(p.rankLine(ALCARAZ, "ATP", NOW), "No. 3", "a week old is what a ranking is");

  /* An undated list is not assumed stale — nothing said is not the same
     as something said and old. */
  p.attachRankings({ATP: {"3782": 3}}, {});
  assert.equal(p.rankLine(ALCARAZ, "ATP", NOW), "No. 3");
});

/* ============ reading a live match at a glance ============ */

test("each completed set says who took it", () => {
  const p = harness();
  const m = match({status:"live", winner:null, setWins:[0,1,null], sets:[[6,3],[1,6],[4,3]],
    tiebreaks:[null,null,null]});
  assert.equal(p.setHtml(m, 0), '<span class="set"><b>6</b>-3</span>', "the first set went to the left name");
  assert.equal(p.setHtml(m, 1), '<span class="set">1-<b>6</b></span>');
  assert.equal(p.setHtml(m, 2), '<span class="set">4-3</span>', "a set still being played marks nobody");
});

test("a tiebreak stays beside its set and does not get marked", () => {
  const p = harness();
  const m = match({setWins:[1], sets:[[6,7]], tiebreaks:[[3,7]]});
  assert.equal(p.setHtml(m, 0), '<span class="set">6-<b>7</b>(3)</span>');
});

test("the tally answers who is winning without counting", () => {
  /* The match the reader got stuck on: 6-3 1-6 4-3, one set each, and
     nothing on the row saying so. */
  const p = harness();
  assert.equal(p.setTally(match({setWins:[0,1,null]})), "1–1");
  assert.equal(p.setTally(match({setWins:[0,0,1]})), "2–1");
  assert.equal(p.setTally(match({setWins:[]})), null, "nothing to tally before a set is done");
  assert.equal(p.setTally(match({setWins:[null]})), null);
});

test("a live row carries the tally beside ESPN's own words for where it is", () => {
  const m = match({status:"live", label:"3rd", winner:null, setWins:[0,1,null],
    sets:[[6,3],[1,6],[4,3]]});
  const p = harness([m], s => s.replace("showScores = false", "showScores = true"));
  const html = p.tennisRow(asGame(m), NOW);
  assert.match(html, /3rd &middot; 1–1 in sets/);
});

test("the tally follows hide-scores like any other score", () => {
  const m = match({status:"live", label:"3rd", winner:null, setWins:[0,1,null],
    sets:[[6,3],[1,6],[4,3]]});
  const p = harness([m]);
  const html = p.tennisRow(asGame(m), NOW);
  assert.match(html, /hidden-score/);
  assert.doesNotMatch(html, /in sets/);
  assert.doesNotMatch(html, /6-3/);
});

/* ============ the leak: a later round names an earlier winner ============ */

const R4 = match();                                    // Alcaraz beat Paul
const QF = match({id:"m2", round:"Quarterfinal", start: NOW + 20*3600000,
  status:"scheduled", label:"", players:[SHELTON, ALCARAZ],
  sets:[], tiebreaks:[], setWins:[], winner:null});

test("a hidden fourth round takes the winner's name out of the quarterfinal", () => {
  /* Hide Alcaraz beating Paul and the quarterfinal still reads "Ben
     Shelton v Carlos Alcaraz", which says he won it. */
  const p = harness([R4, QF]);
  const qf = p.tennisRow(asGame(QF), NOW);
  assert.doesNotMatch(qf, /Carlos Alcaraz/, "naming him here announces the fourth round");
  assert.match(qf, /tbd-slot[^>]*>TBD/, "the slot he came through is undetermined, and says so");
  assert.match(qf, /Ben Shelton/, "his opponent has not played, so nothing about him is hidden");
  /* Including the reminder button's label, which carries the match name
     and would otherwise hand it back in a tooltip. */
  assert.doesNotMatch(qf, /Alcaraz/, "not in the row, and not in the bell's label either");
});

test("the hidden match's own row still names both players", () => {
  /* It is the row the person chose not to look at. Blanking a name on it
     would itself say something about it. */
  const p = harness([R4, QF]);
  const r4 = p.tennisRow(asGame(R4), NOW);
  assert.match(r4, /Tommy Paul/);
  assert.match(r4, /Carlos Alcaraz/);
});

test("revealing the fourth round puts the name back in the quarterfinal", () => {
  const p = harness([R4, QF], s => s.replace('revealed = new Set()', 'revealed = new Set(["tennis:m1"])'));
  assert.match(p.tennisRow(asGame(QF), NOW), /Carlos Alcaraz/);
  assert.doesNotMatch(p.tennisRow(asGame(QF), NOW), /tbd-slot/);
});

test("scores switched on ends the question", () => {
  const p = harness([R4, QF], s => s.replace("showScores = false", "showScores = true"));
  assert.match(p.tennisRow(asGame(QF), NOW), /Carlos Alcaraz/);
});

test("the spoiled set is keyed on the player within their tournament", () => {
  const p = harness([R4, QF]);
  const spoiled = p.spoiledPlayers(NOW);
  assert.deepEqual([...spoiled.keys()].sort(), ["t1|2964", "t1|3782"], "both players, this event only");
  /* The same player at another event is untouched. */
  const elsewhere = match({id:"m9", tid:"t2", round:"Quarterfinal", start: NOW + 30*3600000,
    status:"scheduled", players:[ALCARAZ, SHELTON], winner:null, sets:[], setWins:[]});
  assert.equal(p.playerSpoiled(elsewhere, ALCARAZ), false);
  assert.equal(p.playerSpoiled(QF, ALCARAZ), true);
  /* And an EARLIER match is not affected by a later hidden one. */
  const earlier = match({id:"m0", round:"Round 2", start: NOW - 3*DAY, status:"scheduled",
    players:[ALCARAZ, SHELTON], winner:null});
  assert.equal(p.playerSpoiled(earlier, ALCARAZ), false, "only what comes after can give it away");
});

test("a match outside the board's reach spoils nothing, as with team records", () => {
  const old = match({start: NOW - 5*DAY});
  const later = match({id:"m2", round:"Quarterfinal", start: NOW - 4*DAY,
    status:"scheduled", players:[SHELTON, ALCARAZ], winner:null, sets:[], setWins:[]});
  const p = harness([old, later]);
  assert.equal(p.spoiledPlayers(NOW).size, 0, "no row for it, no Reveal button, nothing withheld");
});

test("a cancelled match puts nobody in the set", () => {
  const p = harness([match({status:"canceled", winner:null, sets:[], setWins:[]})]);
  assert.equal(p.spoiledPlayers(NOW).size, 0, "no winner, nothing to give away");
});

/* ============ who the winner plays next ============ */

test("the next match is found by start time, not by round name", () => {
  /* This draw runs Round 1, Round 2, Round 4, Qualifying Final,
     Quarterfinal, Semifinal. Neither contiguous nor sortable by name. */
  const semi = match({id:"m3", round:"Semifinal", start: NOW + 3*DAY, status:"scheduled",
    players:[ALCARAZ, TBD], winner:null, sets:[], setWins:[]});
  const p = harness([R4, QF, semi], s => s.replace("showScores = false", "showScores = true"));
  assert.equal(p.nextMatchFor(R4).id, "m2", "the earliest later match naming the winner");
  assert.equal(p.nextOpponentLine(R4), "Faces B. Shelton in the Quarterfinal");
});

test("a numbered round takes no article, a named one does", () => {
  /* The draw mixes both. "in the Round 2" reads as a mistake. */
  const r1 = match({id:"a", round:"Round 1", start: NOW - 8*3600000, players:[PAUL, ALCARAZ], winner:1});
  const r2 = match({id:"b", round:"Round 2", start: NOW + 2*DAY, status:"scheduled",
    players:[ALCARAZ, SHELTON], winner:null, sets:[], setWins:[]});
  const p = harness([r1, r2], s => s.replace("showScores = false", "showScores = true"));
  assert.equal(p.nextOpponentLine(r1), "Faces B. Shelton in Round 2");

  const qf = match({id:"c", round:"Qualifying Final", start: NOW + 2*DAY, status:"scheduled",
    players:[ALCARAZ, SHELTON], winner:null, sets:[], setWins:[]});
  const q = harness([r1, qf], s => s.replace("showScores = false", "showScores = true"));
  assert.equal(q.nextOpponentLine(r1), "Faces B. Shelton in the Qualifying Final");
});

test("a slot with no opponent yet says TBD rather than nothing", () => {
  const semi = match({id:"m3", round:"Semifinal", start: NOW + 3*DAY, status:"scheduled",
    players:[TBD, ALCARAZ], winner:null, sets:[], setWins:[]});
  const p = harness([R4, semi], s => s.replace("showScores = false", "showScores = true"));
  assert.equal(p.nextOpponentLine(R4), "Faces TBD in the Semifinal");
});

test("a champion, or a round the draw has not reached, gets no line at all", () => {
  const p = harness([R4], s => s.replace("showScores = false", "showScores = true"));
  assert.equal(p.nextMatchFor(R4), null);
  assert.equal(p.nextOpponentLine(R4), null);
  assert.doesNotMatch(p.tennisRow(asGame(R4), NOW), /next-up/);
  /* And a match nobody has won yet has no next by definition. */
  assert.equal(p.nextOpponentLine(QF), null);
});

test("naming a next opponent says who won, so it waits on the reveal", () => {
  const p = harness([R4, QF]);
  const html = p.tennisRow(asGame(R4), NOW);
  assert.match(html, /hidden-score/);
  assert.doesNotMatch(html, /next-up|Faces /, "who he plays next says he came through");

  const shown = harness([R4, QF], s => s.replace("showScores = false", "showScores = true"));
  assert.match(shown.tennisRow(asGame(R4), NOW), /Faces B\. Shelton in the Quarterfinal/);
});

test("an opponent whose own result is hidden is named TBD in the line", () => {
  /* Shelton wins his quarterfinal, that result is hidden, and the line
     under Alcaraz's semifinal must not name him. */
  const sheltonQF = match({id:"m5", round:"Quarterfinal", start: NOW - 5*3600000,
    players:[SHELTON, PAUL], setWins:[0,0], sets:[[6,4],[6,4]], tiebreaks:[null,null], winner:0});
  const semi = match({id:"m6", round:"Semifinal", start: NOW + 2*DAY, status:"scheduled",
    players:[ALCARAZ, SHELTON], winner:null, sets:[], setWins:[]});
  const alcarazQF = match({id:"m7", round:"Quarterfinal", start: NOW - 7*3600000,
    players:[ALCARAZ, PAUL], setWins:[0,0], sets:[[6,3],[6,3]], tiebreaks:[null,null], winner:0});
  const p = harness([alcarazQF, sheltonQF, semi],
    s => s.replace('revealed = new Set()', 'revealed = new Set(["tennis:m7"])'));
  assert.equal(p.nextOpponentLine(alcarazQF), "Faces TBD in the Semifinal",
    "Shelton's quarterfinal is still hidden");
});

/* ============ how it looks ============ */

test("the marks are weight and ink, not a scoreboard", () => {
  const css = styleText();
  assert.match(ruleFor(css, ".set b"), /font-weight\s*:\s*700/);
  assert.match(ruleFor(css, ".set b"), /color\s*:\s*var\(--ink\)/);
  const lost = ruleFor(css, ".g-team.pl-lost");
  assert.match(lost, /color\s*:\s*var\(--ink-2\)/);
  assert.doesNotMatch(lost, /text-decoration|line-through/, "greyed, not struck through");
  const next = ruleFor(css, ".next-up");
  assert.match(next, /color\s*:\s*var\(--muted\)/);
  const size = r => Number(/font-size\s*:\s*([\d.]+)px/.exec(r)[1]);
  assert.ok(size(next) < size(ruleFor(css, ".g-team")), "quieter than the names above it");
});
