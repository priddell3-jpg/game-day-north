import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadFromPage } from "./helpers/page.mjs";
import { loadFromBuild } from "./helpers/build.mjs";
import {
  KNOWN_COMPS, KNOWN_ZONES, SOCCER_COMPS, GROUPS, allEntries, validateTeams, describeProblems,
  toTeamRows, toGhostRows, toRoster, toClubNames, toEspnName, toAliases, toExtra, toDefaults
} from "../scripts/lib/teams.mjs";

/* The manifest has to earn its way in.
 *
 * It replaces six lists that are currently maintained by hand in two
 * files, and the failure mode of getting that wrong is silent: a club
 * simply stops having fixtures. So before anything reads it, it has to
 * reproduce all six exactly — not equivalently, not nearly, exactly.
 *
 * Nothing in the app reads data/teams.json yet, and the last test in
 * this file is what holds that line. */

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("data/teams.json", root), "utf8"));
const frozen = JSON.parse(readFileSync(new URL("tests/fixtures/frozen-team-ids.json", root), "utf8"));

/* The six lists as they shipped, recorded the moment before the consumer
   migration deleted them.

   The equivalence proof has to outlive the thing it compares against.
   Once TEAM_ROWS is gone from the page there is nothing live to hold the
   manifest up to, and the proof would quietly become vacuous — so the
   originals are recorded and the manifest is held up to the record
   instead. That keeps the assertion doing the same work: the manifest
   must still reproduce, exactly, what the app shipped before it existed.

   This file is a record of what was true. It is never edited to make a
   test pass; a disagreement means the manifest drifted. */
const LEGACY = JSON.parse(readFileSync(new URL("tests/fixtures/legacy-team-lists.json", root), "utf8"));

const P = loadFromPage(["SOCCER", "COMPS", "ZONE_IANA"]);
const B = loadFromBuild(["idFor"]);

/* ============================ it is a valid file ============================ */

test("the committed manifest passes its own validator", () => {
  const problems = validateTeams(manifest);
  assert.equal(problems.length, 0, "\n" + describeProblems(problems));
});

test("the manifest holds today's roster and nothing more", () => {
  assert.equal(manifest.version, 1);
  assert.equal(manifest.teams.length, 50, "50 followable teams, exactly today's roster");
  assert.equal(manifest.teams.length, LEGACY.ROSTER.length);
  assert.equal(allEntries(manifest).length, 62,
    "50 followable, 1 event, 5 ghosts, 6 known only by name");
});

/* ============================ it reproduces all six ============================ */

test("it reproduces TEAM_ROWS, element for element", () => {
  assert.deepEqual(toTeamRows(manifest), LEGACY.TEAM_ROWS);
});

test("it reproduces GHOSTS", () => {
  assert.deepEqual(toGhostRows(manifest), LEGACY.GHOSTS);
});

test("it reproduces ROSTER", () => {
  assert.deepEqual(toRoster(manifest), LEGACY.ROSTER);
});

test("it reproduces CLUB_NAMES", () => {
  assert.deepEqual(toClubNames(manifest), LEGACY.CLUB_NAMES);
});

test("it reproduces ESPN_NAME", () => {
  /* The page's own soccer table decides which clubs belong in this map,
     rather than the manifest's copy of that knowledge, so the assertion
     is against the shipped rule and not against a restatement of it. */
  const isSoccer = c => !!P.SOCCER[c];
  assert.deepEqual(toEspnName(manifest, isSoccer), LEGACY.ESPN_NAME);
});

test("it reproduces ALIASES", () => {
  assert.deepEqual(toAliases(manifest), LEGACY.ALIASES);
});

test("it reproduces EXTRA, including the order within each league", () => {
  const rebuilt = toExtra(manifest);
  assert.deepEqual(rebuilt, LEGACY.EXTRA);
  for(const league of Object.keys(LEGACY.EXTRA))
    assert.deepEqual(rebuilt[league], LEGACY.EXTRA[league], league + " differs in order");
});

