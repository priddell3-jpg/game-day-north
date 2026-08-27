import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFromPage } from "./helpers/page.mjs";

const { validResultRow, readResultStore, dedupeResultRows, RESULTS_VERSION } =
  loadFromPage(
    ["RESULTS_VERSION", "RESULTS_READABLE", "SAME_WINDOW", "normName", "idKey", "ESPN_NAME",
     "clubKeys", "sameClub", "sameGame", "validResultRow", "resultRowAsGame", "SYNTHETIC_ID",
     "rowResolved", "betterResultRow", "dedupeResultRows", "readResultStore"],
    "const DAY = 86400000;");

const NOW = Date.parse("2026-08-24T12:00:00Z");
const row = (over = {}) => ({
  c: "MLB", t: NOW - 2*86400000, s: [4, 3], l: "Final",
  h: ["tor-mlb", "Toronto Blue Jays", "TOR", "#134A8E", "Toronto"],
  a: ["nyy", "New York Yankees", "NYY", "#132448", "New York"],
  ...over
});
/* A second, genuinely different game — the same clubs a week apart would
   also do, but a different opponent makes the intent obvious. */
const otherRow = (over = {}) => row({
  a: ["bos-mlb", "Boston Red Sox", "BOS", "#BD3039", "Boston"], ...over
});

test("a valid current-version payload is read", () => {
  const out = readResultStore({v:RESULTS_VERSION, saved:NOW, rows:[row()]}, NOW);
  assert.equal(out.rows.length, 1);
  assert.equal(out.discarded, undefined);
  assert.equal(out.migrated, false);
});

test("the legacy bare array is migrated rather than lost", () => {
  const out = readResultStore([row(), otherRow()], NOW);
  assert.equal(out.rows.length, 2);
  assert.equal(out.migrated, true);
});

test("an unknown version is discarded, not guessed at", () => {
  const out = readResultStore({v:99, rows:[row()]}, NOW);
  assert.deepEqual(out.rows, []);
  assert.equal(out.discarded, true);
});

test("a malformed container is discarded", () => {
  assert.equal(readResultStore({v:RESULTS_VERSION, rows:"not an array"}, NOW).discarded, true);
  assert.deepEqual(readResultStore("garbage", NOW).rows, []);
  assert.deepEqual(readResultStore(null, NOW).rows, []);
  assert.deepEqual(readResultStore(42, NOW).rows, []);
});

test("an incomplete row is dropped while its valid neighbours survive", () => {
  const out = readResultStore({v:RESULTS_VERSION, rows:[
    row(),
    row({s:[1]}),                 // score of the wrong shape
    row({h:["only-an-id"]}),      // side missing its name
    row({t:"yesterday"}),         // time of the wrong type
    row({c:""}),                  // no competition
    otherRow()
  ]}, NOW);
  assert.equal(out.rows.length, 2);
});

test("an expired row is dropped", () => {
  const out = readResultStore({v:RESULTS_VERSION, rows:[
    row({t: NOW - 9*86400000}),   // older than the week it is kept for
    row()
  ]}, NOW);
  assert.equal(out.rows.length, 1);
});

test("a row from the future is not trusted", () => {
  assert.equal(validResultRow(row({t: NOW + 5*86400000}), NOW), false);
});

test("a non-numeric score never validates", () => {
  assert.equal(validResultRow(row({s:["4","3"]}), NOW), false);
  assert.equal(validResultRow(row({s:[4, NaN]}), NOW), false);
});

/* ================= the event id on a stored row =================
   Added in v3. A recalled result used to carry no id at all, so it met
   the fed copy of the same fixture on club names — and the two readers
   spell one club differently, which is how a game came to stand in
   Recent results twice.
   ================================================================ */

test("a row with an event id validates, and so does one without", () => {
  assert.equal(validResultRow(row({e:"401816683"}), NOW), true);
  assert.equal(validResultRow(row(), NOW), true);
});

test("something that is not an id where the id goes is not this shape", () => {
  for(const e of [401816683, "", true, {}, []]){
    assert.equal(validResultRow(row({e}), NOW), false, JSON.stringify(e));
  }
});

