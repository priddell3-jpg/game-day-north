import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage } from "./helpers/page.mjs";
import { loadFromBuild } from "./helpers/build.mjs";

/* A score used to be read off the scoreboard for the day a fixture falls
   on. That is one request for however many games are on, which is why it
   was built that way — but it makes every result on that date depend on
   one page being complete, and a fixture missing from it is one nothing
   can settle. Royals at Blue Jays on 26 Aug 2026 sat in data.json
   reading "scheduled" for hours after the final out while the summary
   endpoint, asked for that one event, had the complete post-game record.

   So both the build and the page now ask by the event id they already
   hold, and fall back to the day only for a fixture that carries none.
   These run the real 401816683 response through both parsers. */

const FIX = JSON.parse(readFileSync(new URL("./fixtures/mlb-summary-401816683.json", import.meta.url), "utf8"));

/* the same response as a fixture that has not finished, and as one that
   ESPN is still reporting as scheduled — the state the bug left behind */
function withStatus(type, scores){
  const copy = JSON.parse(JSON.stringify(FIX));
  const cp = copy.header.competitions[0];
  cp.status.type = type;
  if(scores) cp.competitors.forEach((c, i) => { c.score = scores[i]; });
  return copy;
}
const LIVE = {id:"2", name:"STATUS_IN_PROGRESS", state:"in", completed:false,
              description:"In Progress", detail:"Top 6th", shortDetail:"Top 6th"};
const PRE  = {id:"1", name:"STATUS_SCHEDULED", state:"pre", completed:false,
              description:"Scheduled", detail:"7:07 PM EDT", shortDetail:"8/26 - 7:07 PM EDT"};

/* ================= the build's parser ================= */

const build = loadFromBuild(["parseSummary", "applySummary", "parseEvent"]);

test("the build reads a final and its score out of a real summary", () => {
  const s = build.parseSummary(FIX, "MLB");
  assert.equal(s.eid, "401816683");
  assert.equal(s.comp, "MLB");
  assert.equal(s.status, "final");
  assert.equal(s.label, "Final");
  assert.deepEqual(s.score, [3, 0]);            // Blue Jays 3, Royals 0
  assert.equal(s.home.name, "Toronto Blue Jays");
  assert.equal(s.away.name, "Kansas City Royals");
  assert.equal(s.start, Date.parse("2026-08-26T23:07Z"));
});

test("the roster club is still resolved to its own id", () => {
  // a top-up that could not name the club would have nothing to apply to
  assert.equal(build.parseSummary(FIX, "MLB").home.id, "tor-mlb");
});

test("only the header is read — the rest of the response is not needed", () => {
  /* The real response was 892 KB across 22 top-level keys. Handing the
     parser the header alone must produce exactly the same fixture, so
     that the boxscore, the play-by-play and the standings are provably
     dead weight rather than merely unused today. */
  const headerOnly = {header: FIX.header};
  assert.deepEqual(build.parseSummary(headerOnly, "MLB"), build.parseSummary(FIX, "MLB"));
});

test("a response with no header yields nothing rather than a guess", () => {
  for(const bad of [null, undefined, {}, {header:null}, {header:{}},
                    {header:{competitions:[]}}, {header:{competitions:null}},
                    {boxscore:{teams:[]}}]){
    assert.equal(build.parseSummary(bad, "MLB"), null);
  }
});

test("a score arrives as a number whether ESPN wrote it as one or not", () => {
  const FINAL = FIX.header.competitions[0].status.type;
  // the captured response writes the runs as strings...
  assert.equal(typeof FIX.header.competitions[0].competitors[0].score, "string");
  assert.deepEqual(build.parseSummary(FIX, "MLB").score, [3, 0]);
  // ...and ESPN writes them as bare numbers elsewhere. Both land as 3-0.
  assert.deepEqual(build.parseSummary(withStatus(FINAL, [3, 0]), "MLB").score, [3, 0]);
});

/* ---- taking that into the fixture it was asked about ---- */

const stuck = (over = {}) => ({
  eid:"401816683", comp:"MLB", start:Date.parse("2026-08-26T23:07Z"),
  home:{id:"tor-mlb", name:"Toronto Blue Jays", abbr:"TOR", city:"Toronto", color:"#134a8e"},
  away:{id:null, name:"Kansas City Royals", abbr:"KC", city:"Kansas City", color:"#004687"},
  status:"scheduled", label:"8/26 - 7:07 PM EDT", score:null,
  venue:{name:"Rogers Centre", city:"Toronto", state:"Ontario"},
  ...over
});

