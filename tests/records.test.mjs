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

const RECORD_NAMES = ["attachTables","tablePlayed","rowPlayed","recordFor","recordLine","recordText","ordinal","ORDINALS","shortScope","REC_ORDER","REC_ORDER_DEFAULT"];
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
/* Two conferences, so the scope IS shown — and MLS writes a record the
   North American way round, which no other league in a "table" does. */
const MLS_EAST = {comp:"MLS", group:"eastern-conference", scope:"Eastern Conference", kind:"table",
  rows:[{id:"tfc", name:"Toronto FC", pts:26, w:5, d:11, l:7, gp:23, pos:11}]};
const MLS_WEST = {comp:"MLS", group:"western-conference", scope:"Western Conference", kind:"table",
  rows:[{id:"van-mls", name:"Vancouver Whitecaps", pts:43, w:13, d:4, l:5, gp:22, pos:1}]};

test("every competition on the board reads as a record, in its own order", () => {
  /* The four shapes, all of which disagree with each other. */
  const m = model();
  m.attachTables([NHL_TABLE, NHL_OTHER, EPL_TABLE, MLS_EAST, MLS_WEST]);

  /* Hockey keeps a point for an overtime loss, so the third number is
     part of the record rather than a tie count. */
  assert.equal(m.recordLine({id:"tor"}, "NHL"), "12-4-2 · 1st in the Atlantic");
  assert.equal(m.recordLine({id:"van"}, "NHL"), "8-8-3 · 4th in the Pacific");

  /* European soccer: won, drawn, lost. One league table needs no scope,
     because "1st" can only mean one thing. */
  assert.equal(m.recordLine({id:"mci"}, "EPL"), "3-0-0 · 1st");
  assert.equal(m.recordLine({id:"ars"}, "EPL"), "2-1-0 · 3rd");

  /* MLS: won, lost, drawn, the way MLS writes it — and with the
     conference, because MLS has two groups where the Premier League has
     one. Thirteen wins, five defeats, four draws. */
  assert.equal(m.recordLine({id:"van-mls"}, "MLS"), "13-5-4 · 1st in the West");
  assert.equal(m.recordLine({id:"tfc"}, "MLS"), "5-7-11 · 11th in the East");
});

test("points are not a record and are no longer shown as one", () => {
  const m = model();
  m.attachTables([EPL_TABLE, MLS_WEST]);
  for(const line of [m.recordLine({id:"mci"}, "EPL"), m.recordLine({id:"van-mls"}, "MLS")]){
    assert.doesNotMatch(line, /pts?\b/, "a points total is a standings figure, got: " + line);
  }
});

test("whether the group is named depends on how many there are, not on the kind", () => {
  /* MLS and the Premier League are both kind "table". A rule keyed on
     kind would strip "in the West", which is the part that was right. */
  const m = model();
  m.attachTables([EPL_TABLE, MLS_EAST, MLS_WEST, NHL_TABLE, NHL_OTHER]);
  assert.match(m.recordLine({id:"van-mls"}, "MLS"), / in the West$/, "two conferences");
  assert.match(m.recordLine({id:"tor"}, "NHL"), / in the Atlantic$/, "several divisions");
  assert.equal(m.recordLine({id:"mci"}, "EPL"), "3-0-0 · 1st", "one table, so no scope");

  /* And the Champions League league phase is one table too, whatever its
     scope happens to be called. */
  const n = model();
  n.attachTables([UCL_TABLE]);
  assert.equal(n.recordLine({id:"mci"}, "UCL"), "1-0-0 · 12th");
});

