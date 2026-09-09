import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromEspnEvent, fromWrMatch, espnStatus, wrStatus,
         isTerminal, isActive } from "../scripts/lib/rugby.mjs";

/* The rule the whole live-score model rests on: a rugby match is over
   when the source says it is, and at no other time. Eighty minutes of
   rugby routinely takes a hundred, a knockout goes to extra time, and a
   match can be stopped and restarted — so nothing here may infer a
   result from elapsed time, and an unrecognised status must read as
   unresolved rather than as a final score.

   rugby-espn-states.json is constructed rather than captured, and says
   so: ESPN was serving no live, half-time, delayed, suspended,
   postponed or abandoned rugby anywhere at the moment this was written. */

const load = n => JSON.parse(readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8"));
const states = load("rugby-espn-states.json");
const byId = id => states.events.find(e => e.id === id);
const parse = id => fromEspnEvent(byId(id), "RUNC");

test("the constructed file says it is constructed", () => {
  assert.match(states._note, /CONSTRUCTED, not captured/);
});

test("in progress", () => {
  const f = parse("900001");
  assert.equal(f.status, "live");
  assert.equal(isActive("live"), true);
  assert.equal(isTerminal("live"), false);
  assert.deepEqual(f.score, [17, 12]);
  assert.equal(f.label, "52'");
});

test("half-time is live, not a result", () => {
  const f = parse("900002");
  assert.equal(f.status, "halftime");
  assert.equal(isActive(f.status), true);
  assert.equal(isTerminal(f.status), false);
  assert.deepEqual(f.score, [10, 7]);
});

test("delayed", () => {
  const f = parse("900003");
  assert.equal(f.status, "delayed");
  assert.equal(isActive(f.status), true);
  assert.equal(isTerminal(f.status), false);
});

test("suspended", () => {
  const f = parse("900004");
  assert.equal(f.status, "suspended");
  assert.equal(isActive(f.status), true);
  assert.equal(isTerminal(f.status), false);
});

test("extra time stays live until the source completes the match", () => {
  // level at 24-24 in the third period, well past eighty minutes. A rule
  // that ended a match on elapsed time would call this a draw.
  const f = parse("900005");
  assert.equal(f.status, "live");
  assert.equal(isTerminal(f.status), false);
  assert.deepEqual(f.score, [24, 24]);
  const period = byId("900005").competitions[0].status.period;
  assert.ok(period > 2, "this is beyond the two halves of normal time");
});

test("postponed is not a result and is not terminal", () => {
  // The match has not been played. It is kept regardless of age, and
  // there is nothing in progress to poll.
  const f = parse("900006");
  assert.equal(f.status, "postponed");
  assert.equal(isTerminal(f.status), false);
  assert.equal(isActive(f.status), false);
  assert.equal(f.score, null);
});

test("cancelled and abandoned are terminal but are not finals", () => {
  const c = parse("900007"), a = parse("900008");
  assert.equal(c.status, "cancelled");
  assert.equal(a.status, "abandoned");
  assert.equal(isTerminal("cancelled"), true);
  assert.equal(isTerminal("abandoned"), true);
  assert.notEqual(c.status, "final");
  assert.notEqual(a.status, "final");
});

test("final", () => {
  const f = parse("900009");
  assert.equal(f.status, "final");
  assert.equal(isTerminal(f.status), true);
  assert.equal(isActive(f.status), false);
  assert.deepEqual(f.score, [31, 24]);
  assert.equal(byId("900009").competitions[0].status.type.completed, true);
});

test("a status ESPN has never published reads as unresolved, never as final", () => {
  const f = parse("900010");
  assert.equal(f.status, "unknown");
  assert.equal(isTerminal(f.status), false);
  assert.equal(isActive(f.status), true, "unresolved is worth asking about again");
});

test("completed is honoured even when the state field is missing", () => {
  assert.equal(espnStatus({completed:true}), "final");
  assert.equal(espnStatus({state:"post"}), "final");
  assert.equal(espnStatus({state:"in"}), "live");
  assert.equal(espnStatus({state:"pre"}), "scheduled");
  assert.equal(espnStatus({}), "unknown");
  assert.equal(espnStatus(null), "unknown");
  assert.equal(espnStatus(undefined), "unknown");
});

test("a stated end beats the state field, so a postponement is not a final", () => {
  // ESPN gives a postponed match state "post". Reading state alone would
  // print "Final" over a match that was never played.
  assert.equal(espnStatus({name:"STATUS_POSTPONED", state:"post", completed:false}), "postponed");
  assert.equal(espnStatus({name:"STATUS_CANCELED", state:"post", completed:false}), "cancelled");
  assert.equal(espnStatus({name:"STATUS_ABANDONED", state:"post", completed:false}), "abandoned");
});

/* ---------------- kickoff not yet settled ---------------- */

test("a kickoff the source flags as unsettled is carried as TBD", () => {
  const f = parse("900011");
  assert.equal(f.timeTBD, true);
  assert.equal(f.status, "scheduled");
});

test("an unflagged kickoff is never guessed to be TBD", () => {
  // Two real fixtures land on exactly 00:00Z. ESPN reports timeValid
  // true for both, so the page shows the time it was given rather than
  // deciding that a round number means nobody knows.
  const tests = load("rugby-espn-test-match.json").events
    .filter(e => /T00:00Z$/.test(e.date));
  assert.ok(tests.length >= 1, "the captured payload has a midnight-UTC kickoff");
  for(const e of tests){
    assert.equal(e.competitions[0].timeValid, true);
    assert.equal(fromEspnEvent(e, "RUTEST").timeTBD, false);
  }
});

/* ---------------- World Rugby's codes ---------------- */

test("World Rugby's status codes map to the same vocabulary", () => {
  assert.equal(wrStatus("C"), "final");
  assert.equal(wrStatus("CC"), "cancelled");
  assert.equal(wrStatus("U"), "scheduled");
  assert.equal(wrStatus("L"), "live");
  assert.equal(wrStatus("HT"), "halftime");
});

test("an unknown World Rugby code is unresolved, never final", () => {
  for(const code of ["", null, undefined, "Z", "WAT", "99"]){
    const s = wrStatus(code);
    assert.equal(isTerminal(s), false, JSON.stringify(code) + " must not be terminal");
    assert.equal(s, "unknown");
  }
});

test("a cancelled World Rugby match keeps its cancellation, not a scoreline", () => {
  const wr = load("rugby-worldrugby-matches.json").content;
  const cc = wr.filter(m => m.status === "CC").map(m => fromWrMatch(m)).filter(Boolean);
  assert.ok(cc.length >= 1);
  cc.forEach(f => assert.equal(f.status, "cancelled"));
});

test("a scheduled match's 0-0 is not read as a score by either adapter", () => {
  const wr = load("rugby-worldrugby-matches.json").content;
  wr.filter(m => m.status === "U").map(m => fromWrMatch(m)).filter(Boolean)
    .forEach(f => assert.equal(f.score, null, f.home.name + " v " + f.away.name));
  load("rugby-espn-nations-championship.json").events
    .map(e => fromEspnEvent(e, "RUNC"))
    .filter(f => f.status === "scheduled")
    .forEach(f => assert.equal(f.score, null));
});
