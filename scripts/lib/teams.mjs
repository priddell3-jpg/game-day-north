/* The team manifest — reading it, rebuilding the lists it replaces, and
 * checking it is internally consistent.
 *
 * Nothing in the app reads this yet, and that is deliberate. The
 * manifest earns its way in by proving it reproduces the six lists it
 * will eventually replace, byte for byte, before a single consumer is
 * pointed at it. Until that is true it is a claim, not a source of
 * truth. See P2_REFACTOR_PLAN.md, change B, step 1.
 *
 * The rebuild functions below exist for exactly that proof. They are not
 * a shim and should not grow into one: when a consumer migrates it reads
 * the manifest directly, and the rebuild function it no longer needs
 * goes with it.
 */

/* Competitions and zones a team may name. Kept here rather than imported
   from the page, so the validator runs on its own in CI — and asserted
   against the page's own tables by the tests, which turns the
   duplication into a drift check instead of a second source of truth. */
export const KNOWN_COMPS = ["NHL", "NBA", "NFL", "MLB", "MLS", "EPL", "UCL", "EFL", "FAC",
  "LALIGA", "SERIEA", "BUNDES", "LIGUE1", "UCI"];
export const KNOWN_ZONES = ["ET", "CT", "MT", "PT", "UK", "CET", "UTC"];
export const SOCCER_COMPS = ["EPL", "UCL", "EFL", "FAC", "MLS", "LALIGA", "SERIEA", "BUNDES", "LIGUE1"];

/* The four groups, in the order a rebuilt TEAM_ROWS needs them.

   teams     — followable clubs.
   events    — followable, but not a club: the men's WorldTour stands in
               the picker where a team would be.
   ghosts    — real clubs nobody can follow, referenced by the baked
               fallback fixtures, so their ids are load-bearing.
   feedOnly  — clubs known only by the name the feed uses, so a fixture
               against one of them resolves to something. */
export const GROUPS = ["teams", "events", "ghosts", "feedOnly"];
export const allEntries = m => GROUPS.flatMap(g => (m && m[g]) || []);

const norm = x => String(x || "").toLowerCase().normalize("NFD")
  .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

/* ---- rebuilding the lists the manifest replaces --------------------- */

/* A TEAM_ROWS row. The trailing 1 is the page's Champions League flag,
   present only on the clubs that carry one, because the row is compared
   against the shipped array element for element. */
export function toTeamRow(e){
  const row = [e.id, e.comp, e.city || "", e.name, e.abbr, e.tz, e.color];
  if((e.extraComps || []).indexOf("UCL") >= 0) row.push(1);
  return row;
}
export const toTeamRows = m => m.teams.concat(m.events).map(toTeamRow);
export const toGhostRows = m => m.ghosts.map(toTeamRow);
export const toRoster = m => m.teams.map(e => [e.id, e.comp, e.feedName]);
export const toDefaults = m => m.defaults.slice();

export function toClubNames(m){
  const out = {};
  for(const e of allEntries(m)) if(e.displayName) out[e.id] = e.displayName;
  return out;
}

/* ESPN_NAME is every soccer-family club the app knows by name, whether
   or not it can be followed. The North American clubs are absent from it
   because their roster name already is the feed's name — including the
   one whose city carries an accent the feed does not use. */
export function toEspnName(m, isSoccer = c => SOCCER_COMPS.indexOf(c) >= 0){
  const out = {};
  for(const e of allEntries(m)) if(isSoccer(e.comp)) out[e.id] = e.feedName;
  return out;
}

export function toAliases(m){
  const out = {};
  for(const e of allEntries(m)) if(e.aliases && e.aliases.length) out[e.id] = e.aliases.slice();
  return out;
}

/* EXTRA is per league; the manifest states it per club. The union is
   taken in club order so the resulting arrays match the shipped ones
   element for element rather than merely as sets. */
export function toExtra(m){
  const out = {};
  for(const e of m.teams){
    for(const c of e.extraComps || []){
      if(!out[e.comp]) out[e.comp] = [];
      if(out[e.comp].indexOf(c) < 0) out[e.comp].push(c);
    }
  }
  return out;
}

/* ---- validation ------------------------------------------------------

   Returns a list of problems, each naming the entry it is about. An
   empty list is a valid manifest. Nothing here throws: a caller that
   wants a hard failure raises one itself, and the tests want to read the
   problems rather than catch them. */
export function validateTeams(m, opts = {}){
  const comps = opts.comps || KNOWN_COMPS;
  const zones = opts.zones || KNOWN_ZONES;
  const problems = [];
  const say = (kind, id, detail) => problems.push({ kind, id, detail });

  if(!m || typeof m !== "object") return [{ kind: "unreadable", id: null, detail: "not an object" }];
  if(m.version !== 1) say("version", null, "expected version 1, got " + JSON.stringify(m.version));
  for(const g of GROUPS) if(!Array.isArray(m[g])) say("group", g, "missing or not an array");
  if(!Array.isArray(m.defaults)) say("group", "defaults", "missing or not an array");
  if(problems.length) return problems;

  const seen = new Map();
  for(const e of allEntries(m)){
    if(!e || !e.id){ say("id", null, "entry with no id"); continue; }
    if(seen.has(e.id)) say("duplicate-id", e.id, "also defined as " + seen.get(e.id));
    else seen.set(e.id, e.comp);
    if(comps.indexOf(e.comp) < 0) say("unknown-comp", e.id, String(e.comp));
    if(!e.feedName) say("missing-feedname", e.id, "");
    /* Only a followable club needs a zone and a colour; a club known
       only by name has neither and is not shown anywhere. */
    if(m.feedOnly.indexOf(e) < 0){
      if(zones.indexOf(e.tz) < 0) say("unknown-zone", e.id, String(e.tz));
    }
  }

  /* Two clubs answering to one name is the failure this whole manifest
     exists to prevent: it silently attaches one club's fixtures to
     another. Names and aliases share the namespace because the matcher
     does not distinguish them. */
  const claim = new Map();
  for(const e of allEntries(m)){
    for(const n of [e.feedName].concat(e.aliases || [])){
      if(!n) continue;
      const k = norm(n);
      if(!k) continue;
      if(claim.has(k) && claim.get(k) !== e.id) say("name-collision", e.id, JSON.stringify(n) + " is also claimed by " + claim.get(k));
      else claim.set(k, e.id);
    }
  }

  /* An ESPN id repeated inside one competition means two of our clubs
     point at the same club upstream, so one of them will never see a
     fixture. Across competitions it is legitimate: the same id namespace
     is not shared between leagues. */
  const byComp = new Map();
  for(const e of allEntries(m)){
    if(!e.espn) continue;
    const k = e.comp + "|" + e.espn;
    if(byComp.has(k)) say("duplicate-espn", e.id, "shares ESPN id " + e.espn + " in " + e.comp + " with " + byComp.get(k));
    else byComp.set(k, e.id);
  }

  for(const id of m.defaults) if(!seen.has(id)) say("missing-default", id, "listed in defaults but not defined");
  for(const e of allEntries(m)){
    for(const c of e.extraComps || []) if(comps.indexOf(c) < 0) say("unknown-comp", e.id, "extraComps: " + c);
  }
  return problems;
}

export const describeProblems = problems =>
  problems.map(p => "  " + p.kind + (p.id ? " [" + p.id + "]" : "") + (p.detail ? ": " + p.detail : "")).join("\n");
