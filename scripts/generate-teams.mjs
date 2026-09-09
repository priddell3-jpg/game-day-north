#!/usr/bin/env node
/**
 * Generates data/teams.json from the six lists that used to hold team
 * data in two files, as recorded in tests/fixtures/legacy-team-lists.json.
 *
 * This is a one-shot, committed on purpose. The manifest it produces is
 * the artefact; this script is the provenance, so anyone can see exactly
 * how today's data became the file rather than having to trust it.
 *
 * It reproduces the manifest as it FIRST existed, fifty clubs. The
 * roster has grown since, so its output no longer matches the committed
 * file and is not meant to — this is provenance, not a build step.
 *
 * It is NOT a codegen step to be re-run. Ids in particular are data, not
 * a derivation: `den` is the Nuggets and `buf` is the Bills because that
 * is what people's saved boards and share links already say, and a rule
 * that recomputed them would eventually disagree with history and empty
 * somebody's board. tests/fixtures/frozen-team-ids.json is the ledger,
 * and the tests fail on any drift from it.
 *
 * Run:  node scripts/generate-teams.mjs [--write] [--force]
 * Without --write it prints what it would produce and changes nothing,
 * and it refuses to overwrite an existing manifest without --force.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

/* The six lists as they shipped, recorded before the migration deleted
   them. This script used to read them live out of the page and the build
   script; it reads the record now, for the plain reason that they are
   gone. That keeps it doing the one job it has — showing exactly how
   today's data became the manifest — for as long as anyone wants to
   check, rather than rotting into a script that cannot run. */
const LEGACY = JSON.parse(readFileSync(
  new URL("../tests/fixtures/legacy-team-lists.json", import.meta.url), "utf8"));
const P = { TEAM_ROWS: LEGACY.TEAM_ROWS, GHOSTS: LEGACY.GHOSTS, CLUB_NAMES: LEGACY.CLUB_NAMES,
            ESPN_NAME: LEGACY.ESPN_NAME, DEFAULT_TEAMS: LEGACY.DEFAULT_TEAMS };
const B = { ROSTER: LEGACY.ROSTER, ALIASES: LEGACY.ALIASES, EXTRA: LEGACY.EXTRA };

const rosterName = new Map(B.ROSTER.map(([id, , name]) => [id, name]));
const rowOf = new Map(P.TEAM_ROWS.map(r => [r[0], r]));

/* ESPN team ids, read from the live /teams endpoint per league and saved
   beside this script. Matching is by the feed's own name, and a club
   that does not match simply carries no id: a wrong id would attach a
   club to another club's fixtures, which is worse than having none. */
let ESPN_IDS = {};
try{
  ESPN_IDS = JSON.parse(readFileSync(new URL("./espn-team-ids.json", import.meta.url), "utf8"));
}catch(e){
  console.warn("  ! no scripts/espn-team-ids.json — the manifest will carry no espn ids");
}

/* The competitions a club enters beyond its own league.

   Two shapes have to fall out of this one field. The page gives every
   Premier League club the two domestic cups and adds the Champions
   League only to the clubs flagged for it; the build takes the union
   over a league to decide which competitions to fetch at all. Declaring
   it per club satisfies both, and the order is fixed so the union
   reproduces EXTRA's order exactly. */
function extraCompsFor(row){
  const comp = row[1], inUcl = !!row[7];
  const out = [];
  if(comp === "EPL"){ out.push("EFL", "FAC"); }
  if(inUcl) out.push("UCL");
  return out;
}

/* What the page calls a club, where that differs from the plain
   derivation of city plus name. This is CLUB_NAMES, and it stays a list
   of exceptions rather than 50 redundant strings. */
const displayOverride = id => P.CLUB_NAMES[id];

const entry = (row, extra = {}) => {
  const [id, comp, city, name, abbr, tz, color] = row;
  const o = { id, comp };
  const espn = ESPN_IDS[id];
  if(espn) o.espn = String(espn);
  if(city) o.city = city;
  o.name = name;
  o.abbr = abbr;
  o.tz = tz;
  o.color = color;
  /* Carried explicitly rather than derived. It equals city plus name for
     31 of the 32 North American clubs and differs for the thirty-second:
     the roster writes "Montreal Canadiens" where the page writes
     "Montréal", and the feed uses the unaccented spelling. A derivation
     would have to know that, so it is simply stated. */
  const feed = rosterName.get(id) || P.ESPN_NAME[id] || (city ? city + " " + name : name);
  o.feedName = feed;
  const aliases = B.ALIASES[id];
  if(aliases && aliases.length) o.aliases = aliases.slice();
  const display = displayOverride(id);
  if(display) o.displayName = display;
  const ex = extraCompsFor(row);
  if(ex.length) o.extraComps = ex;
  return Object.assign(o, extra);
};

