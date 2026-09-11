import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage } from "./helpers/page.mjs";

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
const NOW = Date.parse("2026-09-10T18:00:00Z");

function report(games = [], owned = []){
  globalThis.__serviceGames = games;
  globalThis.__ownedServices = owned;
  const page = loadFromPage(["SERVICES", "coverageReport"], `
    const DAY = 86400000;
    const myGames = () => globalThis.__serviceGames;
    const servicesFor = g => g.serviceIds || [];
    const services = new Set(globalThis.__ownedServices);
  `);
  return {catalogue:page.SERVICES, report:page.coverageReport(NOW)};
}

test("every provider remains selectable with no teams or games", () => {
  const {catalogue, report:result} = report();
  assert.deepEqual(result.services.map(s=>s.id), Object.keys(catalogue));
  assert.equal(result.services.length, 13);
  assert.ok(result.services.every(s=>s.n === 0));
});

test("selected-team game counts annotate rather than filter providers", () => {
  const games = [
    {start:NOW + 3600000, serviceIds:["sportsnet", "tsn"]},
    {start:NOW + 7200000, serviceIds:["sportsnet"]}
  ];
  const {report:result} = report(games, ["flobikes"]);
  assert.equal(result.services.find(s=>s.id === "sportsnet").n, 2);
  assert.equal(result.services.find(s=>s.id === "tsn").n, 1);
  assert.equal(result.services.find(s=>s.id === "dazn").n, 0);
  assert.equal(result.services.find(s=>s.id === "flobikes").owned, true);
  assert.ok(result.services.every(s=>s.kind === "tv" || s.kind === "stream"));
});

test("zero-game providers explain their type instead of saying zero games", () => {
  const render = /function renderServices\(\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(render, /s\.kind==="tv" \? "TV service" : "Streaming service"/);
  assert.match(render, /s\.n \? s\.n\+' game'/);
});
