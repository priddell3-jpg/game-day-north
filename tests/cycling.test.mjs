import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resultBlocks, ridersInBlock, isGCBlock, gcLeaderFrom, stageSections,
  titleWords, titleMatches
} from "../scripts/lib/cycling.mjs";

const here = new URL(".", import.meta.url);
const stagesText = readFileSync(new URL("fixtures/vuelta-2025-stages.wikitext", here), "utf8");
const gcText     = readFileSync(new URL("fixtures/vuelta-2026-main-gc.wikitext", here), "utf8");

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