test("a v2 store is migrated, not discarded — a week of scores survives", () => {
  const out = readResultStore({v:2, saved:NOW, rows:[row(), otherRow()]}, NOW);
  assert.equal(out.rows.length, 2);
  assert.equal(out.migrated, true);
  assert.equal(out.discarded, undefined);
  assert.equal(out.rows[0].e, undefined);        // a v2 row simply has no id
});

/* ---- clearing out the duplicates already written ---- */

/* The pair actually found in a browser: one game, two rows, because a
   live read resolved Kansas City to `kcr` while the committed file
   minted `feed:MLB:KC` for the same club. The kickoff is moved inside
   the week the store keeps so the same rows can also be handed to
   readResultStore, which drops anything older or in the future. */
const KICKOFF = NOW - 2*86400000;
const jaysBase = {
  c: "MLB", t: KICKOFF, s: [3, 0], l: "Final",
  h: ["tor-mlb", "Toronto Blue Jays", "TOR", "#134A8E", "Toronto"]
};
const liveRead = (over = {}) => ({...jaysBase,
  a: ["kcr", "Kansas City Royals", "KC", "#004687", "Kansas City"], ...over});
const fromFile = (over = {}) => ({...jaysBase,
  a: ["feed:MLB:KC", "Kansas City Royals", "KC", "#5A6478", "Kansas City"], ...over});

test("the two readings of one club collapse into a single row", () => {
  const out = dedupeResultRows([fromFile(), liveRead()]);
  assert.equal(out.length, 1);
});

test("the row carrying an event id is the one kept", () => {
  assert.equal(dedupeResultRows([liveRead(), fromFile({e:"401816683"})])[0].e, "401816683");
  assert.equal(dedupeResultRows([fromFile({e:"401816683"}), liveRead()])[0].e, "401816683");
});

test("with no id on either, the more resolved row is kept", () => {
  // `kcr` over `feed:MLB:KC` — same game, but that row also carries the
  // club's real colour rather than the placeholder grey
  for(const pair of [[fromFile(), liveRead()], [liveRead(), fromFile()]]){
    const kept = dedupeResultRows(pair)[0];
    assert.equal(kept.a[0], "kcr");
    assert.equal(kept.a[3], "#004687");
  }
});

test("two rows that both carry an id keep whichever came first", () => {
  const out = dedupeResultRows([liveRead({e:"401816683"}), fromFile({e:"401816683"})]);
  assert.equal(out.length, 1);
  assert.equal(out[0].a[0], "kcr");
});

test("different event ids are different games and both survive", () => {
  const out = dedupeResultRows([liveRead({e:"401816683"}), fromFile({e:"401816684"})]);
  assert.equal(out.length, 2);
});

test("a doubleheader is not collapsed into one game", () => {
  // the reason identity carries a four-hour window rather than a date
  const out = dedupeResultRows([liveRead(), liveRead({t: KICKOFF + 5*3600000, s:[1, 2]})]);
  assert.equal(out.length, 2);
});

test("different clubs are never merged, however alike the rest", () => {
  const out = dedupeResultRows([row(), otherRow()]);
  assert.equal(out.length, 2);
});

test("a store full of duplicates comes back with one row per game", () => {
  const store = {v:2, saved:NOW, rows:[
    fromFile(), liveRead(),                                    // one game, twice
    fromFile({t: KICKOFF - 86400000, s:[3, 5]}),               // the night before,
    liveRead({t: KICKOFF - 86400000, s:[3, 5]}),               // also twice
    row()                                                      // and an unrelated game
  ]};
  const out = readResultStore(store, NOW);
  assert.equal(out.rows.length, 3);
  assert.equal(out.migrated, true);
});

test("dedupe survives the rows that validation would have dropped", () => {
  // it runs after validation, so it never sees a row missing a side
  assert.doesNotThrow(() => dedupeResultRows([]));
  assert.deepEqual(dedupeResultRows([]), []);
});

test("nothing here throws on hostile input", () => {
  for(const bad of [undefined, null, 0, "", [], {}, {v:2}, {v:2, rows:[null, 1, "x"]},
                    {v:3, rows:[null, {e:5}]}]){
    assert.doesNotThrow(() => readResultStore(bad, NOW));
  }
});
