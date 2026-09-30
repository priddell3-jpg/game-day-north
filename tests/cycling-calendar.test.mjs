import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage } from "./helpers/page.mjs";
import { seasonTitle, worldsTitle, sameTitle, parseDateRange, parseSeasonCalendar, parseChampionship,
         parseStageTable, statedStages, poolFromPage, sameRace, inPool, missingRaces, dueMissing,
         calendarEntry, sourceFor, NO_REST_DAYS_UP_TO } from "../scripts/lib/cycling-calendar.mjs";

/* The cycling calendar, checked against the season instead of trusted.

   The 2026 Road World Championships ran in Montreal from 20 to 27
   September and were not on this page, and nothing said so for a month,
   because the race list was typed by hand and compared with nothing.

   Every article here is a real one, saved from the MediaWiki API on
   2026-09-29. */
const root = new URL("../", import.meta.url);
const read = p => readFileSync(new URL(p, root), "utf8");
const PAGE = read("src/page.html");
const BUILD = read("scripts/fetch-data.mjs");
const SEASON = read("tests/fixtures/uci-world-tour-2026.wikitext");
const WORLDS = read("tests/fixtures/uci-road-worlds-2026.wikitext");
const VUELTA = read("tests/fixtures/race-vuelta-2026.wikitext");
const SUISSE = read("tests/fixtures/race-tour-de-suisse-2026.wikitext");
const PARIS_NICE = read("tests/fixtures/race-paris-nice-2026.wikitext");
const REDIRECT = JSON.parse(read("tests/fixtures/uci-world-tour-2027-redirect.json"));

const season = parseSeasonCalendar(SEASON, 2026);
const pool = poolFromPage(PAGE);
const worlds = parseChampionship(WORLDS, 2026, worldsTitle(2026));
const race = name => season.find(r => r.race === name);

/* ============================ the season article ============================ */

test("the saved 2026 season article yields its thirty-six races", () => {
  assert.match(SEASON, /\| rounds\s*= 36/, "the article's own infobox says thirty-six");
  assert.equal(season.length, 36);
  assert.equal(new Set(season.map(r => r.race)).size, 36, "and no race twice");
  assert.deepEqual(season[0], { race: "Tour Down Under", article: "2026 Tour Down Under",
    start: "2026-01-20", end: "2026-01-25", oneDay: false });
  assert.deepEqual(season[35], { race: "Tour of Guangxi", article: "2026 Tour of Guangxi",
    start: "2026-10-13", end: "2026-10-18", oneDay: false });
});

test("dates are read as the table writes them", () => {
  assert.deepEqual([race("Tour de Romandie").start, race("Tour de Romandie").end], ["2026-04-28", "2026-05-03"],
    "a range across two months");
  assert.deepEqual([race("Vuelta a España").start, race("Vuelta a España").end], ["2026-08-22", "2026-09-13"]);
  assert.deepEqual([race("Giro d'Italia").start, race("Giro d'Italia").end], ["2026-05-08", "2026-05-31"]);
  assert.deepEqual([race("Tour de France").start, race("Tour de France").end], ["2026-07-04", "2026-07-26"]);
  for(const [name, day] of [["Il Lombardia", "2026-10-10"], ["Paris–Roubaix", "2026-04-12"],
      ["Grand Prix Cycliste de Québec", "2026-09-11"], ["Grand Prix Cycliste de Montréal", "2026-09-13"]]){
    assert.deepEqual([race(name).start, race(name).end, race(name).oneDay], [day, day, true], name);
  }
  assert.equal(season.filter(r => r.oneDay).length, 21);
  assert.ok(season.every((r, i) => !i || r.start >= season[i - 1].start), "in calendar order");
});

test("a race is named by the link's text and found by the link's target", () => {
  assert.equal(race("Tour of Flanders").article, "2026 Tour of Flanders (men's race)");
  assert.equal(race("Renewi Tour").article, "2026 Renewi Tour", "two flags in the cell do not hide the link");
  assert.ok(season.every(r => /^2026 /.test(r.article)));
});

