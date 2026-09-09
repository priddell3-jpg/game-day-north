import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage } from "./helpers/page.mjs";
import { normalizeRankings, RANK_DEPTH } from "../scripts/lib/tennis.mjs";

/* Narrowing the draw to the top of each tour, in the page.
 *
 * The correction that shaped this: the build cannot do it. Starring a
 * player lives in one browser's storage and the build ships one file to
 * everyone, so a build-side cut would make starring anybody outside the
 * top twenty-five do nothing. The file stays generous and every viewer
 * narrows it for themselves.
 *
 * The rankings are advisory throughout. A rank lets a match through; its
 * absence never keeps one out on its own. An unreachable list shows the
 * whole draw, which is what this page did before the filter existed.
 */

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
const FILE = JSON.parse(readFileSync(new URL("../data.json", import.meta.url), "utf8"));

/* ================= the source and the file ================= */

test("a rankings payload becomes a plain id-to-place lookup", () => {
  const payload = {rankings: [{name:"ATP", ranks: [
    {current: 1, athlete: {id: "3623", displayName: "Jannik Sinner"}},
    {current: 3, athlete: {id: "3782", displayName: "Carlos Alcaraz"}},
    {current: RANK_DEPTH + 1, athlete: {id: "9999", displayName: "Someone"}},
    {current: 0, athlete: {id: "8888"}},
    {current: 5, athlete: {id: null}}
  ]}]};
  assert.deepEqual(normalizeRankings(payload), {"3623": 1, "3782": 3});
});

test("a payload that is not a rankings answer yields null, not an empty list", () => {
  /* Null is what tells the build to carry the previous list forward. An
     empty object would look like a successful answer with nobody in it
     and would widen the draw back out. */
  assert.equal(normalizeRankings(null), null);
  assert.equal(normalizeRankings({}), null);
  assert.equal(normalizeRankings({rankings: []}), null);
  assert.equal(normalizeRankings({rankings: [{ranks: []}]}), null);
});

test("the committed file carries both tours, keyed on the scoreboard's own athlete ids", () => {
  const t = FILE.tennis || {};
  assert.ok(t.rankings && t.rankings.ATP && t.rankings.WTA, "both lists");
  assert.ok(t.rankedAt && t.rankedAt.ATP && t.rankedAt.WTA, "each dated, so staleness is answerable");
  for(const tour of ["ATP", "WTA"]){
    const list = t.rankings[tour];
    const places = Object.values(list);
    assert.ok(places.length > 50, tour + " should carry a real list, got " + places.length);
    assert.ok(Math.min(...places) === 1 && Math.max(...places) <= RANK_DEPTH);
  }
  /* The join this whole feature rests on: ids in the rankings are the
     ids in the matches. If ESPN ever changed one of them, everything
     would silently stop matching and the draw would widen. */
  const ids = new Set((t.matches || []).flatMap(m => (m.players || [])
    .filter(p => p && p.id != null).map(p => String(p.id))));
  const hit = [...ids].filter(id => t.rankings.ATP[id] != null || t.rankings.WTA[id] != null);
  assert.ok(hit.length > 10, "only " + hit.length + " players on the board are in either list");
});

test("the whole thing costs about two kilobytes", () => {
  const bytes = Buffer.byteLength(JSON.stringify((FILE.tennis || {}).rankings || {}));
  assert.ok(bytes < 6000, "rankings are " + bytes + " bytes");
});

/* ================= the filter, in the page ================= */

const PREAMBLE = `
  let TENNIS_RANKS = {};
  let tennisStars = new Set();
  let tennisTours = new Set(["ATP", "WTA"]);
  let tennisEvents = new Set();
  let tennisAll = false;
  globalThis.__games = [];
  const GAMES = globalThis.__games;
  globalThis.__stars = tennisStars;
  globalThis.__setAll = v => { tennisAll = v; };
  globalThis.__isAll = () => tennisAll;
  const esc = s => String(s);
  const isStarredPlayer = p => !!(p && p.id != null && tennisStars.has(String(p.id)));
`;
const model = () => loadFromPage(
  ["TENNIS_TOP", "attachRankings", "rankOfPlayer", "lateRound", "tennisWorthShowing",
   "tennisCounts", "tennisNote", "tennisMine"], PREAMBLE);

