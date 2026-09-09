#!/usr/bin/env node
/**
 * Generates data/teams.json from the six lists that currently hold team
 * data in two files.
 *
 * This is a one-shot, committed on purpose. The manifest it produces is
 * the artefact; this script is the provenance, so anyone can see exactly
 * how today's data became the file rather than having to trust it.
 *
 * It is NOT a codegen step to be re-run. Ids in particular are data, not
 * a derivation: `den` is the Nuggets and `buf` is the Bills because that
 * is what people's saved boards and share links already say, and a rule
 * that recomputed them would eventually disagree with history and empty
 * somebody's board. tests/fixtures/frozen-team-ids.json is the ledger,
 * and the tests fail on any drift from it.
 *
 * Run:  node scripts/generate-teams.mjs [--write]
 * Without --write it prints what it would produce and changes nothing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadFromPage } from "../tests/helpers/page.mjs";
import { loadFromBuild } from "../tests/helpers/build.mjs";

const P = loadFromPage(["TEAM_ROWS", "GHOSTS", "CLUB_NAMES", "ESPN_NAME", "SOCCER", "DEFAULT_TEAMS"]);
const B = loadFromBuild(["ROSTER", "ALIASES", "EXTRA"]);

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

if(write){ writeFileSync(out, json); console.log("wrote data/teams.json"); }
else console.log("(dry run — pass --write to save)");
