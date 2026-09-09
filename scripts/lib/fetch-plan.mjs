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

/* How long a competition's high-water mark keeps guarding it.

   Reading only the previous run leaves a hole a whole season wide.
   Baseball decays to nothing over the winter, so by March the previous
   run records no MLB at all — and a competition absent from the previous
   run is never checked. If the first March request then failed, a whole
   season's opening would ship missing and nothing would say so.

   So the peak is remembered. Forty-five days works because the fixture
   window itself is eighty-three: a season that genuinely ends decays to
   zero over the length of that window, which is far longer than the
   peak stays fresh, so a real ending lapses out of the guard while an
   overnight disappearance does not. */
export const PEAK_TTL_DAYS = 45;

/* The high-water marks to carry into the next run. A competition sets a
   new peak when it beats its old one; otherwise its previous peak and,
   importantly, its previous timestamp are kept, so a season in decline
   stops refreshing and eventually lapses. */
export function nextPeaks(previousPeaks, currentByComp, nowMs){
  const at = new Date(nowMs).toISOString();
  const out = {};
  for(const [comp, p] of Object.entries(previousPeaks || {}))
    if(p && Number.isFinite(p.n)) out[comp] = { n: p.n, at: p.at };
  for(const [comp, n] of Object.entries(currentByComp || {})){
    if(!(n > 0)) continue;
    if(!out[comp] || n >= out[comp].n) out[comp] = { n, at };
  }
  return out;
}

/* What a competition has to be measured against before it may read zero:
   whatever the previous run held, or a peak still inside its lifetime,
   whichever is larger. */
export function vanishBaseline(previousByComp, peaks, nowMs, ttlDays = PEAK_TTL_DAYS){
  const out = Object.assign({}, previousByComp || {});
  for(const [comp, p] of Object.entries(peaks || {})){
    if(!p || !Number.isFinite(p.n)) continue;
    const age = nowMs - Date.parse(p.at);
    if(!Number.isFinite(age) || age > ttlDays * 86400000) continue;   // lapsed: a season really ended
    if(!(out[comp] >= p.n)) out[comp] = p.n;
  }
  return out;
}

/* Two different questions, deliberately measured against two different
   things.

   Vanishing is judged against the peak, because a competition that had
   fixtures recently and has exactly none now is the failure this guard
   exists for, whether or not the previous run happened to hold any.

   Collapsing is judged only against the previous run, because a season
   running down loses fixtures steadily and comparing that to a peak set
   months earlier would call every autumn an outage. */
export function compFloorProblems(previousByComp, currentByComp, opts = {}){
  const min = opts.min == null ? FLOOR_MIN : opts.min;
  const fraction = opts.fraction == null ? FLOOR_FRACTION : opts.fraction;
  const now = currentByComp || {};
  const prev = previousByComp || {};
  const vanish = opts.vanishBaseline || prev;
  const out = [];
  for(const comp of new Set(Object.keys(prev).concat(Object.keys(vanish)))){
    const is = now[comp] || 0;
    const peak = vanish[comp] || 0;
    const was = prev[comp] || 0;
    if(is === 0 && peak >= min) out.push({ comp, was: peak, is, why: "vanished" });
    else if(is > 0 && was >= min && is < was * fraction) out.push({ comp, was, is, why: "collapsed" });
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
