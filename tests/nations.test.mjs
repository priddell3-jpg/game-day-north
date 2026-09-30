import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromBuild } from "./helpers/build.mjs";
import { loadFromPage } from "./helpers/page.mjs";
import { MAX_LIMIT, planRanges, planDays, splitRange, dateKey, isCarriedSeason,
         compFloorProblems, WINDOWED_COMPS, EXPECTED_PER_DAY } from "../scripts/lib/fetch-plan.mjs";
import { LISTED_KICKOFFS, disputeKickoffs, unknownSides, CLOSED_COMPS } from "../scripts/lib/nations.mjs";
import { validateTeams } from "../scripts/lib/teams.mjs";

/* Men's national teams.

   The known answers here come from one real response: ESPN's friendlies
   scoreboard for Saturday 3 October 2026, saved on 2026-09-29. It holds
   eight matches from four continents, of which Canada's is one — which
   is the whole problem this sport poses. A nation's followers must get
   their nation's match and not the other seven. */
const root = new URL("../", import.meta.url);
const SRC = readFileSync(new URL("src/page.html", root), "utf8");
const DAY3 = JSON.parse(readFileSync(new URL("tests/fixtures/scoreboard-intf-20261003.json", root), "utf8"));
const manifest = JSON.parse(readFileSync(new URL("data/teams.json", root), "utf8"));
const nations = manifest.teams.filter(t => t.comp === "INTF");

const build = loadFromBuild(["parseEvent", "idFor", "PATHS"]);
const parsed = DAY3.events.map(ev => build.parseEvent(ev, "INTF"));
const named = (away, home) => parsed.find(f => f.away.name === away && f.home.name === home);

/* ============================ the parser ============================ */

test("the saved friendlies day is the day it claims to be", () => {
  assert.equal(DAY3.leagues[0].slug, "fifa.friendly");
  assert.equal(DAY3.events.length, 8);
  assert.deepEqual(DAY3.events.map(e => e.name), [
    "Brazil at India", "Namibia at Russia", "Peru at Canada", "Djibouti at Sri Lanka",
    "Cameroon at Ivory Coast", "Mali at Tunisia", "Burkina Faso at Argentina",
    "Mexico at United States"]);
});

test("Peru at Canada parses to the match the feed describes", () => {
  const f = named("Peru", "Canada");
  assert.ok(f, "the match must be in the day");
  assert.equal(f.eid, "401900325");
  assert.equal(f.comp, "INTF");
  assert.equal(f.start, Date.parse("2026-10-03T18:00:00Z"), "18:00 UTC, which is 2 p.m. Eastern");
  assert.equal(f.home.id, "nt-can");
  assert.equal(f.home.abbr, "CAN");
  assert.equal(f.away.id, null, "Peru is not followable, so it resolves to nothing rather than to something near");
  assert.equal(f.status, "scheduled");
  assert.equal(f.score, null);
  assert.deepEqual(f.venue, { name: "Stade Saputo", city: "Montreal", country: "Canada" });
});

test("a match between two followable nations resolves both", () => {
  const f = named("Mexico", "United States");
  assert.equal(f.home.id, "nt-usa");
  assert.equal(f.away.id, "nt-mex");
  /* Filed under 3 October because ESPN files by the Eastern date: it
     kicks off at 02:00 UTC on the 4th. */
  assert.equal(f.start, Date.parse("2026-10-04T02:00:00Z"));
});

test("every match in the day parses, and only four involve a nation anyone can follow", () => {
  assert.ok(parsed.every(Boolean), "no event may fail to parse");
  /* The build keeps a fixture when either side is in the manifest. That
     is the first of two filters; the page's is the one that matters to
     the person looking, and it is tested further down. */
  const kept = parsed.filter(f => f.home.id || f.away.id);
  assert.deepEqual(kept.map(f => f.away.name + " at " + f.home.name), [
    "Brazil at India", "Peru at Canada", "Burkina Faso at Argentina", "Mexico at United States"]);
});

