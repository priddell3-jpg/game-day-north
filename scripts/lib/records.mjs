/* A team's record — the full table for every competition, so that a row
 * on the board can say where each side stands.
 *
 * ---- why this is a second source list and not more RACE_SOURCES -----
 *
 * Race answers "who is in the race". Its views are chosen for that: the
 * MLB source is the wild-card view, which is twelve non-division-leaders
 * per league and therefore silently missing three of fifteen American
 * League clubs. Its groups carry qualification zones, a hold that
 * survives a brief outage, and a contract that an unorderable group is
 * not published at all — all of which exist because a Race card is about
 * a cutoff.
 *
 * A record answers "how has this team done", and needs the opposite
 * shape: every team, every competition, no slice and no zone. Extending
 * the Race sources to also yield full tables would have meant giving
 * every Race group a second personality and teaching the page which one
 * it was holding. These two features currently share exactly one thing —
 * the normaliser in race.mjs — and that is the right amount.
 *
 * So the parser is reused wholesale and only the source list is new.
 *
 * ---- what a table has to prove before it may be published -----------
 *
 * Two states both look like a working table and are not one, and both
 * were live in the payloads on the day this was written.
 */
import { RACE_KINDS } from "./race.mjs";

const SITE = "https://site.api.espn.com/apis/v2/sports/";

/* One full table per competition. The North American leagues are asked
   at level=3, which is by division: that is the only view that returns
   every club AND publishes a position within a group small enough for
   "2nd in the Atlantic" to mean something.

   The EFL is absent on purpose. `EFL` in this app is the Carabao Cup,
   which is a knockout and has no table — its standings endpoint answers
   200 with no standings block at all. Clubs in it are Premier League
   clubs, and their record comes from the Premier League table, which is
   the right answer anyway. */
export const TABLE_SOURCES = [
  { comp: "NHL",    kind: RACE_KINDS.DIVISION, url: SITE + "hockey/nhl/standings?level=3",
    view: "divisions", label: "ESPN NHL division standings" },
  { comp: "NBA",    kind: RACE_KINDS.DIVISION, url: SITE + "basketball/nba/standings?level=3",
    view: "divisions", label: "ESPN NBA division standings" },
  { comp: "NFL",    kind: RACE_KINDS.DIVISION, url: SITE + "football/nfl/standings?level=3",
    view: "divisions", label: "ESPN NFL division standings" },
  { comp: "MLB",    kind: RACE_KINDS.DIVISION, url: SITE + "baseball/mlb/standings?level=3",
    view: "divisions", label: "ESPN MLB division standings" },
  { comp: "MLS",    kind: RACE_KINDS.TABLE,    url: SITE + "soccer/usa.1/standings",
    view: "conference tables", label: "ESPN MLS conference standings" },
  { comp: "EPL",    kind: RACE_KINDS.TABLE,    url: SITE + "soccer/eng.1/standings",
    view: "league table", label: "ESPN Premier League table", group: "table" },
  { comp: "LALIGA", kind: RACE_KINDS.TABLE,    url: SITE + "soccer/esp.1/standings",
    view: "league table", label: "ESPN LaLiga table", group: "table" },
  { comp: "SERIEA", kind: RACE_KINDS.TABLE,    url: SITE + "soccer/ita.1/standings",
    view: "league table", label: "ESPN Serie A table", group: "table" },
  { comp: "BUNDES", kind: RACE_KINDS.TABLE,    url: SITE + "soccer/ger.1/standings",
    view: "league table", label: "ESPN Bundesliga table", group: "table" },
  { comp: "LIGUE1", kind: RACE_KINDS.TABLE,    url: SITE + "soccer/fra.1/standings",
    view: "league table", label: "ESPN Ligue 1 table", group: "table" },
  { comp: "UCL",    kind: RACE_KINDS.TABLE,    url: SITE + "soccer/uefa.champions/standings",
    view: "league phase table", label: "ESPN Champions League table", group: "league" }
];

/* Has anything been played?

   A league in its preseason answers a complete, well-formed, entirely
   zero table: every NHL and NFL club reads 0-0 today. Every position in
   it is real and every record in it is a placeholder, so publishing it
   would put "0-0-0, 1st in the Atlantic" under thirty-two clubs. */
export function anythingPlayed(group){
  for(const r of (group && group.rows) || []){
    if(r.gp > 0) return true;
    if((r.w || 0) + (r.l || 0) + (r.d || 0) + (r.otl || 0) > 0) return true;
  }
  return false;
}

/* Is this table about the season now being played?

   The harder of the two, and the one that would have shipped a wrong
   answer rather than an empty one. The NBA today answers a complete
   2025-26 table — Boston 56-26, thirty clubs, every figure real — while
   its own fixtures for the next three months belong to 2026-27. Nothing
   inside the standings payload says it is stale: the season header at
   the top of the response describes the season about to start and
   disagrees with the standings block underneath it in the same way for
   MLB, whose 2026 season is very much in progress.

   The distinction that does hold is against the fixtures. The build has
   just asked each competition for its whole window, and every event
   states the season it belongs to. A table for a season the competition
   is not currently playing is last season's table.

   Absent knowledge is not evidence: a competition with no fixtures in
   the window tells us nothing, and its table is accepted rather than
   thrown away on a comparison that could not be made. */
export function isCurrentSeason(group, seasonYears){
  const years = seasonYears instanceof Set ? seasonYears : new Set(seasonYears || []);
  if(!years.size) return true;
  if(group == null || group.season == null) return true;
  return years.has(Number(group.season));
}

/* Both gates, and the reason a table failed one, for the build log. */
export function tableProblem(group, seasonYears){
  if(!group || !group.rows || !group.rows.length) return "no rows";
  if(!anythingPlayed(group)) return "nothing played yet";
  if(!isCurrentSeason(group, seasonYears))
    return "season " + group.season + ", but the fixtures are "
      + [...(seasonYears instanceof Set ? seasonYears : new Set(seasonYears || []))].join("/");
  return null;
}