const pl = (id, name) => ({id, name, short: name, country: "USA", tbd: false});
const SINNER = pl("3623", "Jannik Sinner");      // 1
const ALCARAZ = pl("3782", "Carlos Alcaraz");    // 3
const QUALIFIER = pl("77777", "Someone Unranked");
const OTHER = pl("88888", "Another Unranked");
const RANKS = {ATP: {"3623": 1, "3782": 3, "4444": 25, "5555": 26}};
const m = (over = {}) => Object.assign({
  id: "x", tour: "ATP", tid: "t1", round: "Round 1",
  players: [QUALIFIER, OTHER], start: 0
}, over);

test("a top-25 player on either side carries the match", () => {
  const p = model();
  p.attachRankings(RANKS);
  assert.equal(p.tennisWorthShowing(m({players: [SINNER, OTHER]})), true);
  assert.equal(p.tennisWorthShowing(m({players: [OTHER, ALCARAZ]})), true);
  assert.equal(p.tennisWorthShowing(m({players: [pl("4444", "Number 25"), OTHER]})), true,
    "twenty-fifth is inside the top twenty-five");
  assert.equal(p.tennisWorthShowing(m({players: [pl("5555", "Number 26"), OTHER]})), false,
    "twenty-sixth is not");
  assert.equal(p.tennisWorthShowing(m()), false, "two players nobody has heard of, first round");
});

test("a quarterfinal or later is shown whoever is in it", () => {
  /* The unseeded player having the run of their life. */
  const p = model();
  p.attachRankings(RANKS);
  for(const round of ["Quarterfinal", "Quarterfinals", "Semifinal", "Semifinals", "Final", "Finals",
                      "quarterfinal", "Semi Final"])
    assert.equal(p.tennisWorthShowing(m({round})), true, round + " must be shown");
  for(const round of ["Round 1", "Round 2", "Round 4", "Round of 16", ""])
    assert.equal(p.tennisWorthShowing(m({round})), false, round + " must not be");
});

test("Qualifying Final is not a final", () => {
  /* It ends in "Final" and is the last match of the week BEFORE the
     tournament — the one name in this draw that would slip through a
     substring test. */
  const p = model();
  p.attachRankings(RANKS);
  assert.equal(p.lateRound("Qualifying Final"), false);
  assert.equal(p.lateRound("Qualifying Finals"), false);
  assert.equal(p.tennisWorthShowing(m({round: "Qualifying Final"})), false);
  assert.equal(p.lateRound("Final"), true);
});

test("a starred player carries the match, which is why this cannot be done in the build", () => {
  const p = model();
  p.attachRankings(RANKS);
  const match = m({players: [QUALIFIER, OTHER]});
  assert.equal(p.tennisWorthShowing(match), false);
  globalThis.__stars.add("77777");
  assert.equal(p.tennisWorthShowing(match), true,
    "starring is per-viewer, so only the page can honour it");
});

test("no rankings means no narrowing, never an empty board", () => {
  const p = model();
  assert.equal(p.tennisWorthShowing(m()), true, "before any list has arrived");
  p.attachRankings(null);
  assert.equal(p.tennisWorthShowing(m()), true);
  p.attachRankings({});
  assert.equal(p.tennisWorthShowing(m()), true);
  /* And one tour's list does not narrow the other's. */
  p.attachRankings(RANKS);
  assert.equal(p.tennisWorthShowing(m({tour: "WTA"})), true, "no WTA list held");
  assert.equal(p.tennisWorthShowing(m({tour: "ATP"})), false);
});

test("a place is used, never shown", () => {
  /* A rank is a filter input. Putting "No. 3" on a row would be a claim
     about a player from a list that can be a week old. */
  const p = model();
  p.attachRankings(RANKS);
  assert.equal(p.rankOfPlayer(ALCARAZ, "ATP"), 3);
  assert.equal(p.rankOfPlayer(QUALIFIER, "ATP"), null, "not in the list is not a rank");
  assert.equal(p.rankOfPlayer(ALCARAZ, "WTA"), null);
  assert.equal(p.rankOfPlayer(null, "ATP"), null);
  const row = /function tennisRow\([\s\S]*?\n\}/.exec(SRC)[0];
  assert.doesNotMatch(row, /rankOfPlayer|TENNIS_RANKS/, "no rank is rendered on a row");
});

test("the filter is what the board reads, and it is only about display", () => {
  assert.match(SRC, /tennisMine = g => tennisTours\.has\(g\.comp\) &&[\s\S]{0,160}tennisWorthShowing\(g\.match\)/);
  /* The file is not narrowed. Everything the build fetched is still
     there for a viewer who stars somebody outside the top twenty-five. */
  const total = (FILE.tennis.matches || []).length;
  const ranks = FILE.tennis.rankings || {};
  const top = (FILE.tennis.matches || []).filter(x => {
    const list = ranks[x.tour];
    if(!list) return true;
    return (x.players || []).some(q => q && q.id != null && list[String(q.id)] <= 25);
  }).length;
  assert.ok(top < total, "the file carries more than the top of the draw: " + top + " of " + total);
});

