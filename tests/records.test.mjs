import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage, styleText, ruleFor } from "./helpers/page.mjs";
import { TABLE_SOURCES, anythingPlayed, isCurrentSeason, tableProblem } from "../scripts/lib/records.mjs";

/* A team's record, under its name, on every row of the board.
 *
 * Two things are being defended here and they pull in opposite
 * directions. A record has to be present for every club, including the
 * ones no race would ever mention — that is the whole reason this reads
 * a second set of tables rather than the Race groups. And it has to
 * disappear in exactly one case, where a finished game is sitting on the
 * board with its result hidden, because a record already counts that
 * result and would announce it.
 */

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
const FILE = JSON.parse(readFileSync(new URL("../data.json", import.meta.url), "utf8"));

/* ================= the build side ================= */

test("every competition with a table has a source, and the cup that has none does not", () => {
  const comps = TABLE_SOURCES.map(s => s.comp);
  for(const c of ["NHL","NBA","NFL","MLB","MLS","EPL","LALIGA","SERIEA","BUNDES","LIGUE1","UCL"])
    assert.ok(comps.includes(c), c + " must have a full-table source");
  assert.equal(new Set(comps).size, comps.length, "one source per competition");
  /* EFL here is the Carabao Cup, not the Championship. A knockout has no
     table and its standings endpoint answers with no standings block at
     all, so asking would spend a request to receive nothing. */
  assert.ok(!comps.includes("EFL"), "a knockout cup has no table to ask for");
  assert.ok(!comps.includes("FAC"));
});

test("the North American sources ask for divisions, so every club is in a group small enough to place", () => {
  for(const s of TABLE_SOURCES.filter(x => ["NHL","NBA","NFL","MLB"].includes(x.comp)))
    assert.match(s.url, /level=3/, s.comp + " must be asked by division");
});

test("a table nothing has been played in is not a table", () => {
  /* Every NHL and NFL club reads 0-0 today. The rows are well formed and
     the positions are real, which is exactly why this needs its own
     gate: nothing downstream would notice. */
  const preseason = { season: 2027, rows: [
    {id:"tor", w:0, l:0, otl:0, gp:0, pos:1},
    {id:"bos", w:0, l:0, otl:0, gp:0, pos:1}] };
  assert.equal(anythingPlayed(preseason), false);
  assert.equal(tableProblem(preseason, [2027]), "nothing played yet");

  const started = { season: 2027, rows: [
    {id:"tor", w:1, l:0, otl:0, gp:1, pos:1},
    {id:"bos", w:0, l:1, otl:0, gp:1, pos:2}] };
  assert.equal(anythingPlayed(started), true);
  assert.equal(tableProblem(started, [2027]), null);

  /* A single game anywhere in the competition is enough: a league does
     not open on the same night in every division. */
  assert.equal(anythingPlayed({rows:[{w:0,l:0,gp:0},{w:0,l:0,gp:1}]}), true);
  assert.equal(anythingPlayed({rows:[]}), false);
  assert.equal(anythingPlayed(null), false);
});

test("last season's completed table is refused, however complete it looks", () => {
  /* The NBA on the day this was written: thirty clubs, every figure
     real, Boston 56-26 — and it is the 2025-26 table, while the NBA's
     own fixtures for the next three months belong to 2026-27. Nothing
     inside the standings payload says so. The fixtures do. */
  const lastSeason = { season: 2026, rows: [{id:"bos-nba", w:56, l:26, gp:82, pos:1}] };
  assert.equal(isCurrentSeason(lastSeason, [2027]), false);
  assert.match(tableProblem(lastSeason, [2027]), /season 2026, but the fixtures are 2027/);

  /* And the case that must NOT be caught with it: baseball's standings
     say 2026 while the season header at the top of the same response
     says 2027, because that header describes the next season to start.
     The fixtures say 2026, so the table is current. */
  assert.equal(isCurrentSeason({season:2026, rows:[]}, [2026]), true);

  /* A competition with no fixtures in the window has not disproved
     anything, so its table is accepted rather than discarded on a
     comparison that could not be made. */
  assert.equal(isCurrentSeason({season:2026, rows:[]}, []), true);
  assert.equal(isCurrentSeason({rows:[]}, [2027]), true, "a table with no stated season is not judged");

  /* A competition playing across a rollover satisfies either year. */
  assert.equal(isCurrentSeason({season:2026}, new Set([2026, 2027])), true);
});

