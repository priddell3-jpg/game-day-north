import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkRanges, CHECK } from "../scripts/check-range.mjs";

/* The night of 2026-09-15: every ranged request answered HTTP 400 and
   the nightly check said "could not be checked" and exited 0. This file
   exists so that cannot happen again. */
const REFUSED = JSON.parse(readFileSync(new URL("./fixtures/espn-scoreboard-range-400.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-09-16T06:10:00Z");
const isRanged = url => /dates=\d{8}-\d{8}/.test(url);

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" } });

function quiet(){
  const lines = { log: [], warn: [], error: [] };
  return { lines, log: { log: m => lines.log.push(m), warn: m => lines.warn.push(m), error: m => lines.error.push(m) } };
}

/* A fetch that answers the range one way and each day another. */
const fetchWith = ({ ranged, day }) => async url => isRanged(url) ? ranged(url) : day(url);

test("the saved 400 is the real answer, and a ranged request that errors fails the check", async () => {
  assert.equal(REFUSED.status, 400);
  assert.equal(REFUSED.body.message, "Failed to get events endpoint.");
  assert.match(REFUSED.request.url, /dates=\d{8}-\d{8}/, "the refused request was the ranged form");

  const { lines, log } = quiet();
  const r = await checkRanges({ now: NOW, log, fetchImpl: fetchWith({
    ranged: () => json(REFUSED.body, REFUSED.status),
    day: () => json({ events: [{ id: 1 }, { id: 2 }] })
  }) });
  assert.equal(r.code, 1, "an HTTP error on the ranged request is the failure this check exists to detect");
  assert.equal(r.rangedErrors, Object.keys(CHECK).length);
  assert.equal(r.failed, Object.keys(CHECK).length);
  assert.ok(lines.error.some(m => /HTTP 400/.test(m)), "and the status is named in the output");
  assert.ok(lines.error.some(m => /fallen back to one request per day/.test(m)),
    "the output says what the build will have done about it");
});

test("nothing to compare is not a pass when the reason is that the ranges errored", async () => {
  /* Out of season everywhere AND the range refused. The old script
     read this as "nothing could be compared" and exited 0. */
  const { log } = quiet();
  const r = await checkRanges({ now: NOW, log, fetchImpl: fetchWith({
    ranged: () => json(REFUSED.body, REFUSED.status),
    day: () => json({ events: [] })
  }) });
  assert.equal(r.checked, 0);
  assert.equal(r.code, 1);
  assert.equal(r.rangedErrors, Object.keys(CHECK).length);
});

test("a range that throws rather than answering is the same failure", async () => {
  const { log } = quiet();
  const r = await checkRanges({ now: NOW, log, fetchImpl: fetchWith({
    ranged: () => { throw new Error("fetch failed"); },
    day: () => json({ events: [{ id: 1 }] })
  }) });
  assert.equal(r.code, 1);
  assert.equal(r.rangedErrors, Object.keys(CHECK).length);
});

test("nothing to compare because every league is out of season still exits 0", async () => {
  const { lines, log } = quiet();
  const r = await checkRanges({ now: NOW, log, fetchImpl: fetchWith({
    ranged: () => json({ events: [] }),
    day: () => json({ events: [] })
  }) });
  assert.equal(r.code, 0);
  assert.equal(r.checked, 0);
  assert.equal(r.rangedErrors, 0);
  assert.deepEqual(r.empty, Object.keys(CHECK));
  assert.ok(lines.warn.some(m => /Nothing could be compared/.test(m)));
});

test("a range that answers and covers its days passes", async () => {
  const { lines, log } = quiet();
  const r = await checkRanges({ now: NOW, log, fetchImpl: fetchWith({
    ranged: () => json({ events: [{ id: 1 }, { id: 2 }, { id: 3 }] }),
    day: url => json({ events: [{ id: Number(url.slice(-14, -11)) % 3 + 1 }] })
  }) });
  assert.equal(r.code, 0);
  assert.equal(r.failed, 0);
  assert.equal(r.checked, Object.keys(CHECK).length);
  assert.ok(lines.log.some(m => /Ranges still cover their whole span/.test(m)));
});

test("a range that answers but drops days is the original failure", async () => {
  const { lines, log } = quiet();
  const r = await checkRanges({ now: NOW, log, fetchImpl: fetchWith({
    ranged: () => json({ events: [{ id: 1 }] }),
    day: () => json({ events: [{ id: 1 }, { id: 2 }] })
  }) });
  assert.equal(r.code, 1);
  assert.equal(r.rangedErrors, 0, "the range answered — this is truncation, not refusal");
  assert.ok(lines.error.some(m => /returned 1 of 2 events/.test(m)));
});

test("a single-day request failing is 'could not be checked', not a verdict either way", async () => {
  /* The days are the reference, not the thing under test. If the
     reference cannot be read the league is skipped — and with the range
     answering, that skip leaves nothing compared and exits 0. */
  const { lines, log } = quiet();
  const r = await checkRanges({ now: NOW, log, fetchImpl: fetchWith({
    ranged: () => json({ events: [{ id: 1 }] }),
    day: () => json({ code: 500 }, 500)
  }) });
  assert.equal(r.code, 0);
  assert.equal(r.failed, 0);
  assert.ok(lines.warn.some(m => /could not be checked/.test(m)));
});

test("the check asks yesterday and the two days before, never today", async () => {
  const asked = [];
  const { log } = quiet();
  await checkRanges({ now: NOW, log, fetchImpl: async url => { asked.push(url); return json({ events: [] }); } });
  const days = asked.filter(u => !isRanged(u)).map(u => /dates=(\d{8})/.exec(u)[1]);
  assert.deepEqual([...new Set(days)], ["20260913", "20260914", "20260915"]);
  const ranged = asked.filter(isRanged).map(u => /dates=(\d{8}-\d{8})/.exec(u)[1]);
  assert.deepEqual([...new Set(ranged)], ["20260913-20260915"]);
  assert.equal(asked.length, Object.keys(CHECK).length * 4, "eight small requests, as promised — four leagues, four each");
});

test("importing the script makes no request", () => {
  /* The module was imported at the top of this file. Had its top level
     run, it would have made eight live requests before any test began;
     the guard on process.argv keeps that to an explicit invocation. */
  const src = readFileSync(new URL("../scripts/check-range.mjs", import.meta.url), "utf8");
  assert.match(src, /import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/);
});
