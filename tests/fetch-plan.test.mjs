import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_LIMIT, SAFE_PER_REQUEST, EXPECTED_PER_DAY, chunkDaysFor, planRanges, splitRange, dateKey,
  FLOOR_MIN, FLOOR_FRACTION, compFloorProblems, describeFloor
} from "../scripts/lib/fetch-plan.mjs";

const DAY = 86400000;
const BUILD = readFileSync(new URL("../scripts/fetch-data.mjs", import.meta.url), "utf8");
const at = iso => Date.parse(iso);

/* ============ asking for a window without being truncated ============ */

test("nothing may ask for more than the ceiling", () => {
  assert.equal(MAX_LIMIT, 1000, "honoured to exactly 1000, and 25 above it");
  const limits = [...BUILD.matchAll(/limit=(\d+)/g)].map(m => Number(m[1]));
  const literal = [...BUILD.matchAll(/"&limit=" \+ (\w+)/g)].map(m => m[1]);
  for(const n of limits) assert.ok(n <= MAX_LIMIT, "the build asks for limit=" + n);
  assert.ok(literal.every(name => name === "MAX_LIMIT"),
    "the scoreboard limit is the named ceiling, not a number someone can raise by hand");
});

test("a competition is chunked according to how much it puts on", () => {
  /* Baseball at 13 events a day league-wide overflows an 84-day window;
     hockey mid-season at about 7 does not. */
  assert.ok(chunkDaysFor("MLB") < 84, "baseball must be split");
  assert.ok(chunkDaysFor("NHL") >= 84, "hockey fits in one request");
  assert.ok(chunkDaysFor("EPL") >= 84);
  for(const [comp, per] of Object.entries(EXPECTED_PER_DAY))
    assert.ok(chunkDaysFor(comp) * per <= SAFE_PER_REQUEST, comp + " plans past its own budget");
  assert.ok(chunkDaysFor("NOT_A_LEAGUE") > 0, "an unknown competition still gets a plan");
});

test("the planned chunks cover the window exactly once", () => {
  const from = at("2026-09-01T00:00:00Z"), to = from + 83*DAY;
  for(const comp of ["MLB", "NHL", "EPL"]){
    const ranges = planRanges(comp, from, to);
    assert.ok(ranges.length >= 1);
    assert.equal(ranges[0][0], dateKey(from), comp + " starts at the window");
    assert.equal(ranges[ranges.length - 1][1], dateKey(to), comp + " ends at the window");
    for(let i = 1; i < ranges.length; i++)
      assert.equal(ranges[i][2], ranges[i - 1][3] + DAY, comp + " has a gap or an overlap");
  }
  assert.equal(planRanges("MLB", from, to).length, 2, "84 days of baseball is two requests");
  assert.equal(planRanges("NHL", from, to).length, 1);
});

test("a full response is halved rather than believed, down to a single day", () => {
  const from = at("2026-09-01T00:00:00Z"), to = from + 9*DAY;
  const [a, b] = splitRange(from, to);
  assert.equal(a[0], from);
  assert.equal(b[1], to);
  assert.equal(a[1] + DAY, b[0], "the halves meet without a gap");
  /* Down and down until there is nothing left to divide, which is the
     point at which a full page can only mean a truncated answer. */
  assert.deepEqual(splitRange(from, from), null);
  let span = [from, to], steps = 0;
  while(splitRange(span[0], span[1])){ span = splitRange(span[0], span[1])[0]; steps++; }
  assert.ok(steps > 0 && steps < 10, "splitting terminates");
});

test("the build treats a response at the ceiling as untrustworthy", () => {
  assert.match(BUILD, /events\.length >= MAX_LIMIT/,
    "a full page and a truncated page are indistinguishable");
  assert.match(BUILD, /cannot be trusted/, "and a single day at the ceiling throws");
  assert.match(BUILD, /splitting rather than trusting a full page/);
});

/* ============ refusing to publish a competition that vanished ============ */

