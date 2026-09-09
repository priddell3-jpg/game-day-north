import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage, styleText, mediaBlock, ruleFor } from "./helpers/page.mjs";
import { loadFromBuild } from "./helpers/build.mjs";
import { CLINCH, RACE_KINDS, groupsFrom, STANDINGS_HOLD } from "../scripts/lib/race.mjs";

/* The Race section, exercised the way the rest of this suite exercises
   the page: by pulling the shipped declarations out of src/page.html and
   evaluating those, so the test runs the code that actually loads rather
   than a copy of it.

   The standings it is given are the real ones, normalised through
   scripts/lib/race.mjs from payloads recorded live — so the build's
   parser, the page's model and this app's own team matcher are all
   checked against each other rather than against a hand-made object. */

const NAMES = ["esc", "COMPS", "SOCCER", "TEAM_ROWS", "TEAMS", "fullName",
  "RACE_MAX_AGE", "RACE_CHECKED", "RACES", "attachStandings", "raceZoneHit", "raceCutoff",
  "racePhase", "RACE_PHASES", "racePhaseOf", "raceRelevance", "RACE_PRIORITY",
  "racePriority", "raceAutoAllowed", "RACE_GAP_TOLERANCE", "RACE_AUTO", "racePrefOf",
  "setRacePref", "raceCardId", "racePrefBtnId", "raceFollowsComp", "raceGroupsFor", "raceSlice",
  "RACE_PER_COMP", "raceCandidates", "racePrimaries", "raceAssignClubs", "raceCards",
  "RACE_CLINCH",
  "raceAge", "raceHeldAt", "raceOrdinal", "raceRowName", "raceShortName", "raceFigures",
  "raceOrigin", "raceLineHtml", "raceRowHtml", "raceCardHtml", "raceGapPhrase", "raceShort",
  "racePrefsHtml", "renderRaces"];

/* A fresh page scope per case. `showScores` and the followed set are read
   by the code under test and never written by it, so they are baked into
   the preamble rather than poked at afterwards. */
function page(opts = {}){
  const pre = "let STANDINGS = [];\n"
    + "let raceFull = new Set(" + JSON.stringify(opts.full || []) + ");\n"
    + "let racesOpen = " + (opts.open === false ? "false" : "true") + ";\n"
    /* Preferences are read and written through the same store the page
       uses; the test supplies a stub so a case can start from a chosen
       state and still observe what a click would have written. */
    + "const RACES_PREFS_KEY = \"gdn.races.prefs\";\n"
    + "const written = {};\n"
    + "const LS = {get:(k,d)=>d, set:(k,v)=>{ written[k] = v; }};\n"
    + "let racePrefs = " + JSON.stringify(opts.prefs || {}) + ";\n"
    + "const selected = new Set(" + JSON.stringify(opts.picks || []) + ");\n"
    + "const hiddenComps = new Set(" + JSON.stringify(opts.hidden || []) + ");\n"
    + "const showScores = " + (opts.scores === false ? "false" : "true") + ";\n";
  const P = loadFromPage(NAMES, pre);
  /* The page builds TEAMS with a loop rather than a declaration, so the
     loop is repeated here against the same TEAM_ROWS. fullName closes
     over this very object. */
  P.TEAM_ROWS.forEach(r => {
    const t = {id:r[0], home:r[1], city:r[2], name:r[3], abbr:r[4], tz:r[5], color:r[6], ucl:!!r[7]};
    t.comps = [r[1]];
    if(r[1] === "EPL") t.comps = ["EPL", "EFL", "FAC"];
    if(t.ucl) t.comps = t.comps.concat(["UCL"]);
    P.TEAMS[t.id] = t;
  });
  return P;
}

