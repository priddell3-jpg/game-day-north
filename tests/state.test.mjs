import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFromPage } from "./helpers/page.mjs";

const { stateOf } = loadFromPage(["stateOf"]);

const START = Date.parse("2026-08-24T23:00:00Z");
const game = (result) => ({ away:{id:"a"}, home:{id:"h"}, comp:"MLB", start:START, result });

/* The rule: completion is something a source reports. Elapsed time is not
   evidence — a delay, extra innings, a stoppage and a postponement are
   indistinguishable from a clock, and the old code called all of them
   "Final". */

test("before the start, with nothing reported, it is scheduled", () => {
  assert.equal(stateOf(game(null), START - 3600000).status, "scheduled");
});

test("an explicit final is trusted, with its score", () => {
  const st = stateOf(game({status:"final", score:[4,3], label:"Final"}), START + 3*3600000);
  assert.equal(st.status, "final");
  assert.deepEqual(st.score, [4,3]);
  assert.equal(st.real, true);
});

test("an explicit final without a score is still final", () => {
  const st = stateOf(game({status:"final", score:null, label:"Final"}), START + 3*3600000);
  assert.equal(st.status, "final");
  assert.equal(st.score, null);
});

test("an explicit live state is trusted", () => {
  const st = stateOf(game({status:"live", score:[1,0], label:"Top 5th"}), START + 3600000);
  assert.equal(st.status, "live");
  assert.equal(st.label, "Top 5th");
});

test("a long-running game is never assumed finished", () => {
  // nine hours past the start, nothing reported: extra innings, a rain
  // delay and a postponement all look exactly like this
  const st = stateOf(game(null), START + 9*3600000);
  assert.equal(st.status, "unknown");
  assert.notEqual(st.status, "final");
  assert.equal(st.score, null);
});

test("a source still saying scheduled after the start is not a countdown", () => {
  // ESPN's season schedule reports a game under way as scheduled, 0-0
  const st = stateOf(game({status:"scheduled", score:null}), START + 2*3600000);
  assert.equal(st.status, "unknown");
});

test("a delayed start does not become final", () => {
  const st = stateOf(game({status:"scheduled", score:null}), START + 30*60000);
  assert.equal(st.status, "unknown");
});

test("no elapsed time ever produces a final", () => {
  for(const hours of [1, 3, 6, 12, 48]){
    assert.notEqual(stateOf(game(null), START + hours*3600000).status, "final");
  }
});

test("a fixture with no opponent yet is scheduled, not unknown", () => {
  assert.equal(stateOf({away:null, home:{id:"h"}, start:START}, START + 5*3600000).status, "scheduled");
});
