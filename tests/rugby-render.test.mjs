import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage, styleText, mediaBlock, ruleFor } from "./helpers/page.mjs";

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");

/* There is no browser here, so these assert the markup the page actually
   builds and the CSS it actually ships — enough to catch a regression in
   what a rugby row says, not enough to claim it was looked at. What was
   and was not seen in a browser is stated in the branch's report. */

/* `crest` cannot be pulled out by the extractor — its declaration
   contains a semicolon inside a string literal — so it is stubbed. It is
   decoration; nothing asserted below depends on it. */
const PREAMBLE = `
  const DAY = 86400000;
  let showScores = true, dataStale = false, liveMode = true;
  let services = new Set(), revealed = new Set(), alerts = new Set();
  let rugbyStars = new Set();
  const crest = t => "";
  const normName = x => String(x||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  const fmtDayLong = k => k;
  const isNarrow = () => false;
`;
const NAMES = ["COMPS","SERVICES","CARRIER_SERVICE","SRC","CHECKED","tv","st","CDN_MLS","RIGHTS",
  "resolveRights","RUGBY_ACTIVE","RUGBY_TERMINAL","rugbyIsActive","rugbyIsTerminal",
  "esc","inkOn","pad","ymd","fmtTime","fmtShortDate","countdownText","BELL","saveButton",
  "provenanceOf","servicesFor","covered","venueDayNote","RUGBY_STATE_TEXT","isStarred","rugbyRow"];

function page(over = ""){ return loadFromPage(NAMES, PREAMBLE + over); }

const NOW = Date.parse("2026-11-07T13:00:00Z");
const nation = (slug, name, abbr) => ({id:"ru:"+slug, name, nation:slug, abbr, color:"#4A5B6A", full:true});
const row = (over = {}) => Object.assign({
  id:"g1", rugby:true, comp:"RUNC", start: Date.parse("2026-11-07T14:10:00Z"),
  home: nation("scotland","Scotland","SCO"), away: nation("new-zealand","New Zealand","NZL"),
  stage:"", venue:{name:"Murrayfield", city:"Edinburgh", country:"Scotland", offset:0},
  sources:["espn","wr"], listed:true, espn:true, fromFeed:true,
  ru:{state:"scheduled", label:"", timeTBD:false},
  result:{status:"scheduled", label:"", score:null}
}, over);

/* ---------------- what a row says ---------------- */