const { idFor } = loadFromBuild(["idFor"]);
const fx = name => JSON.parse(readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8"));
const norm = (file, opts) => groupsFrom(fx(file), Object.assign({ idFor }, opts));

const MLB = norm("standings-mlb-wildcard.json", { comp: "MLB", kind: RACE_KINDS.SEED,
  groupFor: n => ({ "American League": "AL", "National League": "NL" })[n.name] });
const EPL = norm("standings-epl.json", { comp: "EPL", kind: RACE_KINDS.TABLE, group: "table" });
const EPL_PREV = norm("standings-epl-2025-final.json",
  { comp: "EPL", kind: RACE_KINDS.TABLE, group: "table" });
const UCL = norm("standings-ucl.json", { comp: "UCL", kind: RACE_KINDS.TABLE, group: "league" });
const NFL = norm("standings-nfl-conference-2025-final.json", { comp: "NFL", kind: RACE_KINDS.SEED,
  groupFor: n => ({ "American Football Conference": "AFC", "National Football Conference": "NFC" })[n.name] });
const NFL_DIV = norm("standings-nfl-divisions-2025-final.json",
  { comp: "NFL", kind: RACE_KINDS.DIVISION });

const NOW = Date.parse("2026-09-08T21:00:00Z");
const view = (P, id) => P.RACES.find(v => v.id === id);
const grp = (list, id) => list.find(g => g.group === id);

/* ============================ where the line falls ============================ */

test("each cutoff kind lands where the source says it does", () => {
  const P = page();
  assert.equal(P.raceCutoff(view(P, "epl-ucl"), grp(EPL, "table")), 4,
    "the Champions League zone ends at 4 this season");
  assert.equal(P.raceCutoff(view(P, "epl-ucl"), grp(EPL_PREV, "table")), 5,
    "and ended at 5 the season before, from the same code");
  assert.equal(P.raceCutoff(view(P, "epl-rel"), grp(EPL, "table")), 17,
    "the last safe place is the one above the relegation zone");
  assert.equal(P.raceCutoff(view(P, "ucl-top8"), grp(UCL, "league")), 8);
  assert.equal(P.raceCutoff(view(P, "ucl-top24"), grp(UCL, "league")), 24,
    "an unbroken run of qualifying zones from the top");
  assert.equal(P.raceCutoff(view(P, "epl-title"), grp(EPL, "table")), 1);
  assert.equal(P.raceCutoff(view(P, "nfl-afc"), grp(NFL, "AFC")), 7);
});

test("the wild-card and division lines are read, not counted", () => {
  const P = page();
  /* Nothing in the page knows there are three wild cards or one division
     winner. Both fall out of the column the source measures from. */
  assert.equal(P.raceCutoff(view(P, "mlb-wc-al"), grp(MLB, "AL")), 3);
  assert.equal(P.raceCutoff(view(P, "mlb-wc-nl"), grp(MLB, "NL")), 3);
  assert.equal(P.raceCutoff(view(P, "nfl-div"), grp(NFL_DIV, "afc-east")), 1);
  /* Three clubs level at the top of a division share the lead, and the
     line sits above all three rather than picking one. */
  assert.equal(P.raceCutoff(view(P, "nfl-div"), grp(NFL_DIV, "nfc-south")), 1);
});

test("a European run stops at a break in the table", () => {
  const P = page();
  /* 2025-26 put a Europa League place at 15th, won through a cup. The
     run from the top is 1 to 8 and must not swallow ranks 9 to 15. */
  assert.equal(P.raceCutoff(view(P, "epl-euro"), grp(EPL_PREV, "table")), 8);
  assert.equal(P.raceCutoff(view(P, "epl-euro"), grp(EPL, "table")), 5);
});

test("a zone the source stopped publishing takes its race off the page", () => {
  const P = page();
  const stripped = JSON.parse(JSON.stringify(grp(EPL, "table")));
  delete stripped.zones;
  assert.equal(P.raceCutoff(view(P, "epl-ucl"), stripped), null);
  assert.equal(P.raceRelevance(view(P, "epl-ucl"), stripped, NOW, new Set(["liv"])), null,
    "no line means no card, rather than a line put somewhere plausible");
});

/* ============================ when a card appears ============================ */

test("a followed team near the line is what puts a race on the page", () => {
  const P = page({ picks: ["tor-mlb"] });
  P.attachStandings(MLB.concat(EPL));
  const cards = P.raceCards(NOW, new Set(["tor-mlb"]));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, "mlb-wc-al");
  assert.equal(cards[0].reason, "near");
  assert.equal(cards[0].at, 3);
  assert.deepEqual(cards[0].mine.map(r => r.abbr), ["TOR"]);
});

test("following a team in another sport does not put a table on the page", () => {
  /* The regression this gate exists for: a race marked seasonal was
     showing a baseball table to somebody who follows one hockey club. */
  const P = page({ picks: ["van-nhl"] });
  P.attachStandings(MLB.concat(EPL).concat(UCL));
  assert.deepEqual(P.raceCards(NOW, new Set(["van-nhl"])), []);
  assert.equal(P.renderRaces(NOW), "");
  assert.equal(P.raceFollowsComp("MLB", new Set(["van-nhl"])), false);
  assert.equal(P.raceFollowsComp("MLB", new Set(["tor-mlb"])), true);
  assert.equal(P.raceFollowsComp("UCL", new Set(["liv"])), true,
    "a Premier League club that enters the Champions League follows it");
});

test("a club that has played nothing yet is not in a race yet", () => {
  /* Matchday one seeds all 36 Champions League clubs, half of them on
     nothing played. A position is not a race. */
  const P = page({ picks: ["bay"] });
  P.attachStandings(UCL);
  const bayern = grp(UCL, "league").rows.find(r => r.id === "bay");
  assert.equal(bayern.gp, 0, "the recorded payload really does rank a club with no matches");
  assert.deepEqual(P.raceCards(NOW, new Set(["bay"])), []);
});

test("nothing renders when the standings are missing, stale or switched off", () => {
  const held = JSON.parse(JSON.stringify(MLB)).map(g =>
    Object.assign(g, { heldFrom: new Date(NOW - 5 * 86400000).toISOString() }));

  let P = page({ picks: ["tor-mlb"] });
  assert.equal(P.renderRaces(NOW), "", "no standings at all");

  P = page({ picks: ["tor-mlb"] });
  P.attachStandings(held);
  assert.equal(P.renderRaces(NOW), "", "an answer older than the browser will trust");

  P = page({ picks: ["tor-mlb"], hidden: ["MLB"] });
  P.attachStandings(MLB);
  assert.equal(P.renderRaces(NOW), "", "a competition switched off by the filter chips");

  P = page({ picks: [] });
  P.attachStandings(MLB);
  assert.equal(P.renderRaces(NOW), "", "nobody followed yet");

  P = page({ picks: ["tor-mlb"], scores: false });
  P.attachStandings(MLB);
  assert.equal(P.renderRaces(NOW), "",
    "every figure in this section is a result, so scores-off hides all of it");
});

test("an unavailable source produces no card at all, not a card saying so", () => {
  const P = page({ picks: ["tor-mlb", "liv"] });
  P.attachStandings(EPL);                      // baseball simply absent
  const html = P.renderRaces(NOW);
  assert.ok(!/unavailable|could not|unreachable|no data/i.test(html),
    "the home page says nothing about a source it could not read");
  assert.ok(!/MLB/.test(html), "and shows no baseball card");
});

test("a race with nothing played is never shown", () => {
  const P = page({ picks: ["buf"] });
  const zeroed = JSON.parse(JSON.stringify(NFL)).map(g =>
    Object.assign(g, { played: { min: 0, max: 0 } }));
  P.attachStandings(zeroed);
  assert.deepEqual(P.raceCards(NOW, new Set(["buf"])), []);
});

