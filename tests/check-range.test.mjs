import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkRanges, CHECK } from "../scripts/check-range.mjs";

/* What the nightly range check may and may not say.

   The night of 2026-09-15 every ranged request answered HTTP 400 and
   the check said "could not be checked" and exited 0 — the failure it
   existed to see, reported as a pass. Since then the build falls back to
   one request per day on its own, so a refused range has become a
   handled condition rather than an incident. The check must now say so
   plainly, exit 0 for it, and keep exit 1 for the one dangerous case:
   a range that answers but covers fewer events than the days inside it. */
const REFUSED = JSON.parse(readFileSync(new URL("./fixtures/espn-scoreboard-range-400.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-09-16T06:10:00Z");
const LEAGUES = Object.keys(CHECK);
const isRanged = url => /dates=\d{8}-\d{8}/.test(url);

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" } });

function quiet(){
  const lines = { log: [], warn: [], error: [] };
  return { lines, log: { log: m => lines.log.push(m), warn: m => lines.warn.push(m), error: m => lines.error.push(m) } };
}

/* A fetch that answers the range one way and each day another. */
const fetchWith = ({ ranged, day }) => async url => isRanged(url) ? ranged(url) : day(url);

test("the saved 400 is the real refusal", () => {
  assert.equal(REFUSED.status, 400);
  assert.equal(REFUSED.body.message, "Failed to get events endpoint.");
  assert.match(REFUSED.request.url, /dates=\d{8}-\d{8}/, "the refused request was the ranged form");
});

test("a refused range is handled, said plainly, and exits 0", async () => {
  const { lines, log } = quiet();
  const r = await checkRanges({ now: NOW, log, fetchImpl: fetchWith({
    ranged: () => json(REFUSED.body, REFUSED.status),
    day: () => json({ events: [{ id: 1 }, { id: 2 }] })
  }) });
  assert.equal(r.code, 0, "the build falls back to one request per day on its own — this is not an incident");
  assert.deepEqual(r.refused, LEAGUES);
  assert.equal(r.failed, 0);
  assert.ok(lines.log.some(m => /ranges refused — build is on the per-day plan/.test(m)),
    "and the log says exactly what the build is doing about it");
  assert.ok(lines.log.some(m => /HTTP 400/.test(m)), "naming the status");
  assert.equal(lines.error.length, 0, "nothing is reported as an error");
});

test("refused and out of season together is still a handled 0, and still says refused", async () => {
  /* Every day empty AND the range refused. The old script read this as
     "nothing could be compared" and said nothing about the refusal. */
  const { lines, log } = quiet();
  const r = await checkRanges({ now: NOW, log, fetchImpl: fetchWith({
    ranged: () => json(REFUSED.body, REFUSED.status),
    day: () => json({ events: [] })
  }) });
  assert.equal(r.code, 0);
  assert.equal(r.checked, 0);
  assert.deepEqual(r.refused, LEAGUES);
  assert.ok(lines.log.some(m => /ranges refused/.test(m)), "handled is fine; silent is not");
});

test("a range that answers but drops days is the dangerous case, and the only exit 1", async () => {
  const { lines, log } = quiet();
  const r = await checkRanges({ now: NOW, log, fetchImpl: fetchWith({
    ranged: () => json({ events: [{ id: 1 }] }),
    day: () => json({ events: [{ id: 1 }, { id: 2 }] })
  }) });
  assert.equal(r.code, 1);
  assert.deepEqual(r.refused, [], "the range answered — this is truncation, not refusal");
  assert.ok(lines.error.some(m => /returned 1 of 2 events/.test(m)));
  assert.ok(lines.error.some(m => /silently/.test(m)));
});

test("truncation on one league still fails the run when another league was merely refused", async () => {
  const { log } = quiet();
  const r = await checkRanges({ now: NOW, log, fetchImpl: fetchWith({
    ranged: url => /hockey/.test(url) ? json(REFUSED.body, 400) : json({ events: [{ id: 1 }] }),
    day: () => json({ events: [{ id: 1 }, { id: 2 }] })
  }) });
  assert.equal(r.code, 1);
  assert.deepEqual(r.refused, ["NHL"]);
  assert.equal(r.failed, LEAGUES.length - 1);
});

test("a range that answers and covers its days passes", async () => {
  const { lines, log } = quiet();
  const r = await checkRanges({ now: NOW, log, fetchImpl: fetchWith({
    ranged: () => json({ events: [{ id: 1 }, { id: 2 }, { id: 3 }] }),
    day: url => json({ events: [{ id: Number(url.slice(-14, -11)) % 3 + 1 }] })
  }) });
  assert.equal(r.code, 0);
  assert.equal(r.failed, 0);
  assert.equal(r.checked, LEAGUES.length);
  assert.ok(lines.log.some(m => /Ranges still cover their whole span/.test(m)));
});

test("nothing to compare because every league is out of season is a plain log line and exit 0", async () => {
  const { lines, log } = quiet();
  const r = await checkRanges({ now: NOW, log, fetchImpl: fetchWith({
    ranged: () => json({ events: [] }),
    day: () => json({ events: [] })
  }) });
  assert.equal(r.code, 0);
  assert.equal(r.checked, 0);
  assert.deepEqual(r.refused, []);
  assert.deepEqual(r.empty, LEAGUES);
  assert.ok(lines.log.some(m => /Nothing to compare/.test(m)));
  assert.equal(lines.warn.length + lines.error.length, 0, "a plain line, not a warning");
});

test("a range that errors some other way is 'could not be checked', not a verdict", async () => {
  /* A 5xx or a dropped connection says nothing about whether the range
     truncates or is refused. Skipped, warned, exit 0. */
  const { lines, log } = quiet();
  const r = await checkRanges({ now: NOW, log, fetchImpl: fetchWith({
    ranged: () => json({ code: 503 }, 503),
    day: () => json({ events: [{ id: 1 }] })
  }) });
  assert.equal(r.code, 0);
  assert.equal(r.errors, LEAGUES.length);
  assert.deepEqual(r.refused, [], "a 503 is not a refusal");
  assert.ok(lines.warn.some(m => /could not be checked/.test(m)));
});

test("a single-day request failing is 'could not be checked' too", async () => {
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
  assert.equal(asked.length, LEAGUES.length * 4, "eight small requests, as promised — four leagues, four each");
});

test("importing the script makes no request", () => {
  const src = readFileSync(new URL("../scripts/check-range.mjs", import.meta.url), "utf8");
  assert.match(src, /import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/);
});