test("a competition that disappears stops the build", () => {
  /* The case the global guard cannot see: hockey is 35% of the file, so
     losing all of it leaves 65% behind and passes a 50% floor. */
  const before = { NHL: 236, MLB: 138, MLS: 67, NFL: 66, EPL: 54, UCL: 32 };
  const after = { MLB: 138, MLS: 67, NFL: 66, EPL: 54, UCL: 32 };
  const kept = Object.values(after).reduce((a, b) => a + b, 0);
  const was = Object.values(before).reduce((a, b) => a + b, 0);
  assert.ok(kept > was * 0.5, "the old guard would have let this through");

  const problems = compFloorProblems(before, after);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].comp, "NHL");
  assert.equal(problems[0].why, "vanished");
  assert.match(describeFloor(problems), /NHL: 236 fixtures last run, 0 now/);
});

test("a competition that collapses without vanishing also stops it", () => {
  const problems = compFloorProblems({ MLB: 138 }, { MLB: 40 });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].why, "collapsed");
  assert.equal(compFloorProblems({ MLB: 138 }, { MLB: 130 }).length, 0, "a normal run is not a collapse");
});

test("a season ending is not an outage", () => {
  /* Fixtures leave the window a few at a time as a season runs out. The
     threshold has to tolerate that and still catch a cliff. */
  let count = 200;
  for(let run = 0; run < 40; run++){
    const next = Math.max(0, count - Math.ceil(count * 0.05));
    assert.deepEqual(compFloorProblems({ MLB: count }, { MLB: next }), [],
      "a 5% decline at " + count + " read as an outage");
    count = next;
    if(count < FLOOR_MIN) break;
  }
  /* And a competition too small to judge is left alone entirely: a cup
     between rounds legitimately empties. */
  assert.deepEqual(compFloorProblems({ FAC: 6 }, {}), []);
  assert.deepEqual(compFloorProblems({ FAC: FLOOR_MIN - 1 }, { FAC: 0 }), []);
  assert.equal(compFloorProblems({ FAC: FLOOR_MIN }, { FAC: 0 }).length, 1);
});

test("with nothing to compare against, nothing is blocked", () => {
  assert.deepEqual(compFloorProblems(null, { NHL: 236 }), [], "a first run has no previous file");
  assert.deepEqual(compFloorProblems(undefined, undefined), []);
  assert.deepEqual(compFloorProblems({}, {}), []);
  /* A competition appearing for the first time is not a problem either. */
  assert.deepEqual(compFloorProblems({ NHL: 236 }, { NHL: 236, NBA: 104 }), []);
});

test("the worst offenders are reported first", () => {
  const problems = compFloorProblems({ NHL: 236, EPL: 54, MLB: 138 }, {});
  assert.deepEqual(problems.map(p => p.comp), ["NHL", "MLB", "EPL"]);
  assert.ok(FLOOR_FRACTION > 0 && FLOOR_FRACTION < 1);
});

test("the build actually consults the floor before it writes", () => {
  const guard = BUILD.indexOf("compFloorProblems(");
  const write = BUILD.indexOf("writeFileSync(new URL(\"../data.json\"");
  assert.ok(guard > 0 && write > guard, "the guard has to run before the file is replaced");
  assert.match(BUILD, /previous\.counts\.byComp/, "and it reads what the previous run recorded");
});

/* ============ the loops this replaced ============ */

test("the per-team schedule loop is gone", () => {
  assert.ok(!/teams\/" \+ meta\.espn \+ "\/schedule/.test(BUILD),
    "one request per followed team is the cost this change exists to remove");
  assert.ok(!/const nearDays/.test(BUILD), "the near-window per-day scoreboards go with it");
  assert.match(BUILD, /scoreboardRange\(comp, PATHS\[comp\]/);
});

test("preseason is dropped on purpose, and says why", () => {
  /* The ranged scoreboard returns it where the per-team schedules did
     not. Keeping it would hand exhibition games the regular season's
     carriage rules, which is a claim nothing sourced. */
  assert.match(BUILD, /slug === "preseason"/);
  assert.match(BUILD, /carriage claim nothing sourced/);
});

test("the summary cap is sized for the roster it will meet", () => {
  const m = /const SUMMARY_CAP = (\d+);/.exec(BUILD);
  assert.ok(m, "SUMMARY_CAP must exist");
  assert.ok(Number(m[1]) >= 100, "measured peak is 25 starts in a build window, plus stragglers");
  assert.match(BUILD, /summaryCapped/, "and the shortfall is recorded in the file, not only warned");
});
