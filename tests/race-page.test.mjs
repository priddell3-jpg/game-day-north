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

const NAMES = ["esc", "COMPS", "SOCCER", "CLUB_NAMES", "TEAM_ROWS", "TEAMS", "fullName",
  "RACE_MAX_AGE", "RACE_CHECKED", "RACES", "attachStandings", "raceZoneHit", "raceCutoff",
  "racePhase", "raceRelevance", "raceFollowsComp", "raceGroupsFor", "raceSlice",
  "RACE_PER_COMP", "raceCards", "RACE_CLINCH", "raceAge", "raceHeldAt", "raceOrdinal",
  "raceRowName", "raceFigures",
  "raceOrigin", "raceLineHtml", "raceRowHtml", "raceCardHtml", "raceHeadline", "renderRaces"];

/* A fresh page scope per case. `showScores` and the followed set are read
   by the code under test and never written by it, so they are baked into
   the preamble rather than poked at afterwards. */
function page(opts = {}){
  const pre = "let STANDINGS = [];\n"
    + "let raceFull = new Set(" + JSON.stringify(opts.full || []) + ");\n"
    + "let racesOpen = true;\n"
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

test("the headline is readable with the panel shut", () => {
  const P = page({ picks: ["tor-mlb"] });
  P.attachStandings(MLB);
  const html = P.renderRaces(NOW);
  assert.ok(html.startsWith('<details class="races" open>'));
  assert.match(html, /Toronto Blue Jays 4th, 1\.5 back &middot; AL Wild Card|Toronto Blue Jays \d+\w\w, .*AL Wild Card/);
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
  const P = page({ picks: ["tor-mlb"] });
  P.attachStandings(heldCopy(MLB, 26 * HOUR));
  const summary = P.renderRaces(NOW).split("</summary>")[0];
  assert.ok(/not current/.test(summary),
    "the headline is exactly where a stale figure would pass for a live one");
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