/* ================= the build's side of it ================= */

test("an unreachable list is held rather than emptied, and said out loud", () => {
  const build = readFileSync(new URL("../scripts/fetch-data.mjs", import.meta.url), "utf8");
  assert.match(build, /rankings\[tour\] = prevRanks\[tour\]/, "the previous list is carried");
  assert.match(build, /rankedAt\[tour\] = prevRankedAt\[tour\]/, "dated as it was, not as now");
  assert.match(build, /rankings could not be read and none were held/,
    "and the case with nothing to hold is named too");
  assert.match(build, /RANK_STALE_DAYS/, "with a limit past which a held list is called stale");
});

/* ================= the way out of the filter ================= */

/* The hole this closes: the filter's third clause lets a match through
   when a player in it is starred, and a player can only be starred from
   a row on the screen. Without a way to see the whole draw, the only
   players anyone could star are the ones who were never hidden — the
   clause is unreachable and the filter is a one-way door. Both halves
   are needed and neither works alone. */

const game = over => {
  const mm = m(over);
  return {id:"tennis:"+mm.id, tennis:true, comp:mm.tour, match:mm, start:mm.start};
};

test("the whole draw can be shown, and the filter is what it switches off", () => {
  const p = model();
  p.attachRankings(RANKS);
  const buried = game({id:"deep", players:[QUALIFIER, OTHER], round:"Round 1"});
  globalThis.__games.length = 0;
  globalThis.__games.push(buried, game({id:"top", players:[SINNER, OTHER]}));

  assert.equal(p.tennisMine(buried), false, "filtered, as before");
  globalThis.__setAll(true);
  assert.equal(p.tennisMine(buried), true, "and reachable once the whole draw is showing");
  /* The rule itself is untouched, which is what lets the note count what
     is being held back while it is being shown. */
  assert.equal(p.tennisWorthShowing(buried.match), false);
});

test("the flow works end to end: show all, star, collapse back, and it stays", () => {
  const p = model();
  p.attachRankings(RANKS);
  const buried = game({id:"deep", players:[QUALIFIER, OTHER], round:"Round 1"});
  const later = game({id:"deep2", players:[QUALIFIER, SINNER], round:"Round 2", start: 1});
  globalThis.__games.length = 0;
  globalThis.__games.push(buried, later);

  // 1. the qualifier is nowhere to be seen
  globalThis.__setAll(false);
  assert.equal(p.tennisMine(buried), false);

  // 2. show every match, and there they are
  globalThis.__setAll(true);
  assert.equal(p.tennisMine(buried), true);

  // 3. star them from that row
  globalThis.__stars.add("77777");

  // 4. collapse back to the filtered view
  globalThis.__setAll(false);

  // 5. their matches stay
  assert.equal(p.tennisMine(buried), true, "the match they were starred from");
  assert.equal(p.tennisMine(later), true, "and the next one, which was never on screen");
});

