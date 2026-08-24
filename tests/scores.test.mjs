import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFromPage } from "./helpers/page.mjs";

const { findScored, applyScored, orientation, sameClub } = loadFromPage(
  ["normName", "idKey", "SAME_WINDOW", "sameGame", "ESPN_NAME", "clubKeys", "sameClub",
   "orientation", "findScored", "applyScored"]);

/* The live top-up reads the scoreboard and merges what it finds into the
   fixtures already on the page. Those two copies of one fixture describe
   their clubs differently: the committed file mints a `feed:` id for any
   club the build could not map to the roster, while the scoreboard read
   resolves that same club to its roster id. Matching on the raw ids made
   the merge silently do nothing — EPL 401879318 sat at "scheduled" on
   the page while ESPN had it live at 1-2 — so these exercise the actual
   matching path rather than the ids it used to compare. */

const KICKOFF = 1787598000000;                      // the reported event's start

// as the committed file leaves it: Fulham unmapped, so staticTeam() minted an id
const fedFulham   = {id:"feed:EPL:FUL", home:"EPL", city:"Fulham", name:"Fulham", abbr:"FUL", ghost:true, full:true};
const fedChelsea  = {id:"che", home:"EPL", city:"London", name:"Chelsea", abbr:"CHE"};
// as ESPN resolves them: both canonical roster clubs
const espnFulham  = {id:"ful", home:"EPL", city:"London", name:"Fulham", abbr:"FUL"};
const espnChelsea = {id:"che", home:"EPL", city:"London", name:"Chelsea", abbr:"CHE"};

const held = (over = {}) => ({
  eid:"401879318", comp:"EPL", home:fedFulham, away:fedChelsea, start:KICKOFF,
  espn:true, listed:true, fromFeed:true,
  result:{status:"scheduled", label:"Scheduled", score:null},
  ...over
});
const scoreboard = (over = {}) => ({
  eid:"401879318", comp:"EPL", home:espnFulham, away:espnChelsea, start:KICKOFF,
  result:{status:"live", label:"62'", score:[1,2]},
  ...over
});

test("a live score reaches a fixture whose committed opponent has no roster id", () => {
  const game = held(), games = [game];
  const parsed = scoreboard();
  assert.equal(findScored(parsed, games), game);
  assert.equal(applyScored(game, parsed), true);
  assert.equal(game.result.status, "live");
  assert.equal(game.result.label, "62'");
  assert.deepEqual(game.result.score, [1, 2]);       // Fulham 1, Chelsea 2
});

test("the raw ids the old lookup compared genuinely do not match", () => {
  // the premise of the bug: nothing about these two records lines up on
  // id alone, and only the event id ties them together
  assert.notEqual(fedFulham.id, espnFulham.id);
  assert.equal(sameClub(fedFulham, espnFulham), true);
});

test("a score is turned round when the two copies list the clubs the other way", () => {
  const game = held({home:fedChelsea, away:fedFulham}), games = [game];
  applyScored(game, scoreboard());
  assert.deepEqual(game.result.score, [2, 1]);       // Chelsea 2, Fulham 1
  assert.equal(game.result.status, "live");
});

test("orientation reads through the id mismatch in both directions", () => {
  assert.equal(orientation(held(), scoreboard()), 1);
  assert.equal(orientation(held({home:fedChelsea, away:fedFulham}), scoreboard()), -1);
});

test("a final arrives with its label and score", () => {
  const game = held(), games = [game];
  const parsed = scoreboard({result:{status:"final", label:"FT", score:[1,2]}});
  assert.equal(findScored(parsed, games), game);
  applyScored(game, parsed);
  assert.equal(game.result.status, "final");
  assert.deepEqual(game.result.score, [1, 2]);
});

/* --- the event id keeps the precedence sameGame() gives it --- */

test("two different event ids are never merged, however alike the rest", () => {
  const game = held(), games = [game];
  assert.equal(findScored(scoreboard({eid:"401879319"}), games), undefined);
  assert.equal(game.result.score, null);
});

test("the event id wins over a composite match elsewhere in the list", () => {
  // a baked fixture carrying no id, at the same kickoff, between the
  // clubs the scoreboard names — a composite hit that must not take a
  // score belonging to the fed copy
  const baked = held({eid:null, home:espnFulham, away:espnChelsea, fromFeed:false, baked:true});
  const fed = held();
  assert.equal(findScored(scoreboard(), [baked, fed]), fed);
});

test("the composite key still matches when the page's copy has no event id", () => {
  const baked = held({eid:null, home:espnFulham, away:espnChelsea, start:KICKOFF - 20*60000});
  const parsed = scoreboard();
  assert.equal(findScored(parsed, [baked]), baked);
  applyScored(baked, parsed);
  assert.deepEqual(baked.result.score, [1, 2]);
});

