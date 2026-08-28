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

/* --- the header, now carrying a fourth control --- */

test("the top bar is allowed to wrap rather than overflow", () => {
  /* A wordmark and four controls do not fit 320px on one line and are
     not meant to. What must not happen is the row staying one line and
     pushing a control off the side. */
  const rule = ruleFor(mobile, ".topbar-in");
  assert.ok(rule, ".topbar-in must be addressed at the mobile breakpoint");
  assert.match(rule, /flex-wrap\s*:\s*wrap/);
});

test("the header buttons carry a short label for the narrowest screens", () => {
  /* Both labels ship and the breakpoint chooses, rather than JavaScript
     rewriting the button as the window moves. */
  assert.match(css, /\.lbl-short\{display:none\}/);
  const short = ruleFor(narrow, ".lbl-short");
  const full = ruleFor(narrow, ".lbl-full");
  assert.ok(short && full, "both labels must be addressed at 360");
  assert.match(short, /display\s*:\s*inline/);
  assert.match(full, /display\s*:\s*none/);
});

test("the score toggle drops to its icon at 320, and keeps a name", () => {
  /* The open and closed eyes already differ, so the word is what can go.
     A button with no text and no label would be the control that decides
     whether this page spoils a result, announcing itself as nothing. */
  assert.match(ruleFor(narrow, "#scoreToggleLabel"), /display\s*:\s*none/);
  assert.match(SRC, /stg\.setAttribute\("aria-label", scoreLabel\)/);
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
