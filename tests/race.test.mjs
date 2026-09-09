import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RACE_KINDS, RACE_SOURCES, groupsFrom, groupFrom, zonesFrom, sanitizeHex,
  clinchPhrase, clincherOf, numStat, textStat, playedBy, standingsNodes, groupIdFor
} from "../scripts/lib/race.mjs";

/* Every fixture here was recorded from the live ESPN standings API on
   8 Sep 2026 and reduced to the fields the parser reads. Each carries a
   _note saying which URL it came from and which quirk it exists to
   pin down. */
const fx = name => JSON.parse(readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8"));

const MLB_WC = fx("standings-mlb-wildcard.json");
const NFL_WEEK1 = fx("standings-nfl-conference-week1.json");
const NFL_FINAL = fx("standings-nfl-conference-2025-final.json");
const NFL_DIV_WEEK1 = fx("standings-nfl-divisions-week1.json");
const NFL_DIV_FINAL = fx("standings-nfl-divisions-2025-final.json");
const EPL = fx("standings-epl.json");
const EPL_PREV = fx("standings-epl-2025-final.json");
const UCL = fx("standings-ucl.json");

const byGroup = (list, id) => list.find(g => g.group === id);
const abbrs = g => g.rows.map(r => r.abbr);

/* ============================ ordering ============================ */

test("the entries array is not in standings order, in a conference", () => {
  /* The single fact that makes reading the array in order wrong. The
     first seed is the last entry and the eliminated teams are at the
     front. */
  const afc = standingsNodes(NFL_FINAL)[0];
  const raw = afc.standings.entries.map(e => e.team.abbreviation);
  assert.equal(raw[0], "NE", "the recorded payload opens on the SECOND seed");
  assert.equal(raw[raw.length - 1], "DEN", "and closes on the first");

  const g = groupFrom(afc, { comp: "NFL", kind: RACE_KINDS.SEED });
  assert.equal(g.rows[0].abbr, "DEN");
  assert.equal(g.rows[0].pos, 1);
  assert.deepEqual(g.rows.map(r => r.pos), g.rows.map((_, i) => i + 1));
});

test("the entries array is not in standings order, in a division either", () => {
  const west = standingsNodes(NFL_DIV_FINAL).find(n => n.name === "AFC West");
  assert.equal(west.standings.entries[0].team.abbreviation, "LAC");
  const g = groupFrom(west, { comp: "NFL", kind: RACE_KINDS.DIVISION });
  assert.deepEqual(abbrs(g), ["DEN", "LAC", "KC", "LV"]);
});

test("a wild-card group is seeded one to twelve in each league", () => {
  const groups = groupsFrom(MLB_WC, { comp: "MLB", kind: RACE_KINDS.SEED,
    groupFor: n => ({ "American League": "AL", "National League": "NL" })[n.name] });
  assert.equal(groups.length, 2);
  for(const g of groups){
    assert.equal(g.rows.length, 12);
    assert.deepEqual(g.rows.map(r => r.pos), [1,2,3,4,5,6,7,8,9,10,11,12]);
  }
  assert.deepEqual(abbrs(byGroup(groups, "AL")).slice(0, 5), ["NYY", "BOS", "CLE", "TOR", "TEX"]);
});

test("a group nothing has been played in cannot be ordered and is not returned", () => {
  /* Week one of the NFL: every seed is zero. There is no ordering to be
     had, and the right answer is no group rather than a guessed one. */
  const seeds = standingsNodes(NFL_WEEK1)[0].standings.entries
    .map(e => numStat(e, "playoffSeed"));
  assert.ok(seeds.every(s => s === 0), "expected every week-one seed to be zero");
  assert.deepEqual(groupsFrom(NFL_WEEK1, { comp: "NFL", kind: RACE_KINDS.SEED }), []);
});

test("two teams cannot hold one seed", () => {
  const node = JSON.parse(JSON.stringify(standingsNodes(NFL_FINAL)[0]));
  const seedOf = e => e.stats.find(s => s.name === "playoffSeed");
  seedOf(node.standings.entries[1]).value = seedOf(node.standings.entries[0]).value;
  seedOf(node.standings.entries[1]).displayValue = seedOf(node.standings.entries[0]).displayValue;
  assert.equal(groupFrom(node, { comp: "NFL", kind: RACE_KINDS.SEED }), null);
});

test("divisions are ordered by published games behind, and level teams share a place", () => {
  const groups = groupsFrom(NFL_DIV_FINAL, { comp: "NFL", kind: RACE_KINDS.DIVISION });
  assert.equal(groups.length, 8);

  const north = byGroup(groups, "nfc-north");
  assert.deepEqual(abbrs(north), ["CHI", "GB", "MIN", "DET"]);
  /* Minnesota and Detroit are both two games back. Neither the source
     nor this app decides which of them is third, so they share third
     and nothing holds fourth. */
  assert.deepEqual(north.rows.map(r => r.pos), [1, 2, 3, 3]);

  const south = byGroup(groups, "nfc-south");
  assert.deepEqual(south.rows.map(r => r.pos), [1, 1, 1, 4],
    "three teams level at the top share the lead rather than being tiebroken here");
});

test("a division with no games behind published is not returned", () => {
  const groups = groupsFrom(NFL_DIV_WEEK1, { comp: "NFL", kind: RACE_KINDS.DIVISION });
  /* Week one publishes a dash for every team, which reads as zero games
     behind for all four. That orders, but nothing has been played, so
     the group carries a played range of zero and the page gates on it. */
  for(const g of groups) assert.deepEqual(g.played, { min: 0, max: 0 });
});

/* ============================ what a row carries ============================ */

test("games behind is carried as the source wrote it, sign and all", () => {
  const al = byGroup(groupsFrom(MLB_WC, { comp: "MLB", kind: RACE_KINDS.SEED,
    groupFor: n => ({ "American League": "AL", "National League": "NL" })[n.name] }), "AL");
  const row = a => al.rows.find(r => r.abbr === a);
  assert.equal(row("NYY").gb, "+9", "a cushion is published with a plus and kept verbatim");
  assert.equal(row("NYY").gbv, -9, "and valued negatively, which is what says it is a cushion");
  assert.equal(row("CLE").gb, "-", "the team on the line is a dash, not a zero we wrote");
  assert.equal(row("CLE").gbv, 0);
  assert.equal(row("TEX").gb, "1.5");
});

test("a field the source did not publish is absent, not defaulted", () => {
  const al = byGroup(groupsFrom(MLB_WC, { comp: "MLB", kind: RACE_KINDS.SEED,
    groupFor: n => ({ "American League": "AL", "National League": "NL" })[n.name] }), "AL");
  const nyy = al.rows.find(r => r.abbr === "NYY");
  /* The wild-card view blanks the composite record and states no clinch
     letter for a team still in it. Both are simply missing. */
  assert.ok(!("rec" in nyy), "the wild-card view publishes no overall record");
  assert.ok(!("clinch" in nyy), "a team that has clinched nothing carries no letter");
  assert.equal(nyy.w, 81);
  assert.equal(nyy.l, 62);
  assert.equal(nyy.streak, "L1");
  assert.equal(nyy.form, "6-4");
});

test("games played is read where published and added up where it is not", () => {
  const epl = standingsNodes(EPL)[0].standings.entries[0];
  assert.equal(playedBy(epl), 3, "soccer publishes games played");
  const nfl = standingsNodes(NFL_FINAL)[0].standings.entries
    .find(e => e.team.abbreviation === "DEN");
  assert.equal(textStat(nfl, "gamesPlayed"), null, "the NFL publishes no games played");
  assert.equal(playedBy(nfl), 17, "so it comes from the published wins, losses and ties");
});

test("rows resolve to this app's own team ids when a matcher is supplied", () => {
  const idFor = name => ({ "Liverpool": "liv", "Arsenal": "ars", "Chelsea": "che" })[name] || null;
  const ucl = groupsFrom(UCL, { comp: "UCL", kind: RACE_KINDS.TABLE, group: "league", idFor })[0];
  assert.equal(ucl.rows.find(r => r.name === "Liverpool").id, "liv");
  assert.ok(!("id" in ucl.rows.find(r => r.name === "Real Madrid")),
    "a club the matcher does not know carries no id rather than a wrong one");
  assert.equal(ucl.rows.find(r => r.name === "Chelsea"), undefined,
    "Chelsea is not in this season's field at all, which is a fact about the competition");
});

/* ============================ zones ============================ */

test("Champions League cutoffs are read from the payload, not written down", () => {
  const ucl = groupsFrom(UCL, { comp: "UCL", kind: RACE_KINDS.TABLE, group: "league" })[0];
  assert.deepEqual(ucl.zones.map(z => [z.from, z.to, z.label]), [
    [1, 8, "Qualifies for round of 16"],
    [9, 16, "Knockout phase playoffs - seeded"],
    [17, 24, "Knockout phase playoffs - unseeded"],
    [25, 36, "Eliminated"]
  ]);
});

test("the same league gives different cutoffs in different seasons", () => {
  const now = groupsFrom(EPL, { comp: "EPL", kind: RACE_KINDS.TABLE, group: "table" })[0];
  const prev = groupsFrom(EPL_PREV, { comp: "EPL", kind: RACE_KINDS.TABLE, group: "table" })[0];
  const cl = zs => zs.find(z => z.label === "Champions League");
  assert.equal(cl(now.zones).to, 4, "2026-27 sends four clubs to the Champions League");
  assert.equal(cl(prev.zones).to, 5, "2025-26 sent five");
  /* If a number like this were ever written into the repo, one of these
     two assertions would be wrong every season. */
});

test("a zone that recurs further down the table stays a separate zone", () => {
  const prev = groupsFrom(EPL_PREV, { comp: "EPL", kind: RACE_KINDS.TABLE, group: "table" })[0];
  const europa = prev.zones.filter(z => z.label === "Europa League");
  assert.deepEqual(europa.map(z => [z.from, z.to]), [[6, 7], [15, 15]],
    "a cup winner qualifying from mid-table is not a reason to swallow ranks 8 to 14");
});

test("zones are ranges over positions and are never attached to a club", () => {
  const ucl = groupsFrom(UCL, { comp: "UCL", kind: RACE_KINDS.TABLE, group: "league" })[0];
  const last = ucl.rows[ucl.rows.length - 1];
  assert.equal(last.pos, 36);
  for(const r of ucl.rows){
    assert.ok(!("zone" in r) && !("note" in r) && !("label" in r),
      "no row may carry a qualification label of its own");
    assert.ok(!JSON.stringify(r).includes("Eliminated"),
      "and least of all this one: six clubs in that zone have played nothing yet");
  }
  const played = ucl.rows.filter(r => r.pos >= 25).map(r => r.gp);
  assert.ok(played.some(p => p === 0),
    "the recorded payload really does label unplayed clubs' positions as eliminated");
});

test("no notes means no zones, rather than a default set", () => {
  const stripped = JSON.parse(JSON.stringify(EPL));
  standingsNodes(stripped)[0].standings.entries.forEach(e => { delete e.note; });
  const g = groupsFrom(stripped, { comp: "EPL", kind: RACE_KINDS.TABLE, group: "table" })[0];
  assert.equal(zonesFrom(standingsNodes(stripped)[0].standings.entries).length, 0);
  assert.ok(!("zones" in g));
  assert.equal(g.rows.length, 20, "the table itself is still perfectly usable");
});

/* ============================ small, sharp edges ============================ */

test("a colour with two hashes is repaired, and anything else is dropped", () => {
  assert.equal(sanitizeHex("##B5E7CE"), "#b5e7ce");
  assert.equal(sanitizeHex("#81D6AC"), "#81d6ac");
  assert.equal(sanitizeHex("81D6AC"), "#81d6ac");
  assert.equal(sanitizeHex("rebeccapurple"), null);
  assert.equal(sanitizeHex(""), null);
  assert.equal(sanitizeHex(null), null);

  const epl = groupsFrom(EPL, { comp: "EPL", kind: RACE_KINDS.TABLE, group: "table" })[0];
  const europa = epl.zones.find(z => z.label === "Europa League");
  assert.equal(europa.color, "#b5e7ce", "the double hash is in the recorded payload");
});

test("only a clinch letter we can explain is carried", () => {
  assert.equal(clinchPhrase("e"), "eliminated");
  assert.equal(clinchPhrase("z"), "clinched a division");
  assert.equal(clinchPhrase("*"), "clinched home advantage");
  assert.equal(clinchPhrase("q"), null, "an unknown letter gets no invented phrase");
  assert.equal(clinchPhrase(""), null);

  const afc = groupFrom(standingsNodes(NFL_FINAL)[0], { comp: "NFL", kind: RACE_KINDS.SEED });
  assert.equal(afc.rows.find(r => r.abbr === "DEN").clinch, "*");
  assert.equal(afc.rows.find(r => r.abbr === "TEN").clinch, "e");

  const invented = { team: { id: "1", displayName: "X" },
    stats: [{ name: "clincher", displayValue: "q" }] };
  assert.equal(clincherOf(invented), null);
});

test("an empty or unreadable group yields nothing at all", () => {
  assert.equal(groupFrom(null, { comp: "EPL" }), null);
  assert.equal(groupFrom({ name: "X", standings: { entries: [] } }, { comp: "EPL" }), null);
  assert.equal(groupFrom({ name: "X" }, { comp: "EPL" }), null);
  assert.equal(groupFrom({ name: "X", standings: { entries: [{ team: {} }] } },
    { comp: "EPL", kind: RACE_KINDS.TABLE }), null);
});

test("one malformed group does not blank the competition it is in", () => {
  const payload = JSON.parse(JSON.stringify(NFL_DIV_FINAL));
  const nodes = standingsNodes(payload);
  nodes[0].standings.entries.forEach(e => {
    const s = e.stats.find(x => x.name === "gamesBehind");
    delete s.value; s.displayValue = "";
  });
  const groups = groupsFrom(payload, { comp: "NFL", kind: RACE_KINDS.DIVISION });
  assert.equal(groups.length, 7, "seven readable divisions survive the eighth");
  assert.equal(byGroup(groups, "afc-east"), undefined);
});

/* ============================ the source table ============================ */

test("every source names a competition the app already knows and a real view", () => {
  const comps = new Set(["MLB", "NFL", "EPL", "UCL"]);
  for(const s of RACE_SOURCES){
    assert.ok(comps.has(s.comp), s.comp + " is not a competition this app follows");
    assert.ok(/^https:\/\//.test(s.url), "sources are https");
    assert.ok(s.view && s.label, s.comp + " must say which standings view it reads");
    assert.ok(Object.values(RACE_KINDS).includes(s.kind));
  }
});

test("group ids are stable and do not collide within a competition", () => {
  for(const s of RACE_SOURCES){
    const payload = {
      MLB: MLB_WC, EPL, UCL,
      NFL: s.kind === RACE_KINDS.DIVISION ? NFL_DIV_FINAL : NFL_FINAL
    }[s.comp];
    const ids = standingsNodes(payload).map(n => groupIdFor(s, n));
    assert.equal(new Set(ids).size, ids.length, s.comp + "/" + s.view + " has colliding group ids");
    for(const id of ids) assert.match(id, /^[a-z0-9-]+$/i);
  }
});

test("the source table has no qualification cutoff written into it", () => {
  /* The rule this whole design turns on. Cutoffs that the source
     publishes are read from the payload; the two that it does not
     publish live in the page's dated RACES table, next to a note and a
     link, and never here. */
  const src = readFileSync(new URL("../scripts/lib/race.mjs", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/\bcutoff\b/i.test(code), "no cutoff belongs in the normaliser");
  /* "Champions League" is allowed: it names a competition this app
     follows. What must never appear is the wording of a qualification
     zone, because that is a cutoff by another name. */
  assert.ok(!/round of 16|relegation|europa|knockout phase|wild card place/i.test(code),
    "no zone label belongs in the normaliser either");
});

test("league points stay in the tables that have them", () => {
  const epl = groupsFrom(EPL, { comp: "EPL", kind: RACE_KINDS.TABLE, group: "table" })[0];
  const liv = epl.rows.find(r => r.name === "Liverpool");
  assert.equal(liv.pts, 5);
  assert.equal(liv.gd, "+2");

  /* The wild-card view answers `points` as well, and it is not points:
     ESPN calls it the relative value used to work out games behind, and
     it reads -0.5 for a club two games under .500. Carrying it as `pts`
     would be this app renaming a number rather than reporting one. */
  const al = byGroup(groupsFrom(MLB_WC, { comp: "MLB", kind: RACE_KINDS.SEED,
    groupFor: n => ({ "American League": "AL", "National League": "NL" })[n.name] }), "AL");
  const raw = standingsNodes(MLB_WC)[0].standings.entries
    .find(e => e.team.abbreviation === "TOR");
  assert.notEqual(numStat(raw, "points"), null, "the payload really does answer points here");
  for(const r of al.rows){
    assert.ok(!("pts" in r), r.abbr + " carries a points field it has no points for");
    assert.ok(!("gd" in r), r.abbr + " carries a goal difference in a baseball table");
  }
  assert.equal(al.rows.find(r => r.abbr === "TOR").gb, "1",
    "what a baseball row does carry is the published games behind");
});
