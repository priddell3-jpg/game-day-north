/* Race — standings normalisation, source-agnostic.
 *
 * Shared by the build script and exercised directly by the tests, the
 * same bargain scripts/lib/rugby.mjs makes. Nothing here fetches; it is
 * handed a payload and returns groups, or returns nothing at all.
 *
 * The rules that matter, each written against a real ESPN payload:
 *
 *   - The entries array is NOT in standings order. Eliminated teams are
 *     hoisted to the front of it: the American League list opens with a
 *     team on a 15th seed, and the 2025 AFC list closes with the first
 *     seed. Anything that reads the array in order is wrong, so a group
 *     whose position cannot be established from a published field is
 *     rejected rather than shown in whatever order it arrived.
 *
 *   - A qualification note is a fact about a POSITION, not a verdict on
 *     the team standing in it. At matchday one the Champions League
 *     labels ranks 25 to 36 "Eliminated", and six of those clubs have
 *     played no matches at all. Zones are therefore returned as ranges
 *     with labels, never attached to a club, and the caller is expected
 *     to phrase them positionally. A verdict on a team exists only where
 *     the source publishes one per team, which is the clincher letter.
 *
 *   - A stat name does not mean the same thing in every view. In the
 *     wild-card view the overall record is blank, division win
 *     percentage reads zero, and games behind is measured against the
 *     third wild-card line with a negative value for teams holding a
 *     cushion. Each source below therefore names the view it is for.
 *
 * Nothing is invented. A field the source did not publish is absent from
 * the row rather than defaulted, and a group that cannot be ordered is
 * not returned at all.
 */

/* How a group's positions are established.

   seed     — the source publishes a playoff seed and it is the order.
   table    — the source publishes a rank and it is the order.
   division — the source publishes neither, but it does publish games
              behind the division leader, which is a total order with
              ties sharing a place. Positions are the standard
              competition ranking over that published figure, not a
              tiebreak of our own. */
export const RACE_KINDS = { SEED: "seed", TABLE: "table", DIVISION: "division" };

const statOf = (e, name) =>
  (e && Array.isArray(e.stats) ? e.stats.find(s => s && s.name === name) : null) || null;

/* The published text, exactly as published. Games behind reads "-" for
   the team on the line and "+9" for one nine games clear of it, and both
   are the source's own words for a real state; reformatting them would
   be this app writing a number the source did not write. */
export function textStat(entry, name){
  const s = statOf(entry, name);
  if(!s || s.displayValue == null) return null;
  const t = String(s.displayValue).trim();
  return t === "" ? null : t;
}

/* The published number. `value` is preferred over `displayValue` because
   the two carry different information for games behind: "+9" displays a
   cushion and values it at -9, and parsing the display would lose the
   sign that says which side of the line a team is on. */
