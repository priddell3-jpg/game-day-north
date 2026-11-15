/* How the build asks for a window of fixtures, and when it refuses to
 * believe the answer.
 *
 * Two things live here, both pure, both load-bearing enough to want
 * tests of their own rather than to be read out of a 900-line program.
 *
 *   - Chunking a date range so no single request can be truncated.
 *   - Deciding that a competition's fixtures have collapsed, which the
 *     global size guard cannot see.
 */

/* ESPN honours `limit` up to exactly 1000 and silently collapses to 25
   above it, so the value that looks most generous is the one that
   returns almost nothing. 1000 is the ceiling and nothing may ask for
   more. */
export const MAX_LIMIT = 1000;

/* Chunks are planned to land under this rather than under the ceiling,
   so an unusually busy fortnight does not have to be caught by the
   retry. The retry exists anyway; this keeps it rare. */
export const SAFE_PER_REQUEST = 900;

/* Fixtures a competition puts on in a day, league-wide, at its busiest.
   Deliberately generous: a number that is too high costs one extra
   request and a number that is too low risks a truncated answer.

   Measured on 2026-09-09 over a 21-day window, league-wide:
   baseball 13/day, and 1312 hockey games across a 180-day season is
   7.3/day. The rest are far below one a day.

   The international feeds are bursty rather than steady: nothing for
   six weeks, then a window in which the friendlies feed carries every
   nation in the world. Measured on 2026-09-29 the October window held
   34 friendlies, 52 UEFA Nations League matches and 37 Concacaf ones
   across seven days, with 18 the busiest single day. The friendlies
   figure is set well above that because a window before a major
   tournament is busier than one after it. */
export const EXPECTED_PER_DAY = {
  MLB: 16, NHL: 9, NBA: 9, NFL: 3,
  MLS: 4, EPL: 3, UCL: 3, EFL: 3, FAC: 3,
  LALIGA: 3, SERIEA: 3, BUNDES: 3, LIGUE1: 3,
  INTF: 45, UNL: 20, CNL: 12
};
const DEFAULT_PER_DAY = 8;

const DAY = 86400000;
export const dateKey = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");

/* How many days one request may cover for this competition. At least
   one: a single day that still overflows is a real failure, not
   something to divide further. */
export function chunkDaysFor(comp, opts = {}){
  const per = (opts.perDay || EXPECTED_PER_DAY)[comp] || DEFAULT_PER_DAY;
  const safe = opts.safe || SAFE_PER_REQUEST;
  return Math.max(1, Math.floor(safe / per));
}

/* The window, split into ranges no one of which is expected to overflow.
   Inclusive of both ends, and contiguous: every day in the window falls
   in exactly one chunk. */
export function planRanges(comp, fromMs, toMs, opts = {}){
  const days = chunkDaysFor(comp, opts);
  const out = [];
  for(let start = fromMs; start <= toMs; start += days * DAY){
    const end = Math.min(start + (days - 1) * DAY, toMs);
    out.push([dateKey(start), dateKey(end), start, end]);
  }
  return out;
}

/* The same window, one day at a time: the plan the build falls back to
   when ESPN refuses the ranged form outright.

   Since 2026-09-15 a YYYYMMDD-YYYYMMDD request answers HTTP 400 on every
   league, where a week earlier it answered the whole span. A single day
   is the form the scoreboard has always accepted, so it is the floor
   the build stands on when the cheaper form gives way. Inclusive of
   both ends and keyed exactly as planRanges keys its chunks, so the two
   plans cover the same days. */
export function planDays(fromMs, toMs){
  const out = [];
  for(let d = fromMs; d <= toMs; d += DAY) out.push([dateKey(d), d]);
  return out;
}

/* Halve a range that came back full. Returns null when there is nothing
   left to halve, which is the point at which a full response can only
   mean a genuinely truncated answer. */
export function splitRange(fromMs, toMs){
  const days = Math.round((toMs - fromMs) / DAY) + 1;
  if(days <= 1) return null;
  const half = Math.floor(days / 2);
  const mid = fromMs + half * DAY;
  return [[fromMs, mid - DAY], [mid, toMs]];
}

/* ---- refusing to publish a competition that has vanished ------------

   The existing guard refuses to write when the total fixture count falls
   below half the previous run. That was adequate when a request covered
   one day of one league; it is not adequate now that one failed request
   is one league's whole window. Hockey alone is 35% of the file, so its
   complete disappearance leaves 65% behind and sails through.

   `counts.byComp` is already written on every run, so the previous file
   states what each competition looked like. A competition that had a
   real number of fixtures and now has none did not have a quiet week.
   A request that fails outright has been fatal in scoreboardRange since
   2026-09-09; this floor is for the answer that arrives, says 200, and
   carries nothing. */

/* Below this a competition is too small to judge: a cup between rounds
   legitimately empties out. */
