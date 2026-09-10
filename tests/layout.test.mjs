import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { styleText, mediaBlock, ruleFor } from "./helpers/page.mjs";

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");

/* No browser here, so these assert the shipped rules rather than the
   rendered pixels — enough to catch the regression that caused the bug,
   not enough to claim the layout was seen. */

const css = styleText();
const narrow = mediaBlock("(max-width:360px)");
const mobile = mediaBlock("(max-width:760px)");

/* --- the 320px overlap: a name painting into the score column --- */

test("a 320px breakpoint exists", () => {
  assert.ok(narrow, "expected an @media (max-width:360px) block");
});

test("at 320 the team name may wrap instead of overflowing its column", () => {
  const rule = ruleFor(narrow, ".g-team");
  assert.ok(rule, ".g-team must be addressed at the narrow breakpoint");
  assert.match(rule, /white-space\s*:\s*normal/);
});

test("at 320 a single long word can break, which is what caps min-content width", () => {
  // overflow-wrap:anywhere reduces the element's min-content size;
  // break-word does not, and would leave the overflow possible
  assert.match(ruleFor(narrow, ".g-team"), /overflow-wrap\s*:\s*anywhere/);
});

test("the shrinkable-column guarantee holds at every width", () => {
  assert.match(ruleFor(css, ".g-match"), /min-width\s*:\s*0/);
  assert.match(ruleFor(css, ".g-team"), /min-width\s*:\s*0/);
});

test("wider viewports keep the single-line treatment they were verified at", () => {
  // 375/390/430 were checked visually and must not change
  assert.match(ruleFor(css, ".g-team"), /white-space\s*:\s*nowrap/);
});

test("the status column is content-sized on mobile, not squeezed to nothing", () => {
  // the base rule reserves width for the wide layout; on mobile the
  // column is sized to its content instead, so legibility rests on the
  // status text never wrapping rather than on a reserved minimum
  assert.match(ruleFor(css, ".g-score"), /min-width\s*:\s*\d+px/);
  assert.match(ruleFor(mobile, ".g-score"), /min-width\s*:\s*0/);
  // the narrow breakpoint must not shrink it further or hide it
  const narrowScore = ruleFor(narrow, ".g-score");
  if(narrowScore) assert.doesNotMatch(narrowScore, /display\s*:\s*none/);
});

test("the status text itself is never wrapped into ambiguity", () => {
  assert.match(ruleFor(css, ".score-state"), /white-space\s*:\s*nowrap/);
  assert.match(ruleFor(css, ".countdown"), /white-space\s*:\s*nowrap/);
});

/* --- the compact, one-line header --- */

test("the top bar stays on one line because setup moved into the title menu", () => {
  const rule = ruleFor(mobile, ".topbar-in");
  assert.ok(rule, ".topbar-in must be addressed at the mobile breakpoint");
  assert.match(rule, /flex-wrap\s*:\s*nowrap/);
  const header = /<header class="topbar">[\s\S]*?<\/header>/.exec(SRC)[0];
  assert.match(header, /id="appMenuToggle"/);
  assert.match(header, /id="appMenu"/);
  assert.ok(header.indexOf('id="teamsToggle"') > header.indexOf('id="appMenu"'));
  assert.ok(header.indexOf('id="servicesToggle"') > header.indexOf('id="appMenu"'));
});

test("the iOS header reserves the native safe area", () => {
  assert.match(ruleFor(css, ".topbar"), /padding-top\s*:\s*env\(safe-area-inset-top\)/);
  assert.match(ruleFor(css, ".wrap"), /safe-area-inset-left/);
  assert.match(ruleFor(css, ".wrap"), /safe-area-inset-right/);
});

test("the mobile header keeps its horizontal gutter while adding vertical padding", () => {
  const rule = ruleFor(mobile, ".topbar-in");
  assert.match(rule, /padding-top\s*:\s*5px/);
  assert.match(rule, /padding-bottom\s*:\s*5px/);
  assert.doesNotMatch(rule, /padding\s*:\s*10px\s+0/,
    "a shorthand must not erase the .wrap side padding");
});