test("the committed file carries tables, and they are not the Race groups", () => {
  assert.ok(Array.isArray(FILE.tables) && FILE.tables.length, "data.json must carry tables");
  assert.ok(Array.isArray(FILE.standings), "and standings, still separately");
  /* The two are written from different source lists and must not have
     been quietly collapsed into one. */
  const raceMlb = FILE.standings.filter(g => g.comp === "MLB");
  const tableMlb = FILE.tables.filter(g => g.comp === "MLB");
  assert.ok(raceMlb.length && tableMlb.length);
  assert.notDeepEqual(raceMlb.map(g => g.group).sort(), tableMlb.map(g => g.group).sort());
});

test("a club the race view leaves out is in the tables — the case this feature exists for", () => {
  /* The MLB Race source is the wild-card view: twelve non-division-
     leaders per league. Every division leader is therefore missing from
     it, which is six of the most followed clubs in the sport. */
  const inRace = new Set();
  for(const g of FILE.standings) if(g.comp === "MLB") for(const r of g.rows) if(r.id) inRace.add(r.id);
  const leaders = [];
  for(const g of FILE.tables) if(g.comp === "MLB")
    for(const r of g.rows) if(r.id && r.pos === 1) leaders.push(r.id);
  assert.ok(leaders.length >= 6, "one leader per division, got " + leaders.length);
  for(const id of leaders)
    assert.ok(!inRace.has(id), id + " leads its division, so the wild-card view omits it");
});

test("no table is filtered down to the clubs anyone follows", () => {
  const manifest = JSON.parse(readFileSync(new URL("../data/teams.json", import.meta.url), "utf8"));
  const followable = new Set(manifest.teams.map(t => t.id));
  const epl = FILE.tables.find(g => g.comp === "EPL");
  assert.ok(epl && epl.rows.length === 20, "the whole league, not a slice");
  /* Rows the manifest does not know are kept too — a table with holes in
     it would be a table nobody could read. */
  assert.ok(epl.rows.every(r => r.name), "every row is named whether or not it is followable");
  assert.ok(epl.rows.some(r => followable.has(r.id)));
});

/* ================= the page side ================= */

const RECORD_NAMES = ["attachTables","tablePlayed","rowPlayed","recordFor","recordLine","recordText","ordinal","ORDINALS","shortScope"];
const RECORD_PREAMBLE = `let TABLES = [], RECORDS = new Map();\n`;
const model = () => loadFromPage(RECORD_NAMES, RECORD_PREAMBLE);

const NHL_TABLE = {comp:"NHL", group:"atlantic", scope:"Atlantic Division", kind:"division", rows:[
  {id:"tor", name:"Toronto Maple Leafs", w:12, l:4, otl:2, gp:18, pos:1},
  {id:"bos", name:"Boston Bruins", w:9, l:7, otl:1, gp:17, pos:2}]};
const NHL_OTHER = {comp:"NHL", group:"pacific", scope:"Pacific Division", kind:"division", rows:[
  {id:"van", name:"Vancouver Canucks", w:8, l:8, otl:3, gp:19, pos:4}]};
const EPL_TABLE = {comp:"EPL", group:"table", scope:"2026-27 English Premier League", kind:"table", rows:[
  {id:"mci", name:"Manchester City", pts:9, w:3, d:0, l:0, gp:3, pos:1},
  {id:"ars", name:"Arsenal", pts:7, w:2, d:1, l:0, gp:3, pos:3}]};
const UCL_TABLE = {comp:"UCL", group:"league", scope:"League Phase", kind:"table", rows:[
  {id:"mci", name:"Manchester City", pts:3, w:1, d:0, l:0, gp:1, pos:12}]};

test("a record renders for a club in a North American division and for one in a soccer table", () => {
  const m = model();
  m.attachTables([NHL_TABLE, NHL_OTHER, EPL_TABLE]);
  /* Hockey keeps a point for an overtime loss, so the third number is
     part of the record rather than a tie count. */
  assert.equal(m.recordLine({id:"tor"}, "NHL"), "12-4-2 · 1st in the Atlantic");
  assert.equal(m.recordLine({id:"van"}, "NHL"), "8-8-3 · 4th in the Pacific");
  /* One league table needs no scope: "1st" can only mean one thing. */
  assert.equal(m.recordLine({id:"mci"}, "EPL"), "9 pts · 1st");
  assert.equal(m.recordLine({id:"ars"}, "EPL"), "7 pts · 3rd");
});