test("a date this cannot vouch for is no date", () => {
  assert.deepEqual(parseDateRange("20–25 January", 2026), { start: "2026-01-20", end: "2026-01-25" });
  assert.deepEqual(parseDateRange("1 February", 2026), { start: "2026-02-01", end: "2026-02-01" });
  assert.deepEqual(parseDateRange("17–21 June 2026", 2025), { start: "2026-06-17", end: "2026-06-21" },
    "a year the text states wins over the one assumed");
  assert.deepEqual(parseDateRange("30 December – 3 January", 2026), { start: "2026-12-30", end: "2027-01-03" });
  assert.deepEqual(parseDateRange("20-25 January", 2026), { start: "2026-01-20", end: "2026-01-25" }, "a plain hyphen");
  for(const bad of ["TBA", "", "31 June", "January", "25–20 January", "Late August", "20–25 Januar"]){
    assert.equal(parseDateRange(bad, 2026), null, JSON.stringify(bad));
  }
});

test("a calendar with a row that cannot be read is no calendar", () => {
  /* One unreadable date must not yield thirty-five races: a calendar
     with a hole in it says a race is not happening. */
  const holed = SEASON.replace("|10 October", "|TBA");
  assert.notEqual(holed, SEASON);
  assert.deepEqual(parseSeasonCalendar(holed, 2026), []);
  assert.deepEqual(parseSeasonCalendar("no table here", 2026), []);
  assert.deepEqual(parseSeasonCalendar(WORLDS, 2026), [], "an article with tables but no calendar");
});

test("next season's article does not exist yet, and its redirect is not mistaken for it", () => {
  assert.equal(seasonTitle(2027), REDIRECT.requested);
  assert.equal(REDIRECT.title, "UCI World Tour");
  assert.equal(sameTitle(REDIRECT.requested, REDIRECT.title), false,
    "the article about the competition is not the 2027 season");
  assert.equal(sameTitle("2026 UCI World Tour", "2026 UCI World Tour"), true);
  assert.equal(sameTitle("2026 UCI World Tour", "2025 UCI World Tour"), false);
  assert.equal(sameTitle("2026 Tour of Guangxi", "2026 UCI World Tour"), false,
    "which is where a race article that is not written yet lands");
  assert.equal(sameTitle("", ""), false);
});

/* ============================ the pool against the season ============================ */

test("the hand-typed list is read out of the page as it ships", () => {
  assert.deepEqual(pool.map(p => p.short), ["Vuelta a España", "Bretagne Classic", "GP de Québec",
    "GP de Montréal", "Il Lombardia", "Tour of Guangxi"]);
  assert.equal(pool[0].dates.length, 21);
  assert.deepEqual([pool[0].start, pool[0].end], ["2026-08-22", "2026-09-13"]);
  assert.throws(() => poolFromPage("const NOTHING = [];"), /const CYCLING/);
});

test("known answer: thirty of the season's races are not in the list, and six are", () => {
  const missing = missingRaces(season, pool);
  assert.equal(missing.length, 30);
  assert.equal(missing[0].race, "Tour Down Under");
  assert.equal(missing[29].race, "Renewi Tour");
  assert.deepEqual(season.filter(r => inPool(r, pool)).map(r => r.race), ["Vuelta a España", "Bretagne Classic",
    "Grand Prix Cycliste de Québec", "Grand Prix Cycliste de Montréal", "Il Lombardia", "Tour of Guangxi"]);
  assert.deepEqual(missing.filter(m => ["Giro d'Italia", "Tour de France"].includes(m.race)).length, 2);
});

test("the World Championships are in no WorldTour calendar", () => {
  /* Which is the whole reason a check against the season article alone
     would have passed every day of the month they were missed. */
  assert.equal(season.some(r => /world championship/i.test(r.race)), false);
  assert.doesNotMatch(SEASON, /World Championships/);
});