test("the star control exists on the row, on the same pattern as the rugby one", () => {
  const row = /function tennisRow\([\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(row, /class="pl-star" data-player="/, "a control, not just a mark");
  assert.match(row, /aria-pressed="' \+ isStarredPlayer\(p\)/);
  assert.match(row, /aria-label="' \+ \(isStarredPlayer\(p\) \? "Unstar " : "Star "\)/);
  /* And a handler that writes to the same store rugby's writes to, and
     redraws — unstarring somebody below the top of the draw has to take
     their matches off the board.

     Asserted INSIDE the #main listener, not merely present somewhere.
     Both branches were first written into the drawer's listener, where
     the clicks never arrive, and the suite was green: the control
     existed, the handler existed, and nothing connected them. A listener
     has to be on the element the control is actually inside, which is
     why the rugby star sits in the other one. */
  const mainListener = SRC.slice(SRC.indexOf('document.getElementById("main").addEventListener("click"'));
  assert.ok(mainListener.length > 500, "could not isolate the #main listener");
  assert.match(mainListener, /const st=e\.target\.closest\("\[data-player\]"\);/);
  assert.match(mainListener, /tennisStars\.has\(id\)\?tennisStars\.delete\(id\):tennisStars\.add\(id\);/);
  assert.match(mainListener, /const ta=e\.target\.closest\("\[data-tennis-all\]"\);/);
  const drawerListener = SRC.slice(
    SRC.indexOf('document.getElementById("teamGroups").addEventListener("click"'),
    SRC.indexOf('document.getElementById("main").addEventListener("click"'));
  assert.doesNotMatch(drawerListener, /data-tennis-all/,
    "the drawer never sees a click on a row");
  /* Nothing new in the share link: ts= already carries starred players. */
  assert.match(SRC, /if\(tennisStars\.size\) parts\.push\("ts="\+\[\.\.\.tennisStars\]\.join\("\."\)\)/);
});

test("no star control on an empty slot or on a name being withheld", () => {
  /* A star button carrying a player's id beside the word TBD would hand
     back exactly what the row is holding. */
  const row = /function tennisRow\([\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(row, /const starOf = p => \(!p \|\| p\.id == null \|\| p\.tbd\) \? ""/);
  assert.match(row, /if\(playerSpoiled\(m, p\)\)/, "a withheld name gets no star control");
  const spoiledBranch = row.slice(row.indexOf("if(playerSpoiled(m, p))"),
                                  row.indexOf("const rank = rankLine"));
  assert.doesNotMatch(spoiledBranch, /starOf/, "and no place beside it either, which would identify them");
  assert.match(row, /nameOf\(p, i, show\) \+ starOf\(p\)/, "a named player gets one");
});

/* ================= saying that the filter is there ================= */

test("the line says how many matches are being held back, and offers the way out", () => {
  const p = model();
  p.attachRankings(RANKS);
  globalThis.__games.length = 0;
  globalThis.__games.push(game({id:"a", players:[SINNER, OTHER]}),
                          game({id:"b", players:[QUALIFIER, OTHER]}),
                          game({id:"c", players:[QUALIFIER, OTHER]}));
  assert.deepEqual(p.tennisCounts(), {shown: 1, hidden: 2});

  const note = p.tennisNote();
  assert.match(note, /Showing 1 of 3 tennis matches/);
  assert.match(note, /the top 25, the quarterfinals on, and players you have starred/);
  assert.match(note, /data-tennis-all="all"[^>]*>Show every match/);

  globalThis.__setAll(true);
  const all = p.tennisNote();
  assert.match(all, /Showing all 3 tennis matches in the draw/);
  assert.match(all, /data-tennis-all="top"[^>]*>Show the top 25/);
});

test("nothing is said when nothing is being held back", () => {
  const p = model();
  p.attachRankings(RANKS);
  globalThis.__games.length = 0;
  globalThis.__games.push(game({id:"a", players:[SINNER, OTHER]}));
  assert.equal(p.tennisNote(), "", "one more line for no reason");

  /* And nothing at all with tennis switched off. */
  globalThis.__games.push(game({id:"b", players:[QUALIFIER, OTHER]}));
  assert.match(p.tennisNote(), /Showing 1 of 2/);
});

test("the counts describe the viewer's board, not the file", () => {
  const p = model();
  p.attachRankings(RANKS);
  globalThis.__games.length = 0;
  globalThis.__games.push(game({id:"a", players:[QUALIFIER, OTHER], tid:"t1"}),
                          game({id:"b", players:[QUALIFIER, OTHER], tid:"t2"}));
  assert.equal(p.tennisCounts().hidden, 2);
  /* A tournament filter is somebody's own choice and is not the
     top-of-the-draw rule holding anything back. */
  const q = loadFromPage(
    ["TENNIS_TOP", "attachRankings", "rankOfPlayer", "lateRound", "tennisWorthShowing",
     "tennisCounts", "tennisNote", "tennisMine"],
    PREAMBLE.replace("tennisEvents = new Set()", 'tennisEvents = new Set(["t1"])'));
  q.attachRankings(RANKS);
  /* Loading the second model gave it its own empty board, so the same
     two matches go back on it. */
  globalThis.__games.push(game({id:"a", players:[QUALIFIER, OTHER], tid:"t1"}),
                          game({id:"b", players:[QUALIFIER, OTHER], tid:"t2"}));
  assert.equal(q.tennisCounts().hidden, 1, "only the tournament being looked at");
});

test("the switch is this browser's, not part of a shared board", () => {
  /* How one person is reading the draw this week, not the board they
     would send someone. */
  assert.match(SRC, /const TENNIS_ALL_KEY = "gdn\.tennis\.all";/);
  assert.match(SRC, /let tennisAll = LS\.get\(TENNIS_ALL_KEY, false\) === true;/,
    "read strictly as a boolean, like resultsOpen");
  assert.match(SRC, /LS\.set\(TENNIS_ALL_KEY, tennisAll\);/);
  const link = /function shareLink\(\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.doesNotMatch(link, /tennisAll/);
});