/* ---- the four groups of club the app knows about --------------------

   teams     — followable. Exactly today's roster, 50 of them.
   events    — followable, but not a club: the men's WorldTour is a
               competition standing in the picker where a team would be.
   ghosts    — real clubs nobody can follow, referenced by the baked
               fallback fixtures. Their ids are load-bearing.
   feedOnly  — clubs known only by the name the feed uses, so a fixture
               against them resolves. No colours, no picker entry. */
const teams = B.ROSTER.map(([id]) => entry(rowOf.get(id)));
const events = P.TEAM_ROWS.filter(r => !rosterName.has(r[0])).map(r => entry(r));
const ghosts = P.GHOSTS.map(r => entry(r));
const feedOnlyIds = Object.keys(P.ESPN_NAME)
  .filter(id => !rosterName.has(id) && !P.GHOSTS.some(g => g[0] === id));
const feedOnly = feedOnlyIds.map(id => ({ id, comp: "EPL", feedName: P.ESPN_NAME[id] }));

const manifest = {
  version: 1,
  checked: new Date().toISOString().slice(0, 10),
  source: "Generated from TEAM_ROWS, ROSTER, CLUB_NAMES, ESPN_NAME, ALIASES, EXTRA and "
    + "DEFAULT_TEAMS by scripts/generate-teams.mjs. ESPN team ids read from the /teams "
    + "endpoint of each league.",
  /* Ordered, because DEFAULT_TEAMS is an ordered array and the order is
     what a first-time visitor's board looks like. A per-team boolean
     would lose it. */
  defaults: P.DEFAULT_TEAMS.slice(),
  teams, events, ghosts, feedOnly
};

const json = JSON.stringify(manifest, null, 1) + "\n";
const out = new URL("../data/teams.json", import.meta.url);
const write = process.argv.includes("--write");
const force = process.argv.includes("--force");
const withEspn = teams.filter(t => t.espn).length;

console.log("teams     " + String(teams.length).padStart(3));
console.log("events    " + String(events.length).padStart(3) + "   " + events.map(e => e.id).join(", "));
console.log("ghosts    " + String(ghosts.length).padStart(3) + "   " + ghosts.map(e => e.id).join(", "));
console.log("feedOnly  " + String(feedOnly.length).padStart(3) + "   " + feedOnly.map(e => e.id).join(", "));
console.log("defaults  " + String(manifest.defaults.length).padStart(3) + "   " + manifest.defaults.join(", "));
console.log("espn ids  " + withEspn + " of " + teams.length + " teams");
if(withEspn < teams.length){
  console.warn("  ! no espn id for: " + teams.filter(t => !t.espn).map(t => t.id).join(", "));
}
console.log((json.length / 1024).toFixed(1) + " KB");

/* The manifest is the artefact; this script is only how it first came to
   exist. Re-running it over a live file would throw away every edit made
   since — a club that has moved, a name the feed changed, an id minted
   by hand — and would do it silently, from six lists that are themselves
   on their way out.

   So an existing manifest is not overwritten by accident. --force says
   the loss is intended. */
if(write && existsSync(out) && !force){
  console.error("");
  console.error("data/teams.json already exists, and this script will not overwrite it.");
  console.error("");
  console.error("  The manifest is the artefact. Edit data/teams.json directly, then run");
  console.error("  scripts/validate-teams.mjs. Ids in particular are data rather than a");
  console.error("  derivation, and tests/fixtures/frozen-team-ids.json is the ledger they");
  console.error("  are checked against — regenerating cannot honour edits it never saw.");
  console.error("");
  console.error("  If replacing it really is what you want: --write --force");
  console.error("");
  process.exit(1);
}
if(write){
  writeFileSync(out, json);
  console.log(force && existsSync(out) ? "overwrote data/teams.json (--force)" : "wrote data/teams.json");
}else{
  console.log("(dry run — pass --write to save)");
}