test("soccer reads points and a table position, North America reads wins and losses", () => {
  const m = model();
  assert.equal(m.recordText({pts:1}, {kind:"table"}), "1 pt", "one point is not one points");
  assert.equal(m.recordText({pts:0}, {kind:"table"}), "0 pts");
  assert.equal(m.recordText({w:9, l:7}, {kind:"division"}), "9-7", "no third number where none is published");
  assert.equal(m.recordText({w:9, l:7, d:1}, {kind:"division"}), "9-7-1", "football ties, when there are any");
  assert.equal(m.recordText({w:9, l:7, d:0}, {kind:"division"}), "9-7", "and not when there are none");
  assert.equal(m.recordText({w:9, l:7, otl:2}, {kind:"division"}), "9-7-2");
  /* Nothing is composed from figures the source did not publish. The NBA
     publishes no `overall` string at all, which is why the two numbers
     are read directly — but if even those are missing, so is the
     record. */
  assert.equal(m.recordText({w:9}, {kind:"division"}), null);
  assert.equal(m.recordText({}, {kind:"table"}), null);
});

test("a cup tie shows the club's league record, not its record in the cup", () => {
  const m = model();
  m.attachTables([EPL_TABLE, UCL_TABLE]);
  assert.equal(m.recordLine({id:"mci"}, "UCL"), "3 pts · 12th", "in the Champions League, the league phase");
  assert.equal(m.recordLine({id:"mci"}, "EPL"), "9 pts · 1st");
  /* An EFL Cup tie has no table of its own, so it falls back to the
     club's league rather than showing nothing. */
  assert.equal(m.recordLine({id:"mci"}, "EFL"), "9 pts · 1st");
});

test("a club with no row anywhere renders nothing, and asking about one throws nothing", () => {
  const m = model();
  m.attachTables([EPL_TABLE]);
  assert.equal(m.recordLine({id:"no-such-club"}, "EPL"), null);
  assert.equal(m.recordLine({}, "EPL"), null);
  assert.equal(m.recordLine(null, "EPL"), null);
  assert.equal(m.recordFor(null, "EPL"), null);
});

test("a file with no tables leaves every record absent", () => {
  const m = model();
  m.attachTables([EPL_TABLE]);
  assert.ok(m.recordLine({id:"mci"}, "EPL"));
  assert.equal(m.attachTables(null), 0);
  assert.equal(m.recordLine({id:"mci"}, "EPL"), null, "a record must not outlive the data behind it");
  assert.equal(m.attachTables([{comp:"EPL", rows:[]}]), 0, "an empty group is not a group");
});

test("an all-zero table published anyway would still render no record", () => {
  /* The build refuses these, and this is the second line: if one ever
     reached the page, "0-0-0" under thirty-two clubs is the outcome
     being prevented, so the page must not be the only thing standing
     between a preseason table and the board. */
  const m = model();
  m.attachTables([{comp:"NHL", group:"atlantic", scope:"Atlantic Division", kind:"division",
    rows:[{id:"tor", name:"Toronto Maple Leafs", w:0, l:0, otl:0, gp:0, pos:1}]}]);
  assert.equal(m.recordLine({id:"tor"}, "NHL"), null, "never a fabricated 0-0");
});

test("a club that has not played yet has no record, even in a table that has started", () => {
  /* Two matchdays into the Champions League most of the thirty-six clubs
     read zero. "0 pts · 17th" under Liverpool is a fact about the
     alphabet, not about Liverpool. */
  const m = model();
  m.attachTables([{comp:"UCL", group:"league", scope:"League Phase", kind:"table", rows:[
    {id:"mci", name:"Manchester City", pts:3, w:1, d:0, l:0, gp:1, pos:1},
    {id:"liv", name:"Liverpool", pts:0, w:0, d:0, l:0, gp:0, pos:17}]}]);
  assert.equal(m.recordLine({id:"mci"}, "UCL"), "3 pts · 1st", "a club that has played has one");
  assert.equal(m.recordLine({id:"liv"}, "UCL"), null);
  /* And nothing is borrowed from the club's league table to fill the
     gap: a Premier League figure on a row labelled Champions League
     would be read as a Champions League figure. */
  m.attachTables([EPL_TABLE, {comp:"UCL", group:"league", scope:"League Phase", kind:"table",
    rows:[{id:"mci", name:"Manchester City", pts:3, w:1, gp:1, l:0, pos:1},
          {id:"ars", name:"Arsenal", pts:0, w:0, d:0, l:0, gp:0, pos:20}]}]);
  assert.equal(m.recordLine({id:"ars"}, "UCL"), null, "not Arsenal's Premier League line");
  assert.equal(m.recordLine({id:"ars"}, "EPL"), "7 pts · 3rd", "which is still right on a league row");
});

