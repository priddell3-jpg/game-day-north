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
   7.3/day. The rest are far below one a day. */
export const EXPECTED_PER_DAY = {
  MLB: 16, NHL: 9, NBA: 9, NFL: 3,
  MLS: 4, EPL: 3, UCL: 3, EFL: 3, FAC: 3,
  LALIGA: 3, SERIEA: 3, BUNDES: 3, LIGUE1: 3
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
   real number of fixtures and now has none did not have a quiet week —
   its request failed, and `get()` answers null on failure rather than
   throwing, so nothing else would notice. */

/* Below this a competition is too small to judge: a cup between rounds
   legitimately empties out. */
export const FLOOR_MIN = 12;
/* A single three-hourly run losing this much of a competition is not a
   season ending. Season ends are gradual; a failed request is a cliff. */
export const FLOOR_FRACTION = 0.4;

export function compFloorProblems(previousByComp, currentByComp, opts = {}){
  const min = opts.min == null ? FLOOR_MIN : opts.min;
  const fraction = opts.fraction == null ? FLOOR_FRACTION : opts.fraction;
  const now = currentByComp || {};
  const out = [];
  for(const [comp, was] of Object.entries(previousByComp || {})){
    if(!(was >= min)) continue;
    const is = now[comp] || 0;
    if(is === 0) out.push({ comp, was, is, why: "vanished" });
    else if(is < was * fraction) out.push({ comp, was, is, why: "collapsed" });
  }
  return out.sort((a, b) => b.was - a.was);
}

export const describeFloor = problems => problems.map(p =>
  "  " + p.comp + ": " + p.was + " fixtures last run, " + p.is + " now"
  + (p.why === "vanished" ? " — the competition is entirely absent" : " — a drop no season end makes")).join("\n");
