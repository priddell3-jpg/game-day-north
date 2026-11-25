import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFromPage } from "./helpers/page.mjs";

/* The rights table's weekday and hour rules are broadcast windows, and
   broadcast windows are sold and listed on the Eastern clock: Prime
   Video's NHL Wednesday, Sportsnet's Saturday and Monday, the NFL's
   Thursday, Sunday and Monday nights. They were read in UTC, where an
   evening game in North America has already moved to the next day, so
   until 2026-11-24 every Wednesday-night NHL game missed Prime Video's
   rule and a Tuesday 8 p.m. game was given it as confirmed. These cases
   are real fixtures from the 2026-11-24 schedule file. */

const page = loadFromPage(["RIGHTS", "SRC", "CHECKED", "resolveRights"], "const tourneyOf = () => null;");

const team = id => ({ id, name: id, abbr: id.slice(0, 3).toUpperCase() });
/* Built the way loadStatic builds a feed row, UTC weekday and hour
   included, so the test fails if resolveRights ever reads them again. */
const game = (comp, home, away, iso) => ({
  comp, home: team(home), away: team(away), start: Date.parse(iso), stage: "",
  localDow: new Date(iso).getUTCDay(), slotHour: new Date(iso).getUTCHours() });
const names = r => r.carriers.map(c => c.name);

test("a Wednesday-night NHL game is Prime Video's, though it is Thursday in UTC", () => {
  /* Vancouver at Detroit, Wed 25 Nov, 7:30 p.m. ET = Thu 00:30 UTC. */
  const r = page.resolveRights(game("NHL", "det", "van-nhl", "2026-11-26T00:30:00Z"));
  assert.deepEqual(names(r), ["Prime Video"]);
  assert.equal(r.confidence, "confirmed");
  /* Montreal at Colorado, Wed 9:30 p.m. ET: the Wednesday rule comes
     before the Canadiens' regional one. */
  assert.deepEqual(names(page.resolveRights(game("NHL", "col", "mtl-nhl", "2026-11-26T02:30:00Z"))), ["Prime Video"]);
});

test("a Tuesday-night NHL game is not Prime Video's, though it is Wednesday in UTC", () => {
  /* Vegas at Edmonton, Tue 24 Nov, 8 p.m. ET = Wed 01:00 UTC. */
  const r = page.resolveRights(game("NHL", "edm", "vgk", "2026-11-25T01:00:00Z"));
  assert.ok(!names(r).includes("Prime Video"), names(r).join(", "));
  assert.deepEqual(names(r), ["Sportsnet West", "Sportsnet+"]);
});

test("Sportsnet's Saturday and Monday windows are Saturday and Monday evenings, Eastern", () => {
  /* Sat 28 Nov, 7 p.m. ET = Sun 00:00 UTC. */
  assert.deepEqual(names(page.resolveRights(game("NHL", "det", "nsh", "2026-11-29T00:00:00Z"))), ["Sportsnet", "Sportsnet+"]);
  /* Mon 30 Nov, 7 p.m. ET = Tue 00:00 UTC. */
  assert.deepEqual(names(page.resolveRights(game("NHL", "nyr", "car", "2026-12-01T00:00:00Z"))), ["Sportsnet", "Sportsnet+"]);
  /* Fri 27 Nov, 7:30 p.m. ET = Sat 00:30 UTC: a Friday game, so the Jets'
     regional carrier, not Saturday's national window. */
  assert.deepEqual(names(page.resolveRights(game("NHL", "nyi", "wpg", "2026-11-28T00:30:00Z"))), ["TSN3", "TSN+"]);
});

test("the NFL's windows: Sunday afternoon on CTV, Thursday, Sunday and Monday nights on TSN", () => {
  /* Sun 29 Nov, 4:25 p.m. ET = 21:25 UTC: an afternoon game. */
  assert.equal(names(page.resolveRights(game("NFL", "sf", "sea", "2026-11-29T21:25:00Z")))[0], "CTV");
  /* Sun 29 Nov, 8:20 p.m. ET = Mon 01:20 UTC: Sunday Night Football. */
  assert.equal(names(page.resolveRights(game("NFL", "cle", "lv", "2026-11-30T01:20:00Z")))[0], "TSN");
  /* Mon 30 Nov, 8:15 p.m. ET = Tue 01:15 UTC. */
  assert.equal(names(page.resolveRights(game("NFL", "wsh", "cin", "2026-12-01T01:15:00Z")))[0], "TSN");
  /* Thu 26 Nov, 8:20 p.m. ET = Fri 01:20 UTC. */
  assert.equal(names(page.resolveRights(game("NFL", "buf", "kc", "2026-11-27T01:20:00Z")))[0], "TSN");
});

test("the clock follows daylight saving, so October and December agree", () => {
  /* Wed 21 Oct, 7 p.m. EDT = 23:00 UTC; Wed 2 Dec, 7 p.m. EST = Thu 00:00 UTC. */
  assert.deepEqual(names(page.resolveRights(game("NHL", "bos", "wpg", "2026-10-21T23:00:00Z"))), ["Prime Video"]);
  assert.deepEqual(names(page.resolveRights(game("NHL", "bos", "wpg", "2026-12-03T00:00:00Z"))), ["Prime Video"]);
});

test("a row with no kickoff to read falls back to the weekday it carries", () => {
  const g = { comp: "NHL", home: team("bos"), away: team("wpg"), start: NaN, stage: "", localDow: 3, slotHour: 19 };
  assert.deepEqual(names(page.resolveRights(g)), ["Prime Video"]);
});