test("so they are watched by name, and the saved article gives their dates", () => {
  assert.deepEqual(worlds, { race: "UCI Road World Championships", article: "2026 UCI Road World Championships",
    start: "2026-09-20", end: "2026-09-27", oneDay: false, series: "worlds" });
  assert.equal(inPool(worlds, pool), null);
  assert.deepEqual(missingRaces([worlds], pool),
    [{ race: "UCI Road World Championships", start: "2026-09-20", end: "2026-09-27", series: "worlds" }]);
  assert.equal(parseChampionship("no infobox", 2026, worldsTitle(2026)), null);
});

test("the miss would have been named a month before it happened, and every run until it was fixed", () => {
  const all = missingRaces(season.concat([worlds]), pool);
  const named = cutoff => dueMissing(all, cutoff).map(m => m.race);
  /* 22 August 2026, the day the hand list was checked, looking eight
     days back: two races just finished that the list never held, and
     the Worlds, a month away. */
  assert.deepEqual(named("2026-08-14"), ["Hamburg Cyclassics", "Renewi Tour", "UCI Road World Championships"]);
  /* A week on they are the only race the list lacks that is still to come. */
  assert.deepEqual(named("2026-08-24"), ["UCI Road World Championships"]);
  /* 29 September, eight days back: still named, two days after the finish. */
  assert.deepEqual(named("2026-09-21"), ["UCI Road World Championships"]);
  /* And once it is more than eight days gone there is nothing to act on. */
  assert.deepEqual(named("2026-09-28"), []);
  assert.equal(all.length - dueMissing(all, "2026-09-21").length, 30, "the thirty earlier ones are counted, not listed");
});

test("two names are the same race only when they share a word that names something", () => {
  assert.equal(sameRace("Vuelta a España", "La Vuelta Ciclista a España"), true);
  assert.equal(sameRace("Bretagne Classic", "Bretagne Classic - CIC"), true);
  assert.equal(sameRace("GP de Québec", "Grand Prix Cycliste de Québec"), true);
  assert.equal(sameRace("Grand Prix Cycliste de Québec", "Grand Prix Cycliste de Montréal"), false);
  assert.equal(sameRace("UAE Tour", "Tour of Guangxi"), false, "both are tours, and that is all they share");
  assert.equal(sameRace("Tour de France", "Tour of Flanders"), false);
  assert.equal(sameRace("Tour de Suisse", "Tour de Romandie"), false);
  assert.equal(sameRace("Tour", "Tour de France"), false, "a word that names a kind of race names no race");
  assert.equal(sameRace("", "Tour de France"), false);
});

test("the same race next year is not this year's entry", () => {
  const next = { race: "Il Lombardia", start: "2027-10-09", end: "2027-10-09", oneDay: true };
  assert.equal(inPool(next, pool), null);
  assert.equal(inPool(race("Il Lombardia"), pool).short, "Il Lombardia");
});

/* ============================ shown, but never fetched ============================ */

function sourcesFromBuild(){
  const m = /^const CYCLING_SOURCES = (\[[\s\S]*?\n\]);/m.exec(BUILD);
  assert.ok(m, "scripts/fetch-data.mjs must declare CYCLING_SOURCES");
  return new Function("return " + m[1] + ";")();
}
const SOURCES = sourcesFromBuild();