test("the page stays a schedule: two cards per competition and four in all", () => {
  const P = page({ picks: ["liv", "ars", "mci", "tot", "tor-mlb", "nyy"] });
  P.attachStandings(EPL.concat(MLB).concat(UCL));
  const cards = P.raceCards(NOW, new Set(["liv", "ars", "mci", "tot", "tor-mlb", "nyy"]));
  assert.ok(cards.length <= 4, "at most four cards, got " + cards.length);
  const perComp = {};
  cards.forEach(c => { perComp[c.grp.comp] = (perComp[c.grp.comp] || 0) + 1; });
  for(const [comp, n] of Object.entries(perComp))
    assert.ok(n <= P.RACE_PER_COMP, comp + " contributed " + n + " cards");
  assert.equal(cards[0].rank, Math.min(...cards.map(c => c.rank)), "nearest race first");
});

/* ============================ what a card shows ============================ */

test("the slice is the line and the followed clubs, not the whole table", () => {
  const P = page({ picks: ["tor-mlb"] });
  P.attachStandings(MLB);
  const card = P.raceCards(NOW, new Set(["tor-mlb"]))[0];
  const rows = P.raceSlice(card.grp, card.at, card.focus, false);
  assert.ok(rows.length < card.grp.rows.length, "a slice, not the table");
  assert.deepEqual(rows.map(r => r.pos), [2, 3, 4, 5]);
  assert.ok(rows.some(r => r.id === "tor-mlb"));
});

test("a followed club far from the line brings its own window, with a gap between", () => {
  const P = page({ picks: ["sea-mlb"] });
  P.attachStandings(MLB);
  const al = grp(MLB, "AL");
  const me = al.rows.find(r => r.id === "sea-mlb");
  const rows = P.raceSlice(al, 3, [me], false);
  const positions = rows.map(r => r.pos);
  assert.deepEqual(positions.slice(0, 4), [2, 3, 4, 5], "the line, either side");
  assert.deepEqual(positions.slice(4), [me.pos - 1, me.pos, me.pos + 1], "and the club");
  const html = P.raceCardHtml({ id: "x", view: view(P, "mlb-wc-al"), grp: al, at: 3,
    mine: [me], focus: [me], reason: "late", rank: 50, title: "AL Wild Card" });
  assert.ok(html.includes("race-gap"), "with a gap marker where places are skipped");
  assert.equal((html.match(/race-line/g) || []).length, 2, "and exactly one line, drawn once");
});

test("the full table opens without the card changing shape", () => {
  const P = page({ picks: ["tor-mlb"], full: ["mlb-wc-al"] });
  P.attachStandings(MLB);
  const card = P.raceCards(NOW, new Set(["tor-mlb"]))[0];
  const html = P.raceCardHtml(card);
  /* `race-rows` is the list element and contains the row class as a
     substring, so the count has to be anchored on the attribute. */
  assert.equal((html.match(/class="race-row[ "]/g) || []).length, card.grp.rows.length);
  assert.ok(!html.includes("race-gap"), "nothing is skipped, so nothing is marked skipped");
  assert.ok(html.includes('aria-pressed="true"'));
  assert.ok(html.includes("Show the race"));
});

test("a followed club is marked, named this app's way, and given its colour", () => {
  const P = page({ picks: ["tor-mlb"] });
  P.attachStandings(MLB);
  const html = P.raceCardHtml(P.raceCards(NOW, new Set(["tor-mlb"]))[0]);
  assert.ok(html.includes('class="race-row mine" style="--tc:#134A8E"'));
  assert.ok(html.includes("Toronto Blue Jays"));
  assert.ok(html.includes("Cleveland Guardians"), "and the clubs around it, as the feed names them");
});

test("figures are only ever the ones the source published", () => {
  const P = page();
  const al = grp(MLB, "AL");
  const cle = al.rows.find(r => r.abbr === "CLE");
  const figs = P.raceFigures(cle, al);
  assert.ok(figs.includes("level"), "the club on the line is level with it");
  assert.ok(/L10/.test(figs), "recent form, where the view publishes it");
  const nyy = al.rows.find(r => r.abbr === "NYY");
  assert.ok(P.raceFigures(nyy, al).includes("9 ahead"),
    "a cushion is said in words, since the published plus sign does not say what of");

  const liv = grp(EPL, "table").rows.find(r => r.id === "liv");
  const soccer = P.raceFigures(liv, grp(EPL, "table"));
  assert.ok(/pts/.test(soccer) && /pld/.test(soccer) && /GD/.test(soccer));
  assert.ok(!/L10/.test(soccer), "the soccer table publishes no form, so none is shown");
});

test("a zone label is never printed against a club", () => {
  const P = page({ picks: ["liv"] });
  P.attachStandings(EPL.concat(UCL));
  const ucl = grp(UCL, "league");
  const html = P.raceCardHtml({ id: "u", view: view(P, "ucl-top24"), grp: ucl, at: 24,
    mine: [], focus: [], reason: "seasonal", rank: 90, title: "Knockout play-off places" });
  assert.ok(!/Eliminated/i.test(html),
    "twelve clubs sit in a zone the source calls eliminated and six have played nothing");
  assert.ok(html.includes("Through to the play-offs"), "the line is described as a place, not a verdict");
});

test("a clinch letter is the one verdict shown, and it matches the build's", () => {
  const P = page();
  assert.deepEqual(P.RACE_CLINCH, CLINCH,
    "the page and the build must agree on what a letter means");
  const afc = grp(NFL, "AFC");
  const html = P.raceRowHtml(afc.rows.find(r => r.abbr === "DEN"), afc);
  assert.ok(html.includes("clinched home advantage"));
  const plain = P.raceRowHtml(grp(MLB, "AL").rows.find(r => r.abbr === "TOR"), grp(MLB, "AL"));
  assert.ok(!plain.includes("race-clinch"), "a team that has clinched nothing says nothing");
});

test("the card says where its line came from", () => {
  const P = page();
  assert.match(P.raceOrigin(view(P, "epl-ucl")), /qualification zones/);
  assert.match(P.raceOrigin(view(P, "mlb-wc-al")), /games behind/);
  assert.match(P.raceOrigin(view(P, "nfl-afc")), /Seven teams per conference/);
  assert.match(P.raceOrigin(view(P, "nfl-afc")), /Checked 2026-09-08/,
    "the one hand-held number carries a date, the way a rights row does");
});