test("what's on has a page heading above the swipeable rail", () => {
  const section = /<section class="whats-on"[\s\S]*?<\/section>/.exec(SRC);
  assert.ok(section, "expected the What's on section");
  assert.ok(section[0].indexOf('class="rail-head"') < section[0].indexOf('class="rail"'));
  assert.match(section[0], /id="railCount"/);
});

test("teams and services no longer spend permanent header space", () => {
  const header = /<header class="topbar">[\s\S]*?<\/header>/.exec(SRC)[0];
  const menu = /<div class="app-menu"[\s\S]*?<\/div>\s*<\/div>/.exec(header)[0];
  assert.match(menu, /My teams/);
  assert.match(menu, /My services/);
  assert.doesNotMatch(header.slice(header.indexOf('<div class="top-actions">')), /teamsToggle|servicesToggle/);
});

test("the narrow header compresses its three visible pieces", () => {
  assert.match(ruleFor(narrow, ".topbar-in"), /gap\s*:\s*4px/);
  const icon = ruleFor(narrow, ".icon-btn");
  const view = ruleFor(narrow, ".view-toggle");
  assert.match(icon, /padding\s*:\s*5px\s+7px/);
  assert.match(icon, /font-size\s*:\s*11\.5px/);
  assert.match(view, /min-width\s*:\s*64px/);
});

test("the score toggle drops to its icon at 320, and keeps a name", () => {
  /* The open and closed eyes already differ, so the word is what can go.
     A button with no text and no label would be the control that decides
     whether this page spoils a result, announcing itself as nothing. */
  assert.match(ruleFor(narrow, "#scoreToggleLabel"), /display\s*:\s*none/);
  assert.match(SRC, /stg\.setAttribute\("aria-label", scoreLabel\)/);
});

test("every phone card uses one time, matchup, result and services hierarchy", () => {
  const card = ruleFor(mobile, ".game");
  assert.match(card, /grid-template-columns\s*:\s*minmax\(0,1fr\)\s+minmax\(70px,auto\)/);
  assert.match(card, /grid-template-areas\s*:\s*"time bell" "match score" "watch watch"/);
  assert.match(ruleFor(mobile, ".g-watch"), /grid-area\s*:\s*watch/);
  assert.match(ruleFor(mobile, ".g-watch"), /flex-direction\s*:\s*row/);
  assert.match(ruleFor(mobile, ".bell"), /grid-area\s*:\s*bell/);
  assert.equal(ruleFor(mobile, ".results-in .game"), null,
    "Recent results should inherit the universal card rather than drift into another layout");
});