test("positions read the way a person says them", () => {
  const { ordinal, shortScope } = model();
  assert.equal(ordinal(1), "1st");
  assert.equal(ordinal(2), "2nd");
  assert.equal(ordinal(3), "3rd");
  assert.equal(ordinal(4), "4th");
  assert.equal(ordinal(11), "11th", "not 11st");
  assert.equal(ordinal(12), "12th");
  assert.equal(ordinal(13), "13th");
  assert.equal(ordinal(21), "21st");
  assert.equal(ordinal(22), "22nd");
  assert.equal(ordinal(0), null);
  assert.equal(ordinal(null), null);
  assert.equal(shortScope("American League East"), "AL East");
  assert.equal(shortScope("National League Central"), "NL Central");
  assert.equal(shortScope("Atlantic Division"), "Atlantic");
  assert.equal(shortScope("Eastern Conference"), "East");
  assert.equal(shortScope("AFC East"), "AFC East");
});

/* ================= the row, and the spoiler rule ================= */

const ROW_PREAMBLE = `
  const DAY = 86400000;
  let showScores = false, dataStale = false, liveMode = true;
  let services = new Set(), revealed = new Set(), alerts = new Set();
  let selected = new Set();
  globalThis.__selected = selected;
  const crest = t => "";
  const fmtDayLong = k => k;
  const isNarrow = () => false;
  const TOURNEYS = new Map();
  const tourneyOf = () => null;
  const isStarredPlayer = () => false;
  let TABLES = [], RECORDS = new Map();
`;
const ROW_NAMES = ["COMPS","SERVICES","CARRIER_SERVICE","SRC","CHECKED","tv","st","CDN_MLS","RIGHTS",
  "resolveRights","SOCCER","fullName","esc","inkOn","pad","ymd","normName",
  "fmtTime","fmtShortDate","countdownText","BELL","saveButton","provenanceOf","servicesFor",
  "covered","orderedTeams","scoreFor","stateOf","timeState","START_VERB","verbOf","venueTag",
  "attachTables","tablePlayed","rowPlayed","recordFor","recordText","recordLine","ordinal","ORDINALS","shortScope","gameRow"];

const NOW = Date.parse("2026-11-20T23:00:00Z");
const TEAM = (id, city, name, comp) => ({id, home:comp, city, name, abbr:id.toUpperCase().slice(0,3), color:"#123456"});
const LEAFS = TEAM("tor", "Toronto", "Maple Leafs", "NHL");
const BRUINS = TEAM("bos", "Boston", "Bruins", "NHL");
const CANUCKS = TEAM("van", "Vancouver", "Canucks", "NHL");

function rowHarness(){
  const p = loadFromPage(ROW_NAMES, ROW_PREAMBLE);
  p.attachTables([NHL_TABLE, NHL_OTHER, EPL_TABLE]);
  return p;
}
const game = over => Object.assign({
  id:"g1", comp:"NHL", start: NOW - 3*3600000, home: BRUINS, away: LEAFS,
  stage:"", listed:true, espn:true, fromFeed:true, moved:null, venue:null,
  result:{status:"final", label:"Final", score:[2,4]}
}, over);

test("both records render on an ordinary row", () => {
  const p = rowHarness();
  const html = p.gameRow(game({result:{status:"scheduled", label:"", score:null},
    start: NOW + 2*3600000}), NOW);
  assert.match(html, /12-4-2 &middot; 1st in the Atlantic|12-4-2 · 1st in the Atlantic/);
  assert.match(html, /9-7-1 &middot; 2nd in the Atlantic|9-7-1 · 2nd in the Atlantic/);
});

test("a team currently playing still shows its record", () => {
  /* A record cannot move while a game is in progress, so it gives away
     nothing about the game on the screen — and a hidden live score is
     still hidden. */
  const p = rowHarness();
  const html = p.gameRow(game({result:{status:"live", label:"2nd period", score:[1,1]}}), NOW);
  assert.match(html, /1st in the Atlantic/);
  assert.match(html, /2nd in the Atlantic/);
  assert.match(html, /hidden-score/, "the score itself is still behind the reveal");
});

