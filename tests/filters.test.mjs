import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage, styleText, ruleFor } from "./helpers/page.mjs";

/* The competition chips, and the one control added beside them.
 *
 * The chips stay toggles. That is the decision this file mostly exists
 * to hold in place: a tap meaning "only this" would make two
 * competitions together harder than one, and two together is the
 * ordinary case. What was slow is going from fifteen on to one, and that
 * is a single control rather than a new meaning for the other fourteen.
 */

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");

const PREAMBLE = comps => `
  let filtersOpen = globalThis.__filtersOpen === true;
  let hiddenComps = new Set();
  globalThis.__hidden = hiddenComps;
  const myComps = () => ${JSON.stringify(comps)};
`;
const load = (comps = ["NHL", "MLB", "EPL"]) =>
  loadFromPage(["COMPS", "esc", "renderFilters", "setAllComps"], PREAMBLE(comps));

const pressed = (html, comp) =>
  new RegExp('data-comp="' + comp + '" aria-pressed="true"').test(html);

test("a chip is still a toggle, and still says which state it is in", () => {
  const p = load();
  const html = p.renderFilters();
  for(const c of ["NHL", "MLB", "EPL"]) assert.ok(pressed(html, c), c + " starts on");
  globalThis.__hidden.add("NHL");
  assert.ok(!pressed(p.renderFilters(), "NHL"));
  assert.ok(pressed(p.renderFilters(), "MLB"), "one chip off does not touch the others");
});

test("competition controls collapse into one summary row", () => {
  globalThis.__filtersOpen = false;
  const html = load().renderFilters();
  assert.match(html, /^<details class="filters"><summary>/);
  assert.match(html, /Competitions/);
  assert.match(html, /All 3 showing/);
  assert.match(html, /<div class="filter-options">/);
});

test("the disclosure stays open across a redraw", () => {
  globalThis.__filtersOpen = true;
  assert.match(load().renderFilters(), /^<details class="filters" open>/);
  globalThis.__filtersOpen = false;
});

test("the summary says how much of the schedule is showing", () => {
  const p = load();
  globalThis.__hidden.add("NHL");
  assert.match(p.renderFilters(), /2 of 3 showing/);
  p.setAllComps(true);
  assert.match(p.renderFilters(), /None showing/);
});

test("everything but one is still one tap, exactly as before", () => {
  /* The case a select-only chip would have broken. */
  const p = load();
  globalThis.__hidden.add("NHL");
  const html = p.renderFilters();
  assert.ok(!pressed(html, "NHL"));
  assert.ok(pressed(html, "MLB") && pressed(html, "EPL"));
});

test("clear all hides every competition on offer, and the label flips", () => {
  const p = load();
  assert.match(p.renderFilters(), /data-comps-all="clear"[^>]*>Clear all/);
  p.setAllComps(true);
  assert.deepEqual([...globalThis.__hidden].sort(), ["EPL", "MLB", "NHL"]);
  assert.match(p.renderFilters(), /data-comps-all="show"[^>]*>Show all/,
    "nothing is lost by pressing it: the same button puts them back");
});

test("from cleared, a tap adds one competition", () => {
  /* only baseball: clear, tap MLB. */
  const p = load();
  p.setAllComps(true);
  globalThis.__hidden.delete("MLB");
  const html = p.renderFilters();
  assert.ok(pressed(html, "MLB"));
  assert.ok(!pressed(html, "NHL") && !pressed(html, "EPL"));
  assert.match(html, /Clear all/, "with one on, the button offers to clear again");

  /* hockey and baseball: clear, tap NHL, tap MLB. */
  globalThis.__hidden.delete("NHL");
  const two = p.renderFilters();
  assert.ok(pressed(two, "NHL") && pressed(two, "MLB") && !pressed(two, "EPL"));
});

test("show all empties the set rather than listing what to show", () => {
  /* A competition that turns up later must arrive on, not silently
     missing because it was not in the list when the button was pressed. */
  const p = load();
  p.setAllComps(true);
  p.setAllComps(false);
  assert.equal(globalThis.__hidden.size, 0);
});

test("the control is not a competition and does not pretend to be one", () => {
  const p = load();
  const html = p.renderFilters();
  assert.doesNotMatch(html, /data-comps-all="[a-z]+" aria-pressed/, "it has no on/off state to press");
  const rule = ruleFor(styleText(), ".fchip-all");
  assert.ok(rule, ".fchip-all must be styled apart from the chips");
  assert.doesNotMatch(html, /<button class="fchip fchip-all"[^>]*><i /, "and no colour dot");
});

test("with fewer than two competitions there are no filters and no button", () => {
  assert.equal(load(["MLB"]).renderFilters(), "");
  assert.equal(load([]).renderFilters(), "");
});

test("hiddenComps is untouched underneath, so an old x= link still decodes", () => {
  /* The share link writes and reads the same set it always did. Nothing
     about the new control changes its shape, and this runs the shipped
     initialiser against a link written long before the control existed. */
  const block = /\(function initState\(\)\{[\s\S]*?\n\}\)\(\);/.exec(SRC);
  assert.ok(block, "initState must exist");
  const decls = loadFromPage(["DEFAULT_TEAMS", "RUGBY_FOLLOW"], "");
  const state = new Function(`
    const location = {hash: "#t=van-nhl.liv.tor-mlb&s=sportsnet&x=NHL.EPL&sc=0",
                      pathname:"/", search:"", origin:"https://example.test"};
    const history = {replaceState(){}};
    const store = {};
    const LS = { get(k, d){ return d; }, set(){} };
    const DEFAULT_TEAMS = ${JSON.stringify(decls.DEFAULT_TEAMS)};
    const RUGBY_FOLLOW = ${JSON.stringify(decls.RUGBY_FOLLOW)};
    const keptFrom = (list, ok) => Array.isArray(list) ? list.map(String).filter(ok) : [];
    const isTour = v => v === "ATP" || v === "WTA";
    const isEventId = v => /^\\d{1,6}-\\d{4}$/.test(v);
    let selected, services, hiddenComps, showScores, tennisTours, tennisEvents;
    let rugbyStars, tennisStars;
    ${block[0]}
    return {hidden:[...hiddenComps], selected:[...selected]};`)();
  assert.deepEqual(state.hidden.sort(), ["EPL", "NHL"], "the link's own competitions, unchanged");

  /* And the board it produces is the board it always produced. */
  const q = load();
  state.hidden.forEach(c => globalThis.__hidden.add(c));
  const html = q.renderFilters();
  assert.ok(!pressed(html, "NHL") && !pressed(html, "EPL") && pressed(html, "MLB"));
  assert.match(html, /Clear all/, "two of three off is not cleared");
});

test("an empty board while cleared is a state somebody asked for", () => {
  /* Not an outage, and not something to route round: the button that
     caused it is on screen saying Show all. */
  const p = load();
  p.setAllComps(true);
  assert.match(p.renderFilters(), /Show all/);
  assert.doesNotMatch(SRC, /hiddenComps\.clear\(\);\s*\n\s*\/\/ recover/, "nothing quietly undoes it");
});