test("the season filter carries friendlies, whatever year they state", () => {
  /* The friendlies season runs 1 January to 1 January and names itself
     "2026-international-friendly". The filter drops preseason by slug
     and must not mistake an unfamiliar slug for one. */
  for(const ev of DAY3.events){
    assert.equal(ev.season.slug, "2026-international-friendly");
    assert.equal(isCarriedSeason(ev), true, ev.name);
  }
  assert.equal(isCarriedSeason({ season: { year: 2027, slug: "2027-international-friendly" } }), true,
    "a match filed under next year's season is still a match");
  assert.equal(isCarriedSeason({ season: { year: 2026, slug: "league-phase" } }), true, "UEFA Nations League");
  assert.equal(isCarriedSeason({ season: { year: 2026, slug: "group-stage" } }), true, "Concacaf Nations League");
});

test("the build asks the three feeds by the slugs that answer", () => {
  assert.equal(build.PATHS.INTF, "soccer/fifa.friendly");
  assert.equal(build.PATHS.UNL, "soccer/uefa.nations");
  assert.equal(build.PATHS.CNL, "soccer/concacaf.nations.league");
  assert.ok(!Object.values(build.PATHS).some(p => /worldq/.test(p)),
    "World Cup qualifying starts in 2027 and is not asked for yet");
  for(const c of ["INTF", "UNL", "CNL"]) assert.ok(EXPECTED_PER_DAY[c] > 0, c + " needs a planning figure");
});

test("the build's own fetch loop carries the whole day through, season filter and all", async () => {
  const B = loadFromBuild(["scoreboardRange", "PATHS"],
    { MAX_LIMIT, planRanges, planDays, splitRange, dateKey, isCarriedSeason, unknownSides });
  const asked = [];
  const real = globalThis.fetch;
  globalThis.fetch = async url => {
    asked.push(String(url));
    const body = /dates=\d{8}-\d{8}/.test(url) ? { code: 400, message: "Failed to get events endpoint." } : DAY3;
    return new Response(JSON.stringify(body), { status: body.code || 200, headers: { "content-type": "application/json" } });
  };
  const out = [];
  const warn = console.warn, log = console.log;
  console.warn = () => {}; console.log = () => {};
  try{
    const at = Date.parse("2026-10-03T12:00:00Z");
    await B.scoreboardRange("INTF", B.PATHS.INTF, at, at, f => out.push(f));
  }finally{ globalThis.fetch = real; console.warn = warn; console.log = log; }
  assert.ok(asked.every(u => u.includes("/soccer/fifa.friendly/scoreboard?dates=")), asked.join("\n"));
  assert.equal(out.filter(Boolean).length, 8, "nothing was dropped as preseason");
});

/* ======================= kickoff: ESPN against TSN ======================= */

test("ESPN's feed and TSN's listing agree on Peru at Canada", () => {
  /* TSN: "Saturday, Oct. 3 | CanMNT vs. Peru | 2 p.m. ET / 11 a.m. PT".
     2 p.m. Eastern in October is 18:00 UTC, and the raw feed says
     2026-10-03T18:00Z. Read on 2026-09-29. */
  const raw = DAY3.events.find(e => e.id === "401900325");
  assert.equal(raw.date, "2026-10-03T18:00Z");
  assert.equal(raw.status.type.detail, "Sat, October 3rd at 2:00 PM EDT");
  const listing = LISTED_KICKOFFS.find(l => /Peru/.test(l.says));
  assert.equal(Date.parse(listing.start), Date.parse(raw.date));
  const fixtures = parsed.map(f => structuredClone(f));
  assert.deepEqual(disputeKickoffs(fixtures), []);
  assert.ok(fixtures.every(f => f.altStart === undefined), "agreement marks nothing");
});

