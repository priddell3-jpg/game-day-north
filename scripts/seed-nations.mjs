#!/usr/bin/env node
/**
 * Seeds the men's national teams into data/teams.json from ESPN's own
 * team lists, and records how they got there.
 *
 * Like scripts/generate-teams.mjs this is provenance rather than a build
 * step. It was run once, on 2026-09-29, and the manifest it added to is
 * the artefact. It only ever ADDS: a nation already in the manifest is
 * left exactly as it is, so re-running it cannot undo an alias or a
 * colour somebody has corrected by hand since.
 *
 * A nation is modelled the way a club is. Its home competition is the
 * friendlies feed, because that is the one every nation appears in, and
 * the Nations League it enters is an extra competition — the same shape
 * as Liverpool, whose home is the Premier League and who also enter the
 * Champions League.
 *
 * Which nations:
 *   - every team ESPN lists for the UEFA Nations League
 *   - every team ESPN lists for the Concacaf Nations League
 *   - Canada, the United States and Mexico, which ESPN's Concacaf list
 *     omits as of 2026-09-29
 *   - Argentina and Brazil, because they are offered as visible chips
 *
 * Run:  node scripts/seed-nations.mjs [--write]
 * Without --write it prints what it would add and changes nothing.
 */
import { readFileSync, writeFileSync } from "node:fs";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/";
const FEEDS = { INTF: "fifa.friendly", UNL: "uefa.nations", CNL: "concacaf.nations.league" };

/* The twelve offered as chips before anyone searches, in the order they
   are shown. Everything else is behind the search box, as it is for the
   clubs of a big league. */
const FEATURED = ["Canada", "United States", "Mexico", "England", "France", "Germany",
  "Spain", "Italy", "Portugal", "Netherlands", "Argentina", "Brazil"];
/* Followable although neither Nations League list names them. */
const ALSO = ["Canada", "United States", "Mexico", "Argentina", "Brazil"];
/* Concacaf members ESPN's Concacaf Nations League list leaves out. */
const CONCACAF_ALSO = ["Canada", "United States", "Mexico"];

/* Names a feed has used, or plausibly will, for a nation ESPN currently
   spells another way. Tolerance, not a claim: an alias nothing ever
   sends costs nothing, and one that is missing detaches a nation's
   fixtures in a way that looks exactly like a quiet month. */
const ALIASES = {
  "United States": ["USA", "United States of America"],
  "Türkiye": ["Turkey"],
  "Czechia": ["Czech Republic"],
  "Bosnia-Herzegovina": ["Bosnia and Herzegovina"],
  "Republic of Ireland": ["Ireland"],
  "North Macedonia": ["Macedonia"],
  "St. Kitts and Nevis": ["Saint Kitts and Nevis"],
  "St. Lucia": ["Saint Lucia"],
  "St. Martin": ["Saint Martin"],
  "St. Vincent and the Grenadines": ["Saint Vincent and the Grenadines"],
  "Trinidad and Tobago": ["Trinidad & Tobago"],
  "Antigua and Barbuda": ["Antigua & Barbuda"],
  "Turks and Caicos Islands": ["Turks and Caicos"]
};

/* The manifest knows eight zones and none of them is South American, so
   a nation takes the nearest it has. Nothing reads a nation's zone to
   place a kickoff — every start is an absolute instant from the feed. */
const UK = ["England", "Scotland", "Wales", "Northern Ireland", "Republic of Ireland"];
const zoneFor = (name, isUefa) => UK.includes(name) ? "UK" : isUefa ? "CET" : name === "Mexico" ? "CT" : "ET";

/* ESPN gives many nations white or black as their colour, which makes a
   crest that is a blank square. Its alternate is used where the first
   is unusable, and a neutral where both are. */
const PLAIN = new Set(["ffffff", "000000", "", "none"]);
const usable = c => !PLAIN.has(String(c == null ? "" : c).toLowerCase());
const colourOf = t => "#" + String(usable(t.color) ? t.color : usable(t.alternateColor) ? t.alternateColor : "5A6478").toUpperCase();

async function teamsOf(slug){
  const res = await fetch(ESPN + slug + "/teams?limit=1000", { headers: { accept: "application/json" } });
  if(!res.ok) throw new Error(slug + " teams: HTTP " + res.status);
  const j = await res.json();
  return (((j.sports || [])[0] || {}).leagues || [])[0].teams.map(x => x.team);
}

const lists = {};
for(const [comp, slug] of Object.entries(FEEDS)) lists[comp] = await teamsOf(slug);
const friendly = new Map(lists.INTF.map(t => [t.displayName, t]));
const uefa = new Set(lists.UNL.map(t => t.displayName));
const concacaf = new Set(lists.CNL.map(t => t.displayName).concat(CONCACAF_ALSO));

const wanted = [...new Set(FEATURED.concat(ALSO, [...uefa].sort(), [...concacaf].sort()))];
const byName = new Map();
for(const comp of ["INTF", "UNL", "CNL"]) for(const t of lists[comp]) if(!byName.has(t.displayName)) byName.set(t.displayName, t);

const path = new URL("../data/teams.json", import.meta.url);
const manifest = JSON.parse(readFileSync(path, "utf8"));
const have = new Set(manifest.teams.map(t => t.id));
const added = [];
for(const name of wanted){
  const t = byName.get(name);
  if(!t){ console.warn("  ! " + name + " is in no ESPN list — skipped"); continue; }
  const id = "nt-" + String(t.abbreviation).toLowerCase();
  if(have.has(id)) continue;
  have.add(id);
  const e = { id, comp: "INTF", espn: String(t.id), name, abbr: String(t.abbreviation).slice(0, 4),
    tz: zoneFor(name, uefa.has(name)), color: colourOf(t), feedName: name };
  if(ALIASES[name]) e.aliases = ALIASES[name].slice();
  const extra = [uefa.has(name) && "UNL", concacaf.has(name) && "CNL"].filter(Boolean);
  if(extra.length) e.extraComps = extra;
  if(FEATURED.includes(name)) e.featured = true;
  if(!friendly.has(name)) console.warn("  ! " + name + " is not in ESPN's friendlies list under that name");
  added.push(e);
}

console.log("nations to add  " + added.length + "  (" + added.filter(e => e.featured).length + " featured)");
console.log(added.map(e => e.id).join(" "));
if(process.argv.includes("--write")){
  manifest.teams.push(...added);
  writeFileSync(path, JSON.stringify(manifest, null, 1) + "\n");
  console.log("wrote data/teams.json — " + manifest.teams.length + " followable entries");
}else{
  console.log("(dry run — pass --write to save)");
}
