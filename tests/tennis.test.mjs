import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseScoreboard, parseCompetition, normalizeTennis, assembleMatches,
  keepMatch, forPlayers, statusOf, playerDirectory,
  DAY, KEEP_COMPLETED_DAYS, HORIZON_DAYS, SINGLES_GROUPINGS, SETTLED
} from "../scripts/lib/tennis.mjs";

/* The fixtures are real ESPN tennis payloads cut down to a handful of
   tournaments; every competition in them is byte-for-byte what the
   scoreboard served on 2026-08-24. Tennis is nested three deep —
   tournament, then grouping, then the competitions that are the actual
   matches — and a Grand Slam is published in full under both tours, so
   these exercise the shape rather than a tidied idea of it. */

const fx = n => JSON.parse(readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8"));
const ATP = fx("tennis-atp-scoreboard.json");
const WTA = fx("tennis-wta-scoreboard.json");
const RARE = fx("tennis-rare-states.json");

const atpM = parseScoreboard(ATP);
const wtaM = parseScoreboard(WTA);
const byId = (ms, id) => ms.find(m => m.id === id);

/* ---------------- nested parsing ---------------- */

test("matches are found three levels down, inside groupings", () => {
  assert.ok(atpM.length > 0, "nothing parsed out of the ATP fixture");
  assert.ok(wtaM.length > 0, "nothing parsed out of the WTA fixture");
  // every match names its tournament and round, which only exist at the levels above it
  for(const m of atpM){
    assert.ok(m.tournament, "a match came back without its tournament");
    assert.ok(m.tid, "a match came back without a tournament id");
  }
});

test("more than one tournament comes out of a single payload", () => {
  assert.deepEqual([...new Set(atpM.map(m => m.tournament))].sort(),
    ["US Open", "Winston-Salem Open"]);
});

test("a tournament's own fields land on each of its matches", () => {
  const us = atpM.filter(m => m.tid === "189-2026");
  assert.ok(us.length);
  for(const m of us){
    assert.equal(m.tournament, "US Open");
    assert.equal(m.major, true, "a Grand Slam should be flagged as one");
  }
  const ws = atpM.filter(m => m.tid === "363-2026");
  assert.equal(ws[0].major, false);
});

/* ---------------- singles only ---------------- */

test("only the two singles groupings are read", () => {
  assert.deepEqual(SINGLES_GROUPINGS, {"1": "ATP", "2": "WTA"});
});

test("men's singles is ATP and women's singles is WTA", () => {
  const tours = new Set(atpM.concat(wtaM).map(m => m.tour));
  assert.deepEqual([...tours].sort(), ["ATP", "WTA"]);
  // the US Open's women's draw is in the ATP feed; it is still WTA
  const usWomen = atpM.filter(m => m.tid === "189-2026" && m.tour === "WTA");
  assert.ok(usWomen.length, "the women's draw inside the ATP feed was missed");
});

test("doubles never becomes a match", () => {
  const dbl = [];
  for(const p of [ATP, WTA]){
    for(const e of p.events){
      for(const g of e.groupings){
        if(/doubles/.test(g.grouping.slug)) dbl.push(...g.competitions.map(c => String(c.id)));
      }
    }
  }
  assert.ok(dbl.length >= 3, "the fixtures must contain doubles for this to prove anything");
  const parsedIds = new Set(atpM.concat(wtaM).map(m => m.id));
  for(const id of dbl) assert.equal(parsedIds.has(id), false, "doubles match " + id + " was parsed");
});

test("mixed doubles is excluded too", () => {
  const mixed = ATP.events.flatMap(e => e.groupings.filter(g => g.grouping.slug === "mixed-doubles"));
  assert.ok(mixed.length, "the fixture must contain a mixed doubles grouping");
  const ids = new Set(mixed.flatMap(g => g.competitions.map(c => String(c.id))));
  for(const m of atpM) assert.equal(ids.has(m.id), false);
});

test("a pair is refused even if a doubles competition reaches the parser directly", () => {
  const dbl = ATP.events.flatMap(e => e.groupings)
    .find(g => g.grouping.slug === "mens-doubles").competitions[0];
  assert.equal(dbl.competitors[0].type, "team", "fixture no longer matches ESPN's doubles shape");
  assert.equal(parseCompetition(dbl, {tour: "ATP"}), null);
});

/* ---------------- identity ---------------- */

test("a match is identified by ESPN's competition id, not by who is playing", () => {
  for(const m of atpM) assert.match(m.id, /^\d+$/);
});

test("players are identified by stable athlete id", () => {
  for(const m of atpM.concat(wtaM)){
    assert.equal(m.players.length, 2);
    for(const p of m.players){
      if(p.tbd){ assert.equal(p.id, null); continue; }
      assert.match(p.id, /^\d+$/, "player id should be ESPN's athlete id");
      assert.ok(p.name, "a player should still carry a name for display");
    }
  }
});

/* --- unfilled draw slots --- */

test("an unplayed slot in a draw is a placeholder, never a person", () => {
  // ESPN publishes an unqualified slot as a competitor with a negative id
  const slots = atpM.flatMap(m => m.players).filter(p => p.tbd);
  assert.ok(slots.length, "the fixtures must contain a TBD slot for this to prove anything");
  for(const p of slots){
    assert.equal(p.id, null, "a placeholder must not carry a followable id");
    assert.equal(p.name, "TBD");
  }
});

test("a match with nobody in it at all is not a match", () => {
  const raw = ATP.events.flatMap(e => e.groupings).flatMap(g => g.competitions)
    .find(c => (c.competitors || []).every(x => String(x.id).startsWith("-")));
  assert.ok(raw, "the fixtures must contain a TBD-vs-TBD line");
  assert.equal(parseCompetition(raw, {tour: "ATP"}), null);
});

test("a placeholder can never be followed", () => {
  const out = assembleMatches([atpM, wtaM], {now: Date.parse("2026-08-24T20:00:00Z"),
    players: ["-3", "-4", "0"]});
  assert.deepEqual(out.matches, []);
});

test("a competitor with no usable id becomes a placeholder, never a followable player", () => {
  const real = ATP.events[0].groupings[0].competitions[0];
  const broken = JSON.parse(JSON.stringify(real));
  delete broken.competitors[0].id;
  const m = parseCompetition(broken, {tour: "ATP"});
  assert.ok(m, "the other player is still real, so the match still exists");
  assert.equal(m.players.filter(p => p.id === null).length, 1);
  assert.equal(forPlayers([m], ["null", "undefined", ""]).length, 0);
});

test("country comes off the flag, as a code", () => {
  const all = atpM.concat(wtaM).flatMap(m => m.players);
  const withCountry = all.filter(p => p.country);
  assert.ok(withCountry.length, "no player picked up a country");
  for(const p of withCountry) assert.match(p.country, /^[A-Z]{2,3}$/);
});

/* ---------------- ATP / WTA overlap ---------------- */

test("the same Grand Slam match in both feeds is one match", () => {
  const inBoth = atpM.filter(a => wtaM.some(w => w.id === a.id));
  assert.ok(inBoth.length >= 2, "the fixtures must overlap for this to prove anything");

  const merged = assembleMatches([atpM, wtaM], {now: Date.parse("2026-08-24T20:00:00Z")});
  const ids = merged.matches.map(m => m.id);
  assert.equal(ids.length, new Set(ids).size, "a duplicate survived the merge");
  assert.ok(merged.counts.parsed > merged.counts.deduped, "nothing was actually deduplicated");
});

test("deduplication counts the overlap it removed", () => {
  const merged = assembleMatches([atpM, wtaM], {now: Date.parse("2026-08-24T20:00:00Z")});
  assert.equal(merged.counts.parsed, atpM.length + wtaM.length);
  assert.equal(merged.counts.deduped, new Set(atpM.concat(wtaM).map(m => m.id)).size);
});

test("two different matches are never collapsed", () => {
  const merged = assembleMatches([atpM, wtaM], {now: Date.parse("2026-08-24T20:00:00Z")});
  const seen = new Map();
  for(const m of merged.matches){
    const key = m.players.map(p => p.id).sort().join("|") + "@" + m.start;
    assert.equal(seen.has(key), false, "two matches share players and a start: " + key);
    seen.set(key, m.id);
  }
});

/* ---------------- set scores ---------------- */

test("sets are pairs in the players' own order", () => {
  const live = atpM.concat(wtaM).find(m => m.status === "live" && m.sets.length);
  assert.ok(live, "no live match in the fixtures");
  for(const s of live.sets){
    assert.equal(s.length, 2);
    for(const v of s) assert.ok(v === null || Number.isInteger(v));
  }
});

test("set scores are not flattened into one team-style scoreline", () => {
  const m = atpM.concat(wtaM).find(x => x.sets.length >= 2);
  assert.ok(Array.isArray(m.sets[0]) && Array.isArray(m.sets[1]),
    "each set must keep its own pair of games");
  assert.equal(m.score, undefined, "there should be no single two-number score");
});

test("orientation follows ESPN's competitor order, not the array order", () => {
  // ESPN lists competitors away-first; order 1 is the player billed first
  const raw = ATP.events[0].groupings[0].competitions
    .find(c => c.status.type.name === "STATUS_IN_PROGRESS");
  assert.ok(raw, "no in-progress competition in the fixture");
  const first = raw.competitors.find(c => c.order === 1);
  const second = raw.competitors.find(c => c.order === 2);
  assert.notEqual(raw.competitors[0].order, 1, "fixture no longer has the away-first quirk");

  const m = parseCompetition(raw, {tour: "ATP"});
  assert.equal(m.players[0].id, String(first.id));
  assert.equal(m.players[1].id, String(second.id));
  m.sets.forEach((s, i) => {
    const a = (first.linescores[i] || {}).value;
    const b = (second.linescores[i] || {}).value;
    assert.equal(s[0], a === undefined ? null : a, "set " + (i+1) + " first player");
    assert.equal(s[1], b === undefined ? null : b, "set " + (i+1) + " second player");
  });
});

test("a tiebreak is kept beside its set, in the same order", () => {
  const withTb = atpM.concat(wtaM).find(m => m.tiebreaks.some(Boolean));
  assert.ok(withTb, "no tiebreak in the fixtures");
  withTb.tiebreaks.forEach((tb, i) => {
    if(!tb) return;
    assert.equal(tb.length, 2);
    // the tiebreak winner should be the player who took that set
    const [ga, gb] = withTb.sets[i];
    const [ta, tb2] = tb;
    if(ga !== null && gb !== null && ta !== null && tb2 !== null){
      assert.equal(ta > tb2, ga > gb, "tiebreak and set disagree on who won set " + (i+1));
    }
  });
});

test("the winner is an index into the players, or nothing", () => {
  for(const m of atpM.concat(wtaM)){
    if(m.winner === null) continue;
    assert.ok(m.winner === 0 || m.winner === 1);
  }
  const done = atpM.find(m => m.status === "final");
  assert.ok(done && done.winner !== null, "a finished match should name a winner");
});

/* ---------------- lifecycle ---------------- */

const st = type => statusOf({status: {type}});

test("state in is live whatever the phase is called", () => {
  for(const name of ["STATUS_IN_PROGRESS", "STATUS_FIRST_SET", "STATUS_SOMETHING_NEW"]){
    assert.equal(st({name, state: "in", completed: false}), "live", name);
  }
});

test("retired, walkover and suspended are read by name", () => {
  assert.equal(st({name: "STATUS_RETIRED", state: "post", completed: true}), "retired");
  assert.equal(st({name: "STATUS_WALKOVER", state: "post", completed: true}), "walkover");
  assert.equal(st({name: "STATUS_SUSPENDED", state: "in", completed: false}), "suspended");
  assert.equal(st({name: "STATUS_CANCELED", state: "post", completed: false}), "canceled");
});

test("a plain completed match is final", () => {
  assert.equal(st({name: "STATUS_FINAL", state: "post", completed: true}), "final");
  assert.equal(st({name: "STATUS_SCHEDULED", state: "pre", completed: false}), "scheduled");
});

test("elapsed time is never part of the lifecycle", () => {
  // the same status object, read a week later, says exactly the same thing
  const type = {name: "STATUS_IN_PROGRESS", state: "in", completed: false};
  assert.equal(st(type), "live");
  assert.equal(st(type), "live");
});

test("the fixtures really do carry live, final, retired and scheduled", () => {
  const seen = new Set(atpM.concat(wtaM).map(m => m.status));
  for(const want of ["live", "final", "retired", "scheduled"]){
    assert.ok(seen.has(want), "no " + want + " match in the fixtures");
  }
});

test("suspended, walkover and a cancellation parse as themselves", () => {
  /* These three come from the constructed fixture: ESPN was publishing no
     example of any of them when the real payloads were taken, so the
     status blocks are written by hand from ESPN's own naming. */
  const rare = parseScoreboard(RARE);
  assert.equal(rare.length, 3);
  const sus = rare.find(m => m.id === "900001");
  const wo = rare.find(m => m.id === "900002");
  const can = rare.find(m => m.id === "900003");
  assert.equal(sus.status, "suspended");
  assert.equal(sus.sets.length, 2, "a suspended match keeps the sets already played");
  assert.equal(wo.status, "walkover");
  assert.equal(wo.winner, 0, "a walkover still has a player who goes through");
  assert.deepEqual(wo.sets, [], "a walkover was never played, so it has no sets");
  assert.equal(can.status, "canceled");
  assert.equal(can.winner, null, "a cancelled match has no winner");
});

test("suspended is not treated as settled; walkover is", () => {
  assert.equal(!!SETTLED.suspended, false);
  assert.equal(!!SETTLED.walkover, true);
  assert.equal(!!SETTLED.retired, true);
  assert.equal(!!SETTLED.live, false);
});

/* ---------------- times ---------------- */

test("an invalid time is marked, not invented", () => {
  const tbd = atpM.find(m => !m.timeKnown);
  assert.ok(tbd, "no timeValid:false competition in the fixtures");
  assert.equal(tbd.timeKnown, false);
  assert.ok(Number.isFinite(tbd.start), "the day is still known even when the clock is not");
});

test("a valid time is carried through as an instant", () => {
  const known = atpM.find(m => m.timeKnown);
  assert.ok(known);
  assert.ok(Number.isFinite(known.start));
});

test("timeKnown is only ever true when ESPN says timeValid", () => {
  const raw = new Map();
  for(const p of [ATP, WTA]){
    for(const e of p.events) for(const g of e.groupings) for(const c of g.competitions){
      raw.set(String(c.id), c.timeValid === true);
    }
  }
  for(const m of atpM.concat(wtaM)) assert.equal(m.timeKnown, raw.get(m.id), "match " + m.id);
});

test("a competition with an unparseable date is dropped rather than guessed at", () => {
  const real = ATP.events[0].groupings[0].competitions[0];
  const broken = JSON.parse(JSON.stringify(real));
  broken.date = "not a date"; broken.startDate = "";
  assert.equal(parseCompetition(broken, {tour: "ATP"}), null);
});

/* ---------------- retention ---------------- */

const NOW = Date.parse("2026-08-24T20:00:00Z");
const at = (offsetMs, over = {}) => ({id: "x", status: "final", start: NOW + offsetMs, players: [], ...over});

test("a completed match is kept for exactly three days from its start", () => {
  assert.equal(KEEP_COMPLETED_DAYS, 3);
  assert.equal(keepMatch(at(-3 * DAY), NOW), true, "the boundary itself is inside the window");
  assert.equal(keepMatch(at(-3 * DAY + 1), NOW), true);
  assert.equal(keepMatch(at(-3 * DAY - 1), NOW), false, "one millisecond past is outside");
});

test("the cutoff applies to every settled state", () => {
  for(const status of ["final", "retired", "walkover", "canceled", "postponed"]){
    assert.equal(keepMatch(at(-3 * DAY + 1, {status}), NOW), true, status + " just inside");
    assert.equal(keepMatch(at(-3 * DAY - 1, {status}), NOW), false, status + " just outside");
  }
});

test("a match still being played survives the cutoff however old", () => {
  for(const status of ["live", "suspended", "unknown"]){
    assert.equal(keepMatch(at(-9 * DAY, {status}), NOW), true, status + " nine days old");
    assert.equal(keepMatch(at(-40 * DAY, {status}), NOW), true, status + " six weeks old");
  }
});

test("upcoming matches are kept to a fortnight", () => {
  assert.equal(HORIZON_DAYS, 14);
  assert.equal(keepMatch(at(13 * DAY, {status: "scheduled"}), NOW), true);
  assert.equal(keepMatch(at(14 * DAY, {status: "scheduled"}), NOW), true);
  assert.equal(keepMatch(at(14 * DAY + 1, {status: "scheduled"}), NOW), false);
});

test("a scheduled match left unplayed for days is not held forever", () => {
  assert.equal(keepMatch(at(-3 * DAY - 1, {status: "scheduled"}), NOW), false);
});

test("old finished matches are dropped before anything is sent out", () => {
  const old = atpM.map(m => ({...m, status: "final", start: NOW - 30 * DAY}));
  const out = assembleMatches([old], {now: NOW});
  assert.equal(out.matches.length, 0);
  assert.ok(out.counts.deduped > 0, "they were parsed, then dropped");
  assert.equal(out.counts.retained, 0);
});

/* ---------------- following players ---------------- */

test("only matches involving a followed player come back", () => {
  const all = assembleMatches([atpM, wtaM], {now: NOW});
  const someone = all.matches[0].players[0].id;
  const mine = assembleMatches([atpM, wtaM], {now: NOW, players: [someone]});
  assert.ok(mine.matches.length >= 1);
  for(const m of mine.matches){
    assert.ok(m.players.some(p => p.id === someone), "a match arrived for nobody I follow");
  }
});

test("following nobody returns nothing at all", () => {
  const out = assembleMatches([atpM, wtaM], {now: NOW, players: []});
  assert.deepEqual(out.matches, []);
  assert.equal(out.counts.returned, 0);
});

test("an unknown player id simply matches nothing", () => {
  const out = assembleMatches([atpM, wtaM], {now: NOW, players: ["999999999"]});
  assert.deepEqual(out.matches, []);
});

test("a player id is compared as a string, whichever way it arrives", () => {
  const all = assembleMatches([atpM, wtaM], {now: NOW});
  const id = all.matches[0].players[0].id;
  assert.equal(forPlayers(all.matches, [Number(id)]).length, forPlayers(all.matches, [id]).length);
});

/* ---------------- output shape ---------------- */

test("the normalized output is a small, flat contract", () => {
  const out = normalizeTennis([ATP, WTA], {now: NOW});
  assert.ok(Array.isArray(out.matches));
  assert.match(out.generated, /^\d{4}-\d{2}-\d{2}T/);
  const m = out.matches[0];
  assert.deepEqual(Object.keys(m).sort(), [
    "court", "id", "label", "major", "players", "round", "sets", "short",
    "start", "status", "tiebreaks", "timeKnown", "tid", "tour", "tournament",
    "venue", "winner"
  ].sort());
});

test("matches come back in time order", () => {
  const out = normalizeTennis([ATP, WTA], {now: NOW});
  for(let i = 1; i < out.matches.length; i++){
    assert.ok(out.matches[i].start >= out.matches[i-1].start, "out of order at " + i);
  }
});

test("normalising is a large reduction on the real payload", () => {
  const rawBytes = readFileSync(new URL("./fixtures/tennis-atp-scoreboard.json", import.meta.url)).length
                 + readFileSync(new URL("./fixtures/tennis-wta-scoreboard.json", import.meta.url)).length;
  const out = normalizeTennis([ATP, WTA], {now: NOW});
  const outBytes = JSON.stringify(out).length;
  assert.ok(outBytes * 3 < rawBytes, "expected at least a threefold reduction, got "
    + (rawBytes / outBytes).toFixed(1) + "x");
});

test("nothing here throws on a hostile or empty payload", () => {
  for(const bad of [null, undefined, {}, {events: null}, {events: [{}]},
                    {events: [{groupings: [{}]}]},
                    {events: [{groupings: [{grouping: {id: "1"}, competitions: [null, {}, {id: 1}]}]}]}]){
    assert.doesNotThrow(() => parseScoreboard(bad));
  }
  assert.doesNotThrow(() => normalizeTennis(null, {}));
  assert.doesNotThrow(() => assembleMatches([null, [null]], {}));
});

/* ---------------- the player directory ---------------- */

test("the directory lists every singles player once, by id", () => {
  const dir = playerDirectory([ATP, WTA]);
  assert.ok(dir.length > 0);
  const ids = dir.map(r => r[0]);
  assert.equal(ids.length, new Set(ids).size, "a player is listed twice");
  const parsed = new Set(atpM.concat(wtaM).flatMap(m => m.players).filter(p => p.id).map(p => p.id));
  assert.equal(ids.length, parsed.size);
  assert.equal(dir.some(r => r[1] === "TBD"), false, "an unfilled draw slot reached the picker");
});

test("a directory row is id, name, tour and country", () => {
  const dir = playerDirectory([ATP, WTA]);
  for(const [id, name, tour, country] of dir){
    assert.match(id, /^\d+$/);
    assert.ok(name.length);
    assert.match(tour, /^(ATP|WTA|ATP\/WTA)$/);
    assert.ok(country === "" || /^[A-Z]{2,3}$/.test(country));
  }
});

test("the directory carries no doubles player", () => {
  const dir = new Set(playerDirectory([ATP, WTA]).map(r => r[0]));
  for(const p of [ATP, WTA]){
    for(const e of p.events) for(const g of e.groupings){
      if(!/doubles/.test(g.grouping.slug)) continue;
      for(const c of g.competitions) for(const x of c.competitors || []){
        for(const a of (x.roster && x.roster.athletes) || []){
          const m = /\/id\/(\d+)\//.exec(((a.links || [])[0] || {}).href || "");
          if(m) assert.equal(dir.has(m[1]), false, "doubles player " + m[1] + " is in the directory");
        }
      }
    }
  }
});
