import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage } from "./helpers/page.mjs";

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");

/* Two things moved, for one reason: configuration belongs in the header,
   and the schedule belongs in the page.

   Coverage — "Where your teams actually are" — was a panel in the body,
   below every fixture. It is set up once and then almost never touched,
   which is the last thing that should occupy the answer to "what is on
   tonight". It is behind a My services button now, in a drawer built the
   same way the teams one is.

   Recent results was also below the schedule, which meant scrolling past
   the whole window to see last night's score — the thing people check
   first in the morning. It sits at the top now, collapsed, so it costs
   one line rather than a screenful.

   There is no browser here: these assert the markup the page builds and
   the composition it ships. What was actually looked at, and at what
   width, is stated in the branch's report. */

/* ================= the order of the list ================= */

const renderListSrc = /function renderList\([\s\S]*?\n\}/.exec(SRC)[0];

test("the list is composed in one order: setup, history, then the schedule", () => {
  const order = ["welcomeBanner()", "renderFilters()", "servicesHint()", "renderResults("];
  let at = -1;
  for(const piece of order){
    const next = renderListSrc.indexOf(piece, at + 1);
    assert.ok(next > at, piece + " must come after " + (order[order.indexOf(piece)-1] || "the start"));
    at = next;
  }
  // and the day sections are built after all of it
  assert.ok(renderListSrc.indexOf("groupByDay(games)") > at, "the schedule follows the header material");
});

test("the reference material stays at the bottom", () => {
  const days = renderListSrc.indexOf("groupByDay(games)");
  assert.ok(renderListSrc.indexOf("renderRights()") > days);
  assert.ok(renderListSrc.indexOf("noteBlock()") > days);
});

test("the empty branch keeps the same order, with results above the empty state", () => {
  const empty = /if\(!games\.length\)\{[\s\S]*?\n  \}/.exec(renderListSrc)[0];
  assert.ok(empty.indexOf("renderResults(") < empty.indexOf("emptyState()"),
    "history above the empty state, as in the populated branch");
  assert.ok(empty.indexOf("renderFilters()") < empty.indexOf("renderResults("));
});

test("the coverage panel is no longer built into the page body", () => {
  assert.doesNotMatch(SRC, /function renderCoverage/);
  assert.doesNotMatch(renderListSrc, /renderCoverage/);
  // the heading went with it — the drawer has its own
  assert.doesNotMatch(SRC, /Where your teams actually are/);
});

