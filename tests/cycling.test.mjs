import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resultBlocks, ridersInBlock, isGCBlock, gcLeaderFrom, gcStageFrom, stageSections,
  titleWords, titleMatches
} from "../scripts/lib/cycling.mjs";

const here = new URL(".", import.meta.url);
const stagesText = readFileSync(new URL("fixtures/vuelta-2025-stages.wikitext", here), "utf8");
const gcText     = readFileSync(new URL("fixtures/vuelta-2026-main-gc.wikitext", here), "utf8");
/* Saved verbatim from the MediaWiki API on 1 September 2026, the day the
   site was showing a leader who had abandoned the race five stages
   earlier. These two are the known answers that pin the regression. */
const v26Text    = readFileSync(new URL("fixtures/vuelta-2026-stages-1-11.wikitext", here), "utf8");
const v26GcText  = readFileSync(new URL("fixtures/vuelta-2026-main-gc-stage10.wikitext", here), "utf8");

/** The leader as the fetch script reads one: the first rider of the
    general-classification block inside a stage's section. */
function gcLeader(text, n){
  const sec = stageSections(text)[n];
  if(!sec) return null;
  const block = resultBlocks(sec).filter(isGCBlock)[0];
  return block ? (ridersInBlock(block, 1)[0] || null) : null;
}

/* Real wikitext, saved from the pages these parsers actually read. The
   first assertion is the known answer that caught the original bug: a
   table-shaped parser returned "Tissot Timing", the publisher of a
   citation, as a podium finisher. */

function stagePodium(text, n){
  const sec = stageSections(text)[n];
  if(!sec) return null;
  const blocks = resultBlocks(sec);
  const notGC = blocks.filter(b => !isGCBlock(b));
  const res = notGC.filter(b => /result/i.test(b.slice(0,240)))[0] || notGC[0] || "";
  return ridersInBlock(res, 3);
}

test("2025 Vuelta stage 1: the known podium", () => {
  assert.deepEqual(stagePodium(stagesText, 1),
    ["Jasper Philipsen", "Ethan Vernon", "Orluis Aular"]);
});

test("2025 Vuelta stage 1: the GC block gives the race leader", () => {
  const sec = stageSections(stagesText)[1];
  const gc = resultBlocks(sec).filter(isGCBlock)[0];
  assert.ok(gc, "a general classification block should be present");
  assert.deepEqual(ridersInBlock(gc, 1), ["Jasper Philipsen"]);
});

test("no citation publisher is ever mistaken for a rider", () => {
  const podium = stagePodium(stagesText, 1);
  assert.ok(!podium.includes("Tissot Timing"));
});

test("a team time trial yields nothing: there is no rider column", () => {
  // 2025 stage 5 was a TTT, marked rider=no, with teams in the rank rows
  assert.deepEqual(stagePodium(stagesText, 5), []);
});

test("a neutralised stage yields nothing: its ranks are an em dash", () => {
  // 2025 stage 11 (Bilbao) was neutralised; the only block is time gaps
  assert.deepEqual(stagePodium(stagesText, 11), []);
});

test("a podium is exactly three riders or nothing", () => {
  for(const n of [1,5,11]){
    const p = stagePodium(stagesText, n);
    assert.ok(p.length === 3 || p.length === 0, `stage ${n} produced ${p.length}`);
  }
});

test("stageSections finds each stage it is given", () => {
  const keys = Object.keys(stageSections(stagesText)).map(Number).sort((a,b)=>a-b);
  assert.deepEqual(keys, [1,5,11]);
});

test("gcLeaderFrom reads the standings table on a main race article", () => {
  assert.equal(gcLeaderFrom(gcText), "Tadej Pogačar");
});

test("gcLeaderFrom returns null when there is no standings table", () => {
  assert.equal(gcLeaderFrom("== Route ==\nNothing to see."), null);
});

/* --- redirect guard --- */

test("a season overview is rejected for a race that has no article yet", () => {
  assert.equal(titleMatches("2026 Il Lombardia", "2026 UCI World Tour"), false);
  assert.equal(titleMatches("2026 Grand Prix Cycliste de Québec", "2026 UCI World Tour"), false);
  assert.equal(titleMatches("2026 Bretagne Classic", "2026 UCI World Tour"), false);
});