test("the fixture the scoreboard left stranded gets its final", () => {
  const f = stuck();
  assert.equal(build.applySummary(f, build.parseSummary(FIX, "MLB")), true);
  assert.equal(f.status, "final");
  assert.deepEqual(f.score, [3, 0]);
  assert.equal(f.label, "Final");
});

test("the venue the summary does not state is the venue the fixture keeps", () => {
  /* A summary files the ground under gameInfo, not under the
     competition, so this parser reports none. Patching the fixture in
     place rather than replacing it is what stops that absence from
     erasing Rogers Centre. */
  assert.equal(build.parseSummary(FIX, "MLB").venue, undefined);
  const f = stuck();
  build.applySummary(f, build.parseSummary(FIX, "MLB"));
  assert.deepEqual(f.venue, {name:"Rogers Centre", city:"Toronto", state:"Ontario"});
});

test("a score is turned round when the fixture lists the clubs the other way", () => {
  const f = stuck({
    home:{id:null, name:"Kansas City Royals", abbr:"KC", city:"Kansas City", color:"#004687"},
    away:{id:"tor-mlb", name:"Toronto Blue Jays", abbr:"TOR", city:"Toronto", color:"#134a8e"}
  });
  build.applySummary(f, build.parseSummary(FIX, "MLB"));
  assert.deepEqual(f.score, [0, 3]);            // Royals 0, Blue Jays 3
});

test("a score whose orientation cannot be established is not applied at all", () => {
  // neither club named by the summary — a wrong score is worse than none
  const f = stuck({
    home:{id:"nyy", name:"New York Yankees", abbr:"NYY", city:"New York", color:null},
    away:{id:null, name:"Houston Astros", abbr:"HOU", city:"Houston", color:null}
  });
  assert.equal(build.applySummary(f, build.parseSummary(FIX, "MLB")), false);
  assert.equal(f.status, "scheduled");
  assert.equal(f.score, null);
});

test("a final already known is never erased by a summary carrying no score", () => {
  const f = stuck({status:"final", label:"Final", score:[3, 0]});
  assert.equal(build.applySummary(f, build.parseSummary(withStatus(PRE, ["0", "0"]), "MLB")), false);
  assert.equal(f.status, "final");
  assert.deepEqual(f.score, [3, 0]);
});

test("a summary that says nothing new reports that nothing changed", () => {
  // the build writes data.json only when a fixture actually moved
  const f = stuck({status:"final", label:"Final", score:[3, 0]});
  assert.equal(build.applySummary(f, build.parseSummary(FIX, "MLB")), false);
});

test("a game in progress arrives as live, with the score it is at", () => {
  const f = stuck();
  assert.equal(build.applySummary(f, build.parseSummary(withStatus(LIVE, ["2", "0"]), "MLB")), true);
  assert.equal(f.status, "live");
  assert.equal(f.label, "Top 6th");
  assert.deepEqual(f.score, [2, 0]);
});

test("applySummary survives a parse that produced nothing", () => {
  const f = stuck();
  assert.equal(build.applySummary(f, null), false);
  assert.equal(build.applySummary(null, build.parseSummary(FIX, "MLB")), false);
  assert.equal(f.status, "scheduled");
});

/* ================= the page's parser ================= */

/* espnTeamObj resolves an ESPN name against the clubs the page knows and
   mints a ghost for anything else, so it is given the two real rows. */
const PREAMBLE = `
const TEAMS = {
  "tor-mlb": {id:"tor-mlb", home:"MLB", city:"Toronto", name:"Blue Jays", abbr:"TOR", tz:"ET", color:"#134A8E", comps:["MLB"]}
};
const allTeams = Object.values(TEAMS);`;

const page = loadFromPage(
  ["norm", "ESPN_NAME", "venueOf", "espnTeamObj", "parseEvent", "parseSummary"], PREAMBLE);

test("the page reads the same final out of the same response", () => {
  const g = page.parseSummary(FIX, "MLB");
  assert.equal(g.eid, "401816683");
  assert.equal(g.result.status, "final");
  assert.equal(g.result.label, "Final");
  assert.deepEqual(g.result.score, [3, 0]);
  assert.equal(g.start, Date.parse("2026-08-26T23:07Z"));
});

test("the page resolves the followed club rather than minting a ghost for it", () => {
  const g = page.parseSummary(FIX, "MLB");
  assert.equal(g.home.id, "tor-mlb");
  assert.equal(g.home.ghost, undefined);
  assert.equal(g.away.ghost, true);              // the Royals are nobody's row here
});