test("a fixture on the same day but hours away is a different game", () => {
  const other = held({eid:null, home:espnFulham, away:espnChelsea, start:KICKOFF + 5*3600000});
  assert.equal(findScored(scoreboard({eid:null}), [other]), undefined);
});

test("a fixture with no opponent yet is never taken as the match", () => {
  assert.equal(findScored(scoreboard(), [held({away:null})]), undefined);
});

test("an event id never reaches across competitions", () => {
  assert.equal(findScored(scoreboard({comp:"EFL"}), [held()]), undefined);
});

/* --- what the merge refuses to do --- */

test("a scoreless copy does not erase a final already known", () => {
  const game = held({result:{status:"final", label:"FT", score:[1,2]}});
  const parsed = scoreboard({result:{status:"scheduled", label:"Scheduled", score:null}});
  assert.equal(applyScored(game, parsed), false);
  assert.equal(game.result.status, "final");
  assert.deepEqual(game.result.score, [1, 2]);
});

test("a score whose orientation cannot be established is dropped, not guessed", () => {
  // nothing in either record ties a club on one side to a club on the
  // other; a coin-flip here would print a reversed scoreline as fact
  const game = held({home:{id:"feed:EPL:XXX", name:"Unnamed A"}, away:{id:"feed:EPL:YYY", name:"Unnamed B"}});
  applyScored(game, scoreboard());
  assert.equal(game.result.score, null);
  assert.equal(game.result.status, "live");          // still honestly live
});

test("a reschedule moves the fixture but records where it sat", () => {
  const game = held(), games = [game];
  const parsed = scoreboard({start: KICKOFF + 26*3600000});
  assert.equal(findScored(parsed, games), game);     // the id survives the move
  applyScored(game, parsed);
  assert.equal(game.start, KICKOFF + 26*3600000);
  assert.equal(game.moved, KICKOFF);
});

test("an unmoved fixture is not flagged as rescheduled", () => {
  const game = held();
  applyScored(game, scoreboard());
  assert.equal(game.moved, undefined);
});

/* --- the same club-naming mismatch in the North American leagues --- */

test("a club the file names in full matches the roster's city and name", () => {
  const fedRoyals = {id:"feed:MLB:KC", name:"Kansas City Royals", abbr:"KC", city:"Kansas City"};
  const rosterRoyals = {id:"kcr", home:"MLB", city:"Kansas City", name:"Royals", abbr:"KC"};
  assert.equal(sameClub(fedRoyals, rosterRoyals), true);
});

test("two clubs from the same city are still two clubs", () => {
  const yankees = {id:"nyy", home:"MLB", city:"New York", name:"Yankees", abbr:"NYY"};
  const mets = {id:"feed:MLB:NYM", name:"New York Mets", abbr:"NYM", city:"New York"};
  assert.equal(sameClub(yankees, mets), false);
});

test("a score reaches an MLB fixture across the same id mismatch", () => {
  const game = {eid:"401600999", comp:"MLB", start:KICKOFF,
    home:{id:"tor-mlb", home:"MLB", city:"Toronto", name:"Blue Jays", abbr:"TOR"},
    away:{id:"feed:MLB:KC", name:"Kansas City Royals", abbr:"KC", city:"Kansas City"},
    result:{status:"scheduled", label:"", score:null}};
  const parsed = {eid:"401600999", comp:"MLB", start:KICKOFF,
    home:{id:"tor-mlb", home:"MLB", city:"Toronto", name:"Blue Jays", abbr:"TOR"},
    away:{id:"kcr", home:"MLB", city:"Kansas City", name:"Royals", abbr:"KC"},
    result:{status:"live", label:"Top 5th", score:[4, 1]}};
  assert.equal(findScored(parsed, [game]), game);
  applyScored(game, parsed);
  assert.deepEqual(game.result.score, [4, 1]);
  assert.equal(game.result.label, "Top 5th");
});

/* --- and the whole path, through the function the page actually calls ---
   The unit tests above pin the matching rules. This drives fillScores()
   itself — the shipped roster, a real scoreboard payload, parseEvent()
   and the merge — because the bug was never in any one of those pieces:
   it was in how fillScores() joined them up. */

const PREAMBLE = `
  const GAMES = globalThis.__gdn.GAMES;
  const TEAMS = globalThis.__gdn.TEAMS;
  const allTeams = globalThis.__gdn.allTeams;
  const myGames = () => GAMES;
  const jget = globalThis.__gdn.jget;
`;

/* A fresh page for each test: scoredDays remembers which days it has
   already asked about, so two tests sharing one load would see the
   second request quietly skipped. */