test("every race the page types has a source its results are fetched from", () => {
  /* A race in CYCLING and not in CYCLING_SOURCES is shown, and its
     result is never looked for. The rule is enforced for every entry
     rather than only for those already past: a race typed today is a
     past race by the time anyone notices, and a test that starts
     failing on a date nobody chose is a worse way to find out. */
  const today = new Date().toISOString().slice(0, 10);
  for(const p of pool){
    const src = SOURCES.find(s => s.name === p.short);
    const past = p.dates.some(d => d <= today);
    assert.ok(src, p.short + " is in CYCLING" + (past ? ", has a date in the past," : "")
      + " and has no CYCLING_SOURCES entry of that name in scripts/fetch-data.mjs — it is shown and its result is never fetched");
    assert.deepEqual(src.dates, p.dates, p.short + ": the dates results are keyed to must be the dates shown");
    assert.equal(!!src.oneDay, p.oneDay, p.short);
    assert.ok(Array.isArray(src.pages) && src.pages.length, p.short + " needs an article to read");
  }
});

test("and a source is named exactly as the page draws the race", () => {
  /* Results reach a row by the race's name. */
  assert.deepEqual(SOURCES.map(s => s.name).sort(), pool.map(p => p.short).sort());
});

test("the check itself catches a race with no source", () => {
  const typed = poolFromPage(PAGE.replace('{race:"Il Lombardia", short:"Il Lombardia", oneDay:"2026-10-10"},',
    '{race:"Il Lombardia", short:"Il Lombardia", oneDay:"2026-10-10"},\n  {race:"Paris-Tours", short:"Paris-Tours", oneDay:"2026-10-11"},'));
  assert.equal(typed.length, pool.length + 1);
  assert.deepEqual(typed.filter(p => !SOURCES.find(s => s.name === p.short)).map(p => p.short), ["Paris-Tours"]);
});

/* ============================ stage tables ============================ */

const vuelta = parseStageTable(VUELTA, 2026, { start: "2026-08-22", end: "2026-09-13", stages: statedStages(VUELTA) });