test("the page needs no more of the response than the build does", () => {
  assert.deepEqual(page.parseSummary({header: FIX.header}, "MLB"), page.parseSummary(FIX, "MLB"));
});

test("the page yields nothing from a response with no header", () => {
  for(const bad of [null, undefined, {}, {header:{}}, {header:{competitions:[]}}, {boxscore:{}}]){
    assert.equal(page.parseSummary(bad, "MLB"), null);
  }
});

test("the page reports no venue from a summary, so the row keeps its own", () => {
  assert.equal(page.parseSummary(FIX, "MLB").venue, null);
});

test("build and page agree on what the summary says", () => {
  /* The committed file and the direct fetch must describe a fixture the
     same way, or a row changes shape depending on which path it arrived
     by. The two read the status differently on purpose — the build
     matches on the status name, the page on ESPN's state and completed
     flags — so this asserts they still land on the same answer. */
  for(const r of [FIX, withStatus(LIVE, ["2", "0"]), withStatus(PRE, ["0", "0"])]){
    const b = build.parseSummary(r, "MLB"), p = page.parseSummary(r, "MLB");
    assert.equal(b.eid, p.eid);
    assert.equal(b.start, p.start);
    assert.equal(b.status, p.result.status, "status disagreed on " + r.header.competitions[0].status.type.name);
    assert.equal(b.label, p.result.label);
    assert.deepEqual(b.score, p.result.score);
  }
});

/* ================= the merge the page does with it ================= */

const merge = loadFromPage(
  ["normName", "idKey", "SAME_WINDOW", "sameGame", "ESPN_NAME", "clubKeys", "sameClub",
   "orientation", "findScored", "applyScored"]);

test("a summary's final reaches the committed row the day scoreboard stranded", () => {
  /* End to end on the page: the row as loadStatic() left it — the Royals
     unmapped, so staticTeam() minted a feed: id for them — taking the
     score from a response parsed by parseSummary. */
  const row = {
    eid:"401816683", comp:"MLB", start:Date.parse("2026-08-26T23:07Z"),
    home:{id:"tor-mlb", home:"MLB", city:"Toronto", name:"Blue Jays", abbr:"TOR"},
    away:{id:"feed:MLB:KC", home:"MLB", city:"Kansas City", name:"Kansas City Royals", abbr:"KC", ghost:true, full:true},
    espn:true, listed:true, fromFeed:true,
    venue:{name:"Rogers Centre", city:"Toronto", state:"Ontario"},
    result:{status:"scheduled", label:"8/26 - 7:07 PM EDT", score:null}
  };
  const parsed = page.parseSummary(FIX, "MLB");
  assert.equal(merge.findScored(parsed, [row]), row);
  assert.equal(merge.applyScored(row, parsed), true);
  assert.equal(row.result.status, "final");
  assert.deepEqual(row.result.score, [3, 0]);
  assert.deepEqual(row.venue, {name:"Rogers Centre", city:"Toronto", state:"Ontario"});
  assert.equal(row.moved, undefined);            // the kickoff did not move
});

test("a summary is not applied to a different game that looks like this one", () => {
  const other = {
    eid:"401816684", comp:"MLB", start:Date.parse("2026-08-26T23:07Z"),
    home:{id:"tor-mlb", home:"MLB", city:"Toronto", name:"Blue Jays", abbr:"TOR"},
    away:{id:"feed:MLB:KC", home:"MLB", city:"Kansas City", name:"Kansas City Royals", abbr:"KC"},
    result:{status:"scheduled", label:"", score:null}
  };
  assert.equal(merge.findScored(page.parseSummary(FIX, "MLB"), [other]), undefined);
  assert.equal(other.result.score, null);
});

/* ================= the callers ================= */

const SRC_PAGE = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
const SRC_BUILD = readFileSync(new URL("../scripts/fetch-data.mjs", import.meta.url), "utf8");

test("both sides ask the summary endpoint by an id they already hold", () => {
  assert.match(SRC_PAGE, /\/summary\?event="\s*\+\s*encodeURIComponent\(g\.eid\)/);
  assert.match(SRC_BUILD, /\/summary\?event="\s*\+\s*encodeURIComponent\(f\.eid\)/);
});

test("the day scoreboard is still there for a fixture that carries no id", () => {
  /* Not every row has an event id — the baked fallback has none — and
     the day is the only thing left to ask about those. Deleting that
     path would silently stop scoring them. */
  assert.match(SRC_PAGE, /need\.filter\(g => !g\.eid\)/);
  assert.match(SRC_PAGE, /scoreboard\?dates="\+d/);
});
