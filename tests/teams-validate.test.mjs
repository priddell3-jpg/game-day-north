import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateTeams, describeProblems } from "../scripts/lib/teams.mjs";

/* The validator is only worth having if it fails on the things that
   would actually hurt. Each case below breaks the committed manifest in
   one specific way and asserts the right complaint comes back — and,
   just as importantly, that a valid file complains about nothing.

   Every case starts from the real file rather than a hand-made object,
   so a change to the manifest's shape cannot leave these passing
   against a fiction. */

const real = JSON.parse(readFileSync(new URL("../data/teams.json", import.meta.url), "utf8"));
const clone = () => JSON.parse(JSON.stringify(real));
const kinds = m => validateTeams(m).map(p => p.kind);
const problemFor = (m, id) => validateTeams(m).filter(p => p.id === id);

test("the real manifest raises nothing", () => {
  const problems = validateTeams(real);
  assert.equal(problems.length, 0, "\n" + describeProblems(problems));
});

test("a duplicate id is caught, wherever the two entries live", () => {
  const m = clone();
  m.teams[3].id = m.teams[0].id;
  assert.ok(kinds(m).includes("duplicate-id"));

  /* Across groups too: an id reused for a ghost is the same bug. */
  const n = clone();
  n.ghosts[0].id = n.teams[0].id;
  assert.ok(kinds(n).includes("duplicate-id"), "a team and a ghost cannot share an id");
});

test("an unknown competition is caught, in comp and in extraComps", () => {
  const m = clone();
  m.teams[0].comp = "NRL";
  assert.ok(kinds(m).includes("unknown-comp"));

  const n = clone();
  n.teams.find(t => t.extraComps).extraComps.push("NRL");
  assert.ok(kinds(n).includes("unknown-comp"), "a competition a club cannot enter is still unknown");

  /* A rugby competition is a real competition but not one a club in this
     manifest belongs to, so it must still be rejected. */
  const r = clone();
  r.teams[0].comp = "RU6N";
  assert.ok(kinds(r).includes("unknown-comp"));
});

test("an unknown timezone is caught", () => {
  const m = clone();
  m.teams[0].tz = "EST";
  assert.ok(kinds(m).includes("unknown-zone"), "EST is not one of the zones the page can read");
  const n = clone();
  delete n.teams[0].tz;
  assert.ok(kinds(n).includes("unknown-zone"));
});

test("a missing feed name is caught", () => {
  const m = clone();
  delete m.teams[0].feedName;
  assert.ok(kinds(m).includes("missing-feedname"),
    "a club with no feed name matches no fixture and simply never plays");
  const n = clone();
  n.teams[0].feedName = "";
  assert.ok(kinds(n).includes("missing-feedname"));
});

test("an alias that collides with another club is caught", () => {
  /* The bug this whole manifest exists to prevent: two clubs answering
     to one name attaches one club's fixtures to the other. */
  const m = clone();
  const other = m.teams.find(t => t.id !== m.teams[0].id && t.comp === m.teams[0].comp);
  m.teams[0].aliases = [other.feedName];
  /* Reported against whichever entry is reached second, naming the
     first: the validator cannot know which of the two is the mistake,
     so it names both and leaves that judgement to a person. */
  const collisions = validateTeams(m).filter(p => p.kind === "name-collision");
  assert.equal(collisions.length, 1, "alias colliding with another club's name");
  const both = collisions[0].id + " " + collisions[0].detail;
  assert.ok(both.includes(m.teams[0].id) && both.includes(other.id),
    "the complaint must name both clubs, got: " + both);

  /* And alias against alias, which is the same namespace. */
  const n = clone();
  const withAlias = n.teams.find(t => t.aliases && t.aliases.length);
  const victim = n.teams.find(t => t.id !== withAlias.id);
  victim.aliases = [withAlias.aliases[0]];
  assert.ok(kinds(n).includes("name-collision"));

  /* Collision is on the normalised form, not the literal string. */
  const c = clone();
  c.teams[0].aliases = [other.feedName.toUpperCase() + "!"];
  assert.ok(kinds(c).includes("name-collision"), "punctuation and case do not make a different name");
});

test("a default that names no club is caught", () => {
  const m = clone();
  m.defaults.push("no-such-club");
  const found = problemFor(m, "no-such-club");
  assert.ok(found.some(p => p.kind === "missing-default"));
});

test("two clubs pointing at one ESPN id in the same competition is caught", () => {
  const m = clone();
  const [a, b] = m.teams.filter(t => t.comp === "NHL").slice(0, 2);
  b.espn = a.espn;
  const found = problemFor(m, b.id);
  assert.ok(found.some(p => p.kind === "duplicate-espn"),
    "one of the two would never see a fixture");

  /* The same number in two different competitions is fine: the id
     namespaces are not shared between leagues. */
  const n = clone();
  const nhl = n.teams.find(t => t.comp === "NHL");
  const nba = n.teams.find(t => t.comp === "NBA");
  nba.espn = nhl.espn;
  assert.ok(!kinds(n).includes("duplicate-espn"), "different leagues, different namespaces");
});

test("a club known only by name needs no zone or colour", () => {
  const m = clone();
  assert.ok(m.feedOnly.length > 0);
  for(const e of m.feedOnly){
    assert.ok(!e.tz, e.id + " should carry no zone");
    assert.ok(!e.color, e.id + " should carry no colour");
  }
  assert.equal(validateTeams(m).length, 0, "and that is not a problem");
});

test("a structurally broken file fails before it can be misread", () => {
  assert.ok(kinds({ version: 2, teams: [], events: [], ghosts: [], feedOnly: [], defaults: [] }).includes("version"));
  assert.ok(kinds({ version: 1, teams: [], events: [], ghosts: [], defaults: [] }).includes("group"),
    "a missing group is not an empty one");
  assert.ok(validateTeams(null)[0].kind === "unreadable");
  assert.ok(validateTeams("nope")[0].kind === "unreadable");

  /* A broken shape stops there rather than reporting a cascade of
     consequences from the first fault. */
  const shallow = validateTeams({ version: 1, teams: "not an array", events: [], ghosts: [], feedOnly: [], defaults: [] });
  assert.deepEqual([...new Set(shallow.map(p => p.kind))], ["group"]);
});

test("every problem names the entry it is about", () => {
  const m = clone();
  m.teams[0].tz = "EST";
  m.teams[1].comp = "NRL";
  for(const p of validateTeams(m)){
    assert.ok(p.kind, "a problem with no kind");
    assert.ok("id" in p, "a problem that does not say what it is about");
  }
  assert.match(describeProblems(validateTeams(m)), /unknown-zone \[.+\]/);
});
