import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromBuild } from "./helpers/build.mjs";
import { MAX_LIMIT, planRanges, planDays, splitRange, dateKey, isCarriedSeason } from "../scripts/lib/fetch-plan.mjs";

/* Known answers for the plan the build takes when ESPN refuses a range.

   Every response here is a real one, saved on 2026-09-16: the 400 the
   ranged form answered with, and the single days that answered 200 at
   the same moment. The build's own scoreboardRange() and get() are
   evaluated out of scripts/fetch-data.mjs — the code that ships — with
   fetch replaced by a function that serves those files. */
const fixture = name => JSON.parse(readFileSync(new URL("./fixtures/" + name + ".json", import.meta.url), "utf8"));
const REFUSED = fixture("espn-scoreboard-range-400");
const DAYS = {
  "hockey/nhl": {
    20261007: fixture("scoreboard-nhl-20261007"),
    20261008: fixture("scoreboard-nhl-20261008"),
    20261009: fixture("scoreboard-nhl-20261009"),
    20260921: fixture("scoreboard-nhl-20260921-preseason"),
    20260916: fixture("scoreboard-nhl-20260916-empty")
  },
  "soccer/eng.1": {
    20260920: fixture("scoreboard-epl-20260920"),
    20260921: fixture("scoreboard-epl-20260921-empty")
  }
};
const idsOf = j => (j.events || []).map(e => String(e.id));
const DAY = 86400000;
const at = key => Date.parse(key.slice(0, 4) + "-" + key.slice(4, 6) + "-" + key.slice(6, 8) + "T12:00:00Z");

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" } });

/* Serve the saved files. A ranged URL gets the saved 400 unless told
   otherwise; a day URL gets its saved file, and a day nobody saved is a
   test bug, not an empty day. */
function serve(overrides = {}){
  const asked = [];
  const impl = async url => {
    asked.push(url);
    const m = /sports\/([a-z]+\/[a-z0-9.]+)\/scoreboard\?dates=(\d{8})(?:-(\d{8}))?&limit=(\d+)/.exec(url);
    assert.ok(m, "an unexpected URL was asked for: " + url);
    assert.equal(Number(m[4]), MAX_LIMIT, "every request asks for the named ceiling");
    const [, path, from, to] = m;
    if(overrides.ranged && to) return overrides.ranged(path, from, to);
    if(to) return json(REFUSED.body, REFUSED.status);
    if(overrides.day) { const r = overrides.day(path, from); if(r) return r; }
    const day = (DAYS[path] || {})[from];
    assert.ok(day, "no saved response for " + path + " " + from);
    return json(day);
  };
  return { asked, impl };
}

function build(){
  return loadFromBuild(["scoreboardRange", "get", "FAILED", "REJECTED", "planByComp", "PATHS"],
    { MAX_LIMIT, planRanges, planDays, splitRange, dateKey, isCarriedSeason });
}

async function withFetch(impl, fn){
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try{ return await fn(); } finally{ globalThis.fetch = real; }
}

test("the saved 400 is the real refusal, and it is exactly what the fallback keys on", () => {
  assert.equal(REFUSED.status, 400);
  assert.deepEqual(REFUSED.body, { code: 400, message: "Failed to get events endpoint." });
  assert.match(REFUSED.request.url, /dates=\d{8}-\d{8}&limit=1000$/);
});

test("a refused range is asked for one day at a time, and every saved event arrives once", async () => {
  const { asked, impl } = serve();
  const b = build();
  const out = [];
  const from = at("20261007"), to = at("20261009");
  const asks = await withFetch(impl, () => b.scoreboardRange("NHL", b.PATHS.NHL, from, to, f => out.push(f)));

  /* One ranged attempt, then three days, in order. */
  assert.equal(asks, 4);
  assert.deepEqual(asked.map(u => /dates=([\d-]+)/.exec(u)[1]),
    ["20261007-20261009", "20261007", "20261008", "20261009"]);
  assert.equal(b.planByComp.NHL, "per-day");

  /* The known answer: every event id the three saved days carry, each
     once, all parsed as NHL fixtures with no score yet. */
  const expected = ["20261007", "20261008", "20261009"].flatMap(k => idsOf(DAYS["hockey/nhl"][k]));
  assert.equal(expected.length, 17);
  assert.deepEqual(out.map(f => f.eid), expected);
  assert.ok(out.every(f => f && f.comp === "NHL" && f.status === "scheduled" && f.score === null));
  assert.ok(out.every(f => f.home.name && f.away.name), "both clubs named");
  /* Opening night is Canadian: the saved day carries followed clubs. */
  assert.ok(out.some(f => f.home.id || f.away.id), "at least one fixture involves a followed club");
});

test("a refused range on soccer falls back the same way — the refusal is not confined to the NA leagues", async () => {
  const { asked, impl } = serve();
  const b = build();
  const out = [];
  const asks = await withFetch(impl, () => b.scoreboardRange("EPL", b.PATHS.EPL, at("20260920"), at("20260921"), f => out.push(f)));
  assert.equal(asks, 3);
  assert.equal(b.planByComp.EPL, "per-day");
  assert.deepEqual(out.map(f => f.eid), idsOf(DAYS["soccer/eng.1"][20260920]));
  assert.equal(out.length, 4);
  assert.ok(asked[2].includes("dates=20260921&"), "the empty day is still asked for — it is part of the window");
});

