import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage } from "./helpers/page.mjs";

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
const FIX = JSON.parse(readFileSync(new URL("./fixtures/soccer-venues.json", import.meta.url), "utf8"));
const ev = i => FIX.events[i];

/* A location is a fact about the FIXTURE. It used to be read off the
   home team's nominal city and shown only when that city happened to
   differ textually from the club's name, which was wrong twice over:

     · an English club is usually named after its town, so Liverpool
       hosting at Liverpool compared equal and the line vanished, while
       Vancouver Whitecaps compared unequal and kept it — same data,
       different output
     · a club's city is not the match's location. The 2026 League Cup
       final is filed "Manchester City at Arsenal" and played at
       Wembley.

   ESPN states competitions[0].venue on every soccer and North American
   event seen — 1206 soccer events scanned, all with one. So the rule is
   now: the venue the source gives, or nothing. */

/* ---------------- the build's extractor ---------------- */

const build = readFileSync(new URL("../scripts/fetch-data.mjs", import.meta.url), "utf8");
function buildVenueOf(){
  const m = /^function venueOf\(cp\)\{[\s\S]*?\n\}/m.exec(build);
  assert.ok(m, "scripts/fetch-data.mjs must define venueOf");
  return new Function(m[0] + "\nreturn venueOf;")();
}
const pageVenueOf = () => loadFromPage(["venueOf"], "").venueOf;

test("the build and the page extract a venue identically", () => {
  // The committed file and the direct fetch must describe a fixture the
  // same way, or a row changes shape depending on how it arrived.
  const a = buildVenueOf(), b = pageVenueOf();
  for(const e of FIX.events){
    assert.deepEqual(a(e.competitions[0]), b(e.competitions[0]), e.name);
  }
});

test("an EPL fixture keeps the ground the source names", () => {
  const v = pageVenueOf()(ev(0).competitions[0]);
  assert.deepEqual(v, {name:"Portman Road", city:"Ipswich", country:"England"});
});

test("a club named after its own town still gets a location", () => {
  // This is the reported bug: "Liverpool" hosting at "Liverpool" used to
  // compare equal to its own name and lose the line entirely.
  const v = pageVenueOf()(ev(1).competitions[0]);
  assert.equal(v.city, "Liverpool");
  assert.equal(v.name, "Anfield");
  const home = ev(1).competitions[0].competitors.find(c => c.homeAway === "home");
  assert.equal(home.team.displayName, "Liverpool");
  assert.equal(home.team.location, "Liverpool",
    "ESPN's team.location is the club label, not a town — which is why it cannot be the source");
});

test("an MLS home fixture reports the home city", () => {
  const v = pageVenueOf()(ev(2).competitions[0]);
  assert.deepEqual(v, {name:"BC Place", city:"Vancouver", country:"Canada"});
});

test("an MLS away fixture reports the host's city, not the follower's", () => {
  const v = pageVenueOf()(ev(3).competitions[0]);
  assert.equal(v.city, "San Jose, California");
  assert.doesNotMatch(v.city, /Vancouver/, "the away side's city must not leak in");
});

test("a fixture whose source states no location carries none", () => {
  assert.equal(ev(5)._constructed, true, "this case had to be constructed");
  assert.equal(pageVenueOf()(ev(5).competitions[0]), null);
  assert.equal(pageVenueOf()({}), null);
  assert.equal(pageVenueOf()(null), null);
});

test("a moved fixture reports where it is played, not where the home club lives", () => {
  // League Cup final: Arsenal are the nominal home side and their own
  // ground is venue 2267, but the match is at Wembley.
  const c = ev(4).competitions[0];
  const home = c.competitors.find(x => x.homeAway === "home");
  assert.equal(home.team.displayName, "Arsenal");
  assert.notEqual(String(home.team.venue.id), String(c.venue.id),
    "the fixture is not at the home club's own ground");
  const v = pageVenueOf()(c);
  assert.equal(v.name, "Wembley Stadium");
  assert.equal(v.city, "London");
});

/* ---------------- what the row prints ---------------- */

const rowHarness = () => loadFromPage(["esc", "venueTag"], "");

test("the row prints the venue city and nothing else on that line", () => {
  const { venueTag } = rowHarness();
  assert.match(venueTag({venue:{name:"Anfield", city:"Liverpool", country:"England"}}), />in Liverpool</);
  assert.match(venueTag({venue:{name:"BC Place", city:"Vancouver", country:"Canada"}}), />in Vancouver</);
});

test("the city is printed exactly as the source gives it", () => {
  // ESPN qualifies each city as far as it needs to. Appending a state
  // would make hockey read "Vancouver, BC" beside soccer's "Vancouver".
  const { venueTag } = rowHarness();
  const nhl = venueTag({venue:{name:"Rogers Arena", city:"Vancouver", state:"BC", country:"Canada"}});
  assert.match(nhl, />in Vancouver</);
  assert.doesNotMatch(nhl, /in Vancouver, BC</);
  assert.match(venueTag({venue:{name:"Sporting Park", city:"Kansas City, Kansas", country:"USA"}}),
    />in Kansas City, Kansas</);
});