function harness(){
  const GAMES = [], TEAMS = {}, allTeams = [], asked = [];
  const responses = new Map();
  globalThis.__gdn = {GAMES, TEAMS, allTeams,
    jget: async url => {
      asked.push(url);
      if(!responses.has(url)) throw new Error("no stub for " + url);
      return responses.get(url);
    }};
  const page = loadFromPage(
    ["TEAM_ROWS", "GHOSTS", "DAY", "ZONE_IANA", "_zoneFmt", "zoneParts", "espnDate",
     "normName", "idKey", "SAME_WINDOW", "sameGame", "ESPN", "ESPN_PATH", "ESPN_NAME",
     "norm", "espnTeamObj", "parseEvent", "clubKeys", "sameClub", "orientation",
     "findScored", "applyScored", "scoredDays", "fillScores"], PREAMBLE);
  // the shipped roster, built the way the page builds it
  page.TEAM_ROWS.forEach(r=>{
    const t = {id:r[0], home:r[1], city:r[2], name:r[3], abbr:r[4], tz:r[5], color:r[6], ucl:!!r[7]};
    t.comps = r[1]==="EPL" ? ["EPL","EFL","FAC"] : [r[1]];
    if(t.ucl) t.comps = t.comps.concat(["UCL"]);
    TEAMS[t.id] = t;
  });
  page.GHOSTS.forEach(r=>{
    TEAMS[r[0]] = {id:r[0], home:r[1], city:r[2], name:r[3], abbr:r[4], tz:r[5], color:r[6], ghost:true, comps:[r[1]]};
  });
  Object.values(TEAMS).forEach(t=>allTeams.push(t));
  const url = comp => page.ESPN + page.ESPN_PATH[comp] + "/scoreboard?dates=" + page.espnDate(Date.now());
  return {page, GAMES, TEAMS, asked,
    stub: (comp, events) => responses.set(url(comp), {events}),
    url};
}

// Fulham 1 Chelsea 2, in progress — the payload ESPN was serving
const LIVE_EVENT = start => ({
  id: "401879318",
  date: new Date(start).toISOString(),
  competitions: [{
    id: "401879318",
    date: new Date(start).toISOString(),
    status: {type: {name: "STATUS_IN_PROGRESS", shortDetail: "62'", description: "In Progress"}},
    competitors: [
      {homeAway: "home", score: "1", team: {id: "370", displayName: "Fulham", abbreviation: "FUL", location: "Fulham", color: "ffffff"}},
      {homeAway: "away", score: "2", team: {id: "363", displayName: "Chelsea", abbreviation: "CHE", location: "Chelsea", color: "144992"}}
    ]
  }]
});

// the fixture as loadStatic() leaves it: Fulham unmapped, so a minted id
const asCommitted = (h, start) => ({
  eid: "401879318", comp: "EPL", start,
  home: {id:"feed:EPL:FUL", home:"EPL", city:"Fulham", name:"Fulham", abbr:"FUL", ghost:true, full:true},
  away: h.TEAMS.che,
  real: true, espn: true, listed: true, fromFeed: true,
  result: {status:"scheduled", label:"Scheduled", score:null}
});

test("fillScores() merges the live score onto the committed fixture", async () => {
  const h = harness();
  const start = Date.now() - 45*60000;                 // kicked off, still on
  const game = asCommitted(h, start);
  h.GAMES.push(game);
  h.stub("EPL", [LIVE_EVENT(start)]);

  const filled = await h.page.fillScores();

  assert.equal(h.asked.length, 1, "asked the scoreboard for the right day");
  assert.equal(filled, 1);
  assert.equal(game.result.status, "live");
  assert.deepEqual(game.result.score, [1, 2]);
  assert.equal(game.result.label, "62'");
});

test("fillScores() leaves a fixture alone when the scoreboard has a different event", async () => {
  const h = harness();
  const start = Date.now() - 45*60000;
  const game = asCommitted(h, start);
  h.GAMES.push(game);
  const other = LIVE_EVENT(start);
  other.id = "401879999"; other.competitions[0].id = "401879999";
  h.stub("EPL", [other]);

  assert.equal(await h.page.fillScores(), 0);
  assert.equal(game.result.status, "scheduled");
  assert.equal(game.result.score, null);
});

test("fillScores() puts the score the right way round for the home side it holds", async () => {
  const h = harness();
  const start = Date.now() - 45*60000;
  const game = asCommitted(h, start);
  // the page's copy lists Chelsea at home; ESPN lists Fulham
  game.home = h.TEAMS.che;
  game.away = {id:"feed:EPL:FUL", home:"EPL", city:"Fulham", name:"Fulham", abbr:"FUL", ghost:true, full:true};
  h.GAMES.push(game);
  h.stub("EPL", [LIVE_EVENT(start)]);

  assert.equal(await h.page.fillScores(), 1);
  assert.deepEqual(game.result.score, [2, 1]);         // Chelsea 2, Fulham 1
});

test("fillScores() asks for nothing when every fixture already has its score", async () => {
  const h = harness();
  const game = asCommitted(h, Date.now() - 3*3600000);
  game.result = {status:"final", label:"FT", score:[1,2]};
  h.GAMES.push(game);

  assert.equal(await h.page.fillScores(), 0);
  assert.equal(h.asked.length, 0);
});