test("a finished game with its result hidden takes both records down", () => {
  const p = rowHarness();
  const html = p.gameRow(game(), NOW);
  assert.match(html, /hidden-score/, "the game is final and hidden");
  assert.doesNotMatch(html, /g-rec/, "a record already counts that result");
});

test("revealing that game brings the records back", () => {
  /* The record is suppressed to protect a hidden result. Once the person
     has chosen to see the result, there is nothing left to protect. */
  const p = loadFromPage(ROW_NAMES, ROW_PREAMBLE.replace("revealed = new Set()", 'revealed = new Set(["g1"])'));
  p.attachTables([NHL_TABLE, NHL_OTHER, EPL_TABLE]);
  const html = p.gameRow(game(), NOW);
  assert.match(html, /1st in the Atlantic/);
  assert.match(html, /2nd in the Atlantic/);
});

test("with scores switched on, a finished game shows records like any other", () => {
  const p = loadFromPage(ROW_NAMES, ROW_PREAMBLE.replace("showScores = false", "showScores = true"));
  p.attachTables([NHL_TABLE, NHL_OTHER, EPL_TABLE]);
  assert.match(p.gameRow(game(), NOW), /1st in the Atlantic/);
});

test("one row hiding its record does not silence the rest of the board", () => {
  const p = rowHarness();
  const hidden = p.gameRow(game(), NOW);
  const other = p.gameRow(game({id:"g2", home: CANUCKS, away: BRUINS,
    result:{status:"scheduled", label:"", score:null}, start: NOW + 86400000}), NOW);
  assert.doesNotMatch(hidden, /g-rec/);
  assert.match(other, /4th in the Pacific/, "a different game is not the hidden one");
});

test("adding a club to the board renders its record on the same frame", () => {
  /* The tables are not filtered by who is followed, so nothing is
     fetched, rebuilt or waited for when someone is added. The proof is
     that the record is already there with an empty board. */
  const p = rowHarness();
  const fixture = {id:"g3", comp:"NHL", start: NOW + 86400000, home: CANUCKS, away: LEAFS,
    stage:"", listed:true, espn:true, fromFeed:true, moved:null, venue:null,
    result:{status:"scheduled", label:"", score:null}};
  const unfollowed = p.gameRow(fixture, NOW);
  assert.match(unfollowed, /4th in the Pacific/, "with nothing selected at all");
  assert.match(unfollowed, /g-team dim/, "and the club is not followed yet");

  /* Now follow it. The next render is the only thing that happens. */
  globalThis.__selected.add("van");
  const followed = p.gameRow(fixture, NOW);
  assert.match(followed, /4th in the Pacific/);
  assert.match(followed, /1st in the Atlantic/);
});

test("a tennis row renders no record and throws nothing", () => {
  /* Tennis rows carry no home, no away and no team ids at all, so there
     is no row for them to find. The renderer must not go looking. */
  const p = rowHarness();
  assert.equal(p.recordLine(null, "ATP"), null);
  assert.equal(p.recordLine(undefined, "WTA"), null);
  assert.equal(p.recordFor({name:"Carlos Alcaraz"}, "ATP"), null, "a player has no id to look up");
  const row = /function gameRow\([\s\S]*?\n\}/.exec(SRC)[0];
  assert.ok(row.indexOf("if(g.tennis) return tennisRow") < row.indexOf("recordLine"),
    "a tennis row leaves gameRow before any record is looked for");
});

/* ================= how loud it is ================= */

test("the record is quieter than the name it sits under", () => {
  const css = styleText();
  const rec = ruleFor(css, ".g-rec");
  assert.ok(rec, ".g-rec must be styled");
  const name = ruleFor(css, ".g-team");
  const sizeOf = r => Number(/font-size\s*:\s*([\d.]+)px/.exec(r)[1]);
  assert.ok(sizeOf(rec) < sizeOf(name), "smaller than the team name");
  assert.match(rec, /color\s*:\s*var\(--muted\)/, "and not in the ink the name is in");
  assert.doesNotMatch(rec, /font-weight\s*:\s*[6-9]00|bold/, "never bold");
});

test("the name keeps every rule it had — the wrapper is new, .g-team is not", () => {
  const css = styleText();
  assert.match(ruleFor(css, ".g-side"), /flex-direction\s*:\s*column/,
    "the record goes under the name, so each side is a column");
  assert.match(ruleFor(css, ".g-team"), /min-width\s*:\s*0/);
  assert.match(ruleFor(css, ".g-team"), /white-space\s*:\s*nowrap/);
});
