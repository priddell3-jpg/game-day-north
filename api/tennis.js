/**
 * /api/tennis — the tennis source, normalised server-side.
 *
 * ESPN's two tennis scoreboards come to about 2 MB together, carry every
 * doubles draw nobody here asked for, and publish a Grand Slam twice —
 * once under each tour. Having every browser fetch that once a minute to
 * find two players' matches would be indefensible, so one function does
 * it, reduces it to the matches actually being followed, and lets the CDN
 * hand the same answer to everyone who follows the same players.
 *
 * Query:
 *   players  dot-separated ESPN athlete ids     (required; no ids, no matches)
 *   tours    comma-separated: atp, wta          (optional, default both)
 *
 * Caching: the CDN keeps a shared copy for 55 seconds, which is just
 * under the client's one-minute poll, so a room full of viewers following
 * the same player costs one upstream fetch a minute rather than one each.
 * Browsers are told to revalidate every time, so nobody is ever looking
 * at a minute-old score believing it is current.
 */
import { parseScoreboard, assembleMatches } from "../scripts/lib/tennis.mjs";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/tennis/";
const TOURS = ["atp", "wta"];
const MAX_PLAYERS = 40;          // a picker, not a data export
const UPSTREAM_TIMEOUT = 8000;

/* Last good parsed form of each tour, per warm instance. ESPN fails
   occasionally and a failure should not blank a score that was on screen
   a minute ago. This is a courtesy, not a store: a cold instance has
   nothing, which is why the client keeps its own last good answer too. */
const lastGood = new Map();      // tour -> {at, matches}
const STALE_LIMIT = 15 * 60000;  // beyond this, admit to having nothing

async function fetchTour(tour){
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT);
  try{
    const r = await fetch(ESPN + tour + "/scoreboard", {signal: ctl.signal});
    if(!r.ok) throw new Error("HTTP " + r.status);
    const matches = parseScoreboard(await r.json());
    lastGood.set(tour, {at: Date.now(), matches});
    return {tour, matches, stale: false};
  }catch(err){
    const held = lastGood.get(tour);
    if(held && Date.now() - held.at < STALE_LIMIT){
      return {tour, matches: held.matches, stale: true, at: held.at,
              error: String(err && err.message || err)};
    }
    return {tour, matches: [], failed: true, error: String(err && err.message || err)};
  }finally{ clearTimeout(timer); }
}

const oneOf = v => Array.isArray(v) ? v[0] : v;

export default async function handler(req, res){
  const url = new URL(req.url, "http://localhost");
  const q = url.searchParams;

  /* Ids only — the identity ESPN assigns. Anything else is discarded
     rather than passed upstream or echoed back. */
  const players = String(oneOf(q.get("players")) || "")
    .split(/[.,]/).map(s => s.trim()).filter(s => /^\d{1,12}$/.test(s));
  const uniq = [...new Set(players)].slice(0, MAX_PLAYERS);

  const asked = String(oneOf(q.get("tours")) || "").toLowerCase()
    .split(",").map(s => s.trim()).filter(s => TOURS.includes(s));
  const tours = asked.length ? asked : TOURS;

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  /* s-maxage is the CDN's shared copy; max-age=0 with must-revalidate
     means the browser asks every time and gets a 304 when nothing moved.
     stale-while-revalidate keeps a slow upstream from becoming a gap. */
  res.setHeader("Cache-Control",
    "public, s-maxage=55, stale-while-revalidate=300, max-age=0, must-revalidate");

  /* Following nobody returns nothing. The full draw is never a response
     this endpoint can produce, whatever it is asked. */
  if(!uniq.length){
    res.statusCode = 200;
    res.end(JSON.stringify({generated: new Date().toISOString(), matches: [],
      counts: {parsed:0, deduped:0, retained:0, returned:0}, tours: []}));
    return;
  }

  const results = await Promise.all(tours.map(fetchTour));
  const out = assembleMatches(results.map(r => r.matches), {now: Date.now(), players: uniq});

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
    res.end(JSON.stringify({error: "tennis source unavailable", tours: out.tours, matches: null}));
    return;
  }
  res.statusCode = 200;
  res.end(JSON.stringify(out));
}
