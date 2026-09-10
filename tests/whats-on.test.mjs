import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage } from "./helpers/page.mjs";

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");

test("the What's on strip contains no scores or carriers", () => {
  const at = SRC.indexOf("function railCard");
  const body = SRC.slice(at, SRC.indexOf("function renderRugbyPicker", at));
  assert.doesNotMatch(body, /scoreFor|resolveRights|dot-live|rail-meta|rail-row/);
  assert.match(body, /railStateLabel/);
  assert.match(body, /data-rail-game/);
});

test("finished games remain in What's on and are sorted instead of filtered", () => {
  const at = SRC.indexOf("function renderRail");
  const body = SRC.slice(at, SRC.indexOf("function railCard", at));
  assert.doesNotMatch(body, /!railFinished\(g, now\)/);
  assert.doesNotMatch(body, /4\*3600000/,
    "a completed personal event stays for the whole local day");
  assert.match(body, /railCompare/);
});

test("the rail is personal but independent of the competition filter", () => {
  const at = SRC.indexOf("function renderRail");
  const body = SRC.slice(at, SRC.indexOf("function railCard", at));
  assert.match(body, /GAMES\.filter\(g=>isMine\(g\)/);
  assert.doesNotMatch(body, /today=myGames\(\)/);
});

test("a followed-race team qualifies without becoming a selected team", () => {
  const preamble = `
    const selected = new Set(["mine"]);
    const raceIncluded = new Set(["race"]);
    const rugbyOn = () => false;
    const tennisMine = () => false;
  `;
  const {followsTeam, inFollowedRace, isMine} = loadFromPage(
    ["followsTeam", "inFollowedRace", "isMine"], preamble);
  const game = {home:{id:"race"}, away:{id:"other"}};
  assert.equal(followsTeam(game.home), true);
  assert.equal(isMine(game), true);
  assert.equal(inFollowedRace(game), true);
});

test("live, upcoming, and final games are ordered into stable groups", () => {
  const preamble = `
    const TENNIS_SETTLED = {final:1, retired:1, walkover:1, canceled:1, postponed:1};
    const TENNIS_STATE = {final:{text:"Final"},unknown:{text:"Status unavailable"}};
    const stateOf = g => ({status:g.testState});
    const timeState = () => ({state:"set"});
    const fmtTime = ms => String(ms);
  `;
  const {railFinished, railState, railTime, railCompare, railStateLabel} = loadFromPage(
    ["railFinished", "railState", "railTime", "railCompare", "railStateLabel"], preamble);
  const games = [
    {id:"old-final", start:100, testState:"final"},
    {id:"later", start:500, testState:"scheduled"},
    {id:"live", start:300, testState:"live"},
    {id:"new-final", start:200, testState:"final"},
    {id:"sooner", start:400, testState:"scheduled"}
  ];
  games.sort((a,b)=>railCompare(a,b,350));
  assert.deepEqual(games.map(g=>g.id), ["live", "sooner", "later", "new-final", "old-final"]);
  assert.equal(railStateLabel(games[0],350), "Live");
  assert.equal(railStateLabel(games.at(-1),350), "Final");
  assert.equal(railFinished(games.at(-1),350), true);
  assert.equal(railState(games[1],350), "upcoming");
  assert.equal(railTime(games[1],350), "400");
});

test("every full schedule row carries a focusable jump destination", () => {
  const renderers = ["eventRow", "rugbyRow", "tennisRow", "gameRow"];
  for(const name of renderers){
    const at = SRC.indexOf("function "+name);
    const end = SRC.indexOf("\nfunction ", at + 10);
    const body = SRC.slice(at, end < 0 ? undefined : end);
    assert.match(body, /data-game-id=/, name+" must expose its destination");
    assert.match(body, /tabindex="-1"/, name+" must accept shortcut focus");
  }
});

test("tapping a matchup switches to the list and highlights its row", () => {
  const at = SRC.indexOf('document.getElementById("rail").addEventListener');
  const body = SRC.slice(at, SRC.indexOf("/* The service cards", at));
  assert.match(body, /view!=="list"/);
  assert.match(body, /scrollIntoView/);
  assert.match(body, /rail-jump/);
  assert.match(body, /hiddenComps\.delete/,
    "a personal event hidden from the full schedule must be revealed before the jump");
});
