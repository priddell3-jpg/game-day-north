/**
 * Tennis normalisation — ESPN's tennis scoreboard into the small contract
 * the browser is given.
 *
 * Tennis does not fit the shape the rest of this app is built on. Every
 * other sport answers one event per game; tennis answers a tournament,
 * which contains groupings (men's singles, women's doubles, mixed
 * doubles), each of which contains the competitions that are the actual
 * matches. The two feeds together are about 2 MB and, at a Grand Slam,
 * carry the same draw twice — the US Open appears in full under both the
 * ATP and the WTA scoreboard. None of that belongs in a browser.
 *
 * So this module is deliberately its own parser rather than an extension
 * of the team-sport one: the identity, the score shape and the lifecycle
 * are all different, and making the team parser guess at tennis would
 * have meant weakening it for the sports it already gets right.
 *
 * Nothing here reaches the network. It takes payloads and gives back
 * plain data, so the tests can run against committed fixtures.
 */

export const DAY = 86400000;

/* Retention, applied before anything is sent to the browser.
   A finished match is interesting for a few days and then it is history;
   a match still being played is interesting however long ago it started,
   because that is exactly what a suspended match looks like. */
export const KEEP_COMPLETED_DAYS = 3;
export const HORIZON_DAYS = 14;

/* ESPN's grouping ids. Only these two are singles, and the tour follows
   from the grouping rather than from which feed the match arrived in —
   the US Open's men's singles is in the WTA feed as well, and it is ATP
   either way. Doubles (3, 4) and mixed doubles (6) are out of scope for
   this phase and are dropped here rather than filtered later. */
export const SINGLES_GROUPINGS = {"1":"ATP", "2":"WTA"};

/* ESPN's status names, where the name says more than the state does.
   "post" alone cannot tell a completed match from an abandoned one, and
   a retirement is a real result while a walkover is not a match at all. */
const STATUS_BY_NAME = {
  STATUS_RETIRED:       "retired",
  STATUS_WALKOVER:      "walkover",
  STATUS_WALKOVER_WIN:  "walkover",
  STATUS_SUSPENDED:     "suspended",
  STATUS_DELAYED:       "suspended",
  STATUS_RAIN_DELAY:    "suspended",
  STATUS_CANCELED:      "canceled",
  STATUS_CANCELLED:     "canceled",
  STATUS_ABANDONED:     "canceled",
  STATUS_POSTPONED:     "postponed"
};

/* Statuses that mean the match will not produce any more play. These are
   the ones the 3-day cutoff applies to, and the ones that stop the fast
   poll. "suspended" is deliberately absent: a suspended match resumes. */
export const SETTLED = {final:1, retired:1, walkover:1, canceled:1, postponed:1};

/* Read the lifecycle from ESPN's own fields, the same rule the team
   sports use: state "in" is live whatever the phase is called, and only
   completed or "post" ends anything. Elapsed time never does. */
export function statusOf(comp){
  const ty = (comp && comp.status && comp.status.type) || {};
  const named = STATUS_BY_NAME[ty.name];
  if(named) return named;
  if(ty.state === "in") return "live";
  if(ty.completed === true || ty.state === "post") return "final";
  if(ty.state === "pre") return "scheduled";
  return "unknown";
}

/* "GBR" out of .../countries/500/gbr.png. The flag is the only place the
   payload puts a country code on a singles competitor; athlete.flag.alt
   carries the country's name, which is not what a results line shows. */
function countryOf(athlete){
  const href = (athlete && athlete.flag && athlete.flag.href) || "";
  const m = /\/countries\/\d+\/([a-z]{2,3})\.png/i.exec(href);
  return m ? m[1].toUpperCase() : "";
}

const num = v => (typeof v === "number" && isFinite(v)) ? v : null;

/* One competitor, or null if it is not a singles player at all. Doubles
   pairs arrive as type "team" carrying a roster of two athletes, so
   requiring an athlete here is the second guard against doubles slipping
   in — the first being the grouping.

   A slot in a draw that nobody has qualified into yet is still published
   as a competitor: ESPN gives it a negative id and the name "TBD". That
   is a placeholder, not a person, so it gets an id of null — it can
   never be followed, never reaches the player directory, and never
   invents an opponent. The slot is still described, because "Alcaraz vs
   TBD in the third round" is a real and useful thing to know. */
