import { test } from "node:test";
import assert from "node:assert/strict";
import { styleText, mediaBlock, ruleFor } from "./helpers/page.mjs";

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
