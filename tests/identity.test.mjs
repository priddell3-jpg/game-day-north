import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFromPage } from "./helpers/page.mjs";

const { sameGame, normName } = loadFromPage(
  ["normName", "idKey", "ESPN_NAME", "clubKeys", "sameClub", "sameGame", "SAME_WINDOW"]);

const T = Date.parse("2026-08-24T17:05:00Z");
const g = (over = {}) => ({
  comp: "MLB",
  start: T,
  home: {id:"tor-mlb", name:"Toronto Blue Jays"},
  away: {id:"nyy", name:"New York Yankees"},
  ...over
});

/* Identity decides whether two copies of a fixture are the same game.
   Too loose and a doubleheader collapses into one; too strict and the
   same game arriving from two endpoints renders twice. */

test("the same fixture from two sources is one game", () => {
  // the schedule and the scoreboard disagree on the start by minutes
  assert.equal(sameGame(g(), g({start: T + 7*60000})), true);
});

test("home and away reversed is still the same game", () => {
  assert.equal(sameGame(g(), g({
    home: {id:"nyy", name:"New York Yankees"},
    away: {id:"tor-mlb", name:"Toronto Blue Jays"}
  })), true);
});

test("a tight doubleheader is two games, not one", () => {
  // both legs same clubs, same date, more than four hours apart
  assert.equal(sameGame(g(), g({start: T + 5*3600000})), false);
});

test("a split doubleheader is two games", () => {
  assert.equal(sameGame(g(), g({start: T + 9*3600000})), false);
});

test("a postponement to the next day is not the same game object", () => {
  assert.equal(sameGame(g(), g({start: T + 24*3600000})), false);
});

test("different competitions are never the same game", () => {
  assert.equal(sameGame(g(), g({comp:"NHL"})), false);
});

test("a different opponent is never the same game", () => {
  assert.equal(sameGame(g(), g({away:{id:"bos-mlb", name:"Boston Red Sox"}})), false);
});

test("a fixture with no opponent has no identity to compare", () => {
  assert.equal(sameGame(g(), g({away:null})), false);
  assert.equal(sameGame(g({away:null}), g({away:null})), false);
});

test("clubs outside the roster match on name across id prefixes", () => {
  // the committed file mints "feed:", a direct fetch mints "espn:" —
  // comparing those raw made one game look like two
  const a = g({home:{id:"feed:MLB:PIT", name:"Pittsburgh Pirates"}, away:{id:"nyy", name:"New York Yankees"}});
  const b = g({home:{id:"espn:MLB:23",  name:"Pittsburgh Pirates"}, away:{id:"nyy", name:"New York Yankees"}});
  assert.equal(sameGame(a, b), true);
});

test("a roster id and a synthetic one for the same club are one club", () => {
  /* The case idKey alone could not answer, and the one that put a game
     in Recent results twice: a live read resolves Kansas City to the
     roster id `kcr`, while the committed file — which has no roster
     entry for a club nobody follows — mints `feed:MLB:KC`. Neither
     record is wrong; they are the same club described by two readers. */
  const live = g({away:{id:"kcr", name:"Royals", city:"Kansas City"}});
  const fed  = g({away:{id:"feed:MLB:KC", name:"Kansas City Royals", city:"Kansas City"}});
  assert.equal(sameGame(live, fed), true);
});

test("a club is matched on the name the other reader happened to use", () => {
  // the roster splits a club into a city and a name; the file writes it
  // whole, and either description has to find the other
  const split = g({home:{id:"feed:MLB:TOR", name:"Blue Jays", city:"Toronto"}});
  const whole = g({home:{id:"feed:MLB:TOR2", name:"Toronto Blue Jays", city:""}});
  assert.equal(sameGame(split, whole), true);
});

test("loosening the club test did not loosen the game test", () => {
  // two clubs from one city, and the same clubs five hours apart
  const mets = g({away:{id:"feed:MLB:NYM", name:"New York Mets", city:"New York"}});
  assert.equal(sameGame(g(), mets), false);
  assert.equal(sameGame(g(), g({start: T + 5*3600000})), false);
});

test("name normalisation ignores case, accents and punctuation", () => {
  assert.equal(normName("CF Montréal"), normName("cf montreal"));
});

/* --- source event ids take precedence over the composite key --- */

test("matching source ids are the same game even when the clock moved", () => {
  // a postponement: same id, start a day later
  const a = g({eid:"401600123"});
  const b = g({eid:"401600123", start: T + 24*3600000});
  assert.equal(sameGame(a, b), true);
});

test("different source ids are different games however close together", () => {
  const a = g({eid:"401600123"});
  const b = g({eid:"401600124", start: T + 60000});
  assert.equal(sameGame(a, b), false);
});

test("a doubleheader with distinct ids stays two games", () => {
  assert.equal(sameGame(g({eid:"1"}), g({eid:"2", start: T + 3*3600000})), false);
});

test("the composite key still applies when only one copy has an id", () => {
  assert.equal(sameGame(g({eid:"401600123"}), g({start: T + 5*60000})), true);
  assert.equal(sameGame(g({eid:"401600123"}), g({start: T + 5*3600000})), false);
});

test("an id never overrides a competition mismatch", () => {
  assert.equal(sameGame(g({eid:"1"}), g({eid:"1", comp:"NHL"})), false);
});

