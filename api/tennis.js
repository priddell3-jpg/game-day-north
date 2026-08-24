/**
 * /api/tennis — the tennis source, normalised server-side.
 *
 * ESPN's two tennis scoreboards come to about 2 MB together, carry every
 * doubles draw nobody here asked for, and publish a Grand Slam twice —
 * once under each tour. Having every browser fetch that once a minute
 * would be indefensible, so one function does it, keeps the singles, and
 * lets the CDN hand the same answer to everyone asking the same question.
 * About 105 KB comes back for the whole singles field — a nineteenth of
 * what it was read from — and less than that for a narrowed view.
 *
 * Query, both optional and both inclusive; asking for nothing is asking
 * for all of it, which is what the page's default view wants:
 *   tours   comma-separated: atp, wta
 *   events  comma-separated ESPN event ids, e.g. 189-2026
 *
 * Caching: the CDN keeps a shared copy for 55 seconds, just under the
 * client's one-minute poll, so a room full of viewers watching the same
 * tournament costs one upstream fetch a minute rather than one each.
 * Browsers are told to revalidate every time, so nobody is looking at a
 * minute-old score believing it is current.
 */
import { parseScoreboard, assembleMatches } from "../scripts/lib/tennis.mjs";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/tennis/";
const TOURS = ["atp", "wta"];
const MAX_EVENTS = 30;           // a filter, not a query language
const UPSTREAM_TIMEOUT = 8000;

/* Last good parsed form of each tour, per warm instance. ESPN fails
   occasionally and a failure should not blank a score that was on screen
   a minute ago. This is a courtesy, not a store: a cold instance has
   nothing, which is why the client keeps its own last good answer too. */
const lastGood = new Map();      // tour -> {at, parsed}
const STALE_LIMIT = 15 * 60000;  // beyond this, admit to having nothing

async function fetchTour(tour){
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT);
  try{
    const r = await fetch(ESPN + tour + "/scoreboard", {signal: ctl.signal});
    if(!r.ok) throw new Error("HTTP " + r.status);
    const parsed = parseScoreboard(await r.json());
    lastGood.set(tour, {at: Date.now(), parsed});
    return {tour, parsed, stale: false};
  }catch(err){
    const held = lastGood.get(tour);
    if(held && Date.now() - held.at < STALE_LIMIT){
      return {tour, parsed: held.parsed, stale: true, at: held.at,
              error: String(err && err.message || err)};
    }
    return {tour, parsed: {matches: [], tournaments: []}, failed: true,
            error: String(err && err.message || err)};
  }finally{ clearTimeout(timer); }
}

const oneOf = v => Array.isArray(v) ? v[0] : v;

export default async function handler(req, res){
  const url = new URL(req.url, "http://localhost");
  const q = url.searchParams;

  const listed = k => String(oneOf(q.get(k)) || "").split(/[,.]/).map(v => v.trim()).filter(Boolean);

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control",
    "public, s-maxage=55, stale-while-revalidate=300, max-age=0, must-revalidate");

  /* Only the two tours exist, so an unknown one is dropped rather than
     passed upstream. Naming neither means both. */
  const rawTours = listed("tours");
  const asked = rawTours.map(t => t.toLowerCase()).filter(t => TOURS.includes(t));
  const tours = asked.length ? [...new Set(asked)].sort() : TOURS;

  /* An ESPN event id is digits, a hyphen and a year. Anything else is not
     one, and is discarded rather than echoed back or sent anywhere. */
  const rawEvents = listed("events");
  const events = [...new Set(rawEvents.filter(e => /^\d{1,6}-\d{4}$/.test(e)))]
    .sort().slice(0, MAX_EVENTS);

  /* Asking for nothing is asking for all of it. Asking for something that
     does not exist is not: a request naming only tournaments that have
     finished gets an empty answer, so a stale filter reads as "nothing
     there" rather than silently widening to the whole field. */
  const askedForNothingReal = (rawTours.length && !asked.length) ||
                              (rawEvents.length && !events.length);
  if(askedForNothingReal){
    res.statusCode = 200;
    res.end(JSON.stringify({generated: new Date().toISOString(), tournaments: [], matches: [],
      counts: {parsed: 0, deduped: 0, retained: 0, returned: 0, tournaments: 0}, tours: []}));
    return;
  }

  const results = await Promise.all(tours.map(fetchTour));
  const out = assembleMatches(results.map(r => r.parsed), {
    now: Date.now(),
    tours: asked.length ? asked.map(t => t.toUpperCase()) : null,
    events: events.length ? events : null
  });

  out.tours = results.map(r => ({
    tour: r.tour,
    ok: !r.failed,
    stale: !!r.stale,
    ...(r.at ? {at: new Date(r.at).toISOString()} : {}),
    ...(r.error ? {error: r.error} : {})
  }));

  /* Every source failing with nothing held is the one case where the
     answer is "I don't know" rather than "no matches" — the client must
     be able to tell those apart, or an outage looks like a quiet day. */
  if(results.every(r => r.failed)){
    res.statusCode = 503;
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({error: "tennis source unavailable", tours: out.tours,
      matches: null, tournaments: null}));
    return;
  }
  res.statusCode = 200;
  res.end(JSON.stringify(out));
}
