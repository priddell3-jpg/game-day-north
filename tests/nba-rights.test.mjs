import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFromPage } from "./helpers/page.mjs";

/* The NBA rows of the rights table, as updated on 2026-11-15: Bell and
   Rogers renewed to 2035-36, and Prime Video Canada's package began this
   season. The Cup is the one Prime window the schedule can place, by
   Eastern listing night, and that is what most of this file checks. */

const page = loadFromPage(
  ["SRC", "CHECKED", "RIGHTS",
   "ZONE_IANA", "_zoneFmt", "zoneParts", "listingDay", "resolveRights"],
  "const tourneyOf = () => null;");

const team = id => ({ id, name: id, abbr: id.slice(0, 3).toUpperCase() });
const nba = (home, away, startIso) => ({
  comp: "NBA", home: team(home), away: team(away), start: Date.parse(startIso), stage: "",
  localDow: new Date(startIso).getUTCDay(), slotHour: 0,
  result: { status: "scheduled", label: "", score: null } });
const names = r => r.carriers.map(c => c.name);
/* The Cup nights are the day list on the Cup row of data/rights.json. */
const CUP_NIGHTS = page.RIGHTS.find(r => r.comp === "NBA" && r.if && r.if.day).if.day;

/* 00:00 UTC on the 21st is 7 p.m. Eastern on the 20th: a Cup night. */
const CUP_NIGHT_TOR = () => nba("det", "tor-nba", "2026-11-21T00:00:00Z");
const CUP_NIGHT_OTHER = () => nba("ind", "nyk", "2026-11-14T00:30:00Z");
const PLAIN_NIGHT_TOR = () => nba("tor-nba", "mem", "2026-11-22T00:30:00Z");
const PLAIN_NIGHT_OTHER = () => nba("den", "no", "2026-11-15T01:00:00Z");

test("the shared CHECKED date is untouched and the NBA rows do not use it", () => {
  assert.equal(page.CHECKED, "2026-08-22");
  const rows = page.RIGHTS.filter(r => r.comp === "NBA");
  assert.equal(rows.length, 3);
  for(const r of rows) assert.equal(r.checked, "2026-11-15", r.note);
});

test("a Cup night is Prime Video's alone, whoever is playing", () => {
  for(const g of [CUP_NIGHT_TOR(), CUP_NIGHT_OTHER()]){
    const r = page.resolveRights(g);
    assert.deepEqual(names(r), ["Prime Video"]);
    assert.equal(r.carriers[0].kind, "stream");
    assert.equal(r.confidence, "confirmed");
    assert.equal(r.src, page.SRC.nbaprime);
    assert.match(r.src.url, /^https:\/\/www\.aboutamazon\.ca\//);
  }
});

test("the Cup nights are keyed on the Eastern listing date, like the INTF rows", () => {
  assert.equal(page.listingDay(CUP_NIGHT_TOR().start), "2026-11-20");
  assert.ok(CUP_NIGHTS.includes("2026-11-20"));
  assert.ok(!CUP_NIGHTS.includes("2026-11-21"));
  /* Eleven nights, from the first group-play Friday to the Championship. */
  assert.equal(CUP_NIGHTS.length, 11);
  assert.equal(CUP_NIGHTS[0], "2026-10-30");
  assert.equal(CUP_NIGHTS[CUP_NIGHTS.length - 1], "2026-12-11");
  assert.deepEqual([...CUP_NIGHTS].sort(), CUP_NIGHTS, "in calendar order");
});

test("a Raptors game on an ordinary night is TSN and Sportsnet, confirmed, citing TSN's renewal", () => {
  const r = page.resolveRights(PLAIN_NIGHT_TOR());
  assert.deepEqual(names(r), ["TSN", "Sportsnet"]);
  assert.equal(r.confidence, "confirmed");
  assert.equal(r.src, page.SRC.nbatsn);
  assert.match(r.note, /41\/41/);
  assert.match(r.note, /2035-36/);
  assert.match(r.note, /Prime Video exclusives/, "the two streaming-only games are admitted to");
});

test("any other game names Prime Video among the carriers and cites the Sportsnet renewal", () => {
  const r = page.resolveRights(PLAIN_NIGHT_OTHER());
  assert.deepEqual(names(r), ["TSN", "Sportsnet", "Prime Video", "NBA League Pass"]);
  assert.equal(r.confidence, "expected");
  assert.equal(r.src, page.SRC.nbasn);
  assert.match(r.note, /Play-In/);
});

test("the superseded SI source is gone and the three new ones are present", () => {
  assert.equal("raptors" in page.SRC, false);
  for(const k of ["nbatsn", "nbasn", "nbaprime"]){
    assert.ok(page.SRC[k], k);
    assert.match(page.SRC[k].url, /^https:\/\//);
    assert.match(page.SRC[k].label, /2035-36|NBA package/);
  }
});