const isRealAthleteId = id => /^\d+$/.test(id);

function playerOf(c){
  if(!c || c.type !== "athlete" || !c.athlete) return null;
  const id = c.id != null ? String(c.id) : "";
  const name = c.athlete.displayName || c.athlete.fullName || "";
  if(!isRealAthleteId(id) || name === "TBD"){
    return {id: null, name: name || "TBD", short: name || "TBD", country: "", tbd: true};
  }
  return {
    id,                                    // identity is the id, never the name
    name,
    short: c.athlete.shortName || name,
    country: countryOf(c.athlete),
    tbd: false
  };
}

/* Set scores, as pairs, in the players' own order.
   A tennis score is not two numbers; it is a list of sets, each of which
   is two numbers, sometimes with a tiebreak of its own. Flattening that
   into the team-sport [a, b] would lose the match. */
function setsOf(a, b){
  const la = (a && a.linescores) || [], lb = (b && b.linescores) || [];
  const n = Math.max(la.length, lb.length);
  const sets = [], tiebreaks = [];
  for(let i = 0; i < n; i++){
    const x = la[i] || {}, y = lb[i] || {};
    sets.push([num(x.value), num(y.value)]);
    const tx = num(x.tiebreak), ty = num(y.tiebreak);
    tiebreaks.push(tx === null && ty === null ? null : [tx, ty]);
  }
  return {sets, tiebreaks};
}

/* One competition — one match — or null if it is not singles between two
   identifiable players. */
export function parseCompetition(comp, ctx){
  if(!comp || comp.id == null) return null;
  const cs = (comp.competitors || []).slice();
  if(cs.length !== 2) return null;
  /* ESPN lists competitors away-first. Order 1 is the player the match is
     billed under and the one every results line names first, so sort by
     it rather than trusting the array. */
  cs.sort((x, y) => (x.order || 0) - (y.order || 0));
  const p0 = playerOf(cs[0]), p1 = playerOf(cs[1]);
  if(!p0 || !p1) return null;
  /* Both sides unfilled is a line in a draw, not a fixture. Nobody can
     follow it and it would only ever render as "TBD vs TBD". */
  if(p0.tbd && p1.tbd) return null;

  const ty = (comp.status && comp.status.type) || {};
  const status = statusOf(comp);
  const at = Date.parse(comp.date || comp.startDate || "");
  if(!isFinite(at)) return null;           // no usable date: nothing to place it against

  /* timeValid is ESPN saying whether the clock on this match means
     anything. For most of a draw it does not — an unplayed third round
     carries a placeholder of midnight Eastern. The date still buckets the
     match onto a day, but no time is shown and none is invented. */
  const timeKnown = comp.timeValid === true;

  const {sets, tiebreaks} = setsOf(cs[0], cs[1]);
  const wi = cs.findIndex(c => c.winner === true);

  return {
    id: String(comp.id),
    tour: ctx.tour,
    tid: ctx.tid || null,
    tournament: ctx.tournament || "",
    short: ctx.short || ctx.tournament || "",
    major: !!ctx.major,
    round: (comp.round && comp.round.displayName) || "",
    court: (comp.venue && comp.venue.court) || "",
    venue: (comp.venue && comp.venue.fullName) || ctx.venue || "",
    start: at,
    timeKnown,
    status,
    label: ty.shortDetail || ty.detail || ty.description || "",
    players: [p0, p1],
    sets,
    tiebreaks,
    winner: wi >= 0 ? wi : null
  };
}

