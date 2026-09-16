import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { styleText, mediaBlock } from "./helpers/page.mjs";

/* iOS zooms the page in when a focused input, select or textarea has a
   computed font size under 16px, and never zooms back out. The team
   picker's search box was 13px: one tap, and the drawer stayed clipped
   on the right until the page was reloaded — in the app, until it was
   relaunched. These hold every control on the page to 16px on a touch
   screen, and refuse the tempting fix of forbidding zoom in the viewport
   tag, which would take pinch-zoom away from everyone. */

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
const BUILD = readFileSync(new URL("../build.js", import.meta.url), "utf8");
const CSS = styleText();
const COARSE = mediaBlock("(pointer: coarse)") || "";
const MIN_PX = 16;

/* Every form control the page can put on screen, in markup or in a JS
   template string, with the selectors that can reach it. */
const controls = [...SRC.matchAll(/<(input|select|textarea)\b([^>]*)/g)].map(m => {
  const attrs = m[2];
  const id = (/\bid="([^"]+)"/.exec(attrs) || [])[1];
  const classes = ((/\bclass="([^"]+)"/.exec(attrs) || [, ""])[1]).split(/\s+/).filter(Boolean);
  const inline = (/\bstyle="([^"]*)"/.exec(attrs) || [, ""])[1];
  return { tag: m[1], id, classes, inline, at: SRC.slice(0, m.index).split("\n").length };
});

const px = decl => { const m = /(?:^|;|\s)font-size\s*:\s*([\d.]+)px/.exec(decl); return m ? Number(m[1]) : null; };

/* Every rule in a block of CSS, flattened: [selector, declarations].
   Media blocks are entered so a rule inside one is still seen. */
function rules(css){
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while((m = re.exec(css))){
    const sel = m[1].trim().replace(/^[^@]*@media[^{]*$/, "");
    if(!sel || sel.startsWith("@")) continue;
    out.push([sel.split("\n").pop().trim(), m[2]]);
  }
  return out;
}

/* Does this selector reach the control — by tag, class or id? Attribute
   and pseudo suffixes are allowed; a selector for a different element
   that merely contains the word is not matched. */
function reaches(selector, c){
  return selector.split(",").some(s => {
    const last = s.trim().split(/[\s>+~]+/).pop() || "";
    const simple = last.replace(/::?[a-z-]+(\([^)]*\))?/g, "").replace(/\[[^\]]*\]/g, "");
    if(new RegExp("^" + c.tag + "(\\.|#|$)").test(simple)) return true;
    if(c.id && simple.includes("#" + c.id)) return true;
    return c.classes.some(cls => new RegExp("\\." + cls + "(\\.|#|$)").test(simple));
  });
}

test("the page has form controls to hold to this at all", () => {
  assert.ok(controls.length >= 1);
  assert.ok(controls.some(c => c.id === "teamSearch"), "the team picker search box is the one that zoomed");
});

test("no input, select or textarea is under 16px on a touch screen", () => {
  const outsideCoarse = CSS.replace(COARSE, "");
  const problems = [];
  for(const c of controls){
    const name = c.tag + (c.id ? "#" + c.id : "") + c.classes.map(x => "." + x).join("");
    const inlinePx = px(c.inline);
    if(inlinePx != null && inlinePx < MIN_PX) problems.push(name + " (line " + c.at + "): inline style sets " + inlinePx + "px");
    const small = rules(outsideCoarse).filter(([sel, decl]) => reaches(sel, c) && px(decl) != null && px(decl) < MIN_PX);
    if(!small.length) continue;
    const override = rules(COARSE).filter(([sel, decl]) => reaches(sel, c) && px(decl) != null && px(decl) >= MIN_PX);
    if(!override.length){
      problems.push(name + " (line " + c.at + "): " + small.map(([sel, decl]) => sel + " sets " + px(decl) + "px").join(", ")
        + " and nothing under @media (pointer: coarse) raises it to " + MIN_PX + "px");
    }
  }
  assert.deepEqual(problems, [], "iOS zooms on focus for each of these and does not zoom back:\n  " + problems.join("\n  "));
});

test("the team picker search is 13px with a mouse and 16px under a finger", () => {
  const base = rules(CSS.replace(COARSE, "")).find(([sel]) => sel === ".search");
  assert.ok(base, ".search must have a base rule");
  assert.equal(px(base[1]), 13, "the desktop look is unchanged");
  const coarse = rules(COARSE).find(([sel]) => sel === ".search");
  assert.ok(coarse, "and a coarse-pointer override");
  assert.equal(px(coarse[1]), 16);
  assert.match(coarse[1], /padding\s*:/, "with the padding brought in so the box keeps its height");
});

test("the viewport tag is not the fix", () => {
  /* Forbidding zoom would stop this too, by taking pinch-zoom away from
     everyone who needs it. The tag stays exactly as it was. */
  const meta = /<meta name="viewport" content="([^"]*)"/.exec(BUILD);
  assert.ok(meta, "build.js writes the viewport tag");
  assert.doesNotMatch(meta[1], /user-scalable\s*=\s*(no|0)/);
  assert.doesNotMatch(meta[1], /maximum-scale/);
  assert.match(meta[1], /width=device-width/);
  assert.match(meta[1], /initial-scale=1/);
});