test("a feed that says 4 p.m. is shown, and the row carries TSN's 2 p.m. beside it", () => {
  const fixtures = parsed.map(f => structuredClone(f));
  const can = fixtures.find(f => f.home.id === "nt-can");
  can.start = Date.parse("2026-10-03T20:00:00Z");
  const disputed = disputeKickoffs(fixtures);
  assert.deepEqual(disputed.map(f => f.eid), ["401900325"]);
  assert.equal(can.start, Date.parse("2026-10-03T20:00:00Z"), "ESPN's time stays the one shown");
  assert.equal(can.altStart, Date.parse("2026-10-03T18:00:00Z"));
  assert.equal(can.altSource, "TSN");
  assert.equal(fixtures.filter(f => f.altStart != null).length, 1, "and no other match is touched");
});

test("a dispute that resolves stops being reported", () => {
  const fixtures = parsed.map(f => structuredClone(f));
  const can = fixtures.find(f => f.home.id === "nt-can");
  can.altStart = Date.parse("2026-10-03T20:00:00Z"); can.altSource = "TSN";
  assert.deepEqual(disputeKickoffs(fixtures), []);
  assert.equal("altStart" in can, false);
  assert.equal("altSource" in can, false);
});

test("a listing cannot claim the next match of the window", () => {
  /* Canada play on the 3rd and the 6th. With the match of the 3rd gone
     from the feed, its listing must find nothing rather than dispute
     the kickoff of a different game. */
  const usa = { eid: "401905188", comp: "INTF", start: Date.parse("2026-10-07T00:00:00Z"),
    home: { id: "nt-usa", name: "United States" }, away: { id: "nt-can", name: "Canada" } };
  assert.deepEqual(disputeKickoffs([usa]), []);
  assert.equal(usa.altStart, undefined);
});