test("it reproduces DEFAULT_TEAMS, in order", () => {
  assert.deepEqual(toDefaults(manifest), LEGACY.DEFAULT_TEAMS);
});

/* ============================ names still resolve ============================ */

/* The build's matcher, rebuilt from the manifest instead of from ROSTER
   and ALIASES. The construction is copied from scripts/fetch-data.mjs on
   purpose: the point is to prove the manifest feeds it the same input,
   and importing the shipped one would prove nothing, since it closes
   over the very lists being replaced. */
function matcherFromManifest(m){
  const norm = x => (x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  const trimSuffix = n => n.replace(/\b(fc|cf|sc|afc)\b/gi, "").replace(/\s+/g, " ").trim();
  const map = new Map();
  for(const e of m.teams){
    for(const v of [e.feedName].concat(e.aliases || [])){
      if(!map.has(norm(v))) map.set(norm(v), e.id);
      const bare = norm(trimSuffix(v));
      if(bare && !map.has(bare)) map.set(bare, e.id);
    }
  }
  return name => {
    const n = norm(name);
    if(map.has(n)) return map.get(n);
    return map.get(norm(trimSuffix(name || ""))) || null;
  };
}

test("idFor answers identically for every name the app has seen", () => {
  const mine = matcherFromManifest(manifest);
  const corpus = new Set();
  /* Every name the manifest itself knows... */
  for(const e of allEntries(manifest)){
    corpus.add(e.feedName);
    (e.aliases || []).forEach(a => corpus.add(a));
    if(e.displayName) corpus.add(e.displayName);
    if(e.city && e.name) corpus.add(e.city + " " + e.name);
  }
  /* ...and every club name in the fixtures actually shipped today,
     which is the corpus that matters: these are the strings the feed
     really produced. */
  const data = JSON.parse(readFileSync(new URL("data.json", root), "utf8"));
  for(const f of data.fixtures || []){
    if(f.home && f.home.name) corpus.add(f.home.name);
    if(f.away && f.away.name) corpus.add(f.away.name);
  }
  assert.ok(corpus.size > 100, "expected a corpus worth the name, got " + corpus.size);

  const differed = [];
  for(const name of corpus) if(mine(name) !== B.idFor(name)) differed.push(name + ": manifest=" + mine(name) + " shipped=" + B.idFor(name));
  assert.deepEqual(differed, [], "names the manifest resolves differently");
});

test("a name nothing knows still resolves to nothing", () => {
  const mine = matcherFromManifest(manifest);
  for(const name of ["", "Not A Club", "Toronto", "FC"])
    assert.equal(mine(name), B.idFor(name), name);
});

/* ============================ the id ledger ============================ */

test("every frozen id is still in the manifest, still naming the same club", () => {
  const byId = new Map(GROUPS.flatMap(g => manifest[g].map(e => [e.id, { group: g, comp: e.comp, feedName: e.feedName }])));
  const drift = [];
  for(const [id, want] of Object.entries(frozen.ids)){
    const got = byId.get(id);
    if(!got){ drift.push(id + " has gone"); continue; }
    if(got.group !== want.group) drift.push(id + " moved from " + want.group + " to " + got.group);
    if(got.comp !== want.comp) drift.push(id + " changed competition: " + want.comp + " -> " + got.comp);
    if(got.feedName !== want.feedName) drift.push(id + " now names " + got.feedName + ", was " + want.feedName);
  }
  assert.deepEqual(drift, [], "an id that moves breaks saved boards and share links");
});

test("the ledger is complete, so a new id cannot arrive unrecorded", () => {
  const unledgered = allEntries(manifest).map(e => e.id).filter(id => !(id in frozen.ids));
  assert.deepEqual(unledgered, [], "add these to tests/fixtures/frozen-team-ids.json deliberately");
  assert.equal(frozen.count, allEntries(manifest).length);
});

test("the five clubs the baked fixtures name keep their exact ids", () => {
  /* These appear in LIVE_FIXTURES, the hand-checked set the page falls
     back to when nothing can be fetched. Renaming one would break the
     fallback silently. */
  for(const id of ["kcr", "ips", "bou", "nfo", "ful"]){
    assert.equal(frozen.ids[id].group, "ghosts", id);
    assert.ok(manifest.ghosts.some(g => g.id === id), id + " is missing from the manifest");
  }
});

test("the ids a share link carries are the followable ones", () => {
  const followable = manifest.teams.map(e => e.id);
  for(const id of followable) assert.equal(frozen.ids[id].group, "teams", id);
  for(const id of LEGACY.DEFAULT_TEAMS) assert.ok(followable.includes(id), id + " ships as a default but is not followable");
});

/* ============================ no second source of truth ============================ */

test("the validator's tables match the page's own", () => {
  /* The validator carries its own copy so it can run without the page.
     Asserting them equal turns that duplication into a drift check
     rather than a second source of truth. */
  assert.deepEqual(KNOWN_COMPS, Object.keys(P.COMPS).filter(c => !P.COMPS[c].rugby));
  assert.deepEqual(KNOWN_ZONES, Object.keys(P.ZONE_IANA));
  assert.deepEqual(SOCCER_COMPS, Object.keys(P.SOCCER));
});

test("the page carries the manifest inline, and asks for nothing at run time", () => {
  /* This test used to assert the opposite — that nothing read the
     manifest — because #18 deliberately shipped it with no consumers.
     That was its whole purpose and this change is the migration it was
     waiting for, so the assertion inverts rather than disappears.

     What it protects now is the property that made inlining the right
     answer: the page is one self-contained file and fetches no team data
     of its own. */
  const built = readFileSync(new URL("index.html", root), "utf8");
  const inlined = /const TEAM_MANIFEST = (\{[\s\S]*?\});/.exec(built);
  assert.ok(inlined, "the built page must carry the manifest");
  const carried = JSON.parse(inlined[1]);
  assert.equal(carried.teams.length, manifest.teams.length);
  assert.deepEqual(carried, manifest, "and it must be the committed manifest, unaltered");
  assert.ok(!/fetch\([^)]*teams\.json/.test(built), "and never fetch it");

  /* The test helper performs the same substitution, so what these tests
     evaluate is what ships rather than the empty placeholder. */
  const src = readFileSync(new URL("src/page.html", root), "utf8");
  assert.match(src, /\/\*__TEAMS_MANIFEST__\*\//, "the placeholder marker must survive");
});

/* ============================ the generator cannot clobber ============================ */

test("the generator refuses to overwrite a manifest that already exists", () => {
  /* Re-running the generator over a live file would silently discard
     every edit made since — a club that moved, a name the feed changed,
     an id minted by hand — and would do it from six lists that are
     themselves on their way out. The manifest is the artefact; the
     script is only how it first came to exist. */
  const before = readFileSync(new URL("data/teams.json", root), "utf8");
  const run = spawnSync(process.execPath, ["scripts/generate-teams.mjs", "--write"],
    { cwd: fileURLToPath(root), encoding: "utf8" });
  assert.equal(run.status, 1, "writing over an existing manifest must fail");
  assert.match(run.stderr, /will not overwrite it/);
  assert.match(run.stderr, /The manifest is the artefact/, "and it must say what to do instead");
  assert.match(run.stderr, /--write --force/, "including the way out for someone who means it");
  assert.equal(readFileSync(new URL("data/teams.json", root), "utf8"), before,
    "and the file must be untouched");
});

test("a dry run says what it would do and changes nothing", () => {
  const before = readFileSync(new URL("data/teams.json", root), "utf8");
  const run = spawnSync(process.execPath, ["scripts/generate-teams.mjs"],
    { cwd: fileURLToPath(root), encoding: "utf8" });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /dry run/);
  assert.equal(readFileSync(new URL("data/teams.json", root), "utf8"), before);
});