test("the third figure appears only where the sport has one", () => {
  const m = model();
  /* Baseball and basketball: two numbers. "86-0-58" would be a nought
     nobody can play for. */
  assert.equal(m.recordText({w:86, l:58, d:0}, {kind:"division", comp:"MLB"}), "86-58");
  assert.equal(m.recordText({w:9, l:7}, {kind:"division", comp:"NBA"}), "9-7");
  /* Football ties happen, and are shown when they do. */
  assert.equal(m.recordText({w:9, l:7, d:1}, {kind:"division", comp:"NFL"}), "9-7-1");
  assert.equal(m.recordText({w:9, l:7, d:0}, {kind:"division", comp:"NFL"}), "9-7");
  /* Hockey's overtime loss is always part of the record, zero included:
     12-4 and 12-4-0 are not the same claim. */
  assert.equal(m.recordText({w:9, l:7, otl:2}, {kind:"division", comp:"NHL"}), "9-7-2");
  assert.equal(m.recordText({w:9, l:7, otl:0}, {kind:"division", comp:"NHL"}), "9-7-0");
  /* A league table is three numbers and always three: a club with no
     draws has drawn none, which is a fact about their season. */
  assert.equal(m.recordText({w:1, d:0, l:0, pts:3}, {kind:"table", comp:"UCL"}), "1-0-0");
  assert.equal(m.recordText({w:13, d:4, l:5, pts:43}, {kind:"table", comp:"MLS"}), "13-5-4");
  assert.equal(m.recordText({w:13, d:4, l:5, pts:43}, {kind:"table", comp:"EPL"}), "13-4-5");
  /* Nothing is composed from figures the source did not publish. The NBA
     publishes no `overall` string at all, which is why the two numbers
     are read directly — but if even those are missing, so is the
     record. */
  assert.equal(m.recordText({w:9}, {kind:"division", comp:"NBA"}), null);
  assert.equal(m.recordText({}, {kind:"table", comp:"EPL"}), null);
  assert.equal(m.recordText({w:3, l:0, pts:9}, {kind:"table", comp:"EPL"}), null,
    "a table row with no draw count is not a record we can write");
});

test("MLS is written the way MLS writes it, which is not the way ESPN does", () => {
  /* ESPN publishes `overall` as won-drawn-lost for MLS and for Europe
     alike: Chicago Fire arrives as "11-5-6" against 11 wins, 5 draws and
     6 defeats, and 3x11+5 is the 38 points beside it. So passing the
     published string through would put a Whitecaps line in European
     order. The figures are composed here instead, and only the order
     differs — never the numbers. */
  const m = model();
  const row = {w:13, d:4, l:5, pts:43};
  assert.equal(m.recordText(row, {kind:"table", comp:"MLS"}), "13-5-4", "13 won, 5 lost, 4 drawn");
  assert.equal(m.recordText(row, {kind:"table", comp:"EPL"}), "13-4-5", "13 won, 4 drawn, 5 lost");
  assert.deepEqual(m.REC_ORDER.MLS, ["w", "l", "d"]);
  assert.deepEqual(m.REC_ORDER_DEFAULT, ["w", "d", "l"]);
  /* Every other soccer competition the app carries takes the default. */
  for(const comp of ["EPL", "LALIGA", "SERIEA", "BUNDES", "LIGUE1", "UCL", "EFL", "FAC"])
    assert.equal(m.REC_ORDER[comp], undefined, comp + " is written won-drawn-lost");
});

test("a cup tie shows the club's league record, not its record in the cup", () => {
  const m = model();
  m.attachTables([EPL_TABLE, UCL_TABLE]);
  assert.equal(m.recordLine({id:"mci"}, "UCL"), "1-0-0 · 12th", "in the Champions League, the league phase");
  assert.equal(m.recordLine({id:"mci"}, "EPL"), "3-0-0 · 1st");
  /* A League Cup tie has no table of its own, so a club that HAS a
     league table here falls back to it. Most cup clubs do not — see the
     test below. */
  assert.equal(m.recordLine({id:"mci"}, "EFL"), "3-0-0 · 1st");
});

/* ---- the League Cup, where half a row often has no record ---- */

