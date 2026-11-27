import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage, styleText } from "./helpers/page.mjs";

/* The board's matchup rows, as chosen on the phone trial (PR #75): side
   by side, away first and home second with "at" between in every sport ("LA at
   New York"), no
   three-letter badge beside a name that already says it, and the score
   between the two names. */

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
const P = loadFromPage(["SOCCER", "esc", "fullName", "orderedTeams", "scoreFor", "teamNameHtml", "midScore"]);
const team = (id, comp, city, name, more = {}) => ({id, home:comp, city, name, abbr:id.toUpperCase(), color:"#123", ...more});
const VAN = team("van", "NHL", "Vancouver", "Canucks"), DET = team("det", "NHL", "Detroit", "Red Wings");
const LIV = team("liv", "EPL", "Liverpool", "Liverpool");
const BRU = {id:"feed:UCL:BRU", home:"UCL", city:"Club Brugge", name:"Club Brugge", abbr:"BRU", full:true};

test("every sport is written away first, home second, at between", () => {
  for(const g of [{comp:"NHL", away:VAN, home:DET}, {comp:"UCL", away:LIV, home:BRU},
                  {comp:"RUGBY", rugby:true, away:{name:"Canada"}, home:{name:"Wales"}}]){
    const o = P.orderedTeams(g);
    assert.equal(o.a, g.away); assert.equal(o.b, g.home);
    assert.equal(o.sep, "at"); assert.equal(o.flip, true);
  }
});

test("the score is printed the same way round as the names", () => {
  // score is held [home, away]: Liverpool won 3-0 at Brugge
  assert.deepEqual(P.scoreFor({comp:"UCL", away:LIV, home:BRU}, {score:[0, 3]}), [3, 0]);
});

test("a North American club is a city over a nickname; a one-word club stays one", () => {
  /* One wrapper, so on a wide screen it reads as one name with one space
     (the row's flex gap would otherwise open between city and nickname). */
  assert.equal(P.teamNameHtml(DET, "NHL"), '<span class="g-name"><span class="g-city">Detroit</span> <span class="g-nick">Red Wings</span></span>');
  assert.equal(P.teamNameHtml(LIV, "EPL"), '<span class="g-name"><span class="g-nick">Liverpool</span></span>');
  assert.equal(P.teamNameHtml(BRU, "UCL"), '<span class="g-name"><span class="g-nick">Club Brugge</span></span>');
  assert.equal(P.teamNameHtml(null, "NHL"), '<span class="g-name"><span class="g-nick">TBD</span></span>');
});

test("the middle score marks the winner of a final, nobody in a draw or a live game", () => {
  assert.match(P.midScore([4, 3], false, true), /<b class="win">4<\/b><i>&ndash;<\/i><b>3<\/b>/);
  assert.match(P.midScore([1, 2], false, true), /<b>1<\/b><i>&ndash;<\/i><b class="win">2<\/b>/);
  assert.doesNotMatch(P.midScore([1, 1], false, true), /win/);
  assert.doesNotMatch(P.midScore([2, 1], true, false), /win/);
  assert.match(P.midScore([2, 1], true, false), /class="mid-score live"/);
});

test("a game row carries no three-letter badge", () => {
  const body = SRC.slice(SRC.indexOf("function gameRow("), SRC.indexOf("\n}\n", SRC.indexOf("function gameRow(")));
  assert.doesNotMatch(body, /crest\(/);
  const rugby = SRC.slice(SRC.indexOf("function rugbyRow("), SRC.indexOf("\n}\n", SRC.indexOf("function rugbyRow(")));
  assert.doesNotMatch(rugby, /crest\(/);
});

test("on a phone every matchup row is side by side, never wrapped by name length", () => {
  const css = styleText();
  const phone = css.slice(css.lastIndexOf("Side by side on a phone"));
  assert.match(phone, /\.game\.matchup \.g-teams\{display:grid;grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\)/);
  assert.match(phone, /\.game\.matchup\{display:flex;flex-wrap:wrap/);
  assert.match(phone, /\.game\.matchup \.g-match\{display:contents\}/);
  assert.match(phone, /\.game\.matchup \.g-teams\{order:4;flex:1 0 100%\}/, "the teams always get a line of their own");
  assert.match(phone, /\.game\.matchup\.scored \.score-line\{display:none\}/);
  assert.match(css, /\.mid-score\{display:none\}/, "wider screens keep their score cell");
});

test("the phone row is the simple one: no countdown, no records, no venue", () => {
  const css = styleText();
  const phone = css.slice(css.lastIndexOf("Side by side on a phone"));
  assert.match(phone, /\.game\.matchup \.g-rec\{display:none\}/, "records move to the window");
  assert.match(phone, /\.game\.matchup\.is-sched \.g-score\{display:none\}/, "no countdown before a game");
  assert.match(phone, /\.game\.matchup \.g-meta > :not\(\.lg-tag\):not\(\.conf-note\)\{display:none\}/,
    "the league tag and a stale-schedule warning stay; venue, stage and series move");
  assert.doesNotMatch(phone, /\.g-watch\{display:none/, "where to watch stays on the row");
});

test("the window opens from the row, closes on Escape first, and stays current", () => {
  assert.match(SRC, /const row = e\.target\.closest\("\.game\.matchup\[data-game-id\]"\);\s*if\(row\) openGame\(/);
  assert.match(SRC, /if\(e\.target\.closest\("button, a, summary, input, select, label"\)\) return;/, "a row's own buttons keep their jobs");
  assert.match(SRC, /if\(e\.key!=="Escape"\) return;\s*if\(sheetGame\)\{ closeGame\(\); return; \}/);
  assert.match(SRC, /if\(sheetGame\) paintSheet\(\);/, "a re-render repaints the open window");
  assert.match(SRC, /role="dialog" aria-modal="true" aria-labelledby="sheetTitle"/);
  assert.match(styleText(), /\.sd-close\{[^}]*width:44px;height:44px/, "a 44px close target");
});

test("the condensed row keeps the save button's 44px target", () => {
  const css = styleText();
  const phone = css.slice(css.lastIndexOf("Side by side on a phone"));
  assert.match(phone, /\.game\.matchup \.bell\{align-self:center;margin:-12px -8px -12px 0\}/);
  assert.doesNotMatch(phone, /\.bell\{[^}]*(width|height):\s*(?!44)\d/);
});
