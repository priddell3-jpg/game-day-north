/* Men's national teams — the parts of the build that are about them and
 * nothing else, kept pure so they can be tested without fetching.
 *
 * A nation is a team in the manifest like any club, and its fixtures go
 * through the same parser and the same matcher. What is here is what a
 * club never needed: a kickoff somebody else has also published, and a
 * competition whose whole entry list the manifest claims to hold.
 */

/* ---- a kickoff two sources have both stated --------------------------

   ESPN's feed is the live source and its time is the one shown. But a
   broadcaster's own listing is a second, independent statement of the
   same kickoff, and where the two differ the row has to say so rather
   than this file quietly preferring one. It is the treatment rugby
   already has for ESPN against World Rugby — the feed's reading stays
   as `start`, the other is kept beside it as `altStart` with the source
   named — applied to a listing instead of a second feed.

   Checked on 2026-09-29 against the raw feed: ESPN and TSN agree on
   both matches still to be played, to the minute. The table stays
   because agreement on the day it was checked is not agreement on the
   day of the match; a feed that moves a kickoff later is exactly what
   this exists to show.

   Each row names the match by competition, a nation and the listed
   instant rather than by ESPN's event id, so a re-minted id cannot
   detach a listing from its match. */
export const LISTED_KICKOFFS = [
  { comp: "INTF", team: "nt-can", start: "2026-10-03T18:00:00Z", source: "TSN",
    says: "CanMNT vs. Peru — Saturday, Oct. 3, 2 p.m. ET / 11 a.m. PT, Stade Saputo (Montreal), TSN4/5",
    url: "https://www.tsn.ca/soccer/article/canadas-national-teams-back-in-action-in-loaded-fall-soccer-lineup-on-tsn/" },
  { comp: "INTF", team: "nt-can", start: "2026-10-07T00:00:00Z", source: "TSN",
    says: "USA vs. CanMNT — Tuesday, Oct. 6, 8 p.m. ET / 5 p.m. PT, Allianz Field (Saint Paul, Minn.), TSN1",
    url: "https://www.tsn.ca/soccer/article/canadas-national-teams-back-in-action-in-loaded-fall-soccer-lineup-on-tsn/" }
];

/* Rugby's tolerance, for the same reason: two sources that mean the same
   kickoff can differ by a rounding, and that is not a disagreement. */
export const KICKOFF_TOLERANCE = 2 * 60000;
/* How far a feed's time may sit from a listing and still be the match
   the listing is about. Wide enough to catch a kickoff moved across
   midnight, and narrower than the three days between two matches of one
   international window, so a listing can never claim the next fixture. */
export const LISTING_REACH = 36 * 3600000;

/** Mark every fixture whose feed kickoff differs from a published one.
    Mutates the fixtures it marks and returns them. A fixture that agrees
    is cleared of any mark it carried, so a dispute that has resolved
    stops being reported. */
export function disputeKickoffs(fixtures, listings = LISTED_KICKOFFS){
  const disputed = [];
  for(const l of listings){
    const at = Date.parse(l.start);
    if(!Number.isFinite(at)) continue;
    let best = null;
    for(const f of fixtures || []){
      if(!f || f.comp !== l.comp) continue;
      if((f.home && f.home.id) !== l.team && (f.away && f.away.id) !== l.team) continue;
      const gap = Math.abs(f.start - at);
      if(gap > LISTING_REACH) continue;
      if(!best || gap < Math.abs(best.start - at)) best = f;
    }
    if(!best) continue;
    if(Math.abs(best.start - at) > KICKOFF_TOLERANCE){
      best.altStart = at;
      best.altSource = l.source;
      disputed.push(best);
    }else{
      delete best.altStart;
      delete best.altSource;
    }
  }
  return disputed;
}

/* ---- a name the manifest should have known ----------------------------

   The roster warning in the build asks which followable teams matched
   no fixture. For a club that is a good drift detector, because a club
   plays all season. For a nation it is mostly noise: between windows no
   nation has a fixture, and every one of them is reported.

   The Nations Leagues allow a sharper question, asked from the other
   side. The manifest was seeded from each competition's complete entry
   list, so every side in those two feeds should resolve to a nation. One
   that does not is a name that drifted — "Turkey" becoming "Türkiye" —
   and it is caught the first time the feed says it, not months later
   when somebody wonders why a nation never plays.

   The friendlies feed is deliberately not closed: Peru and India are in
   it and are not followable, which is a fact about the roster and not a
   failure to match. */
export const CLOSED_COMPS = ["UNL", "CNL"];

/** Names in a closed competition's events that resolve to no nation. */
export function unknownSides(events, comp, idFor){
  if(CLOSED_COMPS.indexOf(comp) < 0) return [];
  const out = new Set();
  for(const ev of events || []){
    const cp = (ev.competitions && ev.competitions[0]) || ev;
    for(const c of cp.competitors || []){
      const name = c && c.team && c.team.displayName;
      if(name && !idFor(name)) out.add(name);
    }
  }
  return [...out].sort();
}