test("every hand-held cutoff is dated and explained", () => {
  const P = page();
  for(const v of P.RACES){
    if(v.cut.kind !== "rule") continue;
    assert.ok(v.cut.origin, v.id + " states a cutoff without saying where it comes from");
    if(v.cut.at !== 1) assert.ok(v.cut.checked, v.id + " states a league rule with no checked date");
  }
});

/* ============================ small things ============================ */

test("positions are written the way people say them", () => {
  const P = page();
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 36].map(P.raceOrdinal),
    ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "36th"]);
});

test("a club name from the feed is escaped", () => {
  const P = page();
  const html = P.raceRowHtml({ tid: "1", name: '<script>x</script>', pos: 1 },
    { comp: "EPL", kind: "table" });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("the shut panel is one row that says something", () => {
  const P = page({ picks: ["tor-mlb"], open: false });
  P.attachStandings(MLB);
  const html = P.renderRaces(NOW);
  assert.ok(html.startsWith('<details class="races">'), "shut on arrival");
  const summary = html.split("</summary>")[0];
  assert.match(summary, /In the Race/);
  assert.match(summary, /1 relevant/);
  assert.match(summary, /Blue Jays/, "and names the club rather than the race");
  assert.ok(!/Toronto Blue Jays/.test(summary),
    "with the short name, which is most of the width a phone has for this");
});

test("attaching nothing empties what was there", () => {
  const P = page({ picks: ["tor-mlb"] });
  assert.equal(P.attachStandings(MLB), 2);
  assert.ok(P.renderRaces(NOW));
  assert.equal(P.attachStandings(undefined), 0);
  assert.equal(P.renderRaces(NOW), "", "a race cannot outlive the data behind it");
});

/* ============================ the shipped stylesheet ============================

   No browser here, so these assert the rules that ship rather than the
   pixels they produce — enough to catch a regression, not enough to
   claim the card was looked at. */

test("a followed club is marked by more than colour alone", () => {
  const css = styleText();
  const mine = ruleFor(css, ".race-row.mine");
  assert.ok(mine, "expected a rule for a followed club's row");
  assert.match(mine, /box-shadow/, "a bar down the side, which colour blindness cannot remove");
  assert.match(ruleFor(css, ".race-row.mine .race-club"), /font-weight/);
});

test("the figures give way before the club name does on a narrow screen", () => {
  const small = mediaBlock("(max-width:520px)");
  assert.ok(small, "expected a 520px block for the race card");
  assert.match(ruleFor(small, ".race-fig:nth-child(n+3)"), /display:none/);
  assert.match(ruleFor(styleText(), ".race-club"), /text-overflow:ellipsis/);
});

test("a full table scrolls inside its card rather than pushing the schedule away", () => {
  const rule = ruleFor(styleText(), '.race-card:has(.race-more[aria-pressed="true"]) .race-rows');
  assert.ok(rule, "expected the expanded card to cap its own height");
  assert.match(rule, /overflow-y:auto/);
});

test("the line is the one thing on the card with a colour of its own", () => {
  const line = ruleFor(styleText(), ".race-line");
  assert.match(line, /var\(--accent\)/);
  assert.match(line, /dashed/);
});

test("two lines a place apart in one table are one card, not two", () => {
  /* In September the Champions League places end at 4th and the European
     places at 5th, and both cards drew Chelsea, Brentford, Liverpool and
     Newcastle. One of them is an echo. */
  const P = page({ picks: ["liv"] });
  P.attachStandings(EPL);
  const cards = P.raceCards(NOW, new Set(["liv"]));
  const eplCuts = cards.filter(c => c.grp.comp === "EPL").map(c => c.at).sort((a, b) => a - b);
  for(let i = 1; i < eplCuts.length; i++)
    assert.ok(eplCuts[i] - eplCuts[i - 1] >= 3,
      "cards at " + eplCuts.join(" and ") + " show the same clubs twice");
});

/* ============ standings that are being carried, not refreshed ============ */

const HOUR = 3600000;
const heldCopy = (groups, age) => JSON.parse(JSON.stringify(groups)).map(g =>
  Object.assign(g, { heldFrom: new Date(NOW - age).toISOString() }));

test("the page and the build agree on the hard expiry", () => {
  const P = page();
  assert.equal(P.RACE_MAX_AGE, STANDINGS_HOLD,
    "the build must never ship a group the page would refuse to draw");
});

test("a carried group is drawn, and says on its face that it is not current", () => {
  const P = page({ picks: ["tor-mlb"] });
  P.attachStandings(heldCopy(MLB, 30 * HOUR));
  const html = P.renderRaces(NOW);
  assert.ok(html, "an outage does not empty the board");
  assert.ok(html.includes("race-stale"), "the card carries the marker");
  assert.ok(html.includes("Not current &middot; last read 30 hours ago"));
  assert.ok(html.includes("The source has not answered since then."));
  assert.ok(html.includes("where the table stood when it was last read"));
});

test("a shut panel does not present a carried figure as a current one", () => {
  const P = page({ picks: ["tor-mlb"], open: false });
  P.attachStandings(heldCopy(MLB, 26 * HOUR));
  const summary = P.renderRaces(NOW).split("</summary>")[0];
  assert.ok(/not all current/.test(summary),
    "the one row a shut panel costs is exactly where a stale figure would pass for a live one");
});

test("a group read this run says nothing about age", () => {
  const P = page({ picks: ["tor-mlb"] });
  P.attachStandings(MLB);
  const html = P.renderRaces(NOW);
  assert.ok(!html.includes("race-stale"));
  assert.ok(!/not current/i.test(html));
});

test("past the expiry the card goes, however long the source stays down", () => {
  for(const age of [49, 72, 24 * 30]){
    const P = page({ picks: ["tor-mlb"] });
    P.attachStandings(heldCopy(MLB, age * HOUR));
    assert.equal(P.renderRaces(NOW), "", "still drawn after " + age + " hours");
  }
});

test("age is written the way it would be said out loud", () => {
  const P = page();
  const at = h => P.raceAge(NOW - h * HOUR, NOW);
  assert.equal(at(0.2), "under an hour ago");
  assert.equal(at(1), "1 hour ago");
  assert.equal(at(9), "9 hours ago");
  assert.equal(at(35), "35 hours ago");
  assert.equal(at(36), "2 days ago", "past a day and a half, hours stop being read at a glance");
  assert.equal(at(47), "2 days ago");
  assert.equal(P.raceHeldAt({}), null);
  assert.equal(P.raceHeldAt({ heldFrom: "nonsense" }), null);
});

/* ====== the two elimination claims, told apart on the page ====== */

test("a club in the Eliminated zone is not called eliminated", () => {
  const P = page({ picks: ["liv"] });
  P.attachStandings(UCL);
  const ucl = grp(UCL, "league");
  const sporting = ucl.rows.find(r => r.name === "Sporting CP");
  assert.ok(sporting.pos >= 25 && sporting.gp === 0);
  const row = P.raceRowHtml(sporting, ucl);
  assert.ok(!/eliminat/i.test(row),
    "28th on nothing played is a position, not a season");
  assert.ok(!row.includes("race-clinch"));

  /* Even with the whole bottom of the table on screen. */
  const card = P.raceCardHtml({ id: "u", view: view(P, "ucl-top24"), grp: ucl, at: 24,
    mine: [], focus: [], reason: "seasonal", rank: 90, title: "Knockout play-off places" }, NOW);
  assert.ok(!/eliminat/i.test(card));
});

test("a club the source reports as eliminated is called eliminated", () => {
  const P = page({ picks: ["tor-mlb"] });
  const al = grp(MLB, "AL");
  const angels = al.rows.find(r => r.abbr === "LAA");
  assert.equal(angels.clinch, "e");
  const row = P.raceRowHtml(angels, al);
  assert.ok(row.includes("race-clinch"));
  assert.ok(row.includes("eliminated"), "because this one is published about the team");

  /* And a club merely behind the line is not. */
  const behind = al.rows.find(r => r.pos > 3 && !r.clinch);
  assert.ok(!/eliminat/i.test(P.raceRowHtml(behind, al)));
});

test("a card drawn for one club still shows the others you follow", () => {
  /* Toronto sit beside the line and Seattle several places back. The
     card exists because of Toronto; Seattle is on it because you follow
     them, with an ellipsis marking the places stepped over. */
  const P = page({ picks: ["tor-mlb", "sea-mlb"] });
  P.attachStandings(MLB);
  const card = P.raceCards(NOW, new Set(["tor-mlb", "sea-mlb"]))[0];
  assert.equal(card.reason, "near");
  assert.deepEqual(card.focus.map(r => r.abbr), ["TOR"], "Toronto is why it is here");
  const html = P.raceCardHtml(card, NOW);
  assert.ok(html.includes("Toronto Blue Jays"));
  assert.ok(html.includes("Seattle Mariners"), "and Seattle is on it regardless");
  assert.ok(html.includes("race-gap"));
  assert.equal((html.match(/class="race-row mine/g) || []).length, 2, "both marked");
});

test("below 360 the figures move under the name rather than truncating it", () => {
  const narrow = mediaBlock("(max-width:360px)");
  assert.ok(narrow, "expected a 360px block for the race row");
  assert.match(ruleFor(narrow, ".race-row"), /flex-wrap:wrap/);
  assert.match(ruleFor(narrow, ".race-figs"), /flex:1 1 100%/);
  assert.match(ruleFor(narrow, ".race-club"), /white-space:normal/,
    "the club name stops being clipped once it has the width");
  assert.equal(ruleFor(narrow, ".race-pos"), null,
    "the place stays on the same line as the club it belongs to");
});

/* ============ where the section sits, and how much it costs shut ============ */

test("history comes before the race, and both come before the schedule", () => {
  const src = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
  const list = src.slice(src.indexOf("function renderList("));
  const results = list.indexOf("renderResults(now, todayKey)");
  const races = list.indexOf("renderRaces(now)");
  const days = list.indexOf("groupByDay(games)");
  assert.ok(results > -1 && races > -1 && days > -1);
  assert.ok(results < races, "Recent results is above In the Race");
  assert.ok(races < days, "and In the Race is above the schedule");
});

test("the section arrives shut and remembers being opened", () => {
  const src = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
  assert.match(src, /let racesOpen = LS\.get\(RACES_OPEN_KEY, false\) === true;/,
    "shut unless the reader has said otherwise");
  assert.match(src, /LS\.set\(RACES_OPEN_KEY, rc\.open\)/, "and the choice is kept");
  const P = page({ picks: ["tor-mlb"], open: true });
  P.attachStandings(MLB);
  assert.ok(P.renderRaces(NOW).startsWith('<details class="races" open>'));
});

test("the shut row names the club and the gap, not the table", () => {
  const P = page({ picks: ["tor-mlb"], open: false });
  P.attachStandings(MLB);
  const summary = P.renderRaces(NOW).split("</summary>")[0];
  assert.match(summary, /Blue Jays 1 back/);
});

test("a points gap is said in points and a games gap in games", () => {
  const P = page({ picks: ["liv"] });
  const epl = grp(EPL_PREV, "table");
  const card = { view: view(P, "epl-ucl"), grp: epl, at: 5 };
  const liv = epl.rows.find(r => r.id === "liv");
  assert.equal(P.raceGapPhrase(card, liv), "in the UCL places", "fifth of five is in");
  const che = epl.rows.find(r => r.id === "che");
  assert.equal(P.raceGapPhrase(card, che), "8 pts from the UCL places",
    "and the gap is the difference between two published totals");

  const al = grp(MLB, "AL");
  const seed = { view: view(P, "mlb-wc-al"), grp: al, at: 3 };
  assert.equal(P.raceGapPhrase(seed, al.rows.find(r => r.abbr === "TOR")), "1 back");
  assert.equal(P.raceGapPhrase(seed, al.rows.find(r => r.abbr === "CLE")), "on the line");
  assert.equal(P.raceGapPhrase(seed, al.rows.find(r => r.abbr === "NYY")), "9 up");
});

/* ============ season progress decides, not the calendar ============ */

const atProgress = (groups, fraction, length) =>
  JSON.parse(JSON.stringify(groups)).map(g =>
    Object.assign(g, { played: { min: Math.round(fraction * length), max: Math.round(fraction * length) } }));

test("the bands are one table, applied to every competition", () => {
  const P = page();
  assert.deepEqual(P.RACE_PHASES.map(b => b.id), ["early", "mid", "late", "final"]);
  assert.equal(P.RACE_PHASES[0].near, null, "early shows nothing under Auto");
  const nears = P.RACE_PHASES.slice(1).map(b => b.near);
  assert.deepEqual(nears, [...nears].sort((a, b) => a - b), "and the band widens as a season runs out");
  assert.deepEqual(P.RACE_PHASES.map(b => b.solo), [false, false, false, true],
    "a race stands on its own only in the closing stretch");
});

test("three matches into a Premier League season, Auto shows nothing", () => {
  const P = page({ picks: ["liv", "ars", "mci", "tot"] });
  P.attachStandings(EPL);
  const band = P.racePhaseOf(view(P, "epl-ucl"), grp(EPL, "table"));
  assert.equal(band.id, "early");
  assert.deepEqual(P.raceCards(NOW, new Set(["liv", "ars", "mci", "tot"])), [],
    "a table after three matches is not a race, however close the lines look");
  assert.equal(P.renderRaces(NOW), "");
});

test("late in a season the same clubs and the same code produce races", () => {
  const picks = ["ars", "tot", "liv"];
  const P = page({ picks });
  P.attachStandings(EPL_PREV);
  assert.equal(P.racePhaseOf(view(P, "epl-title"), grp(EPL_PREV, "table")).id, "final");
  const cards = P.raceCards(NOW, new Set(picks));
  assert.ok(cards.length, "the final stretch is exactly when this matters");
  assert.ok(cards.every(c => c.grp.comp === "EPL"));
});

test("mid-season shows a club that is close and not one that is not", () => {
  const picks = ["ars", "new"];
  const P = page({ picks });
  const mid = atProgress(EPL_PREV, 0.5, 38);
  P.attachStandings(mid);
  assert.equal(P.racePhaseOf(view(P, "epl-title"), mid[0]).id, "mid");
  const cards = P.raceCards(NOW, new Set(picks));
  const claimed = new Set(cards.flatMap(c => c.focus.map(r => r.id)));
  assert.ok(claimed.has("ars"), "Arsenal are top, which is a title race");
  assert.ok(!claimed.has("new"),
    "Newcastle in twelfth are four places off the nearest line in either direction, "
    + "which mid-season is not a race");
});

/* ============ one primary race per club ============ */

test("a club gets the one line it is nearest to", () => {
  const picks = ["ars", "tot"];
  const P = page({ picks });
  P.attachStandings(EPL_PREV);
  const cards = P.raceCards(NOW, new Set(picks));
  const forClub = id => cards.find(c => c.focus.some(r => r.id === id));
  assert.equal(forClub("ars").view.id, "epl-title", "top of the table is a title race");
  assert.equal(forClub("tot").view.id, "epl-rel",
    "seventeenth is a relegation battle, not a title race it happens to share a table with");
  assert.equal(cards.filter(c => c.focus.some(r => r.id === "ars")).length, 1,
    "and one club does not carry four cards");
});

test("two lines the same distance away go to the one worth more", () => {
  const P = page({ picks: ["mun"] });
  P.attachStandings(EPL_PREV);
  const mun = grp(EPL_PREV, "table").rows.find(r => r.id === "mun");
  assert.equal(mun.pos, 3, "two places off the title and two off the Champions League line");
  const cards = P.raceCards(NOW, new Set(["mun"]));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].view.id, "epl-title");
  assert.ok(P.racePriority(view(P, "epl-title")) < P.racePriority(view(P, "epl-ucl")),
    "and it is the declared value that decides, not the order they happen to sit in");
});

/* ============ pin and hide ============ */

test("pinning shows a race Auto is declining to show", () => {
  const picks = ["liv"];
  const plain = page({ picks });
  plain.attachStandings(EPL);
  assert.deepEqual(plain.raceCards(NOW, new Set(picks)), [], "early season, nothing");

  const pinned = page({ picks, prefs: { "epl-ucl": "pin" } });
  pinned.attachStandings(EPL);
  const cards = pinned.raceCards(NOW, new Set(picks));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, "epl-ucl");
  assert.equal(cards[0].reason, "pinned");
  assert.ok(cards[0].pinned);
  assert.ok(pinned.raceCardHtml(cards[0], NOW).includes("Pinned"));
});

test("pinning cannot invent a table that is not there", () => {
  const P = page({ picks: ["buf"], prefs: { "nfl-afc": "pin" } });
  P.attachStandings([]);
  assert.deepEqual(P.raceCards(NOW, new Set(["buf"])), []);
  const zeroed = JSON.parse(JSON.stringify(NFL)).map(g =>
    Object.assign(g, { played: { min: 0, max: 0 } }));
  const Q = page({ picks: ["buf"], prefs: { "nfl-afc": "pin" } });
  Q.attachStandings(zeroed);
  assert.deepEqual(Q.raceCards(NOW, new Set(["buf"])), [],
    "a pin asks for a race, not for standings nobody has played for");
});

test("hiding removes a race Auto would have shown", () => {
  const picks = ["tor-mlb"];
  const shown = page({ picks });
  shown.attachStandings(MLB);
  assert.equal(shown.raceCards(NOW, new Set(picks)).length, 1);

  const hidden = page({ picks, prefs: { "mlb-wc-al": "hide" } });
  hidden.attachStandings(MLB);
  assert.deepEqual(hidden.raceCards(NOW, new Set(picks)), []);
  assert.equal(hidden.renderRaces(NOW), "", "and with nothing left, the section goes too");
});

test("a hidden race is still reachable, or there is no way back", () => {
  const P = page({ picks: ["tor-mlb"], prefs: { "mlb-wc-al": "hide" } });
  P.attachStandings(MLB);
  const html = P.racePrefsHtml(NOW);
  assert.match(html, /Customize/);
  assert.match(html, /AL Wild Card/);
  assert.match(html, /data-race-pref="mlb-wc-al"[^>]*data-pref="hide" aria-pressed="true"/,
    "showing the state it is actually in");
  assert.match(html, /data-pref="auto"/, "with a way back to Auto");
});

test("preferences key on the race, live in their own store, and leave teams alone", () => {
  const P = page({ picks: ["tor-mlb", "liv"] });
  assert.equal(P.racePrefOf("mlb-wc-al"), P.RACE_AUTO);
  P.setRacePref("mlb-wc-al", "pin");
  assert.equal(P.racePrefOf("mlb-wc-al"), "pin");
  /* Pressing the state a race is already in is how the page returns it
     to Auto, so the three buttons behave as one setting. */
  P.setRacePref("mlb-wc-al", P.RACE_AUTO);
  assert.equal(P.racePrefOf("mlb-wc-al"), P.RACE_AUTO);

  const src = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
  assert.match(src, /const RACES_PREFS_KEY = "gdn\.races\.prefs";/);
  const setter = src.slice(src.indexOf("function setRacePref"));
  assert.match(setter.slice(0, 300), /LS\.set\(RACES_PREFS_KEY/);
  assert.ok(!/gdn\.teams/.test(setter.slice(0, 300)),
    "changing a race preference must never touch which teams are followed");
});

test("a race id is stable and is what a preference is keyed on", () => {
  const P = page();
  const single = P.RACES.find(v => v.id === "mlb-wc-al");
  assert.equal(P.raceCardId(single, { group: "AL" }), "mlb-wc-al");
  const many = P.RACES.find(v => v.kindIs === "division");
  assert.equal(P.raceCardId(many, { group: "afc-east" }), "nfl-div:afc-east",
    "one view over eight divisions still gives each its own id");
  assert.equal(P.racePrefBtnId("nfl-div:afc-east", "pin"), "rp-card-pin-nfl-div:afc-east");
});

test("Customize offers the races you could have, not every race there is", () => {
  const P = page({ picks: ["tor-mlb"] });
  P.attachStandings(MLB.concat(EPL).concat(NFL_DIV));
  const html = P.racePrefsHtml(NOW);
  assert.match(html, /AL Wild Card/);
  assert.ok(!/AFC East/.test(html), "eight football divisions for a baseball follower is a settings screen");
  assert.ok(!/Title race/.test(html), "and a league they follow no club in is not their race either");
});

test("a club above the line is described in words that are English", () => {
  const P = page({ picks: ["ars", "liv", "tot"] });
  const epl = grp(EPL_PREV, "table");
  const row = id => epl.rows.find(r => r.id === id);
  const say = (vid, at, id) => P.raceGapPhrase({ view: view(P, vid), grp: epl, at }, row(id));
  assert.equal(say("epl-title", 1, "ars"), "top of the table",
    "and not 'in the title', which is what a generic phrasing produced");
  assert.equal(say("epl-ucl", 5, "liv"), "in the UCL places");
  assert.equal(say("epl-rel", 17, "tot"), "in safety");
  /* Every view that a table row can reach must read either way round. */
  for(const v of P.RACES.filter(v => v.comp === "EPL" || v.comp === "UCL")){
    const phrase = (v.cut.inside || ("in " + v.cut.short));
    assert.ok(!/^in the title$/.test(phrase), v.id + " reads badly above the line");
    assert.ok(phrase.length > 2, v.id + " has no wording for a club above the line");
  }
});

test("a relegation battle does not open on the club that won the league", () => {
  /* Showing every followed club on every card of a table produced a
     relegation card that led with Arsenal first, two rows of ellipsis,
     and only then the fight at the bottom. */
  const picks = ["ars", "tot", "liv"];
  const P = page({ picks });
  P.attachStandings(EPL_PREV);
  const cards = P.raceCards(NOW, new Set(picks));
  const rel = cards.find(c => c.view.id === "epl-rel");
  const title = cards.find(c => c.view.id === "epl-title");
  assert.ok(rel && title);
  assert.deepEqual(rel.own.map(r => r.id), ["tot"], "the relegation card is Tottenham's");
  assert.ok(title.own.some(r => r.id === "ars"), "the title card is Arsenal's");
  assert.ok(!/Arsenal/.test(P.raceCardHtml(rel, NOW)),
    "and the league winners do not appear in the relegation battle");
});

test("a club whose own race was dropped joins the nearest one that survived", () => {
  const picks = ["ars", "tot", "liv"];
  const P = page({ picks });
  P.attachStandings(EPL_PREV);
  const cards = P.raceCards(NOW, new Set(picks));
  /* Liverpool sit exactly on the Champions League line, but only two
     Premier League cards survive the per-competition cap and that is not
     one of them. They must land somewhere rather than vanish. */
  assert.ok(!cards.some(c => c.view.id === "epl-ucl"));
  const home = cards.find(c => c.own.some(r => r.id === "liv"));
  assert.ok(home, "Liverpool appear on some card");
  assert.equal(home.view.id, "epl-title", "the surviving line their position is nearest to");
});

test("a club with no primary at all still appears in its competition's race", () => {
  const picks = ["tor-mlb", "sea-mlb"];
  const P = page({ picks });
  P.attachStandings(MLB);
  const card = P.raceCards(NOW, new Set(picks))[0];
  const sea = card.grp.rows.find(r => r.id === "sea-mlb");
  assert.ok(Math.abs(sea.pos - card.at) > card.band.near,
    "Seattle are further from the line than the band reaches, so they claim nothing");
  assert.ok(card.own.some(r => r.id === "sea-mlb"), "and are on the card anyway");
  assert.ok(P.raceCardHtml(card, NOW).includes("Seattle Mariners"));
});

/* ============ value, once distance has decided who is in a race ============ */

test("every race says what it is worth", () => {
  const P = page();
  for(const v of P.RACES){
    assert.equal(typeof P.racePriority(v), "number", v.id + " has no priority");
    assert.ok(P.racePriority(v) >= 1 && P.racePriority(v) <= P.RACE_PRIORITY, v.id);
  }
  const pr = id => P.racePriority(view(P, id));
  assert.ok(pr("epl-rel") < pr("epl-title"), "survival outranks the title");
  assert.ok(pr("epl-title") < pr("epl-ucl"), "the title outranks Champions League qualification");
  assert.ok(pr("epl-ucl") < pr("epl-euro"), "which outranks the European places");
  assert.equal(P.raceAutoAllowed(view(P, "epl-euro")), false);
  assert.ok(P.RACES.filter(v => !P.raceAutoAllowed(v)).every(v => v.id === "epl-euro"),
    "and it is the only race kept out of Auto, so this is a decision rather than a habit");
});

test("a club fifth on the Europa line is chasing the Champions League", () => {
  /* The 2026-27 table puts the Champions League places at 1-4 and a
     single Europa place at 5, so a club in fifth sits exactly on the
     Europa line and one place off the Champions League one. The real
     table is used; only which followed club occupies fifth is arranged,
     because no club on this app's roster happens to sit there. */
  const table = JSON.parse(JSON.stringify(grp(EPL, "table")));
  table.played = { min: 34, max: 34 };                 // late in the same season
  table.rows.forEach(r => { if(r.id === "liv") delete r.id; });
  table.rows.find(r => r.pos === 5).id = "liv";
  assert.equal(table.zones.find(z => z.label === "Champions League").to, 4);
  assert.equal(table.zones.find(z => z.label === "Europa League").from, 5);

  const P = page({ picks: ["liv"] });
  P.attachStandings([table]);
  const cards = P.raceCards(NOW, new Set(["liv"]));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].view.id, "epl-ucl",
    "the story is the place being chased, not the one being stood on");
  assert.ok(!cards.some(c => c.view.id === "epl-euro"));
  assert.match(P.raceCardHtml(cards[0], NOW), /Champions League places/);
});

test("the European places never surface on their own", () => {
  const table = JSON.parse(JSON.stringify(grp(EPL_PREV, "table")));
  const P = page({ picks: ["liv", "ars", "che", "new", "tot", "mun", "mci"] });
  P.attachStandings([table]);
  const cards = P.raceCards(NOW, new Set(["liv", "ars", "che", "new", "tot", "mun", "mci"]));
  assert.ok(cards.length, "there are races to show");
  assert.ok(!cards.some(c => c.view.id === "epl-euro"),
    "with seven clubs spread through the table, still not this one");
  /* Nor may it quietly claim a club and take a card off something else. */
  const claimed = P.racePrimaries(P.raceCandidates(NOW, new Set(["che"])));
  assert.ok([...claimed.values()].every(v => v.card.view.id !== "epl-euro"));
});

test("pinning the European places renders them", () => {
  const P = page({ picks: ["che"], prefs: { "epl-euro": "pin" } });
  P.attachStandings(EPL_PREV);
  const cards = P.raceCards(NOW, new Set(["che"]));
  const euro = cards.find(c => c.view.id === "epl-euro");
  assert.ok(euro, "a race kept out of Auto is still a race someone can ask for");
  assert.ok(euro.pinned);
  assert.match(P.raceCardHtml(euro, NOW), /European places/);
  /* And Customize says why it never turned up by itself. */
  assert.match(P.racePrefsHtml(NOW), /European places<i>EPL &middot; pin to see it<\/i>/);
});

test("relegation still wins when a club is genuinely in danger", () => {
  const P = page({ picks: ["tot"] });
  P.attachStandings(EPL_PREV);
  const tot = grp(EPL_PREV, "table").rows.find(r => r.id === "tot");
  assert.equal(tot.pos, 17, "one place above the drop");
  const cards = P.raceCards(NOW, new Set(["tot"]));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].view.id, "epl-rel");
  assert.deepEqual(cards[0].own.map(r => r.id), ["tot"]);
});

