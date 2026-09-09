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
  globalThis.__stars = tennisStars;
  const isStarredPlayer = p => !!(p && p.id != null && tennisStars.has(String(p.id)));
`;
const model = () => loadFromPage(
  ["TENNIS_TOP", "attachRankings", "rankOfPlayer", "lateRound", "tennisWorthShowing"], PREAMBLE);

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