test("coverage is written into the drawer instead of returned as markup", () => {
  /* The drawer lives outside #main, which render() replaces wholesale.
     A renderServices that returned a string would have nowhere to put
     it. */
  const fn = /function renderServices\(\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(fn, /getElementById\("svcBody"\)\.innerHTML/);
  assert.match(fn, /getElementById\("svcSummary"\)/);
  assert.match(fn, /getElementById\("svcCount"\)/);
  assert.doesNotMatch(fn, /return '/);
});

test("the services drawer is the same kind of strip as the teams drawer", () => {
  const svc = /<section class="drawer" id="svcDrawer" hidden>[\s\S]*?<\/section>/.exec(SRC);
  assert.ok(svc, "the services drawer must exist");
  assert.match(svc[0], /class="wrap drawer-in"/);
  assert.match(svc[0], /id="svcCount"/);
  assert.match(svc[0], /id="svcSummary"/);
  assert.match(svc[0], /id="svcBody"/);
});

test("the header carries the button that opens it, with a count", () => {
  const bar = /<header class="topbar">[\s\S]*?<\/header>/.exec(SRC)[0];
  assert.match(bar, /id="servicesToggle"/);
  assert.match(bar, /id="serviceCount"/);
  // beside My teams, not somewhere else on the page
  assert.ok(bar.indexOf('id="teamsToggle"') < bar.indexOf('id="servicesToggle"'));
});

test("the service cards are handled where they now live", () => {
  /* They used to be in #main and were caught by its click listener.
     Leaving that listener in place while moving the cards would have
     been a control that silently did nothing. */
  const main = /document\.getElementById\("main"\)\.addEventListener\([\s\S]*?\n\}\);/.exec(SRC)[0];
  assert.doesNotMatch(main, /data-service/);
  assert.match(SRC, /svcDrawer\.addEventListener\("click"/);
});

/* ================= Recent results ================= */

const MIDNIGHT = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
const DAY = 86400000;

/* daySection and the row renderer below it are a page of markup that
   says nothing about ordering or the summary line, so they are stubbed
   down to a countable marker. */
function results(over = {}){
  const games = over.games === undefined
    ? [ {start: MIDNIGHT - 5*3600000, listed:true, result:{status:"final", score:[3,0]}},
        {start: MIDNIGHT - 30*3600000, listed:true, result:{status:"final", score:[5,3]}} ]
    : over.games;
  const pre = `
    const DAY = 86400000;
    const selected = new Set(${JSON.stringify(over.selected === undefined ? ["tor-mlb"] : over.selected)});
    let showScores = ${over.showScores === undefined ? true : over.showScores};
    let resultsOpen = ${over.resultsOpen === undefined ? false : over.resultsOpen};
    const GAMES = ${JSON.stringify(games)};
    const myGames = () => GAMES;
    const localKey = ms => new Date(ms).toISOString().slice(0, 10);
    const daySection = (k, gs) => "<section class=\\"day\\">" + gs.length + "</section>";
    const stateOf = g => ({status: g.result.status, score: g.result.score});
  `;
  return loadFromPage(["renderResults"], pre).renderResults(Date.now(), "today");
}
const isOpen = html => /<details class="results" open>/.test(html);

test("Recent results arrives collapsed", () => {
  /* The default is not "whatever it was last time on this screen size" —
     it is closed. History expanded on arrival pushes tonight's game
     below the fold to say something nobody asked for. */
  assert.equal(isOpen(results()), false);
  assert.match(results(), /<details class="results">/);
});

test("a viewer who opened it gets it open", () => {
  assert.equal(isOpen(results({resultsOpen: true})), true);
});

test("the summary is worth reading while it is shut", () => {
  const html = results();
  assert.match(html, /Recent results/);
  assert.match(html, /last 3 days &middot; 2 games &middot; 2 final scores/);
});

test("with scores hidden the summary counts games and stops there", () => {
  /* How many of these have a final score is a fact about the outcomes:
     three settled out of four says the fourth was postponed, and a count
     that moves while a game is on says it just finished. */
  const html = results({showScores: false});
  assert.match(html, /last 3 days &middot; 2 games/);
  assert.doesNotMatch(html, /final score/);
  assert.doesNotMatch(html, /no scores available/);
});

test("with scores on and none to show, it says so rather than nothing", () => {
  const html = results({games: [{start: MIDNIGHT - 5*3600000, listed:true, result:{status:"final", score:null}}]});
  assert.match(html, /last 3 days &middot; 1 game &middot; no scores available/);
});

test("that line is also withheld when scores are hidden", () => {
  const html = results({showScores: false,
    games: [{start: MIDNIGHT - 5*3600000, listed:true, result:{status:"final", score:null}}]});
  assert.match(html, /last 3 days &middot; 1 game<\/span>/);
});

test("nothing in the last three days still renders the panel, closed", () => {
  const html = results({games: []});
  assert.match(html, /nothing confirmed/);
  assert.equal(isOpen(html), false);
});

test("following nothing renders no panel at all", () => {
  assert.equal(results({selected: []}), "");
});

test("only whole past days count, so today's game is not a result", () => {
  const html = results({games: [
    {start: MIDNIGHT + 6*3600000, listed:true, result:{status:"final", score:[1,0]}},   // today
    {start: MIDNIGHT - 2*3600000, listed:true, result:{status:"final", score:[2,1]}}    // last night
  ]});
  assert.match(html, /last 3 days &middot; 1 game/);
});

/* ---- the preference that survives the visit ---- */

test("the open state is stored under its own key, read as a strict boolean", () => {
  /* LS.get hands back whatever JSON.parse produced. A truthy string or a
     number in that key is not a value this build wrote, and reading it
     as one would open a panel nobody opened. */
  assert.match(SRC, /const RESULTS_OPEN_KEY = "gdn\.results\.open";/);
  assert.match(SRC, /let resultsOpen = LS\.get\(RESULTS_OPEN_KEY, false\) === true;/);
});

test("it is written when the panel is toggled, not merely remembered in memory", () => {
  const handler = /if\(rs\) rs\.addEventListener\("toggle"[\s\S]*?\}\);/.exec(SRC)[0];
  assert.match(handler, /resultsOpen\s*=\s*rs\.open/);
  assert.match(handler, /LS\.set\(RESULTS_OPEN_KEY, rs\.open\)/);
});

test("the key is not the one the remembered scores live under", () => {
  // gdn.results holds a week of finals; clobbering it with a boolean
  // would throw those away on the first toggle
  assert.match(SRC, /const RESULTS_KEY = "gdn\.results";/);
  assert.notEqual("gdn.results", "gdn.results.open");
});

/* ================= the drawers ================= */

/* showDrawer is DOM code, so it is given a document small enough to
   reason about: enough of an element to record what was set on it. */
const DOM_PRE = `
  function fakeEl(){
    return {
      _hidden: true, _attrs: {},
      setAttribute(k, v){ if(k === "hidden") this._hidden = true; this._attrs[k] = String(v); },
      getAttribute(k){ return this._attrs[k]; },
      removeAttribute(k){ if(k === "hidden") this._hidden = false; delete this._attrs[k]; },
      hasAttribute(k){ return k === "hidden" ? this._hidden : (k in this._attrs); }
    };
  }
  const NODES = {drawer: fakeEl(), svcDrawer: fakeEl(), teamsToggle: fakeEl(), servicesToggle: fakeEl()};
  const document = {getElementById: id => NODES[id]};
  globalThis.__probe = {nodes: NODES, drew: []};
  const renderDrawer = () => globalThis.__probe.drew.push("teams");
  const renderServices = () => globalThis.__probe.drew.push("services");
`;
function drawers(){
  const p = loadFromPage(["drawer", "svcDrawer", "DRAWERS", "showDrawer", "openDrawer", "toggleDrawer"], DOM_PRE);
  return Object.assign(p, {probe: globalThis.__probe});
}

test("opening one drawer closes the other", () => {
  const p = drawers();
  p.openDrawer(p.svcDrawer);
  assert.equal(p.svcDrawer.hasAttribute("hidden"), false);
  assert.equal(p.drawer.hasAttribute("hidden"), true);
  p.openDrawer(p.drawer);
  assert.equal(p.drawer.hasAttribute("hidden"), false);
  assert.equal(p.svcDrawer.hasAttribute("hidden"), true, "two full-width strips must not stack");
});

test("the buttons say which drawer is showing", () => {
  const p = drawers();
  const pressed = () => ({
    teams: p.probe.nodes.teamsToggle.getAttribute("aria-pressed"),
    services: p.probe.nodes.servicesToggle.getAttribute("aria-pressed")
  });
  p.openDrawer(p.svcDrawer);
  assert.deepEqual(pressed(), {teams: "false", services: "true"});
  p.openDrawer(p.drawer);
  assert.deepEqual(pressed(), {teams: "true", services: "false"});
  p.toggleDrawer(p.drawer);
  assert.deepEqual(pressed(), {teams: "false", services: "false"});
});

test("opening a drawer draws it, and drawing it is what fills it", () => {
  /* The services drawer is empty markup until renderServices runs. A
     showDrawer that only unhid it would open a blank panel. */
  const p = drawers();
  p.openDrawer(p.svcDrawer);
  assert.deepEqual(p.probe.drew, ["services"]);
  p.openDrawer(p.drawer);
  assert.deepEqual(p.probe.drew, ["services", "teams"]);
  // and the one being closed is not redrawn on the way out
  assert.equal(p.probe.drew.filter(x => x === "services").length, 1);
});

test("clicking the button of an open drawer closes it", () => {
  const p = drawers();
  p.openDrawer(p.svcDrawer);
  p.toggleDrawer(p.svcDrawer);
  assert.equal(p.svcDrawer.hasAttribute("hidden"), true);
  assert.equal(p.drawer.hasAttribute("hidden"), true, "and does not open the other one instead");
});

test("marking a service persists it and redraws what depends on it", () => {
  const handler = /svcDrawer\.addEventListener\("click"[\s\S]*?\n\}\);/.exec(SRC)[0];
  assert.match(handler, /services\.has\(id\)\?services\.delete\(id\):services\.add\(id\)/);
  assert.match(handler, /persist\(\)/);
  assert.match(handler, /render\(\)/);
  // persist is what writes the selection to this browser
  const persist = /function persist\(\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(persist, /LS\.set\("gdn\.services",\[\.\.\.services\]\)/);
});

test("an open services drawer is redrawn when the fixtures move", () => {
  // the counts on the cards are counts of games; a drawer left open
  // through a refresh would otherwise show half-hour-old figures
  const fn = /function render\(\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(fn, /if\(!svcDrawer\.hasAttribute\("hidden"\)\) renderServices\(\)/);
  assert.match(fn, /serviceCount"\)\.textContent=services\.size/);
});

/* ---- discovering the button ---- */

test("someone who has marked nothing is pointed at the new button", () => {
  /* Coverage used to announce itself by sitting in the page with the
     panel open. Behind a button it cannot, so something has to point. */
  const hint = loadFromPage(["servicesHint"],
    "const services = new Set(); const myGames = () => [{}];").servicesHint();
  assert.match(hint, /class="svc-hint"/);
  assert.match(hint, /id="svcHintOpen"/);
  assert.match(hint, /My services/);
});

test("it disappears for good once a service is marked", () => {
  const hint = loadFromPage(["servicesHint"],
    'const services = new Set(["sportsnet"]); const myGames = () => [{}];').servicesHint();
  assert.equal(hint, "");
});

test("it is not shown to someone with no fixtures to cover", () => {
  const hint = loadFromPage(["servicesHint"],
    "const services = new Set(); const myGames = () => [];").servicesHint();
  assert.equal(hint, "");
});

test("its button opens the drawer rather than scrolling somewhere", () => {
  assert.match(SRC, /#svcHintOpen"\)\)\{ openDrawer\(svcDrawer\); return; \}/);
});