/* Every singles match in one scoreboard payload. */
export function parseScoreboard(payload){
  const out = [];
  const events = (payload && payload.events) || [];
  for(const ev of events){
    const ctx0 = {
      tid: ev.id != null ? String(ev.id) : null,
      tournament: ev.name || "",
      short: ev.shortName || ev.name || "",
      major: ev.major === true,
      venue: (ev.venue && ev.venue.fullName) || ""
    };
    for(const g of ev.groupings || []){
      const gid = g && g.grouping && g.grouping.id != null ? String(g.grouping.id) : "";
      const tour = SINGLES_GROUPINGS[gid];
      if(!tour) continue;                  // doubles and mixed never get built
      for(const comp of g.competitions || []){
        const m = parseCompetition(comp, Object.assign({tour}, ctx0));
        if(m) out.push(m);
      }
    }
  }
  return out;
}

/* Retention. Applied here, server-side, so the browser is never sent a
   draw it would only throw away.

   A settled match is kept for three days from its start. Anything still
   capable of changing — live, suspended, or a status the source has not
   resolved — is kept regardless of age, because a match suspended for
   rain on Tuesday and resumed on Thursday is not a stale record. Upcoming
   matches are kept to a fortnight, which is longer than any single
   tournament and short of holding a season. */
export function keepMatch(m, now){
  if(!m) return false;
  if(m.status === "live" || m.status === "suspended" || m.status === "unknown") return true;
  if(SETTLED[m.status]) return m.start >= now - KEEP_COMPLETED_DAYS * DAY;
  // scheduled: a fortnight ahead, and not still sitting unplayed days later
  return m.start <= now + HORIZON_DAYS * DAY && m.start >= now - KEEP_COMPLETED_DAYS * DAY;
}

/* Matches involving at least one of these athlete ids. Identity is the
   id ESPN assigns; names are never the key, because two players can share
   one and one player's name is spelled several ways across a season. */
export function forPlayers(matches, ids){
  const want = new Set([...(ids || [])].map(String));
  if(!want.size) return [];
  return (matches || []).filter(m => m.players.some(p => p.id && want.has(p.id)));
}

/* Assemble already-parsed match lists into the contract the browser
   receives. Deduplicated by match id: at a Grand Slam the same singles
   draw is published under both tours, and the id is identical in each,
   so the id is the only thing that can be trusted to collapse them.

   Kept separate from normalizeTennis() so the server can hold the parsed
   form of each tour and re-apply retention on every request. Retention
   depends on the clock, and a cached answer must not carry yesterday's
   idea of what counts as recent. */
export function assembleMatches(lists, opts){
  const o = opts || {};
  const now = typeof o.now === "number" ? o.now : Date.now();
  const seen = new Map();
  let parsed = 0;
  for(const list of lists || []){
    for(const m of list || []){
      if(!m || m.id == null) continue;
      parsed++;
      if(!seen.has(m.id)) seen.set(m.id, m);
    }
  }
  let matches = [...seen.values()];
  const deduped = matches.length;
  matches = matches.filter(m => keepMatch(m, now));
  const retained = matches.length;
  if(o.players) matches = forPlayers(matches, o.players);
  matches.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  return {
    generated: new Date(now).toISOString(),
    matches,
    counts: {parsed, deduped, retained, returned: matches.length}
  };
}

/* Normalise raw payloads. The convenience form of the above, used by the
   tests and by anything holding whole scoreboards rather than parsed
   lists. */
export function normalizeTennis(payloads, opts){
  return assembleMatches((payloads || []).map(parseScoreboard), opts);
}

/* The searchable player list for the picker: every singles player
   currently in a draw, by stable id. Small enough to ship with the
   schedule file, which means searching costs no request at all. */
export function playerDirectory(payloads){
  const byId = new Map();
  for(const p of payloads || []){
    for(const m of parseScoreboard(p)){
      for(const pl of m.players){
        if(!pl.id) continue;               // an unfilled draw slot is not a player
        const prev = byId.get(pl.id);
        if(!prev) byId.set(pl.id, {id:pl.id, name:pl.name, country:pl.country, tours:new Set([m.tour])});
        else prev.tours.add(m.tour);
      }
    }
  }
  return [...byId.values()]
    .map(p => [p.id, p.name, [...p.tours].sort().join("/"), p.country])
    .sort((a, b) => a[1].localeCompare(b[1]));
}