export const FLOOR_MIN = 12;
/* A single three-hourly run losing this much of a competition is not a
   season ending. Season ends are gradual; a failed request is a cliff. */
export const FLOOR_FRACTION = 0.4;

/* The reference is the previous run, and nothing older.

   From 2026-09-09 to 2026-11-15 a competition was also measured against
   its high-water mark of the last 45 days, so that one absent from the
   previous run could still be judged. That reference had one reachable
   effect, and it was the wrong one: a competition whose schedule simply
   ran out was refused for as long as its peak stayed fresh. Baseball's
   postseason held 20 fixtures in the window on 18 October 2026, one on
   5 November and none on the 6th — the World Series had ended on 28
   October — and the build refused to write for ten days, taking every
   other sport's scores with it (issue #60). The 45-day lifetime assumed
   a count that decays over the whole 83-day window, which a short,
   sparse postseason does not do.

   What the peak was meant to cover does not need it. A competition
   absent from the previous run has nothing left to lose: a request that
   wrongly answers "nothing" for it leaves the file exactly as it was,
   and the next run that answers properly fills it back in. The only
   loss left is a competition holding fewer than FLOOR_MIN fixtures and
   answering nothing for one run, which the floor already accepts as too
   small to judge. */

/* Competitions played in international windows, which the floor must
   not judge.

   Everything above assumes a season: fixtures arrive steadily, and a
   competition that had a real number of them and now has none did not
   have a quiet week. A national team's calendar is the opposite. The
   UEFA Nations League league phase ends on 19 November 2026 and its
   next match is in March; eight days after that last matchday the
   count falls from a full matchday to nothing between one run and the
   next, exactly the cliff the floor reads as a failed request. It would
   then refuse to write the file at all, and every other sport would
   stop updating because international football had gone quiet on
   schedule.

   Exempting them gives up nothing the build relied on. A request that
   fails outright is already fatal in scoreboardRange, whatever the
   competition; the floor only ever added a second opinion for the case
   where the source answers and says "nothing", and for these
   competitions "nothing" is the ordinary answer most weeks of the
   year. */
export const WINDOWED_COMPS = ["INTF", "UNL", "CNL"];

/* Two readings of one drop, both against the previous run.

   Vanishing is a competition that held at least FLOOR_MIN fixtures last
   run and holds none now. Collapsing is one that lost more than the
   fraction between two runs without emptying. Neither looks further
   back than the last run: a season running down loses fixtures
   steadily, and any older reference would call every autumn an outage. */
export function compFloorProblems(previousByComp, currentByComp, opts = {}){
  const min = opts.min == null ? FLOOR_MIN : opts.min;
  const fraction = opts.fraction == null ? FLOOR_FRACTION : opts.fraction;
  const now = currentByComp || {};
  const prev = previousByComp || {};
  const windowed = opts.windowed || WINDOWED_COMPS;
  const out = [];
  for(const comp of Object.keys(prev)){
    if(windowed.indexOf(comp) >= 0) continue;
    const was = prev[comp] || 0;
    const is = now[comp] || 0;
    if(was < min) continue;                 // too small to judge
    if(is === 0) out.push({ comp, was, is, why: "vanished" });
    else if(is < was * fraction) out.push({ comp, was, is, why: "collapsed" });
  }
  return out.sort((a, b) => b.was - a.was);
}

export const describeFloor = problems => problems.map(p =>
  "  " + p.comp + ": " + p.was + " fixtures last run, " + p.is + " now"
  + (p.why === "vanished" ? " — the competition is entirely absent" : " — a drop no season end makes")).join("\n");

/* ---- which parts of a season this app carries ----------------------

   The ranged scoreboard returns preseason; the per-team season schedules
   it replaced did not. Taking everything would quietly add exhibition
   games to people's boards, and that matters here for one specific
   reason rather than a general preference.

   The rights table keys on COMPETITION. An exhibition game would be told
   it is on Sportsnet on a Saturday because the regular season is — a
   carriage claim nothing sourced, about a game that may not be televised
   at all. Wrong rights information is worse than an absent fixture,
   which is the judgement the whole app is built on.

   Carrying preseason would mean teaching the rights table about season
   type first. That is a real feature and it is not this one, so this is
   the line to change when it happens: add the slug here and the fixtures
   arrive. */
export const CARRIED_SEASON_SLUGS = ["regular-season", "post-season", "off-season"];
export const EXCLUDED_SEASON_SLUGS = ["preseason"];

/* A slug the source did not state is carried: absence of a label is not
   evidence of an exhibition, and soccer states none at all. */
export function isCarriedSeason(ev){
  const slug = ((ev && ev.season) || {}).slug;
  if(!slug) return true;
  return EXCLUDED_SEASON_SLUGS.indexOf(slug) < 0;
}