test("the full address is kept, in the tooltip", () => {
  const { venueTag } = rowHarness();
  const html = venueTag({venue:{name:"Rogers Arena", city:"Vancouver", state:"BC", country:"Canada"}});
  assert.match(html, /title="Rogers Arena, Vancouver, BC, Canada"/);
});

test("no venue means no location line at all — never a guess", () => {
  const { venueTag } = rowHarness();
  assert.equal(venueTag({}), "");
  assert.equal(venueTag({venue:null}), "");
  assert.equal(venueTag({venue:{name:"Somewhere"}}), "", "a name without a city says nothing about where");
  assert.equal(venueTag(null), "");
  assert.equal(venueTag(undefined), "");
});

test("the location can no longer be derived from either team", () => {
  const { venueTag } = rowHarness();
  // A fixture with rich team data but no venue must still print nothing.
  assert.equal(venueTag({
    home:{id:"van-mls", name:"Whitecaps", city:"Vancouver"},
    away:{id:"liv", name:"Liverpool", city:"Liverpool"}
  }), "");
});

test("the old team-derived rule is gone from the source", () => {
  assert.doesNotMatch(SRC, /normName\(g\.home\.city\) !== normName\(g\.home\.name\)/,
    "the name-vs-city comparison that suppressed English clubs must not return");
  const row = /function gameRow\([\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(row, /venueTag\(g\)/);
  assert.doesNotMatch(row, /g\.home\.city/, "gameRow must not read a city off the home team");
});

test("no club-to-ground mapping was introduced", () => {
  // A mapping is what breaks the moment a match moves.
  const tag = /function venueTag\(g\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.doesNotMatch(tag, /TEAMS\[|TEAM_ROWS|VENUES|STADIUM/);
});

/* ---------------- the whole row, as it ships ---------------- */

/* `crest` cannot be pulled out by the extractor — its declaration holds a
   semicolon inside a string literal — so it is stubbed. Nothing asserted
   here depends on it. */
const ROW_PREAMBLE = `
  const DAY = 86400000;
  let showScores = true, dataStale = false, liveMode = true;
  let services = new Set(), revealed = new Set(), alerts = new Set(), selected = new Set(["liv","van-mls"]);
  const crest = t => "";
  const fmtDayLong = k => k;
  const isNarrow = () => false;
`;
const ROW_NAMES = ["COMPS","SERVICES","CARRIER_SERVICE","SRC","CHECKED","tv","st","CDN_MLS","RIGHTS",
  "resolveRights","SOCCER","CLUB_NAMES","fullName","esc","inkOn","pad","ymd","normName",
  "fmtTime","fmtShortDate","countdownText","BELL","saveButton","provenanceOf","servicesFor",
  "covered","orderedTeams","scoreFor","stateOf","timeState","START_VERB","verbOf",
  "venueTag","gameRow"];
const rows = () => loadFromPage(ROW_NAMES, ROW_PREAMBLE);

const NOW = Date.parse("2026-09-20T12:00:00Z");
const club = (id, city, name, abbr) => ({id, home:"EPL", city, name, abbr, color:"#B3122B", full:true});
const fixture = (over = {}) => Object.assign({
  id:"x1", comp:"EPL", start: NOW + 3*86400000,
  home: club("liv","Liverpool","Liverpool","LIV"),
  away: club("nfo","Nottingham Forest","Nottingham Forest","NFO"),
  stage:"", listed:true, espn:true, fromFeed:true, moved:null,
  venue:{name:"Anfield", city:"Liverpool", country:"England"},
  result:{status:"scheduled", label:"", score:null}
}, over);

test("the reported EPL fixtures now render a location", () => {
  const p = rows();
  // Liverpool v Nottingham Forest — was blank
  assert.match(p.gameRow(fixture(), NOW), /in Liverpool/);
  // Ipswich Town v Liverpool — was blank
  assert.match(p.gameRow(fixture({
    home: club("ips","Ipswich Town","Ipswich Town","IPS"),
    away: club("liv","Liverpool","Liverpool","LIV"),
    venue:{name:"Portman Road", city:"Ipswich", country:"England"}
  }), NOW), /in Ipswich/);
});

test("the MLS fixture that already worked still says the same thing", () => {
  const p = rows();
  const html = p.gameRow(fixture({comp:"MLS",
    home:{id:"van-mls", home:"MLS", city:"Vancouver", name:"Whitecaps FC", abbr:"VAN", color:"#00245E"},
    away:{id:"hou", home:"MLS", city:"Houston Dynamo FC", name:"Houston Dynamo FC", abbr:"HOU", color:"#f60", full:true},
    venue:{name:"BC Place", city:"Vancouver", country:"Canada"}}), NOW);
  assert.match(html, /in Vancouver/);
});

test("an MLS away fixture names the host city", () => {
  const p = rows();
  const html = p.gameRow(fixture({comp:"MLS",
    home:{id:"sj", home:"MLS", city:"San Jose Earthquakes", name:"San Jose Earthquakes", abbr:"SJ", color:"#00f", full:true},
    away:{id:"van-mls", home:"MLS", city:"Vancouver", name:"Whitecaps FC", abbr:"VAN", color:"#00245E"},
    venue:{name:"PayPal Park", city:"San Jose, California", country:"USA"}}), NOW);
  assert.match(html, /in San Jose, California/);
  assert.doesNotMatch(html, /in Vancouver/);
});

test("a moved fixture renders the host ground's city, not the home club's", () => {
  const p = rows();
  // Arsenal are nominally home; the match is at Wembley.
  const html = p.gameRow(fixture({comp:"EFL",
    home: club("ars","London","Arsenal","ARS"),
    away: club("mci","Manchester","Man City","MCI"),
    venue:{name:"Wembley Stadium", city:"London", country:"England"}}), NOW);
  assert.match(html, /title="Wembley Stadium, London, England"/);
  assert.match(html, /in London/);
});

test("a fixture with no venue renders no location, whatever its teams say", () => {
  const p = rows();
  const html = p.gameRow(fixture({venue:null}), NOW);
  assert.doesNotMatch(html, /\bin Liverpool\b/);
  assert.doesNotMatch(html, /class="g-meta">[^<]*<span>in /);
});

test("every soccer fixture in the committed file renders a location", () => {
  const p = rows();
  const d = JSON.parse(readFileSync(new URL("../data.json", import.meta.url), "utf8"));
  const SOCCER = ["EPL","MLS","EFL","FAC","UCL","LALIGA","SERIEA","BUNDES","LIGUE1"];
  const sample = d.fixtures.filter(f => SOCCER.includes(f.comp)).slice(0, 60);
  assert.ok(sample.length >= 40);
  const blank = [];
  for(const f of sample){
    const g = fixture({comp:f.comp, venue:f.venue,
      home:Object.assign({full:true, home:f.comp}, f.home),
      away:Object.assign({full:true, home:f.comp}, f.away)});
    if(!/<span title="[^"]*">in /.test(p.gameRow(g, NOW))) blank.push(f.home.name + " v " + f.away.name);
  }
  assert.deepEqual(blank, [], "these rendered no location");
});

/* ---------------- through the pipeline ---------------- */

test("a venue survives being written to the file and read back", () => {
  const d = JSON.parse(readFileSync(new URL("../data.json", import.meta.url), "utf8"));
  const soccer = d.fixtures.filter(f => ["EPL","MLS","EFL","FAC","UCL","LALIGA","SERIEA","BUNDES","LIGUE1"].includes(f.comp));
  assert.ok(soccer.length > 50, "the committed file should carry plenty of soccer");
  const withVenue = soccer.filter(f => f.venue && f.venue.city);
  assert.equal(withVenue.length, soccer.length,
    "every soccer fixture in the file should carry a venue: " +
    soccer.filter(f => !f.venue).slice(0,3).map(f => f.home.name + " v " + f.away.name).join("; "));
});

test("an English club named after its town now has a location in the file", () => {
  const d = JSON.parse(readFileSync(new URL("../data.json", import.meta.url), "utf8"));
  const same = d.fixtures.filter(f => f.comp === "EPL" && f.home.city === f.home.name);
  assert.ok(same.length > 0, "there should be clubs whose ESPN label equals their name");
  same.forEach(f => assert.ok(f.venue && f.venue.city,
    f.home.name + " lost its location to the old name-vs-city rule"));
});

test("loadStatic carries the file's venue onto the row", () => {
  const fn = /function loadStatic\(\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(fn, /venue:f\.venue \|\| null/);
});

test("a copy with no venue cannot erase one already known", () => {
  // The baked fallback and a remembered result carry none, and a refresh
  // that let them win blanked a location the row had a second earlier.
  const merge = /function mergeReal\(built\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(merge, /if\(!g\.venue && prev\.venue\) g\.venue = prev\.venue;/);
  const applied = /function applyScored\(match, parsed\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(applied, /if\(parsed\.venue && !match\.venue\) match\.venue = parsed\.venue;/);
});

test("the build fills a venue when only one of the two endpoints states it", () => {
  const add = /function add\(f\)\{[\s\S]*?\n\}/.exec(build)[0];
  assert.match(add, /f\.venue = fixtures\[i\]\.venue/);
  assert.match(add, /fixtures\[i\]\.venue = f\.venue/);
});
