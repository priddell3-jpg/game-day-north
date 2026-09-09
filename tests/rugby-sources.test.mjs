import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromEspnEvent, fromWrMatch, nationOf, isPlaceholderSide,
         compForWrLabel, RUGBY_COMPS } from "../scripts/lib/rugby.mjs";

/* Every payload below is a trimmed copy of a real response, captured on
   2026-08-25 and named in each file's _note. The one exception is
   rugby-espn-states.json, which says so in its own note.

   The question these answer is the one the product turns on: what counts
   as a men's senior international. Neither feed carries a flag for it —
   a British and Irish Lions tour and a New Zealand tour of South Africa
   both file provincial warm-ups beside the Tests, under the same
   competition, with nothing to tell them apart. */

const load = n => JSON.parse(readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8"));
const espnAll = (file, comp) => {
  const rejects = new Set();
  const kept = (load(file).events || []).map(e => fromEspnEvent(e, comp, rejects)).filter(Boolean);
  return { kept, rejects, total: (load(file).events || []).length };
};
const pair = f => f.home.name + " v " + f.away.name;

/* ---------------- every ESPN competition adapter ---------------- */

test("Six Nations: a real fixture is parsed whole", () => {
  const { kept } = espnAll("rugby-espn-six-nations.json", "RU6N");
  assert.equal(kept.length, 1);
  const f = kept[0];
  assert.equal(pair(f), "Ireland v Scotland");
  assert.equal(f.ids[0], "espn:602514");
  assert.equal(f.comp, "RU6N");
  assert.equal(f.start, Date.parse("2026-03-14T14:10Z"));
  assert.equal(f.status, "final");
  assert.deepEqual(f.score, [43, 21]);
  assert.equal(f.venue.name, "Aviva Stadium");
});

test("Nations Championship: finals and scheduled fixtures both parse", () => {
  const { kept, total } = espnAll("rugby-espn-nations-championship.json", "RUNC");
  assert.equal(kept.length, total);
  assert.equal(kept.filter(f => f.status === "final").length, 1);
  assert.equal(kept.filter(f => f.status === "scheduled").length, 2);
  // a scheduled fixture reads 0-0 in this feed; that is not a score
  kept.filter(f => f.status === "scheduled").forEach(f => assert.equal(f.score, null));
});

test("The Rugby Championship adapter parses its 2025 season", () => {
  const { kept, total } = espnAll("rugby-espn-rugby-championship.json", "RUTRC");
  assert.equal(kept.length, total);
  assert.ok(kept.every(f => f.comp === "RUTRC"));
  assert.ok(kept.some(f => pair(f) === "South Africa v Australia"));
});

test("Rugby World Cup adapter parses", () => {
  const { kept, total } = espnAll("rugby-espn-rugby-world-cup.json", "RURWC");
  assert.equal(kept.length, total);
  assert.ok(kept.every(f => f.comp === "RURWC" && f.status === "scheduled"));
});

test("International Test Match adapter parses tier-two tests", () => {
  const { kept } = espnAll("rugby-espn-test-match.json", "RUTEST");
  assert.ok(kept.some(f => pair(f) === "Japan v Canada"));
  assert.ok(kept.some(f => pair(f) === "Belgium v Hong Kong"));
});

/* ---------------- the tour problem ---------------- */

test("a Lions tour yields only the Tests, not the tour", () => {
  const { kept, total, rejects } = espnAll("rugby-espn-lions-tour.json", "RULIONS");
  assert.equal(total, 10, "the captured tour has ten fixtures");
  assert.equal(kept.length, 4, "four of them are Tests");
  assert.deepEqual(kept.map(pair).sort(), [
    "Australia v British and Irish Lions",
    "Australia v British and Irish Lions",
    "Australia v British and Irish Lions",
    "British and Irish Lions v Argentina"
  ].sort());
  // Super Rugby clubs and invitational XVs are expected here, so they
  // are dropped silently rather than reported as a data problem
  assert.deepEqual([...rejects], []);
});

test("the South African franchise called Lions is not the touring side", () => {
  // The Johannesburg Lions play New Zealand three days after the Test in
  // the same World Rugby competition. Matching on the word would file a
  // provincial warm-up as a Lions Test.
  assert.equal(nationOf("Lions"), null);
  assert.equal(nationOf("British and Irish Lions").slug, "british-and-irish-lions");
  const wr = load("rugby-worldrugby-matches.json").content;
  const rivalry = wr.filter(m => /Greatest Rivalry/.test(m.competition));
  const kept = rivalry.map(m => fromWrMatch(m)).filter(Boolean);
  assert.ok(rivalry.length > kept.length, "the tour carries more than its Tests");
  assert.ok(kept.every(f => pair(f) === "South Africa v New Zealand"));
});

test("an uncapped XV is not its nation", () => {
  // No suffix-trimming rule may ever be applied to a rugby name, or
  // "Argentina XV" becomes Argentina.
  for(const n of ["Argentina XV", "Australia XV", "England XV", "France A", "Japan XV"]){
    assert.equal(nationOf(n), null, n + " must not resolve to a nation");
  }
  const wr = load("rugby-worldrugby-matches.json").content;
  const xv = wr.find(m => /XV/.test(m.teams.map(t => t.name).join(" ")));
  assert.ok(xv, "the fixture file carries an uncapped XV");
  assert.equal(fromWrMatch(xv), null);
});

/* ---------------- what must never appear ---------------- */

test("women's, sevens, age-grade, club and domestic fixtures are all excluded", () => {
  const wr = load("rugby-worldrugby-matches.json").content;
  const rejects = new Set();
  const kept = wr.map(m => fromWrMatch(m, rejects)).filter(Boolean);
  const keptIds = new Set(kept.map(f => f.ids[0]));

  /* Club and domestic competitions are named rather than pattern-matched:
     "Asia Rugby Championship" and "Rugby Americas North Championship" are
     senior men's international competitions whose names contain the same
     words as club leagues, and a loose pattern drops real tests. */
  const CLUB = /English Premiership|Super Rugby|Bunnings Warehouse NPC|Currie Cup|URC|Top 14|Pro D2|Japan League One|Major League Rugby|Heartland|English Championship/;
  const mustDrop = wr.filter(m =>
       m.sport !== "MRU"                                   // women, sevens, age-grade
    || CLUB.test(m.competition));
  assert.ok(mustDrop.length >= 8, "the fixture file carries enough to exclude");
  for(const m of mustDrop){
    assert.equal(keptIds.has("wr:" + m.matchId), false,
      m.sport + " / " + m.competition + " must not survive");
  }
  // and none of them raised a warning: they are expected, not a fault
  assert.deepEqual([...rejects], []);
});

test("the sport code alone separates men's from women's and U20 Six Nations", () => {
  const wr = load("rugby-worldrugby-matches.json").content;
  const six = wr.filter(m => /Six Nations/.test(m.competition));
  assert.ok(six.some(m => m.sport === "MRU"));
  assert.ok(six.some(m => m.sport === "WRU"));
  assert.ok(wr.some(m => m.sport === "JMU"));
  const kept = six.map(m => fromWrMatch(m)).filter(Boolean);
  assert.ok(kept.length > 0);
  assert.ok(kept.every(f => f.comp === "RU6N"));
});

test("men's senior internationals from World Rugby are accepted", () => {
  const wr = load("rugby-worldrugby-matches.json").content;
  const kept = wr.map(m => fromWrMatch(m)).filter(Boolean);
  const comps = new Set(kept.map(f => f.comp));
  assert.ok(comps.has("RU6N"));
  assert.ok(comps.has("RUPNC"), "the Pacific Nations Cup exists only in this feed");
  assert.ok(comps.has("RUWNC"), "the World Rugby Nations Cup exists only in this feed");
  assert.ok(comps.has("RUNC"));
  assert.ok(kept.some(f => pair(f) === "Fiji v Canada"));
});

/* ---------------- competitions ---------------- */

test("a club or women's competition maps to no competition at all", () => {
  assert.equal(compForWrLabel("English Premiership 2027"), null);
  assert.equal(compForWrLabel("Super Rugby 2026"), null);
  assert.equal(compForWrLabel("Bunnings Warehouse NPC 2026"), null);
  assert.equal(compForWrLabel("Women's Six Nations 2026"), null);
  assert.equal(compForWrLabel("U20 Six Nations 2026"), null);
});

test("supported competitions map to the ids the page renders", () => {
  assert.equal(compForWrLabel("Six Nations 2026"), "RU6N");
  assert.equal(compForWrLabel("Nations Championship 2026"), "RUNC");
  assert.equal(compForWrLabel("World Rugby Nations Cup 2026"), "RUWNC");
  assert.equal(compForWrLabel("Pacific Nations Cup 2026"), "RUPNC");
  assert.equal(compForWrLabel("The Rugby Championship 2026"), "RUTRC");
  assert.equal(compForWrLabel("Rugby World Cup 2027"), "RURWC");
  assert.equal(compForWrLabel("Men's Internationals 2026"), "RUTEST");
  assert.equal(compForWrLabel("Bledisloe Cup 2026"), "RUTEST");
});

test("every competition the product claims has at least one route in", () => {
  for(const [id, c] of Object.entries(RUGBY_COMPS)){
    assert.ok(c.espn || c.wr, id + " must be reachable from some source");
  }
});

/* ---------------- placeholders ---------------- */

test("a placeholder opponent is kept as a dated fixture, not dropped", () => {
  const wr = load("rugby-worldrugby-matches.json").content;
  const final = wr.find(m => /Winner M1/.test(m.teams.map(t => t.name).join(" ")));
  assert.ok(final);
  const f = fromWrMatch(final);
  assert.ok(f, "a final with an undecided opponent is still a real fixture");
  assert.equal(f.home.tbd, true);
  assert.equal(f.home.slug, null);
  assert.equal(f.home.name, "Winner M1");
  assert.equal(f.round, "Final");
});

test("positional placeholders are recognised and clubs are not", () => {
  for(const p of ["NTH 1st", "STH 6th", "Winner M1", "Loser M2", "TBC", "Runner-up"]){
    assert.equal(isPlaceholderSide(p), true, p);
  }
  for(const n of ["Ireland", "Stormers", "Brumbies", "Argentina XV"]){
    assert.equal(isPlaceholderSide(n), false, n);
  }
});

/* ---------------- independence ---------------- */

test("one source failing leaves the other's fixtures intact", () => {
  // The shape of the guarantee: the adapters share no state, so feeding
  // one garbage cannot alter what the other returns.
  const wr = load("rugby-worldrugby-matches.json").content;
  const before = wr.map(m => fromWrMatch(m)).filter(Boolean).length;
  for(const junk of [null, undefined, {}, {sport:"MRU"}, {sport:"MRU", teams:[]},
                     {sport:"MRU", competition:"Six Nations 2026", teams:[{name:"Ireland"},{name:"Wales"}]}]){
    assert.doesNotThrow(() => fromEspnEvent(junk, "RU6N"));
    assert.doesNotThrow(() => fromWrMatch(junk));
  }
  assert.equal(wr.map(m => fromWrMatch(m)).filter(Boolean).length, before);
});

test("a malformed event yields nothing rather than a half-built fixture", () => {
  const good = load("rugby-espn-six-nations.json").events[0];
  const noDate = JSON.parse(JSON.stringify(good)); noDate.date = null;
  noDate.competitions[0].date = null;
  assert.equal(fromEspnEvent(noDate, "RU6N"), null);
  const noId = JSON.parse(JSON.stringify(good)); noId.id = null;
  noId.competitions[0].id = null;
  assert.equal(fromEspnEvent(noId, "RU6N"), null);
});

test("an unrecognised nation is reported rather than silently dropped", () => {
  // This is how a feed renaming a country gets noticed. A club is
  // expected and stays quiet; something unknown must not.
  const rejects = new Set();
  fromWrMatch({sport:"MRU", competition:"Six Nations 2026", matchId:"x",
    time:{millis:Date.parse("2026-02-05T20:10Z")},
    teams:[{name:"Ireland"}, {name:"Republic of Rugbyland"}], scores:[0,0], status:"U"}, rejects);
  assert.deepEqual([...rejects], ["Republic of Rugbyland"]);
});
