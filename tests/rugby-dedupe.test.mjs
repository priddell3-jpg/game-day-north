import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromEspnEvent, fromWrMatch, dedupe, sameFixture, mergeFixture,
         preferComp, SAME_KICKOFF } from "../scripts/lib/rugby.mjs";

/* Two sources describe the same Test and agree on almost nothing that
   could be used as a key. ESPN mints "603247"; World Rugby mints a UUID.
   So an event id is authoritative only inside the source that issued it,
   and the rule is:

     · same namespace, same id      -> the same fixture
     · same namespace, different id -> NEVER the same fixture
     · no shared namespace          -> both nations, and kickoffs close

   The kickoff window is not decoration: South Africa play New Zealand
   three times in four weeks, so the nations alone would collapse a
   series into one match. */

const load = n => JSON.parse(readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8"));
const KO = Date.parse("2026-08-22T15:10Z");
const side = (slug, name) => ({slug, name, abbr:null, tbd:false});
const fx = o => Object.assign({
  ids:["espn:1"], sources:["espn"], comp:"RUTEST", start:KO, timeTBD:false,
  home:side("south-africa","South Africa"), away:side("new-zealand","New Zealand"),
  status:"scheduled", label:"", score:null, venue:null, round:""
}, o);

/* ---------------- ids first ---------------- */

test("the same id in the same namespace is the same fixture", () => {
  assert.equal(sameFixture(fx(), fx({start:KO + 30*60000})), true);
});

test("different ids in the SAME namespace never merge", () => {
  // Even with identical nations and identical kickoffs: the source said
  // these are two events, and it is the authority on that.
  const a = fx({ids:["espn:1"]}), b = fx({ids:["espn:2"]});
  assert.equal(sameFixture(a, b), false);
  assert.equal(dedupe([a, b]).length, 2);
});

test("different ids in the same namespace stay apart even after another source joins", () => {
  const a = fx({ids:["espn:1", "wr:aaa"], sources:["espn","wr"]});
  const b = fx({ids:["espn:2"]});
  assert.equal(sameFixture(a, b), false);
});

test("ids from different sources fall back to nations and kickoff", () => {
  const a = fx({ids:["espn:1"], sources:["espn"]});
  const b = fx({ids:["wr:abc"], sources:["wr"]});
  assert.equal(sameFixture(a, b), true);
  assert.equal(dedupe([a, b]).length, 1);
});

/* ---------------- the fallback ---------------- */

test("the same two nations a week apart are two matches", () => {
  const a = fx({ids:["espn:1"]});
  const b = fx({ids:["wr:abc"], sources:["wr"], start: KO + 7*86400000});
  assert.equal(sameFixture(a, b), false);
});

test("the kickoff window is bounded, and its edges hold", () => {
  const a = fx({ids:["espn:1"]});
  const near = fx({ids:["wr:abc"], sources:["wr"], start: KO + SAME_KICKOFF - 60000});
  const far  = fx({ids:["wr:abc"], sources:["wr"], start: KO + SAME_KICKOFF});
  assert.equal(sameFixture(a, near), true);
  assert.equal(sameFixture(a, far), false);
});

test("a reversed fixture is still the same match", () => {
  const a = fx({ids:["espn:1"]});
  const b = fx({ids:["wr:abc"], sources:["wr"],
    home:side("new-zealand","New Zealand"), away:side("south-africa","South Africa")});
  assert.equal(sameFixture(a, b), true);
});

test("a fixture with an undecided side cannot be matched by nations", () => {
  // "Winner M1" is not a nation and must never be folded into one.
  const a = fx({ids:["wr:a"], sources:["wr"], home:{slug:null, name:"Winner M1", tbd:true}});
  const b = fx({ids:["espn:9"], home:{slug:null, name:"Winner M2", tbd:true}});
  assert.equal(sameFixture(a, b), false);
});

/* ---------------- what survives a merge ---------------- */

test("a score turns round when the sources disagree about who is at home", () => {
  const a = fx({ids:["espn:1"]});                                    // SA v NZ
  const b = fx({ids:["wr:abc"], sources:["wr"], status:"final",
    home:side("new-zealand","New Zealand"), away:side("south-africa","South Africa"),
    score:[33, 16]});                                                 // NZ 33, SA 16
  const m = mergeFixture(a, b);
  assert.deepEqual(m.score, [16, 33], "printed against South Africa first, as the base lists them");
});

test("a score kept in the same orientation is not flipped", () => {
  const a = fx({ids:["espn:1"]});
  const b = fx({ids:["wr:abc"], sources:["wr"], status:"final", score:[16, 33]});
  assert.deepEqual(mergeFixture(a, b).score, [16, 33]);
});

test("the named competition beats the catch-all bucket", () => {
  // ESPN files Rugby Championship fixtures under International Test
  // Match; World Rugby names them. The name should win.
  assert.equal(preferComp("RUTEST", "RUNC"), "RUNC");
  assert.equal(preferComp("RUNC", "RUTEST"), "RUNC");
  assert.equal(preferComp("RUTEST", "RU6N"), "RU6N");
  const a = fx({ids:["espn:1"], comp:"RUTEST"});
  const b = fx({ids:["wr:abc"], sources:["wr"], comp:"RUNC"});
  assert.equal(mergeFixture(a, b).comp, "RUNC");
});

test("a stated status is never replaced by an unreadable one", () => {
  const a = fx({ids:["espn:1"], status:"live", label:"52'"});
  const b = fx({ids:["wr:abc"], sources:["wr"], status:"unknown"});
  assert.equal(mergeFixture(a, b).status, "live");
});

test("a final replaces a live report, not the other way round", () => {
  const live = fx({ids:["espn:1"], status:"live", score:[10, 7]});
  const done = fx({ids:["wr:abc"], sources:["wr"], status:"final", score:[10, 7], label:"FT"});
  assert.equal(mergeFixture(live, done).status, "final");
  assert.equal(mergeFixture(done, live).status, "final");
});

test("a kickoff the sources disagree about keeps both readings", () => {
  // ESPN and World Rugby differ by fifteen to sixty minutes on several
  // fixtures. The base copy's time is shown; discarding the other would
  // leave the disagreement unauditable.
  const a = fx({ids:["espn:1"], start: KO});
  const b = fx({ids:["wr:abc"], sources:["wr"], start: KO - 60*60000});
  const m = mergeFixture(a, b);
  assert.equal(m.start, KO, "the base reading is the one shown");
  assert.equal(m.altStart, KO - 60*60000);
  assert.equal(m.altSource, "wr");
});

test("agreement within a couple of minutes is not recorded as a dispute", () => {
  const a = fx({ids:["espn:1"], start: KO});
  const b = fx({ids:["wr:abc"], sources:["wr"], start: KO + 60000});
  assert.equal(mergeFixture(a, b).altStart, undefined);
});

test("both source ids survive a merge, so either can match it later", () => {
  const m = mergeFixture(fx({ids:["espn:1"]}), fx({ids:["wr:abc"], sources:["wr"]}));
  assert.deepEqual(m.ids.sort(), ["espn:1", "wr:abc"]);
  assert.deepEqual(m.sources.sort(), ["espn", "wr"]);
});

test("World Rugby's venue wins, because ESPN's country is unreliable", () => {
  // ESPN files the Perth Test as "Perth, Scotland" and the Jujuy Test as
  // "San Salvador, El Salvador" — address.state is a US field carrying a
  // country. World Rugby has both right and carries the UTC offset.
  const a = fx({ids:["espn:1"],
    venue:{name:"Optus Stadium", city:"Perth", country:"Scotland", offset:null, __src:"espn"}});
  const b = fx({ids:["wr:abc"], sources:["wr"],
    venue:{name:"", city:"Perth | Boorloo", country:"Australia", offset:8, __src:"wr"}});
  const m = mergeFixture(a, b);
  assert.equal(m.venue.country, "Australia");
  assert.equal(m.venue.offset, 8);
  assert.equal(m.venue.name, "Optus Stadium", "ESPN still fills what World Rugby leaves blank");
});

/* ---------------- against the real payloads ---------------- */

test("the two real feeds fold into one list without losing or doubling a fixture", () => {
  const espn = load("rugby-espn-nations-championship.json").events
    .map(e => fromEspnEvent(e, "RUNC")).filter(Boolean);
  const wr = load("rugby-worldrugby-matches.json").content
    .map(m => fromWrMatch(m)).filter(Boolean).filter(f => f.comp === "RUNC");
  assert.ok(espn.length && wr.length);
  const merged = dedupe(espn.concat(wr));
  // no fixture is lost
  const ids = new Set(merged.flatMap(f => f.ids));
  espn.concat(wr).forEach(f => assert.ok(ids.has(f.ids[0]), f.ids[0] + " must survive"));
  // and no two entries share an id
  const seen = new Set();
  merged.forEach(f => f.ids.forEach(i => {
    assert.equal(seen.has(i), false, i + " appears twice");
    seen.add(i);
  }));
});

test("a real cross-source Test merges to one row with both ids", () => {
  const espn = load("rugby-espn-test-match.json").events
    .map(e => fromEspnEvent(e, "RUTEST")).filter(Boolean)
    .filter(f => f.ids[0] === "espn:603247");
  const wr = load("rugby-worldrugby-matches.json").content
    .map(m => fromWrMatch(m)).filter(Boolean)
    .filter(f => f.status === "final" && f.home.slug === "south-africa"
      && f.away.slug === "new-zealand");
  assert.equal(espn.length, 1);
  assert.equal(wr.length, 1);
  const merged = dedupe(espn.concat(wr));
  assert.equal(merged.length, 1, "one Test, described twice");
  assert.equal(merged[0].sources.length, 2);
  assert.deepEqual(merged[0].score, [16, 33]);
});

test("dedupe is stable and sorted by kickoff", () => {
  const out = dedupe([
    fx({ids:["espn:3"], start: KO + 2*86400000}),
    fx({ids:["espn:1"], start: KO}),
    fx({ids:["espn:2"], start: KO + 86400000})
  ]);
  assert.deepEqual(out.map(f => f.ids[0]), ["espn:1", "espn:2", "espn:3"]);
});

test("dedupe survives nulls in the list", () => {
  assert.equal(dedupe([null, fx(), undefined]).length, 1);
  assert.deepEqual(dedupe([]), []);
});