export function numStat(entry, name){
  const s = statOf(entry, name);
  if(!s) return null;
  const raw = s.value != null ? s.value : s.displayValue;
  if(raw == null || raw === "") return null;
  const n = Number(String(raw).replace(/[^0-9.eE+-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/* ESPN's clinch letters. This IS a per-team verdict from the source and
   is the only thing here allowed to read as one.

   Deliberately a closed set: a letter that is not listed yields nothing
   rather than a guessed phrase. ESPN has added letters before, and a
   wrong expansion of one would put a false claim about a team's season
   on the page. */
export const CLINCH = {
  "*": "clinched home advantage",
  "z": "clinched a division",
  "y": "clinched a bye",
  "x": "clinched a playoff place",
  "e": "eliminated"
};
export const clinchPhrase = letter => CLINCH[String(letter || "").trim().toLowerCase()]
  || CLINCH[String(letter || "").trim()] || null;

/* The letter, only when it is one we can explain. Carrying a letter the
   page cannot phrase would just move the guess downstream. */
export function clincherOf(entry){
  const t = textStat(entry, "clincher");
  if(!t) return null;
  return clinchPhrase(t) ? t : null;
}

/* A colour as the source states it, when it states a usable one.

   The Premier League's Europa League zone currently arrives as
   "##B5E7CE" — two hashes, which no stylesheet accepts. One leading run
   of hashes is tolerated and anything else is dropped, because a colour
   is decoration and a wrong one is worse than none. */
export function sanitizeHex(value){
  if(value == null) return null;
  const m = /^#*([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(value).trim());
  return m ? "#" + m[1].toLowerCase() : null;
}

/* Qualification zones, collapsed from the per-entry notes.

   Returned as ranges over positions, never as a property of a club. A
   run of consecutive ranks sharing a description is one zone; a gap in
   the ranks ends the run, so the unlabelled middle of a league table
   does not silently join the two zones either side of it. */
export function zonesFrom(entries){
  const noted = [];
  for(const e of entries || []){
    const n = e && e.note;
    if(!n || !n.description) continue;
    const rank = Number(n.rank);
    if(!Number.isFinite(rank) || rank < 1) continue;
    noted.push({ rank, label: String(n.description).trim(), color: sanitizeHex(n.color) });
  }
  if(!noted.length) return [];
  noted.sort((a, b) => a.rank - b.rank);
  const zones = [];
  for(const n of noted){
    const last = zones[zones.length - 1];
    if(last && last.label === n.label && n.rank === last.to + 1){ last.to = n.rank; continue; }
    const z = { from: n.rank, to: n.rank, label: n.label };
    if(n.color) z.color = n.color;
    zones.push(z);
  }
  return zones;
}

/* Games played, which the soccer feeds publish and the NFL does not.
   Adding the three results together is arithmetic over published
   figures, not an estimate, and it is the only way to tell week one
   apart from a league that has not started. */
export function playedBy(entry){
  const gp = numStat(entry, "gamesPlayed");
  if(gp != null) return gp;
  const w = numStat(entry, "wins"), l = numStat(entry, "losses"), d = numStat(entry, "ties");
  if(w == null || l == null) return null;
  return w + l + (d == null ? 0 : d);
}

const put = (o, k, v) => { if(v != null && v !== "") o[k] = v; };

/* One row. Every field is omitted unless the source published it. */
export function rowFrom(entry, opts = {}){
  const t = entry && entry.team;
  if(!t || t.id == null) return null;
  const name = t.displayName || t.name || "";
  if(!name) return null;
  const row = { tid: String(t.id), name };
  put(row, "abbr", t.abbreviation);
  const id = opts.idFor ? opts.idFor(name) : null;
  put(row, "id", id);
  put(row, "gp", playedBy(entry));
  put(row, "w", numStat(entry, "wins"));
  put(row, "d", numStat(entry, "ties"));
  put(row, "l", numStat(entry, "losses"));
  /* League points and goal difference belong to a ranked table and to
     nothing else. The North American views answer `points` too, but it
     means something entirely different there — ESPN describes it as the
     "relative value from the leader used to determine the actual
     gamesBehind", which read -0.5 for a club two games under .500. A
     field called pts in a baseball row would be a number this app had
     quietly renamed, so neither is carried outside a table. */
  if(opts.kind === RACE_KINDS.TABLE){
    put(row, "pts", numStat(entry, "points"));
    put(row, "gd", textStat(entry, "pointDifferential"));
  }
  put(row, "rec", textStat(entry, "overall"));
  put(row, "gb", textStat(entry, "gamesBehind"));
  const gbv = numStat(entry, "gamesBehind");
  if(gbv != null) row.gbv = gbv;
  put(row, "streak", textStat(entry, "streak"));
  put(row, "form", textStat(entry, "Last Ten Games"));
  put(row, "div", textStat(entry, "divisionRecord"));
  put(row, "clinch", clincherOf(entry));
  return row;
}

/* Positions, from whichever published field this kind of group orders
   by. Returns null when the field is missing or unusable for any row —
   an unordered group is not shown at all, because the order is the
   whole point of a race.

   A seed of zero is how the NFL reads in week one, before anything has
   been played. That is unusable rather than wrong, and it is the reason
   nothing renders for the NFL today. */
export function positionsFor(rows, entries, kind){
  if(!rows.length) return null;
  if(kind === RACE_KINDS.SEED || kind === RACE_KINDS.TABLE){
    const field = kind === RACE_KINDS.SEED ? "playoffSeed" : "rank";
    const seen = new Set();
    for(let i = 0; i < rows.length; i++){
      const p = numStat(entries[i], field);
      if(p == null || p < 1 || !Number.isInteger(p)) return null;
      if(seen.has(p)) return null;                 // two teams cannot hold one seed
      seen.add(p);
      rows[i].pos = p;
    }
    return rows.slice().sort((a, b) => a.pos - b.pos);
  }
  if(kind === RACE_KINDS.DIVISION){
    for(const r of rows) if(r.gbv == null) return null;
    const sorted = rows.slice().sort((a, b) => a.gbv - b.gbv);
    /* Standard competition ranking: equal published figures share a
       place and the next place skips. Inventing a tiebreak between two
       teams the source reports as level would be this app deciding a
       standing, which it does not do. */
    sorted.forEach((r, i) => {
      r.pos = (i > 0 && r.gbv === sorted[i - 1].gbv) ? sorted[i - 1].pos : i + 1;
    });
    return sorted;
  }
  return null;
}

/* Every node in the response that carries a standings block, in the
   order the response nests them. A league answers with one; a request
   for conferences or divisions answers with several. */
export function standingsNodes(payload){
  const out = [];
  const walk = n => {
    if(!n || typeof n !== "object") return;
    if(n.standings && Array.isArray(n.standings.entries)) out.push(n);
    (n.children || []).forEach(walk);
  };
  walk(payload);
  return out;
}

/* The season the response is about, read from the standings block and
   not from the top of the payload — the two disagree. The MLB response
   says 2027 at the top while its own standings say 2026, because the
   header is describing the next season to start rather than the one
   being reported.

   This exists so a caller holding a previous answer can tell "the source
   is briefly unreachable" from "the season has rolled over and this is a
   new, empty table", which look identical otherwise and end very
   differently: one is worth waiting out, the other would freeze last
   season's final table on the page for ever. */
export function seasonOf(payload){
  for(const n of standingsNodes(payload)){
    const s = n.standings.season;
    if(s != null) return s;
  }
  return null;
}

/* A stable id for a group within its competition. The scope name is the
   source's, and a stored id built from it would move if ESPN reworded
   "American League" — so the caller names the groups it expects and
   anything else is keyed on a slug of the source's name, which is still
   stable enough for a file rebuilt every three hours. */
const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/* One group, or null.

   Null is returned for a group that cannot be ordered, has no rows, or
   whose season cannot be read. A caller that gets null writes nothing:
   the page renders no card for a race it has no standings for, so an
   absent group and an unreachable source look the same from the outside,
   which is the intended behaviour on the home page. */
export function groupFrom(node, opts = {}){
  const st = node && node.standings;
  if(!st || !Array.isArray(st.entries) || !st.entries.length) return null;
  const kind = opts.kind || RACE_KINDS.TABLE;
  const entries = st.entries.filter(e => e && e.team && e.team.id != null);
  if(!entries.length) return null;
  const rows = [];
  for(const e of entries){
    const r = rowFrom(e, opts);
    if(!r) return null;                     // a row we cannot name is a broken payload
    rows.push(r);
  }
  const ordered = positionsFor(rows, entries, kind);
  if(!ordered) return null;
  const played = ordered.map(r => (r.gp == null ? null : r.gp)).filter(v => v != null);
  const group = {
    comp: opts.comp,
    group: opts.group || slug(node.name) || "all",
    scope: node.name || node.displayName || "",
    kind,
    rows: ordered
  };
  if(opts.season != null) group.season = opts.season;
  else if(st.season != null) group.season = st.season;
  if(played.length === ordered.length){
    group.played = { min: Math.min(...played), max: Math.max(...played) };
  }
  const zones = zonesFrom(entries);
  if(zones.length) group.zones = zones;
  return group;
}

/* Every group in one response. An unusable group is dropped and the
   usable ones are kept: a competition is not blanked because one of its
   divisions arrived malformed. */
export function groupsFrom(payload, opts = {}){
  const nodes = standingsNodes(payload);
  const out = [];
  for(const n of nodes){
    const g = groupFrom(n, Object.assign({}, opts,
      { group: opts.groupFor ? opts.groupFor(n) : opts.group }));
    if(g) out.push(g);
  }
  return out;
}

/* ---- the sources, each naming the view it reads ---------------------

   Every one of these was called against the live API and its shape read
   before this file was written. The `view` note records which ESPN
   standings view the field meanings below belong to, because the same
   field name means something else in another one. */
const SITE = "https://site.api.espn.com/apis/v2/sports/";
const WEB = "https://site.web.api.espn.com/apis/v2/sports/";

export const RACE_SOURCES = [
  { comp: "MLB", kind: RACE_KINDS.SEED,
    /* type=1 is the wild-card view: twelve non-division-leaders per
       league, seeded 1 to 12 among themselves, with games behind
       measured against the third wild-card place rather than against
       the best record in the league. */
    url: WEB + "baseball/mlb/standings?type=1&level=2",
    view: "wild card, by league",
    label: "ESPN wild card standings",
    groups: { "American League": "AL", "National League": "NL" } },

  { comp: "NFL", kind: RACE_KINDS.SEED,
    /* The default view already seeds each conference 1 to 16, which is
       the playoff picture. The playoff-flavoured view drops the seed
       entirely and answers with nothing for a season in progress. */
    url: SITE + "football/nfl/standings",
    view: "conference seeds",
    label: "ESPN conference standings",
    groups: { "American Football Conference": "AFC", "National Football Conference": "NFC" } },

  { comp: "NFL", kind: RACE_KINDS.DIVISION,
    url: SITE + "football/nfl/standings?level=3",
    view: "divisions",
    label: "ESPN division standings" },

  { comp: "EPL", kind: RACE_KINDS.TABLE,
    url: SITE + "soccer/eng.1/standings",
    view: "league table",
    label: "ESPN Premier League table",
    group: "table" },

  { comp: "UCL", kind: RACE_KINDS.TABLE,
    /* The league phase is a single 36-team table, and its qualification
       zones arrive in the payload rather than being written down here.
       That is deliberate: how many places qualify automatically is a
       competition rule that has changed once already and can change
       again. */
    url: SITE + "soccer/uefa.champions/standings",
    view: "league phase table",
    label: "ESPN Champions League table",
    group: "league" }
];

/* The group id for a node, from the source's own map where it has one.
   A source without a map keys on the slug, which is what the eight NFL
   divisions use: "AFC East" becomes "afc-east". */
export const groupIdFor = (src, node) =>
  (src.groups && src.groups[node && node.name]) || src.group || slug(node && node.name) || "all";