test("tennis gets a full-width set-score line on phones", () => {
  assert.match(SRC, /class="game tennis-game/);
  const row = ruleFor(mobile, ".tennis-game,.event-game");
  assert.match(row, /grid-template-columns\s*:\s*minmax\(0,1fr\)\s+44px/);
  assert.match(row, /grid-template-areas\s*:\s*"time bell" "match match" "score score" "watch watch"/);
  assert.match(ruleFor(mobile, ".tennis-game .g-score"), /flex-direction\s*:\s*row/);
  assert.match(ruleFor(mobile, ".tennis-game .g-score"), /flex-wrap\s*:\s*wrap/);
  const next = ruleFor(mobile, ".tennis-game .g-score .conf-note,.tennis-game .next-up");
  assert.match(next, /flex-basis\s*:\s*100%/);
  assert.match(next, /white-space\s*:\s*normal/);
  assert.match(next, /overflow-wrap\s*:\s*anywhere/);
  const note = ruleFor(mobile, ".tennis-game .match-note");
  assert.match(note, /text-transform\s*:\s*none/);
  assert.match(note, /letter-spacing\s*:\s*0/);
});

test("cycling gets the same specialty layout and a readable podium", () => {
  assert.match(SRC, /class="game event-game/);
  assert.match(ruleFor(mobile, ".event-game .g-score"), /align-items\s*:\s*flex-start/);
  assert.match(ruleFor(mobile, ".event-game .podium"), /text-align\s*:\s*left/);
  assert.match(SRC, /const racing = state === "today" && !g\.podium/);
  assert.match(SRC, /event-game'\+\(racing\?" is-live":""\)/,
    "a stage that merely happened today must not look live after it finishes");
});

test("nothing in the header is pinned to a width it cannot give up", () => {
  const bar = /<header class="topbar">[\s\S]*?<\/header>/.exec(SRC)[0];
  assert.doesNotMatch(bar, /style="[^"]*width:\s*\d/);
  const brand = ruleFor(css, ".brand");
  assert.match(brand, /min-width\s*:\s*0/, "the wordmark must be able to shrink");
});

test("the coverage panel's own chrome went with the panel", () => {
  // the pieces the drawer reuses stay; the <details> styling does not
  assert.equal(ruleFor(css, ".coverage"), null);
  assert.equal(ruleFor(css, ".cov-h"), null);
  assert.ok(ruleFor(css, ".svc-grid"), "the service cards are still styled");
  assert.ok(ruleFor(css, ".cov-bar"), "so is the coverage bar");
  assert.ok(ruleFor(css, ".cov-note"), "and the unconfirmed-carrier note");
});

test("the drawer has room for the coverage line it now carries", () => {
  assert.ok(ruleFor(css, ".drawer-sub"), ".drawer-sub must be styled");
  assert.ok(ruleFor(css, ".svc-hint"), "the first-run hint must be styled");
});

test("team bulk actions are visually separate from the league disclosure", () => {
  assert.match(ruleFor(css, ".picker-bulk-row"), /border-bottom\s*:\s*1px solid var\(--line\)/);
  assert.match(ruleFor(css, ".picker-bulk,.picker-clear"), /min-height\s*:\s*34px/);
  assert.match(ruleFor(css, ".picked-first .picker-clear"), /flex\s*:\s*none/);
  assert.match(ruleFor(css, ".picker-clear.confirm"), /var\(--warn-soft\)/);
});

test("carrier ownership is shown on the service itself, without a second badge", () => {
  const pip = ruleFor(css, ".svc .pip");
  assert.match(pip, /border-radius\s*:\s*50%/);
  assert.match(pip, /border[^;]*var\(--line-strong\)/);
  assert.match(ruleFor(css, ".svc.owned .pip"), /background\s*:\s*var\(--ok\)/);
  assert.equal(ruleFor(css, ".tag-cov"), null);
  assert.doesNotMatch(SRC, />You have it<|>Needs [^<]*</);
});

/* --- the save control --- */

test("the save control keeps a 44px target on mobile", () => {
  const rule = ruleFor(mobile, ".bell");
  assert.ok(rule, ".bell must be addressed at the mobile breakpoint");
  assert.match(rule, /width\s*:\s*44px/);
  assert.match(rule, /height\s*:\s*44px/);
  assert.doesNotMatch(rule, /display\s*:\s*none/);
});

/* --- the calendar fix, now visually verified: guard it --- */

test("the calendar keeps columns that are allowed to shrink", () => {
  assert.match(ruleFor(css, ".cal-grid"), /repeat\(7,\s*minmax\(0,\s*1fr\)\)/);
});

test("calendar cells and events keep their shrink guarantees", () => {
  assert.match(ruleFor(css, ".cal-cell"), /min-width\s*:\s*0/);
  assert.match(ruleFor(css, ".cal-ev"), /min-width\s*:\s*0/);
});

test("no rule reintroduces a fixed seven-column calendar grid", () => {
  assert.doesNotMatch(css, /grid-template-columns\s*:\s*repeat\(7,\s*1fr\)/);
});
