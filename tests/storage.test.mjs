import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFromPage } from "./helpers/page.mjs";

const { validResultRow, readResultStore, RESULTS_VERSION } =
  loadFromPage(["RESULTS_VERSION", "validResultRow", "readResultStore"], "const DAY = 86400000;");

const NOW = Date.parse("2026-08-24T12:00:00Z");
const row = (over = {}) => ({
  c: "MLB", t: NOW - 2*86400000, s: [4, 3], l: "Final",
  h: ["tor-mlb", "Toronto Blue Jays", "TOR", "#134A8E", "Toronto"],
  a: ["nyy", "New York Yankees", "NYY", "#132448", "New York"],
  ...over
});

test("a valid current-version payload is read", () => {
  const out = readResultStore({v:RESULTS_VERSION, saved:NOW, rows:[row()]}, NOW);
  assert.equal(out.rows.length, 1);
  assert.equal(out.discarded, undefined);
});

test("the legacy bare array is migrated rather than lost", () => {
  const out = readResultStore([row(), row()], NOW);
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
    row()
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

test("nothing here throws on hostile input", () => {
  for(const bad of [undefined, null, 0, "", [], {}, {v:2}, {v:2, rows:[null, 1, "x"]}]){
    assert.doesNotThrow(() => readResultStore(bad, NOW));
  }
});