test("shared generic cycling vocabulary is not a match", () => {
  // "2026 Tour of Guangxi" and "2026 UCI World Tour" share only "tour"
  assert.equal(titleMatches("2026 Tour of Guangxi", "2026 UCI World Tour"), false);
});

test("a shared year alone is not a match", () => {
  assert.ok(!titleWords("2026 Il Lombardia").has("2026"));
});

test("a genuine rename still matches", () => {
  assert.equal(titleMatches("2026 Bretagne Classic", "2026 Bretagne Classic - CIC"), true);
});

test("an identical title matches, accents and commas included", () => {
  assert.equal(titleMatches("2026 Vuelta a España", "2026 Vuelta a España"), true);
  assert.equal(titleMatches("2025 Vuelta a España, Stage 1 to Stage 11",
                            "2025 Vuelta a España, Stage 1 to Stage 11"), true);
});

test("nothing distinctive to compare is accepted rather than dropped", () => {
  assert.equal(titleMatches("2026", "2026 UCI World Tour"), true);
});

/* --- the 2026 Vuelta regression --- */

test("2026 Vuelta: the GC after stage 9 is Enric Mas, not the abandoned leader", () => {
  assert.equal(gcLeader(v26Text, 9), "Enric Mas");
});

test("2026 Vuelta: every stage section that has run yields a GC leader", () => {
  // the leader was frozen because settled stages were never re-read;
  // each of these blocks parses, so nothing excuses a stale value
  for(const n of [1,2,3,4,5,6,7,8,9,10]){
    assert.ok(gcLeader(v26Text, n), `stage ${n} produced no GC leader`);
  }
});

test("2026 Vuelta: the lead changes hands at stage 8 and stays changed", () => {
  assert.equal(gcLeader(v26Text, 7), "Tadej Pogačar");
  assert.equal(gcLeader(v26Text, 8), "Enric Mas");
  assert.equal(gcLeader(v26Text, 10), "Enric Mas");
});

test("2026 Vuelta stage 3 was cancelled: a GC but no podium", () => {
  // hail stopped the stage 15km out, so Wikipedia carries standings and
  // no result. Nothing to report is the right answer, not a guess.
  assert.deepEqual(stagePodium(v26Text, 3), []);
  assert.equal(gcLeader(v26Text, 3), "Tadej Pogačar");
});

test("2026 Vuelta: a stage that has been ridden still yields its podium", () => {
  assert.deepEqual(stagePodium(v26Text, 9),
    ["Enric Mas", "Oscar Onley", "Primož Roglič"]);
  assert.deepEqual(stagePodium(v26Text, 10),
    ["Bastien Tronchon", "Magnus Cort", "Thibau Nys"]);
});

test("2026 Vuelta: a stage not yet ridden yields nothing at all", () => {
  assert.deepEqual(stagePodium(v26Text, 11), []);
  assert.equal(gcLeader(v26Text, 11), null);
});

/* --- the main article competes on freshness --- */

test("gcStageFrom reads the stage the standings table is current to", () => {
  assert.equal(gcStageFrom(v26GcText), 10);
  assert.equal(gcLeaderFrom(v26GcText), "Enric Mas");
});

test("the main article's own table knew the leader the stage blocks did", () => {
  assert.equal(gcLeaderFrom(v26GcText), gcLeader(v26Text, gcStageFrom(v26GcText)));
});

test("gcStageFrom returns null when there is no standings table", () => {
  assert.equal(gcStageFrom("== Route ==\nNothing to see."), null);
});

test("a standings table with no readable stage number yields no stage", () => {
  // freshness cannot be compared without it, so the leader is not used
  assert.equal(gcStageFrom("|+ General classification after stage (1-10)"), null);
});

test("the earlier snapshot still reads as stage 1", () => {
  assert.equal(gcStageFrom(gcText), 1);
  assert.equal(gcLeaderFrom(gcText), "Tadej Pogačar");
});