test("a cup row with a record on one side or neither reads as a finished row", () => {
  /* Most League Cup ties pair a club this app carries a table for with
     one it does not. A row is not broken because half of it has nothing
     to say — there is no empty element, no stray separator, and no
     placeholder standing in for a figure nobody published. */
  const p = rowHarness([SCHEDULED_ONLY]);
  const known = {id:"tor", home:"NHL", city:"Toronto", name:"Maple Leafs"};
  /* A soccer club's name is the whole name — fullName drops the city
     for a soccer competition rather than prefixing it. */
  const unknown = {id:"lin", home:"EFL", city:"Lincoln City", name:"Lincoln City"};
  const oneSide = p.gameRow({id:"cup1", comp:"EFL", start: NOW + 86400000,
    home: known, away: unknown, stage:"", listed:true, espn:true, fromFeed:true,
    moved:null, venue:null, result:{status:"scheduled", label:"", score:null}}, NOW);
  assert.equal((oneSide.match(/class="g-rec"/g) || []).length, 1, "one record, for the side that has one");
  assert.doesNotMatch(oneSide, /class="g-rec"><\/span>/, "and no empty one for the side that does not");
  assert.match(oneSide, /Lincoln City/, "the club is still named");

  const neither = p.gameRow({id:"cup2", comp:"EFL", start: NOW + 86400000,
    home: unknown, away: {id:"mid", home:"EFL", city:"Middlesbrough", name:""},
    stage:"", listed:true, espn:true, fromFeed:true, moved:null, venue:null,
    result:{status:"scheduled", label:"", score:null}}, NOW);
  assert.doesNotMatch(neither, /g-rec/, "no record on either side is a complete row, not a broken one");
  assert.match(neither, /g-side/, "the sides are still there");
  assert.match(neither, /class="at"/, "and so is the separator between them");
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
  assert.equal(m.recordLine({id:"mci"}, "UCL"), "1-0-0 · 1st", "a club that has played has one");
  assert.equal(m.recordLine({id:"liv"}, "UCL"), null);
  /* And nothing is borrowed from the club's league table to fill the
     gap: a Premier League figure on a row labelled Champions League
     would be read as a Champions League figure. */
  m.attachTables([EPL_TABLE, {comp:"UCL", group:"league", scope:"League Phase", kind:"table",
    rows:[{id:"mci", name:"Manchester City", pts:3, w:1, gp:1, l:0, pos:1},
          {id:"ars", name:"Arsenal", pts:0, w:0, d:0, l:0, gp:0, pos:20}]}]);
  assert.equal(m.recordLine({id:"ars"}, "UCL"), null, "not Arsenal's Premier League line");
  assert.equal(m.recordLine({id:"ars"}, "EPL"), "2-1-0 · 3rd", "which is still right on a league row");
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
  /* The board spoiledTeams reads. Held on globalThis so a test can put
     games on it and then ask what the page makes of them. */
  globalThis.__board = [];
  const myGames = () => globalThis.__board;
  let SPOILED = new Set();
  globalThis.__spoil = now => { SPOILED = spoiledTeams(now); return SPOILED; };
`;
const ROW_NAMES = ["COMPS","SERVICES","CARRIER_SERVICE","SRC","CHECKED","tv","st","CDN_MLS","RIGHTS",
  "resolveRights","SOCCER","fullName","esc","inkOn","pad","ymd","normName",
  "fmtTime","fmtShortDate","countdownText","BELL","saveButton","provenanceOf","servicesFor",
  "covered","visibleRights","carrierHtml","orderedTeams","scoreFor","stateOf","timeState","START_VERB","verbOf","venueTag",
  "attachTables","tablePlayed","rowPlayed","recordFor","recordText","recordLine","ordinal","ORDINALS","shortScope",
  "RESULTS_DAYS","spoiledTeams","gameRow"];

const NOW = Date.parse("2026-11-20T23:00:00Z");
const TEAM = (id, city, name, comp) => ({id, home:comp, city, name, abbr:id.toUpperCase().slice(0,3), color:"#123456"});
const LEAFS = TEAM("tor", "Toronto", "Maple Leafs", "NHL");
const BRUINS = TEAM("bos", "Boston", "Bruins", "NHL");
const CANUCKS = TEAM("van", "Vancouver", "Canucks", "NHL");

/* The board, and then the same two steps render() takes: work out whose
   records are being held back, and only then draw the rows. */
function rowHarness(board = [], preamble = ROW_PREAMBLE){
  const p = loadFromPage(ROW_NAMES, preamble);
  p.attachTables([NHL_TABLE, NHL_OTHER, EPL_TABLE]);
  globalThis.__board = board;
  globalThis.__spoil(NOW);
  return p;
}
const game = over => Object.assign({
  id:"g1", comp:"NHL", start: NOW - 3*3600000, home: BRUINS, away: LEAFS,
  stage:"", listed:true, espn:true, fromFeed:true, moved:null, venue:null,
  result:{status:"final", label:"Final", score:[2,4]}
}, over);

/* A finished game, and the same two teams playing again later in the
   window. This pair is the whole spoiler rule. */
const FINISHED = game();
const UPCOMING = game({id:"g9", start: NOW + 2*86400000,
  home: LEAFS, away: BRUINS, result:{status:"scheduled", label:"", score:null}});
const SCHEDULED_ONLY = game({id:"g8", start: NOW + 2*86400000,
  home: CANUCKS, away: BRUINS, result:{status:"scheduled", label:"", score:null}});

test("both records render on an ordinary row", () => {
  const p = rowHarness([UPCOMING]);
  const html = p.gameRow(UPCOMING, NOW);
  assert.match(html, /12-4-2 · 1st in the Atlantic/);
  assert.match(html, /9-7-1 · 2nd in the Atlantic/);
});

test("a team currently playing still shows its record", () => {
  /* A record cannot move while a game is in progress, so it gives away
     nothing about the game on the screen — and a hidden live score is
     still hidden. */
  const live = game({result:{status:"live", label:"2nd period", score:[1,1]}});
  const p = rowHarness([live]);
  const html = p.gameRow(live, NOW);
  assert.match(html, /1st in the Atlantic/);
  assert.match(html, /2nd in the Atlantic/);
  assert.match(html, /hidden-score/, "the score itself is still behind the reveal");
});

test("a finished game with its result hidden takes both records down", () => {
  const p = rowHarness([FINISHED]);
  const html = p.gameRow(FINISHED, NOW);
  assert.match(html, /hidden-score/, "the game is final and hidden");
  assert.doesNotMatch(html, /g-rec/, "a record already counts that result");
});

test("and takes them down on that team's UPCOMING row too", () => {
  /* The leak the per-row rule left open. The Bruins played last night
     and play again on Sunday. Sunday's row is scheduled, so nothing
     about that row is hidden — but the record on it already counts last
     night, and 9-7-1 becoming 10-7-1 announces the result on a row about
     a game that has not been played. */
  const p = rowHarness([FINISHED, UPCOMING]);
  const ahead = p.gameRow(UPCOMING, NOW);
  assert.doesNotMatch(ahead, /g-rec/,
    "neither team may show a record while their finished game is hidden");
  assert.doesNotMatch(ahead, /hidden-score/, "the upcoming row itself hides nothing");
  assert.match(ahead, /Maple Leafs/, "the row is otherwise unchanged");
});

test("revealing that game restores the record on both rows", () => {
  const p = rowHarness([FINISHED, UPCOMING],
    ROW_PREAMBLE.replace("revealed = new Set()", 'revealed = new Set(["g1"])'));
  assert.match(p.gameRow(FINISHED, NOW), /1st in the Atlantic/, "on the game that was hidden");
  assert.match(p.gameRow(UPCOMING, NOW), /1st in the Atlantic/, "and on the one ahead of it");
  assert.match(p.gameRow(UPCOMING, NOW), /2nd in the Atlantic/);
});

test("a team with no hidden result behind it shows its record on every row", () => {
  /* The Canucks have nothing final on the board. The Bruins do, and only
     the Bruins go quiet — one team's hidden result must not empty the
     board. */
  const p = rowHarness([FINISHED, SCHEDULED_ONLY]);
  const html = p.gameRow(SCHEDULED_ONLY, NOW);
  assert.match(html, /4th in the Pacific/, "the Canucks are unaffected");
  assert.doesNotMatch(html, /2nd in the Atlantic/, "the Bruins, on the same row, are not");
});

test("with scores switched on, a finished game shows records like any other", () => {
  const p = rowHarness([FINISHED, UPCOMING], ROW_PREAMBLE.replace("showScores = false", "showScores = true"));
  assert.match(p.gameRow(FINISHED, NOW), /1st in the Atlantic/);
  assert.match(p.gameRow(UPCOMING, NOW), /1st in the Atlantic/);
});

test("a soccer result keeps the deciding reason supplied by the live source", () => {
  const england = TEAM("eng", "", "England", "EPL");
  const france = TEAM("fra", "", "France", "EPL");
  const penalties = game({comp:"EPL", home:england, away:france,
    result:{status:"final", label:"England won on penalties", score:[1,1]}});
  const p = rowHarness([penalties], ROW_PREAMBLE.replace("showScores = false", "showScores = true"));
  const html = p.gameRow(penalties, NOW);
  assert.match(html, /England won on penalties/);
  assert.doesNotMatch(html, /Ended early|Game ended/);
});

test("the suppressed set is worked out once, over the board, not per row", () => {
  const p = rowHarness([FINISHED, UPCOMING]);
  const spoiled = p.spoiledTeams(NOW);
  assert.deepEqual([...spoiled].sort(), ["bos", "tor"], "both sides of the hidden game");
  /* A race, a rugby fixture and a tennis match carry no record to give
     away, and asking about them must not throw. */
  globalThis.__board = [FINISHED, {id:"r1", event:true, start:NOW, race:"Some race"},
    {id:"t1", tennis:true, start:NOW, home:null, away:null},
    {id:"ru1", rugby:true, start:NOW - 3*3600000, home:{id:"ire"}, away:{id:"eng"},
     ru:{state:"final"}, result:{status:"final", score:[10,7]}}];
  const again = p.spoiledTeams(NOW);
  assert.deepEqual([...again].sort(), ["bos", "tor"], "nothing else contributes an id");
});

test("a finished game older than the board cannot suppress anything", () => {
  /* The suppressed set reaches exactly as far back as Recent results
     does, because that is as far back as a person can see a hidden game
     or click Reveal on it. A game five days ago is on nobody's screen,
     so no result is being withheld — and counting it would take a team's
     record off the board permanently, since in daily sport there is
     nearly always something back there. */
  const old = game({id:"g7", start: NOW - 5*86400000});
  const p = rowHarness([old, UPCOMING]);
  assert.deepEqual([...p.spoiledTeams(NOW)], [], "out of the board's reach");
  assert.match(p.gameRow(UPCOMING, NOW), /1st in the Atlantic/);

  /* One day inside it does suppress, and can be revealed. */
  const recent = game({id:"g6", start: NOW - 26*3600000});
  const q = rowHarness([recent, UPCOMING]);
  assert.deepEqual([...q.spoiledTeams(NOW)].sort(), ["bos", "tor"]);
  assert.doesNotMatch(q.gameRow(UPCOMING, NOW), /g-rec/);
});

test("the spoiler rule and Recent results read the same three days from one constant", () => {
  const { RESULTS_DAYS } = rowHarness();
  assert.equal(RESULTS_DAYS, 3);
  const spoil = /function spoiledTeams\(now\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(spoil, /RESULTS_DAYS \* DAY/, "the set reaches as far as the panel does");
  const results = /function renderResults\([\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(results, /RESULTS_DAYS\*DAY/, "and the panel reaches as far as the set does");
});

test("one row hiding its record does not silence the rest of the board", () => {
  const p = rowHarness([FINISHED, SCHEDULED_ONLY]);
  assert.doesNotMatch(p.gameRow(FINISHED, NOW), /g-rec/);
  assert.match(p.gameRow(SCHEDULED_ONLY, NOW), /4th in the Pacific/);
});

test("adding a club to the board renders its record on the same frame", () => {
  /* The tables are not filtered by who is followed, so nothing is
     fetched, rebuilt or waited for when someone is added. The proof is
     that the record is already there with an empty board. */
  const fixture = {id:"g3", comp:"NHL", start: NOW + 86400000, home: CANUCKS, away: LEAFS,
    stage:"", listed:true, espn:true, fromFeed:true, moved:null, venue:null,
    result:{status:"scheduled", label:"", score:null}};
  const p = rowHarness([fixture]);
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