test("the per-day plan applies the same preseason filter the ranged plan did", async () => {
  const { impl } = serve();
  const b = build();
  const out = [];
  const asks = await withFetch(impl, () => b.scoreboardRange("NHL", b.PATHS.NHL, at("20260921"), at("20260921"), f => out.push(f)));
  assert.equal(asks, 2, "one refusal, one day");
  assert.equal(idsOf(DAYS["hockey/nhl"][20260921]).length, 8, "the saved day holds eight exhibition games");
  assert.deepEqual(out, [], "and none of them reaches the board");
});

test("an empty day is asked and answers nothing, and the plan is still recorded", async () => {
  const { impl } = serve();
  const b = build();
  const out = [];
  await withFetch(impl, () => b.scoreboardRange("NHL", b.PATHS.NHL, at("20260916"), at("20260916"), f => out.push(f)));
  assert.deepEqual(out, []);
  assert.equal(b.planByComp.NHL, "per-day");
});

test("a range that is accepted is used as before — one request, no days", async () => {
  const { asked, impl } = serve({ ranged: () => json(DAYS["hockey/nhl"][20261008]) });
  const b = build();
  const out = [];
  const asks = await withFetch(impl, () => b.scoreboardRange("NHL", b.PATHS.NHL, at("20261007"), at("20261009"), f => out.push(f)));
  assert.equal(asks, 1);
  assert.equal(asked.length, 1);
  assert.equal(b.planByComp.NHL, "ranged");
  assert.deepEqual(out.map(f => f.eid), idsOf(DAYS["hockey/nhl"][20261008]));
});

test("the per-day plan covers exactly the days the ranged plan would have", () => {
  const from = at("20260908"), to = from + 83 * DAY;
  const days = planDays(from, to);
  assert.equal(days.length, 84, "eight back and seventy-five forward is eighty-four days inclusive");
  assert.equal(days[0][0], "20260908");
  assert.equal(days[83][0], dateKey(to));
  for(let i = 1; i < days.length; i++) assert.equal(days[i][1], days[i - 1][1] + DAY, "contiguous");
  /* Every chunk the ranged plan makes is a run of these same keys. */
  for(const comp of ["MLB", "NHL", "EPL"]){
    const covered = planRanges(comp, from, to).flatMap(([, , a, b]) => planDays(a, b).map(d => d[0]));
    assert.deepEqual(covered, days.map(d => d[0]), comp + " chunks and days name the same dates");
  }
  assert.deepEqual(planDays(from, from).map(d => d[0]), ["20260908"], "a one-day window is one day");
});

test("a day that cannot be fetched is fatal, exactly as a refused-and-failed range would be", async () => {
  const { impl } = serve({ day: (path, from) => from === "20261008" ? json({ code: 500 }, 500) : null });
  const b = build();
  await assert.rejects(
    withFetch(impl, () => b.scoreboardRange("NHL", b.PATHS.NHL, at("20261007"), at("20261009"), () => {})),
    err => /NHL 20261008 could not be fetched/.test(err.message) && /part of NHL missing/.test(err.message));
});

test("a single day at the ceiling is not believed", async () => {
  const full = { events: Array.from({ length: MAX_LIMIT }, (_, i) => ({ id: i })) };
  const { impl } = serve({ day: () => json(full) });
  const b = build();
  await assert.rejects(
    withFetch(impl, () => b.scoreboardRange("NHL", b.PATHS.NHL, at("20261008"), at("20261008"), () => {})),
    /at the request ceiling/);
});

test("only a caller that asks for it sees a refusal; everyone else sees a failure, as before", async () => {
  /* The summary top-up, standings, tennis and rugby all call get()
     without the option. A 400 there must go on meaning "failed" — after
     the retry — so their sentinel handling is untouched. */
  let n = 0;
  const impl = async () => { n++; return json(REFUSED.body, 400); };
  const b = build();
  const plain = await withFetch(impl, () => b.get("https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=1"));
  assert.equal(plain, b.FAILED);
  assert.equal(n, 2, "retried once, like any other failure");
  n = 0;
  const opted = await withFetch(impl, () => b.get("https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=1-2&limit=1000", { rejectable: true }));
  assert.equal(opted, b.REJECTED);
  assert.equal(n, 1, "a refused form is not retried — the same question gets the same answer");
});

test("the build records the plan in the file it writes and logs it per competition", () => {
  const BUILD = readFileSync(new URL("../scripts/fetch-data.mjs", import.meta.url), "utf8");
  assert.match(BUILD, /planByComp, rangedRefused: rejected,/, "counts.planByComp says which form each competition got");
  assert.match(BUILD, /planByComp\[comp\] = !dayRequests \? "ranged"/);
  assert.match(BUILD, /refused as a range \(HTTP 400\)/, "the run log names the refusal");
  assert.match(BUILD, /const r = await get\(url, \{ rejectable: true \}\);/, "only the ranged request opts in");
  assert.equal((BUILD.match(/rejectable: true/g) || []).length, 1);
});