test("every listing names its source and the words it was read from", () => {
  for(const l of LISTED_KICKOFFS){
    assert.ok(Number.isFinite(Date.parse(l.start)), l.says);
    assert.match(l.url, /^https:\/\/www\.tsn\.ca\//);
    assert.ok(l.source && l.says && l.team && l.comp);
    assert.ok(nations.some(n => n.id === l.team), l.team + " must be a nation in the manifest");
  }
});

/* ================== the page: a nation's own matches ================== */

/* The board as the page builds it, by running the page's own statement
   rather than a copy of it. */
function board(){
  const stmt = /^TEAM_MANIFEST\.teams\.concat\(TEAM_MANIFEST\.events\)\.forEach\(e=>\{[\s\S]*?\n\}\);/m.exec(SRC);
  assert.ok(stmt, "the page must still build TEAMS from the manifest");
  return new Function("TEAM_MANIFEST", "const TEAMS = {};\n" + stmt[0] + "\nreturn TEAMS;")(manifest);
}
const TEAMS = board();

/* The committed file as the build would write it for that day — and,
   to be strict about it, with all eight matches in it rather than the
   four the build would keep. The page must not rely on the build having
   filtered first. */
const payload = () => ({ generated: "2026-10-03T12:00:00Z",
  fixtures: parsed.map(f => structuredClone(f)) });

async function loaded(selected, file = payload()){
  globalThis.__nationsPayload = file;
  globalThis.__nationsBuilt = [];
  const page = loadFromPage(["staticTeam", "followsTeam", "loadStatic"], `
    const TEAMS = ${JSON.stringify(TEAMS)};
    const allTeams = Object.values(TEAMS);
    const selected = new Set(${JSON.stringify(selected)});
    const raceIncluded = new Set();
    const norm = x => String(x || "").toLowerCase();
    let staticAt = 0, staticCount = 0, staticTennis = null, staticSource = "none";
    const readStaticPayload = async () => ({data: globalThis.__nationsPayload, source: "site"});
    const validStaticPayload = () => true;
    const mergeReal = built => { globalThis.__nationsBuilt = built; };
    const attachStandings = () => {}, syncRaceTeams = () => {}, attachCycling = () => {};
    const bestTennisBlock = () => ({block: null, at: 0});
    const attachTennis = () => {}, attachRankings = () => {}, attachTables = () => {};
    const rugbyOn = () => false, attachRugby = () => 0;
  `);
  const n = await page.loadStatic();
  return { n, built: globalThis.__nationsBuilt };
}
const label = g => g.away.name + " at " + g.home.name;

test("following Canada puts Canada's match on the board and none of the other seven", async () => {
  const { n, built } = await loaded(["nt-can"]);
  assert.equal(n, 1);
  assert.deepEqual(built.map(label), ["Peru at Canada"]);
  assert.equal(built[0].comp, "INTF");
  assert.equal(built[0].home.id, "nt-can");
});

test("following nobody who plays that day shows nothing from it", async () => {
  assert.deepEqual((await loaded(["nt-eng"])).built, [], "England are in the Nations League that day, not this feed");
  assert.deepEqual((await loaded(["van-nhl", "liv"])).built, [], "and a club follower sees no internationals at all");
});

test("following two nations shows their matches, once each, and still not the slate", async () => {
  const { built } = await loaded(["nt-mex", "nt-usa", "nt-arg"]);
  assert.deepEqual(built.map(label), ["Burkina Faso at Argentina", "Mexico at United States"]);
});

test("a nation that is not followable cannot be followed into the board by its name", async () => {
  /* Peru is in the file as Canada's opponent, and is not in the
     manifest. Neither its name nor the id it would have had puts its
     match on anybody's board. */
  assert.deepEqual((await loaded(["Peru", "nt-per"])).built, []);
});

test("the list itself only ever shows a followed nation's matches", () => {
  globalThis.__nationsGames = parsed.map(f => ({ comp: f.comp, home: f.home, away: f.away, start: f.start }));
  const page = loadFromPage(["isMine", "myGames"], `
    const GAMES = globalThis.__nationsGames;
    const selected = new Set(["nt-can"]);
    const raceIncluded = new Set();
    const hiddenComps = new Set();
    const rugbyOn = () => false, tennisMine = () => false;
  `);
  assert.deepEqual(page.myGames().map(label), ["Peru at Canada"]);
});

test("a kickoff the file disputes reaches the row with both readings", async () => {
  const file = payload();
  const can = file.fixtures.find(f => f.home.id === "nt-can");
  can.start = Date.parse("2026-10-03T20:00:00Z");
  can.altStart = Date.parse("2026-10-03T18:00:00Z");
  can.altSource = "TSN";
  const { built } = await loaded(["nt-can"], file);
  assert.equal(built[0].start, can.start);
  assert.equal(built[0].altStart, can.altStart);
  assert.equal(built[0].altSource, "TSN");
  const clean = (await loaded(["nt-can"])).built[0];
  assert.equal("altStart" in clean, false, "and a fixture nobody disputes carries no such field");
});

/* ============================ the row ============================ */

const ROW_PREAMBLE = `
  const DAY = 86400000;
  let showScores = true, dataStale = false, liveMode = true;
  let services = new Set(["tsn"]), revealed = new Set(), alerts = new Set(), selected = new Set(["nt-can"]);
  const crest = t => "";
  const fmtDayLong = k => k;
  const isNarrow = () => false;
  const TOURNEYS = new Map();
  const tourneyOf = () => null;
  const isStarredPlayer = () => false;
  const _zoneFmt = {};
  let RECORDS = new Map();
  let SPOILED = new Set();
`;
const ROW_NAMES = ["COMPS","SERVICES","CARRIER_SERVICE","SRC","CHECKED","tv","st","CDN_MLS","RIGHTS",
  "ZONE_IANA","zoneParts","listingDay",
  "resolveRights","SOCCER","fullName","esc","inkOn","pad","ymd","normName",
  "fmtTime","fmtShortDate","countdownText","BELL","saveButton","provenanceOf","servicesFor",
  "covered","visibleRights","carrierHtml","orderedTeams","scoreFor","stateOf","timeState","START_VERB","verbOf",
  "venueTag","recordFor","recordText","recordLine","ordinal","ORDINALS","shortScope","gameRow"];
const page = loadFromPage(ROW_NAMES, ROW_PREAMBLE);

const NOW = Date.parse("2026-09-29T18:00:00Z");
const side = id => TEAMS[id] || { id: "feed:INTF:" + id, home: "INTF", city: "", name: id, abbr: id.slice(0, 3).toUpperCase(),
  color: "#5A6478", ghost: true, full: true, comps: ["INTF"] };
const game = (home, away, startIso, over = {}) => Object.assign({
  id: "INTF-1-" + home + "-" + away, comp: "INTF", home: side(home), away: side(away),
  start: Date.parse(startIso), stage: "", listed: true, espn: true, fromFeed: true, moved: null,
  venue: null, result: { status: "scheduled", label: "", score: null } }, over);

const PERU = () => game("nt-can", "Peru", "2026-10-03T18:00:00Z");
const USA = () => game("nt-usa", "nt-can", "2026-10-07T00:00:00Z");

test("a nation reads by its name, home side first, like any soccer fixture", () => {
  const html = page.gameRow(PERU(), NOW);
  assert.match(html, />Canada</);
  assert.match(html, /<span class="at">vs<\/span>/);
  assert.match(html, />Friendly</);
});

test("an undisputed kickoff says nothing about a dispute", () => {
  assert.doesNotMatch(page.gameRow(PERU(), NOW), /Kick-off disputed|alt-time/);
});

test("a disputed kickoff shows ESPN's time and names both sources", () => {
  const g = game("nt-can", "Peru", "2026-10-03T20:00:00Z",
    { altStart: Date.parse("2026-10-03T18:00:00Z"), altSource: "TSN" });
  const html = page.gameRow(g, NOW);
  const espn = page.esc(page.fmtTime(g.start)), tsn = page.esc(page.fmtTime(g.altStart));
  assert.notEqual(espn, tsn);
  assert.match(html, /Kick-off disputed/);
  assert.ok(html.includes('<div class="g-time">' + espn), "the time shown is the feed's");
  assert.ok(html.includes('<span class="alt-time">ESPN ' + espn + " &middot; TSN " + tsn + "</span>"), html);
  assert.ok(html.includes("ESPN's time is the one shown"), "and the tooltip says which was chosen");
});

/* ============================ rights ============================ */

const names = r => r.carriers.map(c => c.name);

test("Canada v Peru is on TSN4 and TSN5, confirmed, from TSN's own lineup", () => {
  const r = page.resolveRights(PERU());
  assert.deepEqual(names(r), ["TSN4", "TSN5"]);
  assert.equal(r.confidence, "confirmed");
  assert.equal(r.src, page.SRC.tsnfall);
  assert.match(r.src.url, /^https:\/\/www\.tsn\.ca\/soccer\/article\/canadas-national-teams-back-in-action/);
  assert.match(r.note, /Oct 3, 2 p\.m\. ET/);
  assert.equal(r.checked, "2026-09-29");
  assert.deepEqual(page.servicesFor(PERU()), ["tsn"]);
});

test("Canada at the United States is on TSN1, keyed on the Eastern date TSN lists it under", () => {
  /* 00:00 UTC on the 7th is 8 p.m. Eastern on the 6th. A rule keyed on
     the UTC date would miss its own match. */
  const r = page.resolveRights(USA());
  assert.deepEqual(names(r), ["TSN1"]);
  assert.equal(r.confidence, "confirmed");
  assert.equal(r.src, page.SRC.tsnfall);
  assert.equal(page.listingDay(USA().start), "2026-10-06");
});

test("the rule is keyed on Canada being in the match, home or away", () => {
  assert.equal(page.resolveRights(game("nt-can", "Peru", "2026-10-03T18:00:00Z")).confidence, "confirmed");
  assert.equal(page.resolveRights(game("Peru", "nt-can", "2026-10-03T18:00:00Z")).confidence, "confirmed");
  assert.deepEqual(names(page.resolveRights(game("nt-can", "Chile", "2026-09-26T23:00:00Z"))), ["TSN4"]);
});

test("a Canada match TSN has not listed is expected on TSN, not confirmed", () => {
  const g = game("nt-can", "Japan", "2026-11-14T00:30:00Z");
  const r = page.resolveRights(g);
  assert.deepEqual(names(r), ["TSN"]);
  assert.equal(r.confidence, "expected");
  assert.equal(r.src, page.SRC.tsnfall);
  /* And inside five days an expectation is no longer offered as
     somewhere to watch: the row says coverage is not confirmed. */
  const near = g.start - 2 * 86400000;
  assert.deepEqual(page.visibleRights(g, near).carriers, []);
  assert.match(page.gameRow(g, near), /Coverage not confirmed/);
});

test("a friendly without Canada claims no carrier", () => {
  for(const g of [game("nt-usa", "nt-mex", "2026-10-04T02:00:00Z"), game("India", "nt-bra", "2026-10-03T14:00:00Z")]){
    const r = page.resolveRights(g);
    assert.deepEqual(r.carriers, []);
    assert.equal(r.confidence, "unknown");
    assert.equal(r.src, page.SRC.none);
    assert.match(page.gameRow(g, NOW), /Coverage not confirmed/);
  }
});

test("the UEFA Nations League names DAZN, from UEFA's own listing", () => {
  const r = page.resolveRights(game("nt-cro", "nt-eng", "2026-10-03T16:00:00Z", { comp: "UNL" }));
  assert.deepEqual(names(r), ["DAZN Canada"]);
  assert.equal(r.confidence, "confirmed");
  assert.match(r.src.url, /^https:\/\/www\.uefa\.com\/uefanationsleague\//);
});

test("the Concacaf Nations League claims nothing, Canada or not", () => {
  for(const g of [game("nt-blz", "nt-guf", "2026-10-04T02:00:00Z", { comp: "CNL" }),
                  game("nt-can", "nt-jam", "2027-03-25T23:00:00Z", { comp: "CNL" })]){
    const r = page.resolveRights(g);
    assert.deepEqual(r.carriers, []);
    assert.equal(r.confidence, "unknown");
  }
});

test("every carrier the national-team rows name is a service somebody can own", () => {
  for(const r of page.RIGHTS.filter(r => ["INTF", "UNL", "CNL"].includes(r.comp))){
    for(const c of r.carriers){
      assert.ok(page.CARRIER_SERVICE[c.name], c.name + " must roll up to a service");
      assert.ok(page.SERVICES[page.CARRIER_SERVICE[c.name]]);
    }
    assert.ok(r.note && r.src && r.checked, "every row says why, from where, and when");
    if(r.confidence !== "unknown") assert.ok(r.src.url, "a claim needs a link");
    else assert.deepEqual(r.carriers, [], "and an unknown names nobody");
  }
});

/* ============================ the manifest ============================ */

const FEATURED = ["Canada", "United States", "Mexico", "England", "France", "Germany",
  "Spain", "Italy", "Portugal", "Netherlands", "Argentina", "Brazil"];

test("the manifest holds the nations, valid, under ids no club uses", () => {
  assert.deepEqual(validateTeams(manifest), []);
  assert.equal(nations.length, 96);
  assert.ok(nations.every(n => /^nt-[a-z]{3,4}$/.test(n.id)), "every nation id is nt- and its code");
  assert.ok(manifest.teams.filter(t => t.comp !== "INTF").every(t => !/^nt-/.test(t.id)));
  assert.ok(nations.every(n => n.espn && n.feedName === n.name));
  const comps = n => [n.comp].concat(n.extraComps || []);
  assert.deepEqual(comps(nations.find(n => n.id === "nt-eng")), ["INTF", "UNL"]);
  assert.deepEqual(comps(nations.find(n => n.id === "nt-can")), ["INTF", "CNL"]);
  assert.deepEqual(comps(nations.find(n => n.id === "nt-arg")), ["INTF"]);
  assert.equal(nations.filter(n => (n.extraComps || []).includes("UNL")).length, 54);
});

test("twelve nations are flagged, and they are the twelve asked for, in order", () => {
  assert.deepEqual(nations.filter(n => n.featured).map(n => n.name), FEATURED);
  assert.ok(manifest.teams.filter(t => t.comp !== "INTF").every(t => !t.featured), "no club is featured");
});

test("a nation's other names resolve to it in the build", () => {
  assert.equal(build.idFor("United States"), "nt-usa");
  assert.equal(build.idFor("USA"), "nt-usa");
  assert.equal(build.idFor("Türkiye"), "nt-tur");
  assert.equal(build.idFor("Turkey"), "nt-tur");
  assert.equal(build.idFor("Czech Republic"), "nt-cze");
  assert.equal(build.idFor("Curacao"), "nt-cuw");
  assert.equal(build.idFor("Republic of Ireland"), "nt-irl");
  assert.equal(build.idFor("Northern Ireland"), "nt-nir");
  assert.equal(build.idFor("Peru"), null);
});

test("no club lost its name to a nation", () => {
  for(const t of manifest.teams.filter(t => t.comp !== "INTF")){
    assert.equal(build.idFor(t.feedName), t.id, t.feedName);
  }
});

test("a name that drifts in a Nations League feed is reported the first time it is said", () => {
  const ev = (home, away) => ({ competitions: [{ competitors: [
    { homeAway: "home", team: { displayName: home } }, { homeAway: "away", team: { displayName: away } }] }] });
  assert.deepEqual(CLOSED_COMPS, ["UNL", "CNL"]);
  assert.deepEqual(unknownSides([ev("Spain", "Czechia"), ev("Turkey", "Wales")], "UNL", build.idFor), [],
    "a known alias is not drift");
  assert.deepEqual(unknownSides([ev("Spain", "Czech Rep."), ev("Turkiye Republic", "Wales")], "UNL", build.idFor),
    ["Czech Rep.", "Turkiye Republic"]);
  assert.deepEqual(unknownSides(DAY3.events, "INTF", build.idFor), [],
    "the friendlies feed is open: Peru not being followable is not a name that drifted");
});

/* ============================ the floor ============================ */

test("a competition played in windows may fall to nothing without stopping the build", () => {
  assert.deepEqual(WINDOWED_COMPS, ["INTF", "UNL", "CNL"]);
  const before = { UNL: 54, INTF: 23, CNL: 74, EPL: 100 };
  assert.deepEqual(compFloorProblems(before, { EPL: 100 }), [],
    "the league phase ending is not an outage");
  assert.deepEqual(compFloorProblems(before, { UNL: 9, INTF: 2, CNL: 1, EPL: 100 }), [],
    "nor is a matchday ageing out of the window");
  assert.deepEqual(compFloorProblems(before, { UNL: 54, INTF: 23, CNL: 74 }).map(p => p.comp), ["EPL"],
    "and a league that vanishes is still caught");
  const peaks = { UNL: 156, EPL: 100 };
  assert.deepEqual(compFloorProblems({}, {}, { vanishBaseline: peaks }).map(p => p.comp), ["EPL"],
    "a remembered peak does not guard a windowed competition either");
});

/* ============================ the picker ============================ */

function drawer(opts = {}){
  const fn = /function pickerLeagueTeams\(lg\)\{[\s\S]*?function renderDrawer\(\)\{[\s\S]*?\n\}/.exec(SRC);
  assert.ok(fn, "the picker helpers and renderDrawer must exist");
  const P = loadFromPage(["COMPS", "PICKER_CAP", "SOCCER", "fullName"]);
  const pickable = Object.values(TEAMS);
  const body = `
    const PICKER_CAP = ${P.PICKER_CAP};
    const COMPS = ${JSON.stringify(P.COMPS)};
    const SOCCER = ${JSON.stringify(P.SOCCER)};
    const pickable = ${JSON.stringify(pickable)};
    const selected = new Set(${JSON.stringify(opts.selected || [])});
    const search = ${JSON.stringify(opts.search || "")};
    const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
    const crest = t => "";
    const fullName = ${P.fullName.toString()};
    const renderRugbyPicker = () => "", tennisPicker = () => "", shareLink = () => "";
    const tennisTours = new Set(), tennisEvents = new Set();
    let html = "";
    const document = { getElementById: () => ({ set innerHTML(v){ html = v; }, set textContent(v){} }) };
    ${fn[0]}
    renderDrawer();
    return html;`;
  return new Function(body)();
}
const section = (html, lg) => {
  const at = html.indexOf('data-picker-section="league-' + lg + '"');
  if(at < 0) return "";
  const end = html.indexOf("</details>", at);
  return html.slice(at, end);
};
const chipNames = html => [...html.matchAll(/<button class="chip" data-team="[^"]+"[^>]*>([^<]+)/g)].map(m => m[1]);

test("the nations section is named for the teams, and shows the twelve before anyone searches", () => {
  const s = section(drawer(), "INTF");
  assert.ok(s.includes("<b>Men's national teams</b>"), "not \"International Friendly\", which is a competition");
  assert.deepEqual(chipNames(s), FEATURED);
  assert.match(s, /84 more &mdash; search to find them/);
});

test("the Nations Leagues are competitions, not second lists of the same nations", () => {
  const html = drawer();
  assert.equal(section(html, "UNL"), "");
  assert.equal(section(html, "CNL"), "");
});

test("every other nation is behind the search, under the name people type", () => {
  assert.deepEqual(chipNames(section(drawer({ search: "scot" }), "INTF")), ["Scotland"]);
  assert.deepEqual(chipNames(section(drawer({ search: "jamaica" }), "INTF")), ["Jamaica"]);
  assert.deepEqual(chipNames(section(drawer({ search: "turkey" }), "INTF")), ["Türkiye"],
    "an alias answers the search where the feed's spelling would not");
  assert.deepEqual(chipNames(section(drawer({ search: "usa" }), "INTF")), ["United States"]);
});

test("a followed nation outside the twelve is never hidden behind the cap", () => {
  const s = section(drawer({ selected: ["nt-sco"] }), "INTF");
  assert.equal(chipNames(s)[0], "Scotland");
  assert.match(s, /1 picked/);
});

test("a club league's chips are in the order they always were", () => {
  const { fullName } = loadFromPage(["SOCCER", "fullName"]);
  const nhl = manifest.teams.filter(t => t.comp === "NHL").slice(0, 12).map(t => fullName(TEAMS[t.id]));
  assert.deepEqual(chipNames(section(drawer(), "NHL")), nhl);
});

/* ============================ the page and the build agree ============================ */

test("the page knows the three competitions the build fetches, under the same paths", () => {
  const P = loadFromPage(["COMPS", "SOCCER", "ESPN_PATH"]);
  for(const c of ["INTF", "UNL", "CNL"]){
    assert.ok(P.COMPS[c], c);
    assert.equal(P.SOCCER[c], 1, c + " is soccer: home side first, name without a city");
    assert.equal(P.ESPN_PATH[c], build.PATHS[c], c + " must be asked for at the same path by both");
  }
  assert.equal(P.COMPS.INTF.picker, "Men's national teams");
  const colours = Object.values(P.COMPS).map(c => c.color.toLowerCase());
  assert.equal(new Set(colours).size, colours.length, "no two competitions share a colour");
});