test("a scheduled row names both nations, the competition and the venue", () => {
  const html = page().rugbyRow(row(), NOW);
  assert.match(html, /Scotland/);
  assert.match(html, /New Zealand/);
  assert.match(html, /Nations C&#039;ship|Nations C'ship/);
  assert.match(html, /Murrayfield/);
  assert.match(html, /Kick-off/);
});

test("the two nations are separated by v, not by at", () => {
  const html = page().rugbyRow(row(), NOW);
  assert.match(html, /<span class="at">v<\/span>/);
});

test("a round is shown when the source gave one", () => {
  const html = page().rugbyRow(row({stage:"Semi-Finals", comp:"RUPNC"}), NOW);
  assert.match(html, /Semi-Finals/);
});

test("no venue is invented when the source supplied none", () => {
  const html = page().rugbyRow(row({venue:null}), NOW);
  assert.doesNotMatch(html, /class="g-meta">[\s\S]*?\bat /);
});

/* ---------------- states ---------------- */

const stateRow = (state, over = {}) => row(Object.assign({
  ru:{state, label:"", timeTBD:false},
  result:{status: state === "final" ? "final" : "live", label:"", score:[17, 12]}
}, over));

test("a live row is marked live and carries the source's own clock text", () => {
  const html = page().rugbyRow(stateRow("live", {ru:{state:"live", label:"52'"}}), NOW);
  assert.match(html, /class="game is-live/);
  assert.match(html, /dot-live/);
  assert.match(html, /52&#039;|52'/);
});

test("half-time says half-time and still reads as live", () => {
  const html = page().rugbyRow(stateRow("halftime"), NOW);
  assert.match(html, /Half-time/);
  assert.match(html, /is-live/);
});

test("delayed and suspended say so and stay live", () => {
  for(const [s, word] of [["delayed","Delayed"], ["suspended","Suspended"]]){
    const html = page().rugbyRow(stateRow(s), NOW);
    assert.match(html, new RegExp(word), s);
    assert.match(html, /is-live/, s);
  }
});

test("postponed, cancelled and abandoned are said plainly and are not live", () => {
  for(const [s, word] of [["postponed","Postponed"], ["cancelled","Cancelled"], ["abandoned","Abandoned"]]){
    const html = page().rugbyRow(stateRow(s, {result:{status:"scheduled", label:"", score:null}}), NOW);
    assert.match(html, new RegExp(word), s);
    assert.doesNotMatch(html, /is-live/, s);
    assert.doesNotMatch(html, /Final/, s);
  }
});

test("a final says FT and shows the score", () => {
  const html = page().rugbyRow(stateRow("final", {ru:{state:"final", label:"FT"},
    result:{status:"final", label:"FT", score:[31, 24]}}), NOW);
  assert.match(html, /31 &ndash; 24/);
  assert.match(html, /FT/);
  assert.doesNotMatch(html, /is-live/);
});

test("an unresolved match says so instead of guessing a result", () => {
  const html = page().rugbyRow(row({ru:{state:"unknown", label:""},
    result:{status:"unknown", label:"", score:null}, start: NOW - 3*3600000}), NOW);
  assert.match(html, /Status unavailable/);
  assert.match(html, /Awaiting update/);
  assert.doesNotMatch(html, /Final/);
  assert.doesNotMatch(html, /countdown/);
});

/* ---------------- scores follow the existing preference ---------------- */

test("with scores off the number is hidden behind a reveal, and the state is not", () => {
  const p = page("showScores = false;");
  const html = p.rugbyRow(stateRow("live", {ru:{state:"live", label:"52'"},
    result:{status:"live", label:"52'", score:[17, 12]}}), NOW);
  assert.doesNotMatch(html, /17 &ndash; 12/);
  assert.match(html, /hidden-score/);
  assert.match(html, /Live now/);
});

test("with scores on the number is printed as given", () => {
  const html = page().rugbyRow(stateRow("live", {ru:{state:"live", label:"52'"},
    result:{status:"live", label:"52'", score:[17, 12]}}), NOW);
  assert.match(html, /17 &ndash; 12/);
});

test("a final with no score says so rather than showing zeros", () => {
  const html = page().rugbyRow(stateRow("final", {ru:{state:"final", label:"FT"},
    result:{status:"final", label:"FT", score:null}}), NOW);
  assert.match(html, /No score available/);
  assert.doesNotMatch(html, /0 &ndash; 0/);
});

/* ---------------- starred nations ---------------- */

test("a starred nation is marked without anything else being removed", () => {
  const p = page(`rugbyStars = new Set(["scotland"]);`);
  const starred = p.rugbyRow(row(), NOW);
  assert.match(starred, /g-team starred/);
  assert.match(starred, /star-pip/);
  assert.match(starred, /has-star/);
  // and the unstarred nation in the same row is still fully named
  assert.match(starred, /New Zealand/);
});

test("a row with no starred nation is rendered in full and unmarked", () => {
  const p = page(`rugbyStars = new Set(["ireland"]);`);
  const html = p.rugbyRow(row(), NOW);
  assert.doesNotMatch(html, /star-pip/);
  assert.doesNotMatch(html, /has-star/);
  assert.match(html, /Scotland/);
  assert.match(html, /New Zealand/);
  assert.match(html, /Murrayfield/);
});

test("starring never changes the length or structure of the row", () => {
  const off = page(`rugbyStars = new Set();`).rugbyRow(row(), NOW);
  const on  = page(`rugbyStars = new Set(["scotland"]);`).rugbyRow(row(), NOW);
  const cells = h => (h.match(/class="g-(time|match|watch|score)"/g) || []).length;
  assert.equal(cells(off), cells(on));
  assert.equal(cells(off), 4);
});

/* ---------------- carriage ---------------- */

test("the Six Nations names Premier Sports", () => {
  const html = page().rugbyRow(row({comp:"RU6N"}), NOW);
  assert.match(html, /Premier Sports/);
  assert.doesNotMatch(html, /Coverage TBD/);
});

test("the Nations Championship names Premier Sports", () => {
  assert.match(page().rugbyRow(row({comp:"RUNC"}), NOW), /Premier Sports/);
});

test("the Autumn Nations Series names DAZN", () => {
  assert.match(page().rugbyRow(row({comp:"RUANS"}), NOW), /DAZN/);
});

test("an unverified competition says Coverage TBD and names no carrier", () => {
  for(const comp of ["RUTEST", "RUPNC", "RUWNC", "RUTRC", "RURWC", "RULIONS"]){
    const html = page().rugbyRow(row({comp}), NOW);
    assert.match(html, /Coverage TBD/, comp);
    assert.match(html, /Not confirmed in Canada/, comp);
    assert.doesNotMatch(html, /You have it/, comp);
  }
});

test("a Lions tour does not inherit the 2025 carrier", () => {
  const html = page().rugbyRow(row({comp:"RULIONS"}), NOW);
  assert.match(html, /Coverage TBD/);
  // the 2025 listing is recorded in the note, not asserted as current
  const rule = /\{comp:"RULIONS"[\s\S]*?\},\n/.exec(SRC)[0];
  assert.match(rule, /confidence:"unknown"/);
  assert.match(rule, /2025/);
});

test("an uncertain competition is never marked as covered", () => {
  const p = page(`services = new Set(["dazn","premier","sportsnet","tsn"]);`);
  const html = p.rugbyRow(row({comp:"RUTEST"}), NOW);
  assert.doesNotMatch(html, /You have it/);
  assert.match(html, /Coverage TBD/);
});

test("Premier Sports is a service someone can say they subscribe to", () => {
  const p = page(`services = new Set(["premier"]);`);
  assert.match(p.rugbyRow(row({comp:"RU6N"}), NOW), /You have it/);
  assert.equal(p.SERVICES.premier.label, "Premier Sports");
  assert.equal(p.CARRIER_SERVICE["Premier Sports"], "premier");
});

/* ---------------- time and the date line ---------------- */

test("a TBD kickoff says TBD rather than showing a time", () => {
  const html = page().rugbyRow(row({ru:{state:"scheduled", label:"", timeTBD:true}}), NOW);
  assert.match(html, /Time TBD/);
});

test("the venue's day is noted only when it differs from the reader's", () => {
  const p = page();
  // Sydney, 2026-10-17T05:00Z. The venue offset is known, and in a
  // North American zone the venue's Saturday is the reader's Friday.
  const syd = row({start: Date.parse("2026-10-17T05:00:00Z"),
    venue:{name:"Accor Stadium", city:"Sydney", country:"Australia", offset:11}});
  const html = p.rugbyRow(syd, NOW);
  if(new Date(syd.start).getDay() !== new Date(syd.start + 11*3600000).getUTCDay()){
    assert.match(html, /venue-day/);
    assert.match(html, /Sydney/);
  }
  // a match whose venue day matches the reader's says nothing extra
  const home = row({venue:{name:"Murrayfield", city:"Edinburgh", country:"Scotland", offset:0}});
  const plain = p.rugbyRow(home, NOW);
  assert.doesNotMatch(plain, /venue-day/);
});

test("a compound city name is shortened rather than painted across the row", () => {
  // World Rugby writes some cities as a compound. The whole string in a
  // 74px column ran straight over the competition chip beside it.
  const p = page();
  const html = p.rugbyRow(row({start: Date.parse("2026-09-05T05:50:00Z"),
    venue:{name:"Hanazono Rugby Stadium", city:"Osaka Prefecture, Higashiosaka City",
           country:"Japan", offset:9}}), NOW);
  const note = /<span class="venue-day">([^<]*)<\/span>/.exec(html);
  assert.ok(note, "the note must be present for this fixture");
  assert.ok(note[1].length <= 26, "got: " + note[1]);
  assert.doesNotMatch(note[1], /Higashiosaka/);
  // the full venue still appears where there is room for it
  assert.match(html, /Higashiosaka City/);
});

test("a pipe-separated city keeps only its first name in the note", () => {
  const p = page();
  for(const [city, want] of [["Sydney | Wangal", "Sydney"], ["Perth | Boorloo", "Perth"]]){
    const html = p.rugbyRow(row({start: Date.parse("2026-10-17T05:00:00Z"),
      venue:{name:"Stadium", city, country:"Australia", offset:11}}), NOW);
    const note = /<span class="venue-day">([^<]*)<\/span>/.exec(html);
    if(note) assert.match(note[1], new RegExp(want + "$"), city);
  }
});

test("the time column can shrink, so nothing in it can overflow the row", () => {
  assert.match(ruleFor(css, ".g-time"), /min-width\s*:\s*0/);
});

test("no venue-day claim is made when the offset is unknown", () => {
  const html = page().rugbyRow(row({start: Date.parse("2026-10-17T05:00:00Z"),
    venue:{name:"Accor Stadium", city:"Sydney", country:"Australia", offset:null}}), NOW);
  assert.doesNotMatch(html, /venue-day/);
});

/* ---------------- undecided opponents ---------------- */

test("a fixture with an undecided opponent shows what the feed called it", () => {
  const html = page().rugbyRow(row({comp:"RUPNC", stage:"Final",
    home:{id:"ru:tbd:winnerm1", name:"Winner M1", abbr:"WINN", color:"#5A6478", full:true, tbdSide:true},
    away:{id:"ru:tbd:winnerm2", name:"Winner M2", abbr:"WINN", color:"#5A6478", full:true, tbdSide:true}}), NOW);
  assert.match(html, /Winner M1/);
  assert.match(html, /Winner M2/);
  assert.match(html, /Opponent TBD/);
  assert.match(html, /Final/);
});

/* ---------------- the competition chip ---------------- */

test("every rugby competition has a chip label and a colour", () => {
  const { COMPS } = page();
  const rugby = Object.entries(COMPS).filter(([, c]) => c.rugby);
  assert.ok(rugby.length >= 8);
  for(const [id, c] of rugby){
    assert.ok(c.short && c.short.length <= 16, id + " needs a short chip label");
    assert.match(c.color, /^#[0-9A-Fa-f]{6}$/, id);
    assert.ok(c.name, id);
  }
});

test("rugby competition colours are distinct from each other", () => {
  const { COMPS } = page();
  const colours = Object.values(COMPS).map(c => c.color.toLowerCase());
  assert.equal(new Set(colours).size, colours.length, "two competitions share a colour");
});

test("the competition filter is the existing one, so rugby gets a chip for free", () => {
  const f = /function renderFilters\(\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(f, /myComps\(\)/);
  assert.match(f, /data-comp/);
});

/* ---------------- the calendar ---------------- */

test("rugby reads home v away in the calendar, not away at home", () => {
  const cal = /function renderCalendar\([\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(cal, /g\.rugby[\s\S]*?" v "/);
  assert.match(cal, /" @ "/, "the North American form must still exist for the other sports");
});

test("the calendar shows a rugby state rather than falling through to FT", () => {
  const cal = /function renderCalendar\([\s\S]*?\n\}/.exec(SRC)[0];
  for(const tag of ["PPD", "CANC", "ABD"]) assert.ok(cal.includes(tag), tag);
});

test("a starred nation is picked out in the calendar too", () => {
  const cal = /function renderCalendar\([\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(cal, /isStarred/);
});

/* ---------------- layout ---------------- */

const css = styleText();
const narrow = mediaBlock("(max-width:360px)");
const mobile = mediaBlock("(max-width:760px)");

test("the rugby row reuses the grid that was verified at every width", () => {
  // Same five columns as every other row, so the widths already checked
  // still hold rather than a second layout needing its own verification.
  const ru = /function rugbyRow\([\s\S]*?\n\}/.exec(SRC)[0];
  for(const cls of ["g-time", "g-match", "g-teams", "g-meta", "g-watch", "g-score"]){
    assert.ok(ru.includes('class="' + cls), cls + " must be the shared class");
  }
  assert.match(ruleFor(css, ".game"), /grid-template-columns:74px 1fr auto auto 34px/);
});

test("a starred nation cannot push a name out of its column at 320px", () => {
  assert.match(ruleFor(narrow, ".g-team"), /white-space\s*:\s*normal/);
  assert.match(ruleFor(narrow, ".g-team"), /overflow-wrap\s*:\s*anywhere/);
  assert.match(ruleFor(css, ".g-team"), /min-width\s*:\s*0/);
  const pip = ruleFor(css, ".star-pip");
  assert.ok(pip, ".star-pip must be styled");
  assert.match(pip, /flex\s*:\s*none/, "the star must not be squeezed to nothing");
});

test("the venue-day note stays readable in full and inside its column", () => {
  // It is the only thing explaining why a Saturday match sits under
  // Friday, so it wraps rather than being clipped — and overflow-wrap is
  // what caps its min-content width so it cannot paint across the row.
  const rule = ruleFor(css, ".venue-day");
  assert.ok(rule);
  assert.match(rule, /overflow-wrap\s*:\s*anywhere/);
  assert.match(rule, /max-width\s*:\s*100%/);
  assert.doesNotMatch(rule, /white-space\s*:\s*nowrap/);
  const n = ruleFor(narrow, ".venue-day");
  if(n) assert.doesNotMatch(n, /display\s*:\s*none/);
});

test("the status column keeps the treatment it was verified at", () => {
  assert.match(ruleFor(css, ".g-score"), /min-width\s*:\s*\d+px/);
  assert.match(ruleFor(mobile, ".g-score"), /min-width\s*:\s*0/);
  assert.match(ruleFor(css, ".score-state"), /white-space\s*:\s*nowrap/);
});

test("the star reads as more than a colour", () => {
  // A hue-only cue is invisible to a good share of readers and on a
  // monochrome display; the glyph carries the same information.
  const ru = /function rugbyRow\([\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(ru, /&#9733;/);
  assert.match(ru, /aria-label="Starred nation"/);
});

test("the nation picker keeps a usable target and says what starring does", () => {
  assert.ok(ruleFor(css, ".ru-star"), ".ru-star must be styled");
  const picker = /function renderRugbyPicker\(\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(picker, /aria-pressed/);
  assert.match(picker, /Starring changes nothing about which matches are listed/);
});
