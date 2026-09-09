import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFromPage } from "./helpers/page.mjs";

/* The two things a reader can see go wrong when the leader is stale: the
   lead is pinned to a stage it was never read after, and a completed
   stage is not recognised as finished for the rail's ordering. Both are
   rendering decisions, so they are asserted against the declarations
   the page actually ships. */

const PRE = `
  const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const fmtTime = ms => new Date(ms).toISOString().slice(11,16);
  const normName = x => String(x||"").toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"");
  const localKey = ms => new Date(ms).toISOString().slice(0,10);
  const GAMES = globalThis.__GAMES;
`;

globalThis.__GAMES = [];
const GAMES = globalThis.__GAMES;
const setGames = list => { GAMES.length = 0; list.forEach(g=>GAMES.push(g)); };

const { attachCycling, stageNumber, leadNote, railFinished, railTime, matchupLabel } =
  loadFromPage(["stageNumber", "leadNote", "railFinished", "railTime", "matchupLabel", "attachCycling"], PRE);

const HOUR = 3600000;
const day = n => Date.parse("2026-08-2" + n + "T12:00:00Z");

function vueltaGames(){
  return [9, 10].map((d, i) => ({
    event: true, race: "Vuelta a España", stage: "Stage " + (i + 8),
    start: day(d - 1), id: "s" + (i + 8)
  }));
}

/* --- the lead is attached to the stage it was read after --- */

test("stageNumber reads the number out of a stage label", () => {
  assert.equal(stageNumber({stage: "Stage 10"}), 10);
  assert.equal(stageNumber({stage: "Stage 18 (ITT)"}), 18);
  assert.equal(stageNumber({stage: "One-day race"}), null);
  assert.equal(stageNumber({}), null);
});

test("the lead lands on leaderStage, not on the latest stage that has run", () => {
  setGames(vueltaGames());
  attachCycling([{race:"Vuelta a España", leader:"Enric Mas", leaderStage:8, stages:[]}]);
  const s8 = GAMES.find(g=>g.stage === "Stage 8");
  const s9 = GAMES.find(g=>g.stage === "Stage 9");
  assert.equal(s8.leader, "Enric Mas", "the lead belongs to the stage it was read after");
  assert.equal(s9.leader, undefined, "a later stage has no standings yet and must not borrow them");
});

test("a leader with no leaderStage is attached to no stage at all", () => {
  setGames(vueltaGames());
  attachCycling([{race:"Vuelta a España", leader:"Tadej Pogačar", leaderStage:null, stages:[]}]);
  assert.ok(GAMES.every(g=>g.leader === undefined),
    "an undated leader was still pinned to a stage");
});

test("a stage the race never listed cannot receive the lead", () => {
  setGames(vueltaGames());
  attachCycling([{race:"Vuelta a España", leader:"Enric Mas", leaderStage:21, stages:[]}]);
  assert.ok(GAMES.every(g=>g.leader === undefined));
});

test("leadNote names the stage the standings were read after", () => {
  const html = leadNote({leader: "Enric Mas", leaderStage: 10});
  assert.match(html, /Enric Mas/);
  assert.match(html, /leads after stage 10/);
});

test("a leader with no known stage is not rendered as a current fact", () => {
  assert.equal(leadNote({leader: "Tadej Pogačar", leaderStage: null}), "");
  assert.equal(leadNote({leader: "Tadej Pogačar"}), "");
  assert.equal(leadNote({leaderStage: 10}), "");
});

test("a leader's name is escaped like any other untrusted text", () => {
  assert.ok(!leadNote({leader: "<script>", leaderStage: 3}).includes("<script>"));
});

/* --- What's on keeps only the trustworthy cycling facts --- */

const stage = extra => Object.assign({event:true, timeKnown:true, start:day(9), finishUtc:day(9)+5*HOUR}, extra);

test("a stage with a published timetable keeps its quiet start time", () => {
  assert.match(railTime(stage(), day(9) - HOUR), /^\d\d:\d\d$/);
});

test("a stage without a trustworthy timetable gets no invented time", () => {
  assert.equal(railTime({event:true, start:day(9)}, day(9)), "");
});

test("a cycling item names both the race and stage", () => {
  assert.equal(matchupLabel({event:true, race:"Vuelta a España", stage:"Stage 10"}),
    "Vuelta a España · Stage 10");
});

test("a cycling stage remains before its expected finish", () => {
  assert.equal(railFinished(stage(), day(9) + 2*HOUR), false);
});

test("a cycling stage enters the finished rail group after its expected finish", () => {
  for(const t of [6, 8, 12]){
    assert.equal(railFinished(stage(), day(9) + t*HOUR), true);
  }
});
