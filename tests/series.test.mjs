import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage } from "./helpers/page.mjs";
import { loadFromBuild } from "./helpers/build.mjs";

/* Where a game stands in its best-of series — "MIL leads series 2-0"
   under the matchup of a postseason game.

   Every payload here is a real ESPN response, saved on 14 Oct 2026 with
   the MLB postseason under way and the 2025 MLS Cup playoffs, 2026 NHL
   and NBA conference finals read back from their dates. The field names
   were taken from those payloads rather than assumed:

     · the scoreboard states competitions[0].series as ONE object, typed
       "playoff", with a pre-formatted `summary` and per-side `wins`
     · the summary endpoint states it as an ARRAY, and on a regular-
       season game that array holds "current" and "season" entries —
       "TB wins series 3-0" is the season series, not a standing
     · MLS's scoreboard object has no type and no summary; the wording
       sits in the event note ("Series tied 1-1", "PHI win series 2-0")
     · a regular-season scoreboard event carries no series at all */

const fix = n => JSON.parse(readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8"));
const MLB_POST   = fix("scoreboard-mlb-20261013-postseason.json");   // ALCS game 2, final
const MLB_FUTURE = fix("scoreboard-mlb-20261018-postseason.json");   // NLCS game 6, if necessary
const MLS_PLAYOFF= fix("scoreboard-mls-20251101-playoffs.json");     // round one, best of three
const NHL_PLAYOFF= fix("scoreboard-nhl-20260520-playoffs.json");
const NBA_PLAYOFF= fix("scoreboard-nba-20260520-playoffs.json");
const NHL_REG    = fix("scoreboard-nhl-20261007.json");
const EPL_REG    = fix("scoreboard-epl-20260920.json");
const SUM_POST   = fix("mlb-summary-401908024-postseason.json");
const SUM_REG    = fix("mlb-summary-401816943-regular.json");
const SUM_REG_2  = fix("mlb-summary-401816683.json");

const build = loadFromBuild(["seriesOf", "parseEvent", "parseSummary", "applySummary"]);
/* merge() sits past the block the helper evaluates, so it is pulled out
   on its own, the way the location test reaches venueOf. */
build.merge = (() => {
  const src = readFileSync(new URL("../scripts/fetch-data.mjs", import.meta.url), "utf8");
  const m = /^function merge\(held, f\)\{[\s\S]*?\n\}/m.exec(src);
  assert.ok(m, "scripts/fetch-data.mjs must define merge");
  return new Function(m[0] + "\nreturn merge;")();
})();

/* ================= the build ================= */

test("the build reads the series summary off a real postseason event", () => {
  const f = build.parseEvent(MLB_POST.events[0], "MLB");
  assert.equal(f.series, "Series tied 1-1");
  assert.equal(f.status, "final");
  assert.deepEqual(f.score, [3, 1]);
});

test("a game not yet reached still states where the series stands", () => {
  const f = build.parseEvent(MLB_FUTURE.events[0], "MLB");
  assert.equal(f.status, "scheduled");
  assert.equal(f.series, "MIL leads series 2-0");
});

test("a regular-season event carries no series field at all", () => {
  // The whole regular season must be untouched: not null, not "", absent.
  for(const sb of [NHL_REG, EPL_REG]){
    for(const ev of sb.events){
      const f = build.parseEvent(ev, "NHL");
      assert.ok(f, ev.name);
      assert.ok(!("series" in f), ev.name + " should carry no series key");
    }
  }
});

test("no existing field changes shape when a series is added", () => {
  const f = build.parseEvent(MLB_POST.events[0], "MLB");
  assert.deepEqual(Object.keys(f).sort(),
    ["away","comp","eid","home","label","score","series","start","status","venue"]);
  const g = build.parseEvent(NHL_REG.events[0], "NHL");
  assert.deepEqual(Object.keys(g).sort(),
    ["away","comp","eid","home","label","score","start","status","venue"]);
});

test("NHL and NBA playoff events have the same shape as MLB's", () => {
  assert.equal(build.parseEvent(NHL_PLAYOFF.events[0], "NHL").series, "VGK leads series 1-0");
  assert.equal(build.parseEvent(NBA_PLAYOFF.events[0], "NBA").series, "Series tied 1-1");
});

test("MLS states the wording in the event note, not on the series", () => {
  const byId = Object.fromEntries(MLS_PLAYOFF.events.map(e => [e.id, e]));
  assert.equal(byId["760086"].competitions[0].series.summary, undefined,
    "the premise: ESPN's MLS series object has no summary");
  assert.equal(build.parseEvent(byId["760086"], "MLS").series, "Series tied 1-1");
  assert.equal(build.parseEvent(byId["760068"], "MLS").series, "PHI win series 2-0");
  for(const ev of MLS_PLAYOFF.events){
    assert.ok(build.parseEvent(ev, "MLS").series, ev.shortName);
  }
});

test("the note is not a series on a league that words its own", () => {
  // MLB's note is "ALCS - Game 2": a label, not a standing. It is never
  // taken, because MLB's series object states the summary itself.
  const cp = MLB_POST.events[0].competitions[0];
  assert.deepEqual(cp.notes.map(n => n.headline), ["ALCS - Game 2"]);
  const copy = JSON.parse(JSON.stringify(cp));
  copy.series.summary = "";
  assert.equal(build.seriesOf(copy), null, "with no summary and a note that is not about a series, nothing");
});

test("the summary endpoint's playoff entry is read, and its season entries are not", () => {
  const s = build.parseSummary(SUM_POST, "MLB");
  assert.equal(s.series, "Series tied 1-1");
  const types = SUM_POST.header.competitions[0].series.map(x => x.type).sort();
  assert.deepEqual(types, ["current", "playoff", "season"], "the premise: three entries on a postseason summary");

  // A regular-season game's summary states "TB wins series 3-0" — the
  // three-game set — and "TB leads series 4-0" for the season. Neither
  // is a standing and neither reaches the file.
  const r = build.parseSummary(SUM_REG, "MLB");
  assert.deepEqual(SUM_REG.header.competitions[0].series.map(x => x.type).sort(), ["current", "season"]);
  assert.ok(!("series" in r), "a regular-season summary yields no series key");
  assert.ok(!("series" in build.parseSummary(SUM_REG_2, "MLB")));
});

test("the summary top-up carries a moved series onto the fixture", () => {
  const f = build.parseEvent(MLB_POST.events[0], "MLB");
  const held = Object.assign({}, f, {status:"live", label:"Top 8th", score:[3,1], series:"CLE leads series 1-0"});
  assert.equal(build.applySummary(held, build.parseSummary(SUM_POST, "MLB")), true);
  assert.equal(held.series, "Series tied 1-1");
  assert.equal(held.status, "final");
});

test("a summary stating no series does not erase one the fixture has", () => {
  const f = build.parseEvent(MLB_POST.events[0], "MLB");
  const held = Object.assign({}, f, {status:"live", score:[2,1], label:"Top 8th"});
  const s = Object.assign({}, build.parseSummary(SUM_POST, "MLB"));
  delete s.series;
  assert.equal(build.applySummary(held, s), true);
  assert.equal(held.series, "Series tied 1-1");
});

test("the top-up reports nothing changed when only the series is the same", () => {
  const f = build.parseEvent(MLB_POST.events[0], "MLB");
  const s = build.parseSummary(SUM_POST, "MLB");
  assert.equal(build.applySummary(f, s), false, "identical status, label, score and series");
});

test("two readings of one fixture keep the series whichever copy wins", () => {
  const withScore = build.parseEvent(MLB_POST.events[0], "MLB");
  const noScore = Object.assign({}, withScore, {status:"scheduled", score:null});
  delete noScore.series;
  const a = build.merge(noScore, Object.assign({}, withScore));
  assert.equal(a.series, "Series tied 1-1");
  const held = Object.assign({}, withScore); delete held.series;
  const b = build.merge(held, Object.assign({}, withScore, {score:null}));
  assert.equal(b, held);
  assert.equal(b.series, "Series tied 1-1");
});

test("seriesOf is defensive about what the feed says", () => {
  assert.equal(build.seriesOf(null), null);
  assert.equal(build.seriesOf({}), null);
  assert.equal(build.seriesOf({series:{type:"season", summary:"TB wins series 5-1"}}), null);
  assert.equal(build.seriesOf({series:[{type:"current", summary:"x"}, {type:"season", summary:"y"}]}), null);
  assert.equal(build.seriesOf({series:{type:"playoff", summary:42}}), null, "a non-string summary is nothing");
  assert.equal(build.seriesOf({series:{type:"playoff", summary:"  "}}), null);
  assert.equal(build.seriesOf({series:{type:"playoff", summary:"  MIL leads series 2-0 "}}), "MIL leads series 2-0");
  assert.equal(build.seriesOf({series:{type:"playoff", summary:"a".repeat(500)}}).length, 80, "capped");
  assert.equal(build.seriesOf({series:{title:"Playoff Series"}, notes:[{headline:"Round One - Game 2"}]}), null,
    "an MLS-shaped series whose note is not about the series says nothing");
});

/* ================= the page ================= */

/* page.parseEvent resolves teams through the manifest, which these
   fixtures' clubs are mostly in; what matters is that the extractor is
   the same one. */
const PAGE_PREAMBLE = `
  const norm = s => String(s||"").toLowerCase();
`;

test("the build and the page extract a series identically", () => {
  const page = loadFromPage(["seriesOf"], "");
  for(const sb of [MLB_POST, MLB_FUTURE, MLS_PLAYOFF, NHL_PLAYOFF, NBA_PLAYOFF, NHL_REG, EPL_REG]){
    for(const ev of sb.events){
      assert.equal(page.seriesOf(ev.competitions[0]), build.seriesOf(ev.competitions[0]), ev.name);
    }
  }
  for(const s of [SUM_POST, SUM_REG, SUM_REG_2]){
    const cp = s.header.competitions[0];
    assert.equal(page.seriesOf(cp), build.seriesOf(cp));
  }
});

test("the page's own parser carries the field the same way", () => {
  const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
  const pe = /^function parseEvent\(ev, comp\)\{[\s\S]*?\n\}/m.exec(SRC)[0];
  assert.match(pe, /const series = seriesOf\(cp\);/);
  assert.match(pe, /\.\.\.\(series \? \{series\} : \{\}\)/, "absent, not null, when there is none");
  /* And the three places a fixture is copied or patched keep it: the row
     built from the committed file, a later copy meeting an earlier one,
     and the live top-up. */
  const loadStatic = /^async function loadStatic\(\)\{[\s\S]*?\n\}/m.exec(SRC)[0];
  assert.match(loadStatic, /\.\.\.\(f\.series \? \{series:f\.series\} : \{\}\)/);
  const mergeReal = /^function mergeReal\(built\)\{[\s\S]*?\n\}/m.exec(SRC)[0];
  assert.match(mergeReal, /if\(!g\.series && prev\.series\) g\.series = prev\.series;/);
  const applyScored = /^function applyScored\(match, parsed\)\{[\s\S]*?\n\}/m.exec(SRC)[0];
  assert.match(applyScored, /if\(parsed\.series\) match\.series = parsed\.series;/);
});

/* ---------------- the whole row, as it ships ---------------- */

const ROW_PREAMBLE = `
  const DAY = 86400000;
  let showScores = true, dataStale = false, liveMode = true;
  let services = new Set(), revealed = new Set(), alerts = new Set(), selected = new Set(["tor","lad"]);
  const crest = t => "";
  const fmtDayLong = k => k;
  const isNarrow = () => false;
  const TOURNEYS = new Map();
  const tourneyOf = () => null;
  const isStarredPlayer = () => false;
  let RECORDS = new Map();
  let SPOILED = new Set();
`;
const ROW_NAMES = ["COMPS","SERVICES","CARRIER_SERVICE","SRC","CHECKED","tv","st","CDN_MLS","RIGHTS",
  "resolveRights","SOCCER","fullName","esc","inkOn","pad","ymd","normName",
  "fmtTime","fmtShortDate","countdownText","BELL","saveButton","provenanceOf","servicesFor",
  "covered","visibleRights","carrierHtml","orderedTeams","scoreFor","stateOf","timeState","START_VERB","verbOf",
  "venueTag","seriesTag","recordFor","recordText","recordLine","ordinal","ORDINALS","shortScope","gameRow"];
const rows = (preamble = ROW_PREAMBLE) => loadFromPage(ROW_NAMES, preamble);

const NOW = Date.parse("2026-10-14T16:00:00Z");
const club = (id, city, name, abbr) => ({id, home:"MLB", city, name, abbr, color:"#134A8E", full:true});
const fixture = (over = {}) => Object.assign({
  id:"x1", comp:"MLB", start: NOW + 8*3600000,
  home: club("tor","Toronto","Toronto Blue Jays","TOR"),
  away: club("lad","Los Angeles","Los Angeles Dodgers","LAD"),
  stage:"", listed:true, espn:true, fromFeed:true, moved:null,
  venue:{name:"Rogers Centre", city:"Toronto", state:"Ontario"},
  result:{status:"scheduled", label:"", score:null}
}, over);

test("a game with a series shows it under the matchup, beside the location", () => {
  const html = rows().gameRow(fixture({series:"TOR leads series 2-1"}), NOW);
  assert.match(html, /<span class="g-series">TOR leads series 2-1<\/span>/);
  // on the meta line, after the venue, before the carriers
  assert.match(html, /class="g-meta">[\s\S]*in Toronto<\/span><span class="g-series">TOR leads series 2-1<\/span>[\s\S]*<\/div><div class="g-watch">/);
});

test("a game with no series renders nothing — no element, no placeholder", () => {
  const html = rows().gameRow(fixture(), NOW);
  assert.doesNotMatch(html, /g-series/);
  assert.doesNotMatch(html, /series/i);
  // and the row is byte-for-byte what it was without the field
  assert.equal(html, rows().gameRow(fixture({series:undefined}), NOW));
  assert.equal(html, rows().gameRow(fixture({series:""}), NOW));
  assert.equal(html, rows().gameRow(fixture({series:null}), NOW));
});

test("a series summary is escaped on the way into the row", () => {
  const html = rows().gameRow(fixture({series:'TOR <b>leads</b> & "series" 2-1 <img src=x onerror=alert(1)>'}), NOW);
  assert.match(html, /<span class="g-series">TOR &lt;b&gt;leads&lt;\/b&gt; &amp; &quot;series&quot; 2-1 &lt;img src=x onerror=alert\(1\)&gt;<\/span>/);
  assert.doesNotMatch(html, /<b>|<img|onerror=alert\(1\)>/);
});

test("the standing is held back with the records when a finished game is hidden", () => {
  // "TOR leads series 2-1" says who won the game whose score is hidden.
  const spoiled = rows(ROW_PREAMBLE.replace("let SPOILED = new Set();", 'let SPOILED = new Set(["tor","lad"]);'));
  const g = fixture({series:"TOR leads series 2-1", result:{status:"final", label:"Final", score:[4,2]}});
  assert.doesNotMatch(spoiled.gameRow(g, NOW), /g-series/);
  assert.match(rows().gameRow(g, NOW), /g-series/, "shown again once nothing is being hidden");
});

test("seriesTag on its own", () => {
  const { seriesTag } = loadFromPage(["esc", "seriesTag"], "let SPOILED = new Set();");
  assert.equal(seriesTag({}), "");
  assert.equal(seriesTag(null), "");
  assert.equal(seriesTag({series:"  "}), "");
  assert.equal(seriesTag({series:42}), "");
  assert.equal(seriesTag({series:"Series tied 1-1"}), '<span class="g-series">Series tied 1-1</span>');
});

/* ---------------- through the pipeline ---------------- */

test("the committed file carries a series on every MLB postseason game and on no regular-season one", () => {
  const d = JSON.parse(readFileSync(new URL("../data.json", import.meta.url), "utf8"));
  const mlb = d.fixtures.filter(f => f.comp === "MLB");
  if(!mlb.length) return;                         // out of season: nothing to say
  const post = mlb.filter(f => f.start >= Date.parse("2026-10-11T00:00Z") && f.start < Date.parse("2026-11-10T00:00Z"));
  const reg  = mlb.filter(f => f.start <  Date.parse("2026-09-28T00:00Z"));
  for(const f of reg) assert.ok(!("series" in f), f.home.abbr + " v " + f.away.abbr + " is regular season");
  /* Only asserted while the file was built after this landed: an older
     file has no field anywhere and that is not a failure of the rule. */
  if(post.length && post.some(f => "series" in f)){
    for(const f of post) assert.equal(typeof f.series, "string", f.home.abbr + " v " + f.away.abbr);
  }
});