test("the Vuelta's stage dates, read from its article, are the ones typed by hand from another source", () => {
  /* The hand list was checked against ProCyclingStats; this is
     Wikipedia. Twenty-one dates agreeing across two sources, rest days
     and all, is the known answer this parser is held to. */
  assert.equal(statedStages(VUELTA), 21);
  assert.equal(vuelta.length, 21);
  assert.deepEqual(vuelta.map(s => s.date), pool[0].dates);
  assert.deepEqual(vuelta.map(s => s.n), Array.from({ length: 21 }, (_, i) => i + 1));
  assert.equal(vuelta.some(s => s.date === "2026-08-31" || s.date === "2026-09-07"), false, "the two rest days are not stages");
  assert.deepEqual(vuelta.filter(s => /\(/.test(s.label)).map(s => s.label), ["Stage 1 (ITT)", "Stage 18 (ITT)"]);
  assert.deepEqual(vuelta.map(s => s.label.replace(/ \(.*/, "")), pool[0].stages.map(s => s[1].replace(/ \(.*/, "")));
  assert.deepEqual(vuelta[0], { n: 1, date: "2026-08-22", label: "Stage 1 (ITT)", route: "Monaco – Monaco", km: 9,
    page: "2026 Vuelta a España, Stage 1 to Stage 11" });
  assert.deepEqual(vuelta[20], { n: 21, date: "2026-09-13", label: "Stage 21", route: "Granada – Granada", km: 99.4,
    page: "2026 Vuelta a España, Stage 12 to Stage 21" });
});

test("a cancelled stage is still a stage, on its day", () => {
  assert.match(VUELTA, /Stage cancelled/);
  assert.deepEqual([vuelta[2].n, vuelta[2].date], [3, "2026-08-24"]);
});

test("week-long races read the same way", () => {
  const suisse = parseStageTable(SUISSE, 2026, { start: "2026-06-17", end: "2026-06-21", stages: statedStages(SUISSE) });
  assert.deepEqual(suisse.map(s => s.date), ["2026-06-17", "2026-06-18", "2026-06-19", "2026-06-20", "2026-06-21"]);
  assert.equal(suisse[3].label, "Stage 4 (ITT)");
  assert.equal(suisse[3].km, 23.7);
  const pn = parseStageTable(PARIS_NICE, 2026, { start: "2026-03-08", end: "2026-03-15", stages: statedStages(PARIS_NICE) });
  assert.equal(pn.length, 8);
  assert.equal(pn[2].label, "Stage 3 (TTT)");
  assert.deepEqual([pn[0].date, pn[7].date], ["2026-03-08", "2026-03-15"]);
  assert.equal(pn[0].page, null, "a link to a section of the same article names no other page");
});

test("a stage list that disagrees with the race it belongs to is refused", () => {
  assert.equal(parseStageTable(VUELTA, 2026, { start: "2026-08-23" }), null, "wrong first day");
  assert.equal(parseStageTable(VUELTA, 2026, { end: "2026-09-14" }), null, "wrong last day");
  assert.equal(parseStageTable(VUELTA, 2026, { stages: 20 }), null, "wrong count");
  assert.equal(parseStageTable(SEASON, 2026), null, "an article with no stage table");
  assert.equal(parseStageTable("", 2026), null);
  const gap = VUELTA.replace("#Stage 7|7]]", "#Stage 7|8]]");
  assert.notEqual(gap, VUELTA);
  assert.equal(parseStageTable(gap, 2026), null, "a stage number missing from the run");
  const undated = VUELTA.replace('| style="text-align:right" | 25 August', '| style="text-align:right" | TBA');
  assert.notEqual(undated, VUELTA);
  assert.equal(parseStageTable(undated, 2026), null, "a stage with no date");
});

/* ============================ the calendar the page reads ============================ */

test("a one-day race needs nothing but its date", () => {
  const e = calendarEntry(race("Il Lombardia"), inPool(race("Il Lombardia"), pool), null);
  assert.deepEqual(e, { race: "Il Lombardia", year: 2026, start: "2026-10-10", end: "2026-10-10", oneDay: true,
    article: "2026 Il Lombardia", hand: "Il Lombardia", from: "season",
    rows: [["2026-10-10", "One-day race", "", 0]] });
});

test("a race the page already types is drawn under the name the page already uses", () => {
  const q = race("Grand Prix Cycliste de Québec");
  assert.equal(calendarEntry(q, inPool(q, pool), null).race, "GP de Québec");
  assert.equal(calendarEntry(race("Strade Bianche"), null, null).race, "Strade Bianche");
});

test("a stage list from the article is preferred to the typed one, and the typed one to none", () => {
  const v = race("Vuelta a España"), held = inPool(v, pool);
  const fromArticle = calendarEntry(v, held, vuelta);
  assert.equal(fromArticle.from, "article");
  assert.equal(fromArticle.rows.length, 21);
  assert.deepEqual(fromArticle.rows[0], ["2026-08-22", "Stage 1 (ITT)", "Monaco – Monaco", 9]);
  const fromHand = calendarEntry(v, held, null);
  assert.equal(fromHand.from, "hand");
  assert.deepEqual(fromHand.rows, pool[0].stages);
  const g = race("Tour of Guangxi");
  assert.equal(calendarEntry(g, inPool(g, pool), null).from, "hand", "its article is not written yet");
});

test("a short stage race with no stage list is its days, and says they are days", () => {
  const e = calendarEntry(race("Tour de Suisse"), null, null);
  assert.equal(e.from, "range");
  assert.equal(e.partial, undefined);
  assert.deepEqual(e.rows.map(r => r[0]), ["2026-06-17", "2026-06-18", "2026-06-19", "2026-06-20", "2026-06-21"]);
  assert.deepEqual(e.rows.map(r => r[1]), ["Day 1 of 5", "Day 2 of 5", "Day 3 of 5", "Day 4 of 5", "Day 5 of 5"]);
  assert.ok(e.rows.every(r => !/^Stage/.test(r[1])), "no stage number is claimed that nothing stated");
});

test("a Grand Tour with no stage list is its first and last day, never a guess at the days between", () => {
  assert.equal(NO_REST_DAYS_UP_TO, 9);
  for(const name of ["Giro d'Italia", "Tour de France"]){
    const e = calendarEntry(race(name), null, null);
    assert.equal(e.from, "range");
    assert.equal(e.partial, true);
    assert.deepEqual(e.rows, [[race(name).start, "Race starts", "", 0], [race(name).end, "Final stage", "", 0]]);
  }
  /* Spreading the Vuelta's twenty-one stages over its twenty-three days
     would put a stage on a rest day. */
  const spread = calendarEntry(race("Vuelta a España"), null, null);
  assert.equal(spread.rows.length, 2);
});

test("results are looked for wherever the calendar has a day to key them to", () => {
  const one = calendarEntry(race("Strade Bianche"), null, null);
  assert.deepEqual(sourceFor(one, null), { name: "Strade Bianche", dates: ["2026-03-07"], oneDay: true,
    pages: ["2026 Strade Bianche"], generated: true });
  const v = calendarEntry(race("Vuelta a España"), null, vuelta);
  const src = sourceFor(v, vuelta);
  assert.equal(src.name, "Vuelta a España");
  assert.deepEqual(src.dates, pool[0].dates);
  assert.deepEqual(src.pages, ["2026 Vuelta a España, Stage 1 to Stage 11", "2026 Vuelta a España, Stage 12 to Stage 21",
    "2026 Vuelta a España"], "the split articles the stage table links to, then the main one");
  assert.deepEqual(src.pages, SOURCES.find(s => s.name === "Vuelta a España").pages,
    "which are exactly the pages typed by hand for it");
  assert.equal(sourceFor(calendarEntry(race("Tour de France"), null, null), null), null,
    "a race with no stage dates has nothing to key a result to");
  assert.equal(sourceFor(calendarEntry(race("Tour de Suisse"), null, null), null), null);
});

/* ============================ the build ============================ */

test("the build reads the season, writes what is missing, and does not stop for it", () => {
  assert.match(BUILD, /wikiArticle\(seasonTitle\(year\)\)|const want = seasonTitle\(year\)/);
  assert.match(BUILD, /worldsTitle\(year\)/);
  assert.match(BUILD, /poolFromPage\(readFileSync\(new URL\("\.\.\/src\/page\.html"/);
  assert.match(BUILD, /missingRaces: missingRacesOut, missingRacesEarlier/);
  assert.match(BUILD, /\n  cyclingCalendar,\n/, "the calendar is written into the file");
  assert.match(BUILD, /let missingRacesOut = null/, "unchecked is null, not an empty list");
  const block = BUILD.slice(BUILD.indexOf("THE SEASON — what is on"), BUILD.indexOf("const cyclingSources ="));
  assert.ok(block.length > 1000);
  assert.doesNotMatch(block, /process\.exit|throw new Error/, "nothing in the season check is fatal");
  assert.match(block, /\}catch\(e\)\{\s*calendarProblems\.push/);
  assert.match(BUILD, /for\(const rc of cyclingSources\)/, "results are fetched for generated sources too");
  assert.match(BUILD, /const calendarSame = /, "and a changed calendar is a reason to write the file");
});

test("the season article must answer under its own title", () => {
  const block = BUILD.slice(BUILD.indexOf("THE SEASON — what is on"), BUILD.indexOf("const cyclingSources ="));
  assert.match(block, /!sameTitle\(want, a\.title\)/);
  assert.match(block, /sameTitle\(r\.article, a\.title\)/, "and so must a race's");
});

/* ============================ the page ============================ */

function harness(){
  globalThis.__calGames = [];
  const page = loadFromPage(["addStage", "attachCalendar", "stageNumber", "attachCycling"], `
    const GAMES = globalThis.__calGames;
    const TEAMS = {"uci-wt": {id: "uci-wt", name: "Men's WorldTour"}};
    let gid = 0;
    const addGame = o => { o.id = "UCI-" + (++gid); GAMES.push(o); return o; };
    const normName = x => String(x||"").toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").replace(/[^a-z0-9]/g,"");
    const localKey = ms => new Date(ms).toISOString().slice(0,10);
  `);
  /* The hand list, drawn the way the page draws it at start. */
  for(const p of pool){
    if(p.oneDay) page.addStage(p.short, p.dates[0], "One-day race");
    else p.stages.forEach(s => page.addStage(p.short, s[0], s[1], s[2], s[3]));
  }
  return { page, GAMES: globalThis.__calGames };
}
const rowsOf = (GAMES, name) => GAMES.filter(g => g.race === name).map(g => [g.day, g.stage]);
const entry = (name, stages) => calendarEntry(race(name), inPool(race(name), pool), stages || null);

test("the page still types its list, as the fallback", () => {
  const { GAMES } = harness();
  assert.equal(GAMES.length, 21 + 1 + 1 + 1 + 1 + 6);
  assert.match(PAGE, /^const CYCLING = \[/m);
  assert.match(PAGE, /if\(Array\.isArray\(r\.cyclingCalendar\)\) attachCalendar\(r\.cyclingCalendar\);\s*if\(Array\.isArray\(r\.cycling\)\) attachCycling/,
    "and reads the calendar before the results");
});

test("a calendar that agrees with the list changes nothing, down to the rows themselves", () => {
  const { page, GAMES } = harness();
  const before = GAMES.slice();
  const n = page.attachCalendar([entry("Il Lombardia"), entry("Tour of Guangxi")]);
  assert.equal(n, 0);
  assert.equal(GAMES.length, before.length);
  assert.ok(GAMES.every((g, i) => g === before[i]), "the same objects, so nothing a row had learned is lost");
});

test("a file with no calendar leaves the hand list exactly as typed", () => {
  const { page, GAMES } = harness();
  const before = GAMES.length;
  for(const nothing of [undefined, null, [], "x", {}]) assert.equal(page.attachCalendar(nothing), 0);
  assert.equal(GAMES.length, before);
});

test("a race only the calendar knows is drawn from it", () => {
  const { page, GAMES } = harness();
  const next = [
    calendarEntry({ race: "Tour Down Under", article: "2027 Tour Down Under", start: "2027-01-19", end: "2027-01-24", oneDay: false }, null, null),
    calendarEntry({ race: "Strade Bianche", article: "2027 Strade Bianche", start: "2027-03-06", end: "2027-03-06", oneDay: true }, null, null)
  ];
  assert.equal(page.attachCalendar(next), 2);
  assert.deepEqual(rowsOf(GAMES, "Strade Bianche"), [["2027-03-06", "One-day race"]]);
  assert.deepEqual(rowsOf(GAMES, "Tour Down Under").map(r => r[1]),
    ["Day 1 of 6", "Day 2 of 6", "Day 3 of 6", "Day 4 of 6", "Day 5 of 6", "Day 6 of 6"]);
  const g = GAMES.find(x => x.race === "Strade Bianche");
  assert.equal(g.comp, "UCI");
  assert.equal(g.event, true);
  assert.equal(g.start, Date.parse("2027-03-06T12:00:00Z"));
  assert.ok(GAMES.every((x, i) => !i || x.start >= GAMES[i - 1].start), "and the list stays in order");
  assert.equal(page.attachCalendar(next), 0, "a second reading of the same file adds nothing");
});

test("where the calendar and the list disagree, the calendar wins", () => {
  const { page, GAMES } = harness();
  const moved = Object.assign({}, entry("Il Lombardia"), { start: "2026-10-11", end: "2026-10-11",
    rows: [["2026-10-11", "One-day race", "", 0]] });
  assert.equal(page.attachCalendar([moved]), 1);
  assert.deepEqual(rowsOf(GAMES, "Il Lombardia"), [["2026-10-11", "One-day race"]]);
  assert.equal(GAMES.filter(g => g.race === "Tour of Guangxi").length, 6, "and no other race is touched");
});

test("a stage list from the article replaces the typed one and keeps what each day had learned", () => {
  const { page, GAMES } = harness();
  const s5 = GAMES.find(g => g.race === "Vuelta a España" && g.day === "2026-08-26");
  s5.podium = ["A", "B", "C"]; s5.timeKnown = true; s5.start = Date.parse("2026-08-26T11:05:00Z"); s5.finishUtc = 5;
  assert.equal(page.attachCalendar([entry("Vuelta a España", vuelta)]), 1);
  const now = GAMES.filter(g => g.race === "Vuelta a España");
  assert.equal(now.length, 21);
  assert.deepEqual(now.map(g => g.day), pool[0].dates);
  const kept = now.find(g => g.day === "2026-08-26");
  assert.notEqual(kept, s5);
  assert.deepEqual(kept.podium, ["A", "B", "C"]);
  assert.equal(kept.start, Date.parse("2026-08-26T11:05:00Z"));
  assert.equal(kept.route, "Falset – Roquetes");
});

test("next year's race does not overwrite this year's", () => {
  const { page, GAMES } = harness();
  const next = calendarEntry({ race: "Il Lombardia", article: "2027 Il Lombardia", start: "2027-10-09", end: "2027-10-09", oneDay: true }, null, null);
  assert.equal(page.attachCalendar([next]), 1);
  assert.deepEqual(rowsOf(GAMES, "Il Lombardia"), [["2026-10-10", "One-day race"], ["2027-10-09", "One-day race"]]);
});

test("an entry the page cannot read is ignored whole, never drawn in part", () => {
  const { page, GAMES } = harness();
  const before = GAMES.length;
  const good = entry("Tour of Guangxi");
  for(const bad of [null, {}, { race: "X" }, { race: "X", rows: [] }, { race: "X", rows: [["soon", "Stage 1"]] },
      { race: "", rows: [["2027-01-01", "One-day race"]] },
      Object.assign({}, good, { rows: good.rows.slice(0, 3).concat([["not a date", "Stage 4"]]) })]){
    assert.equal(page.attachCalendar([bad]), 0, JSON.stringify(bad));
  }
  assert.equal(GAMES.length, before);
});

test("one race's leader cannot land on another race that shares its only long word", () => {
  const { page, GAMES } = harness();
  page.attachCalendar([calendarEntry({ race: "UAE Tour", article: "2027 UAE Tour", start: "2027-02-15", end: "2027-02-21", oneDay: false },
    null, [1, 2, 3].map(n => ({ n, date: "2027-02-1" + (4 + n), label: "Stage " + n, route: "", km: 0, page: null })))]);
  page.attachCycling([{ race: "Tour of Guangxi", leader: "Somebody", leaderStage: 2, stages: [] }]);
  assert.equal(GAMES.find(g => g.race === "UAE Tour" && g.stage === "Stage 2").leader, undefined);
  assert.equal(GAMES.find(g => g.race === "Tour of Guangxi" && g.stage === "Stage 2").leader, "Somebody");
});

test("the file's calendar is bounded like everything else the page accepts", () => {
  const { validStaticPayload } = loadFromPage(["validStaticPayload"]);
  const base = { generated: new Date().toISOString(), fixtures: [] };
  assert.equal(validStaticPayload(base), true, "a file with no calendar is an ordinary file");
  assert.equal(validStaticPayload(Object.assign({}, base, { cyclingCalendar: [entry("Il Lombardia")] })), true);
  assert.equal(validStaticPayload(Object.assign({}, base, { cyclingCalendar: "x" })), false);
  assert.equal(validStaticPayload(Object.assign({}, base, { cyclingCalendar: new Array(121).fill({}) })), false);
});
