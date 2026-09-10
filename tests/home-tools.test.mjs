import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { styleText, ruleFor } from "./helpers/page.mjs";

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
const CSS = styleText();

test("the title opens a compact setup menu and the view is one switch", () => {
  const header = /<header class="topbar">[\s\S]*?<\/header>/.exec(SRC)[0];
  assert.match(header, /id="appMenuToggle"[^>]*aria-expanded="false"/);
  assert.match(header, /id="appMenu"[^>]*role="menu"[^>]*hidden/);
  assert.match(header, /id="teamsToggle"[^>]*role="menuitem"/);
  assert.match(header, /id="servicesToggle"[^>]*role="menuitem"/);
  assert.match(header, /id="viewToggle"/);
  assert.doesNotMatch(header, /id="v-list"|id="v-cal"/);
});

test("the home strip adapts to the controls that actually exist", () => {
  const at = SRC.indexOf("function renderHomeTools");
  const body = SRC.slice(at, SRC.indexOf("function renderList", at));
  assert.match(body, /if\(filter\) tools\.push/);
  assert.match(body, /if\(race\) tools\.push/);
  assert.match(body, /if\(results\) tools\.push/);
  assert.match(body, /--tool-count:'\+tools\.length/);
  assert.match(body, /kind:"filters",label:"All sports"/);
  assert.match(body, /kind:"races",label:"In the Race"/);
  assert.match(body, /kind:"results",label:"Recent results"/);
});

test("no active race means no race control", () => {
  const at = SRC.indexOf("function homeRaceState");
  const body = SRC.slice(at, SRC.indexOf("function toggleHomeTool", at));
  assert.match(body, /!showScores\) return null/);
  assert.match(body, /if\(!cards\.length\) return null/);
});

test("multiple races get a compact selector and a plus count", () => {
  const homeAt = SRC.indexOf("function homeRaceState");
  const home = SRC.slice(homeAt, SRC.indexOf("function toggleHomeTool", homeAt));
  assert.match(home, /cards\.length>1 \? " \\u00b7 \+"\+\(cards\.length-1\)/);
  const racesAt = SRC.indexOf("function renderRaces");
  const races = SRC.slice(racesAt, SRC.indexOf("/* ---------- rights table", racesAt));
  assert.match(races, /cards\.length>1/);
  assert.match(races, /data-race-select/);
  assert.match(races, /raceCardHtml\(chosen, now\)/);
});

test("opening one home control closes the other two and remembers race/results", () => {
  const at = SRC.indexOf("function toggleHomeTool");
  const body = SRC.slice(at, SRC.indexOf("function renderHomeTools", at));
  assert.match(body, /filtersOpen=kind==="filters" && !was/);
  assert.match(body, /racesOpen=kind==="races" && !was/);
  assert.match(body, /resultsOpen=kind==="results" && !was/);
  assert.match(body, /LS\.set\(RACES_OPEN_KEY,racesOpen\)/);
  assert.match(body, /LS\.set\(RESULTS_OPEN_KEY,resultsOpen\)/);
});

test("recent results reuses full schedule cards inside its inline panel", () => {
  const at = SRC.indexOf("function renderResults");
  const body = SRC.slice(at, SRC.indexOf("/* ---------- Race", at));
  assert.match(body, /daySection\(k, gs, now, todayKey\)/);
  assert.match(body, /if\(compact\) return '<div class="results-in">'/);
});

test("the tennis explanation sits beside the first tennis day", () => {
  const at = SRC.indexOf("function renderList");
  const body = SRC.slice(at, SRC.indexOf("const MONTHS", at));
  assert.match(body, /let tennisHelp=tennisNote\(\)/);
  assert.match(body, /gs\.some\(g=>g\.tennis\)/);
  assert.ok(body.indexOf("tennisHelp") < body.indexOf("daySection(k, gs"));
});

test("live emphasis is strongest in What's On and quiet in the full card", () => {
  assert.match(ruleFor(CSS, ".rail-card.live"), /var\(--live-soft\)/);
  assert.match(ruleFor(CSS, ".rail-live"), /background:var\(--live\)/);
  const game = ruleFor(CSS, ".game.is-live");
  assert.match(game, /var\(--live-soft\) 34%/);
  assert.match(game, /border-left-color:transparent/);
});