test("value does not reach past a line a club is standing on", () => {
  /* Priority alone would hand Liverpool, exactly on the Champions
     League line, to the title race four places above them. */
  const P = page({ picks: ["liv"] });
  const claimed = P.racePrimaries(P.raceCandidates(NOW, new Set(["liv"])));
  P.attachStandings(EPL_PREV);
  const again = P.racePrimaries(P.raceCandidates(NOW, new Set(["liv"])));
  const pick = again.get("liv");
  assert.ok(pick, "Liverpool are in a race");
  assert.equal(pick.card.view.id, "epl-ucl");
  assert.equal(pick.gap, 0);
  assert.equal(P.RACE_GAP_TOLERANCE, 2);
});

test("a more valuable race at the same distance takes the club", () => {
  /* Buffalo are one place off the last playoff spot and one place off
     the division lead. Both are equally near; one matters more. */
  const P = page({ picks: ["buf"] });
  P.attachStandings(NFL.concat(NFL_DIV));
  const cards = P.raceCards(NOW, new Set(["buf"]));
  const forBuf = cards.find(c => c.own.some(r => r.id === "buf"));
  assert.ok(forBuf);
  assert.equal(forBuf.view.id, "nfl-afc", "the playoff picture, not the division it shares a gap with");
  assert.ok(P.racePriority(view(P, "nfl-afc")) < P.racePriority(view(P, "nfl-div")));
});
