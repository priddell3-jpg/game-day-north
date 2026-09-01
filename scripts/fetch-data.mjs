#!/usr/bin/env node
/**
 * Builds data.json: every fixture for the followable teams, with scores.
 *
 * Runs in CI, not in anyone's browser. That is the whole point — one
 * machine talks to ESPN on a schedule and commits the result, instead of
 * every visitor rediscovering the same endpoint quirks for themselves.
 *
 * Three of those quirks are load-bearing:
 *   - a game is filed under its US Eastern date, not UTC
 *   - the season schedule reports finished games as scheduled, 0-0;
 *     only the scoreboard carries the result
 *   - a YYYYMMDD-YYYYMMDD range silently returns the first day only.
 *     Soccer accepts YYYYMM for a whole month; the NA leagues do not.
 *
 * No dependencies. Node 20+ for built-in fetch.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { easternDate } from "./lib/dates.mjs";
import { isGCBlock, resultBlocks, ridersInBlock, gcLeaderFrom, gcStageFrom, freshestLeader,
         stageSections, titleWords, titleMatches } from "./lib/cycling.mjs";
import { RUGBY_COMPS, fromEspnEvent, fromWrMatch, dedupe, isTerminal,
         FORWARD_DAYS as RUGBY_FORWARD } from "./lib/rugby.mjs";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/";
const PATHS = {
  NHL:"hockey/nhl", NBA:"basketball/nba", NFL:"football/nfl", MLB:"baseball/mlb",
  MLS:"soccer/usa.1", EPL:"soccer/eng.1", UCL:"soccer/uefa.champions",
  EFL:"soccer/eng.league_cup", FAC:"soccer/eng.fa",
  LALIGA:"soccer/esp.1", SERIEA:"soccer/ita.1", BUNDES:"soccer/ger.1", LIGUE1:"soccer/fra.1"
};
const NA = new Set(["NHL","NBA","NFL","MLB"]);
const DAY = 86400000;
const BACK = 8, FORWARD = 75;          // days of history / lookahead to keep

/* The followable roster. Kept in step with TEAM_ROWS in src/page.html —
   if you add a team there, add it here or its fixtures won't be built. */
const ROSTER = [
["tor-nhl","NHL","Toronto Maple Leafs"],["van-nhl","NHL","Vancouver Canucks"],
["edm","NHL","Edmonton Oilers"],["cgy","NHL","Calgary Flames"],
["ott","NHL","Ottawa Senators"],["mtl-nhl","NHL","Montreal Canadiens"],
["wpg","NHL","Winnipeg Jets"],["bos-nhl","NHL","Boston Bruins"],
["nyr","NHL","New York Rangers"],["vgk","NHL","Vegas Golden Knights"],
["sea-nhl","NHL","Seattle Kraken"],["col","NHL","Colorado Avalanche"],
["tor-nba","NBA","Toronto Raptors"],["gsw","NBA","Golden State Warriors"],
["lal","NBA","Los Angeles Lakers"],["bos-nba","NBA","Boston Celtics"],
["den","NBA","Denver Nuggets"],["okc","NBA","Oklahoma City Thunder"],
["nyk","NBA","New York Knicks"],
["sea-nfl","NFL","Seattle Seahawks"],["buf","NFL","Buffalo Bills"],
["sf","NFL","San Francisco 49ers"],["kc","NFL","Kansas City Chiefs"],
["dal","NFL","Dallas Cowboys"],["phi","NFL","Philadelphia Eagles"],
["det","NFL","Detroit Lions"],
["tor-mlb","MLB","Toronto Blue Jays"],["sea-mlb","MLB","Seattle Mariners"],
["lad","MLB","Los Angeles Dodgers"],["nyy","MLB","New York Yankees"],
["bos-mlb","MLB","Boston Red Sox"],["cle","MLB","Cleveland Guardians"],
["liv","EPL","Liverpool"],["ars","EPL","Arsenal"],["mci","EPL","Manchester City"],
["mun","EPL","Manchester United"],["che","EPL","Chelsea"],["tot","EPL","Tottenham Hotspur"],
["new","EPL","Newcastle United"],
["rma","LALIGA","Real Madrid"],["bar","LALIGA","Barcelona"],
["bay","BUNDES","Bayern Munich"],["psg","LIGUE1","Paris Saint-Germain"],["int","SERIEA","Internazionale"],
["van-mls","MLS","Vancouver Whitecaps"],["tfc","MLS","Toronto FC"],
["mtl-mls","MLS","CF Montreal"],["lafc","MLS","LAFC"],
["mia","MLS","Inter Miami CF"],["sou","MLS","Seattle Sounders FC"]
];
/* Clubs that enter competitions beyond their own league. */
const EXTRA = { EPL:["EFL","FAC","UCL"], LALIGA:["UCL"], BUNDES:["UCL"], LIGUE1:["UCL"], SERIEA:["UCL"] };

const norm = x => (x||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]/g,"");
const pad = n => String(n).padStart(2,"0");
/* Names the feed uses that no rule could derive from ours. Each of these
   silently detached a club until the unmatched-team warning caught it. */
const ALIASES = {
  int:  ["Inter Milan", "Inter"],
  lafc: ["Los Angeles FC"],
  "van-mls": ["Vancouver Whitecaps FC"],
  sou:  ["Seattle Sounders"],
  mia:  ["Inter Miami"],
  "mtl-mls": ["CF Montréal", "Montreal Impact"],
  psg:  ["PSG", "Paris SG"],
  bay:  ["Bayern München", "FC Bayern München"],
  rma:  ["Real Madrid CF"],
  bar:  ["FC Barcelona"]
};

/* Match on the name, and on the name minus a club suffix. ESPN says
   "Vancouver Whitecaps" where the roster said "Vancouver Whitecaps FC",
   and that one word silently detached every one of their fixtures from
   the person following them. Tolerate the difference both ways. */
const trimSuffix = n => n.replace(/\b(fc|cf|sc|afc)\b/gi, "").replace(/\s+/g," ").trim();
const NAME_TO_ID = new Map();
for(const [id,,name] of ROSTER){
  const variants = [name].concat(ALIASES[id] || []);
  for(const v of variants){
    if(!NAME_TO_ID.has(norm(v))) NAME_TO_ID.set(norm(v), id);
    const bare = norm(trimSuffix(v));
    if(bare && !NAME_TO_ID.has(bare)) NAME_TO_ID.set(bare, id);
  }
}
function idFor(displayName){
  const n = norm(displayName);
  if(NAME_TO_ID.has(n)) return NAME_TO_ID.get(n);
  const bare = norm(trimSuffix(displayName || ""));
  return NAME_TO_ID.get(bare) || null;
}

function monthKeys(from, to){
  const out = [], d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while(d <= to){ out.push(d.getUTCFullYear()+pad(d.getUTCMonth()+1)); d.setUTCMonth(d.getUTCMonth()+1); }
  return out;
}
let calls = 0, failures = 0, consecutive = 0, ok = 0;
async function get(url){
  calls++;
  // If the very first requests all fail there is no route to the API at
  // all. Bail immediately rather than spending twenty minutes proving it.
  if(!ok && consecutive >= 3){
    throw new Error("no route to the sports API — " + consecutive + " requests failed with nothing succeeding");
  }
  for(let attempt=0; attempt<2; attempt++){
    try{
      const res = await fetch(url, {headers:{"accept":"application/json"}, signal:AbortSignal.timeout(15000)});
      if(res.status === 404){ ok++; consecutive = 0; return null; }   // routine: out of season
      if(!res.ok) throw new Error("HTTP "+res.status);
      const j = await res.json();
      ok++; consecutive = 0;
      return j;
    }catch(err){
      if(attempt === 1){
        failures++; consecutive++;
        console.warn("  ! " + url.replace(ESPN,"") + " — " + err.message);
        return null;
      }
      await new Promise(r=>setTimeout(r, 700));
    }
  }
}
/* Where the match is actually being played, as the source states it.

   This is a fact about the FIXTURE, not about the home club, and the
   difference is not academic: the 2026 League Cup final is filed as
   "Manchester City at Arsenal" and played at Wembley. Reading a location
   off the home team would have labelled it with Arsenal's own ground.

   Deliberately no mapping and no inference. If ESPN states a venue it is
   carried through verbatim; if it states none, the fixture carries none
   and the page shows nothing rather than guessing. ESPN populates this
   on every soccer and North American event seen so far, on both the
   scoreboard and the per-team season schedule. */
function venueOf(cp){
  const v = cp && cp.venue;
  if(!v) return null;
  const a = v.address || {};
  const out = {};
  if(v.fullName) out.name = v.fullName;
  if(a.city) out.city = a.city;
  /* state is a US/Canadian field and is absent for English grounds;
     country is absent for US ones. Both are kept when given because
     "Kansas City" alone is two different places. */
  if(a.state) out.state = a.state;
  if(a.country) out.country = a.country;
  return Object.keys(out).length ? out : null;
}

function parseEvent(ev, comp){
  const cp = (ev.competitions && ev.competitions[0]) || ev;
  const cs = cp.competitors || [];
  const H = cs.find(c=>c.homeAway==="home") || cs[0];
  const A = cs.find(c=>c.homeAway==="away") || cs[1];
  if(!H || !A || !H.team || !A.team) return null;
  const start = Date.parse(ev.date || cp.date);
  if(!start) return null;
  const ty = ((cp.status || ev.status || {}).type) || {};
  const nm = ty.name || "";
  const status = /FINAL|FULL_TIME|POST/.test(nm) ? "final"
               : /IN_PROGRESS|HALFTIME|END_PERIOD|FIRST_HALF|SECOND_HALF|DELAY|RAIN/.test(nm) ? "live"
               : "scheduled";
  const num = v => { const n = parseInt(String(v==null?"":v).replace(/[^0-9-]/g,""),10); return Number.isNaN(n)?null:n; };
  const side = c => {
    const t = c.team;
    return { id: idFor(t.displayName),
             name: t.displayName || t.name || "", abbr: (t.abbreviation||"?").slice(0,4),
             /* ESPN's team.location is the club's own label, and for
                soccer that is the club name rather than a town —
                "Ipswich Town", "New York City FC". It is kept because
                the roster matches against it, but it is NOT where the
                page gets a location from: that comes from venueOf above,
                which is a fact about the fixture. */
             city: t.location || "",
             color: t.color ? "#"+String(t.color).replace("#","") : null };
  };
  const sh = num(H.score && H.score.displayValue != null ? H.score.displayValue : H.score);
  const sa = num(A.score && A.score.displayValue != null ? A.score.displayValue : A.score);
  const venue = venueOf(cp);
  return {
    /* The source's own event id. Team names drift, start times move, and
       a composite key built from them has to guess whether two records
       are one game. An id does not guess. Kept as eid so it never
       collides with the page's internal row ids. */
    eid: (ev.id != null ? String(ev.id) : (cp.id != null ? String(cp.id) : null)),
    comp, start, home: side(H), away: side(A), status,
    ...(venue ? {venue} : {}),
    label: ty.shortDetail || ty.description || (status==="final" ? "Final" : ""),
    score: (status === "scheduled" || sh === null || sa === null) ? null : [sh, sa]
  };
}
/* ---- one event, asked about by its own id ------------------------------

   A score used to be read only off the scoreboard for the day a fixture
   falls on. That is one request for however many games are on, which is
   why it was built that way, but it makes every result on that date
   depend on one page being complete: whatever is not in it — not filed
   there yet, served short — is a fixture nothing can settle, and the row
   stays "scheduled" until something else happens to fix it.

   Royals at Blue Jays on 26 Aug 2026 is the case this was written for.
   It sat in data.json reading "scheduled" long after the final out,
   while this endpoint, asked for that one event by id, had the complete
   post-game record. Why the day route did not carry it was not
   established; that it needed a second route was.

   So a fixture whose event id we already hold is asked about by that id.
   The scoreboard remains the source for fixtures that carry no id, and
   for discovering games the season schedule omits.

   The response is enormous — the boxscore, every pitch, odds, standings,
   and 892 KB of it for one baseball game. Only header.competitions[0] is
   read; the rest is parsed and dropped. Note that a summary states no
   venue there (it files one under gameInfo), which is why applySummary
   below patches a fixture in place instead of replacing it. */
function parseSummary(sum, comp){
  const h = sum && sum.header;
  const cp = h && Array.isArray(h.competitions) && h.competitions[0];
  if(!cp) return null;
  return parseEvent({ id: h.id != null ? h.id : cp.id, date: cp.date, competitions: [cp] }, comp);
}

/* Take a summary's status and score into the fixture it was asked about.

   The id was ours to begin with, so this is not an identity question —
   but it is still a question of which way round the two copies list the
   clubs, and a score whose orientation cannot be established is worse
   than no score at all. Undecidable means nothing is applied.

   A known final is never erased by a copy carrying no score: the same
   rule the page applies wherever two records of one fixture meet. */
function applySummary(f, s){
  if(!f || !s) return false;
  const k = t => t.id || norm(t.name);
  const straight = k(s.home)===k(f.home) && k(s.away)===k(f.away);
  const reversed = k(s.home)===k(f.away) && k(s.away)===k(f.home);
  if(!straight && !reversed) return false;
  if(f.status === "final" && f.score && !s.score) return false;
  const sc = s.score && reversed ? [s.score[1], s.score[0]] : s.score;
  if(f.status === s.status && f.label === s.label &&
     JSON.stringify(f.score) === JSON.stringify(sc)) return false;
  f.status = s.status;
  f.label = s.label;
  f.score = sc;
  return true;
}

const SAME = 4*3600000;
function sameGame(a,b){
  if(a.comp !== b.comp || Math.abs(a.start-b.start) >= SAME) return false;
  const k = s => s.id || norm(s.name);
  return (k(a.home)===k(b.home) && k(a.away)===k(b.away))
      || (k(a.home)===k(b.away) && k(a.away)===k(b.home));
}

const now = Date.now();
const fixtures = [];
function add(f){
  if(!f) return;
  if(f.start < now - BACK*DAY || f.start > now + FORWARD*DAY) return;
  if(!f.home.id && !f.away.id) return;                 // nobody follows either club
  const i = fixtures.findIndex(x=>sameGame(x,f));
  if(i < 0){ fixtures.push(f); return; }
  if(f.score && !fixtures[i].score){
    // the copy with a score wins, but must not lose a venue it lacks:
    // the season schedule and the scoreboard do not always both state one
    if(!f.venue && fixtures[i].venue) f.venue = fixtures[i].venue;
    fixtures[i] = f;
  } else if(!fixtures[i].venue && f.venue){
    fixtures[i].venue = f.venue;
  }
}

const comps = new Set();
ROSTER.forEach(([,comp])=>{ comps.add(comp); (EXTRA[comp]||[]).forEach(c=>comps.add(c)); });

console.log("Building fixtures for " + ROSTER.length + " teams across " + comps.size + " competitions");

// North American leagues: per-team season schedules give the long tail
const espnIds = {};
for(const comp of [...comps].filter(c=>NA.has(c))){
  const list = await get(ESPN + PATHS[comp] + "/teams?limit=500");
  const teams = (((list||{}).sports||[{}])[0].leagues||[{}])[0].teams || [];
  for(const w of teams){
    const t = w.team; if(!t) continue;
    const id = idFor(t.displayName);
    if(id) espnIds[id] = { comp, espn: t.id };
  }
}
for(const [id, meta] of Object.entries(espnIds)){
  const sched = await get(ESPN + PATHS[meta.comp] + "/teams/" + meta.espn + "/schedule");
  (((sched||{}).events)||[]).forEach(ev=>add(parseEvent(ev, meta.comp)));
}

// ...and per-date scoreboards for the near window, which carries scores
// the season schedule does not and turns up games it omits entirely.
// Since the summary top-up below, this is no longer the last word on a
// score — it is what a fixture with no event id has, and a first answer
// for everything else.
const nearDays = [];
for(let d=-BACK; d<=3; d++) nearDays.push(easternDate(now + d*DAY));
for(const comp of [...comps].filter(c=>NA.has(c))){
  for(const day of nearDays){
    const r = await get(ESPN + PATHS[comp] + "/scoreboard?dates=" + day);
    (((r||{}).events)||[]).forEach(ev=>add(parseEvent(ev, comp)));
  }
}

// Soccer answers a month at a time
const months = monthKeys(new Date(now - BACK*DAY), new Date(now + FORWARD*DAY));
for(const comp of [...comps].filter(c=>!NA.has(c))){
  for(const m of months){
    const r = await get(ESPN + PATHS[comp] + "/scoreboard?dates=" + m + "&limit=400");
    (((r||{}).events)||[]).forEach(ev=>add(parseEvent(ev, comp)));
  }
}

/* Score top-up, one event at a time.

   Everything that has started and is not settled gets asked about by its
   own id, whatever the day's scoreboard said. A fixture already carrying
   a final is left alone; so is one with no event id, which has nothing
   to ask with and keeps whatever the scoreboard gave it.

   Newest first, and capped: a postponement that never resolves would
   otherwise be re-asked on every run for the eight days it stays in the
   window. If the cap bites it is said out loud rather than quietly
   leaving the oldest fixtures looking settled. */
const SUMMARY_CAP = 40;
const stale = fixtures
  .filter(f => f.eid && PATHS[f.comp] && f.start <= now && !(f.status === "final" && f.score))
  .sort((a,b) => b.start - a.start);
if(stale.length > SUMMARY_CAP){
  console.warn("  ! " + stale.length + " unsettled fixtures, asking about the " +
    SUMMARY_CAP + " most recent — the rest keep what the scoreboard gave them");
}
let toppedUp = 0;
for(const f of stale.slice(0, SUMMARY_CAP)){
  const r = await get(ESPN + PATHS[f.comp] + "/summary?event=" + encodeURIComponent(f.eid));
  if(applySummary(f, parseSummary(r, f.comp))) toppedUp++;
}
if(stale.length){
  console.log("Summary top-up: " + toppedUp + " of " +
    Math.min(stale.length, SUMMARY_CAP) + " unsettled fixtures moved on");
}

fixtures.sort((a,b)=>a.start-b.start);

/* The previously committed file. Three things read it: the outage guard
   below, the no-change guard, and the cycling block, which keeps a
   settled stage result rather than re-fetching one that cannot change. */
let previous = null;
try{ previous = JSON.parse(readFileSync(new URL("../data.json", import.meta.url), "utf8")); }catch(e){}

/* ============================================================
   CYCLING RESULTS — stage podiums and the race lead, from Wikipedia.

   Wikipedia is the deliberate source choice: the MediaWiki API is
   explicitly open to automation and the licence permits reuse, where
   ProCyclingStats has actively reserved against scraping. Results for
   WorldTour races land on Wikipedia within hours of a finish.

   Grand Tours keep per-stage results in split articles ("<race>, Stage
   1 to Stage 11"). Those are the correct titles — the main article's
   leadership table links to exactly them — but they are created only
   once the race is under way, so early on the main article is the only
   source, and it carries the standings as a plain wikitable instead.

   Within a stage section the results are not tables at all: each
   classification is a run of {{cyclingresult}} templates opened by
   {{cyclingresult start|title=...}}, the stage result first and the
   general classification second. A parse that cannot produce exactly
   three names produces nothing: results are fetched or absent, never
   invented. A team time trial and a neutralised stage both correctly
   yield nothing, having no rider podium to report.
   ============================================================ */
const WIKI_API = "https://en.wikipedia.org/w/api.php";
const WIKI_UA = "GameDayNorth/1.0 (personal sports schedule; github.com/priddell3-jpg/game-day-north)";
const CYCLING_SOURCES = [
  {name:"Vuelta a España",
   /* the race's own promotional site publishes the day's timetable —
      the one source whose whole purpose is telling people when to watch */
   official:{base:"https://www.lavuelta.es/en/stage-", tz:"+02:00"},
   dates:[
    "2026-08-22","2026-08-23","2026-08-24","2026-08-25","2026-08-26","2026-08-27",
    "2026-08-28","2026-08-29","2026-08-30","2026-09-01","2026-09-02","2026-09-03",
    "2026-09-04","2026-09-05","2026-09-06","2026-09-08","2026-09-09","2026-09-10",
    "2026-09-11","2026-09-12","2026-09-13"],
   /* The split per-stage articles are the right titles — the main
      article's leadership table links to exactly these — but they are
      created only once the race is under way, so the main article is
      listed too: early on it is the only place the leader appears. */
   pages:["2026 Vuelta a España, Stage 1 to Stage 11","2026 Vuelta a España, Stage 12 to Stage 21",
          "2026 Vuelta a España"]},
  {name:"Bretagne Classic", dates:["2026-08-30"], oneDay:true, pages:["2026 Bretagne Classic"]},
  {name:"GP de Québec", dates:["2026-09-11"], oneDay:true, pages:["2026 Grand Prix Cycliste de Québec"]},
  {name:"GP de Montréal", dates:["2026-09-13"], oneDay:true, pages:["2026 Grand Prix Cycliste de Montréal"]},
  {name:"Il Lombardia", dates:["2026-10-10"], oneDay:true, pages:["2026 Il Lombardia"]},
  {name:"Tour of Guangxi", dates:[
    "2026-10-13","2026-10-14","2026-10-15","2026-10-16","2026-10-17","2026-10-18"],
   pages:["2026 Tour of Guangxi"]}
];
async function wikitextOf(title){
  const url = WIKI_API + "?action=parse&prop=wikitext&format=json&formatversion=2&redirects=1&page="
    + encodeURIComponent(title);
  try{
    const res = await fetch(url, {headers:{"user-agent":WIKI_UA, "accept":"application/json"},
      signal:AbortSignal.timeout(20000)});
    if(!res.ok) return null;
    const j = await res.json();
    const text = (j.parse && j.parse.wikitext) || null;
    if(!text) return null;
    /* A title that does not exist yet can still answer, by redirecting
       to a season overview — "2026 Il Lombardia" lands on "2026 UCI
       World Tour". Parsing that would attribute one page's contents to
       a race it says nothing about. Reject an answer whose title shares
       no significant word with the request, and name the mismatch so
       the title can be corrected rather than quietly returning nothing. */
    const got = (j.parse && j.parse.title) || "";
    if(!titleMatches(title, got)){
      console.warn("  ! \"" + title + "\" resolved to \"" + got
        + "\" — no shared words, treating as missing; the title needs fixing");
      return null;
    }
    return text;
  }catch(e){ return null; }
}
const todayISO = new Date(now).toISOString().slice(0,10);
const prevCycling = (previous && Array.isArray(previous.cycling)) ? previous.cycling : [];
const cyclingOut = [];
/* A stage entry may exist only to carry a timetable, so a podium is a
   stage that actually has three riders, not merely a stage present. */
const podiumCount = r => (r && r.stages || []).filter(x=>x && Array.isArray(x.top3) && x.top3.length===3).length;
try{
  for(const rc of CYCLING_SOURCES){
    if(rc.dates[0] > todayISO) continue;                       // hasn't started
    const prev = prevCycling.find(x=>x.race===rc.name) || {};
    const prevStages = prev.stages || [];
    const settled = d => prevStages.find(x=>x.date===d && Array.isArray(x.top3) && x.top3.length===3);
    const due = rc.dates.filter(d=>d <= todayISO && !(settled(d) && d < todayISO));
    let stages = rc.dates.filter(d=>d <= todayISO).map(settled).filter(Boolean);
    /* The leader carries forward with the stage it was read after, so a
       value kept from a previous run can be compared for freshness
       against anything parsed this run rather than outranking it. */
    let leader = prev.leader || null;
    let leaderStage = Number.isFinite(prev.leaderStage) ? prev.leaderStage : null;
    if(due.length){
      const texts = [];
      for(const pg of rc.pages){ const t = await wikitextOf(pg); if(t) texts.push(t); }
      if(texts.length){
        if(rc.oneDay){
          // one table, after a Result heading where there is one
          const t = texts[0];
          const at = t.search(/^=+\s*Results?\s*=+\s*$/im);
          const blocks = resultBlocks(at >= 0 ? t.slice(at) : t).filter(b=>!isGCBlock(b));
          const top3 = blocks.length ? ridersInBlock(blocks[0], 3) : [];
          stages = top3.length === 3 ? [{date:rc.dates[0], top3}] : stages;
        } else {
          const sections = {};
          texts.forEach(t=>Object.assign(sections, stageSections(t)));
          const fresh = [];
          /* Every source offers a leader together with the stage its
             standings are current to, and the freshest offer wins.
             Freshness is compared, not assumed. */
          const offers = [];
          rc.dates.forEach((date, i)=>{
            if(date > todayISO) return;
            const sec = sections[i+1];
            const blocks = sec ? resultBlocks(sec) : [];
            /* The GC is read from every stage section present, including
               one whose podium is already settled. A podium cannot
               change once ridden but the standings under it can, and
               returning early on a settled stage meant only the current
               day's GC was ever consulted — which froze the leader at a
               rider who had since abandoned the race. */
            const gcBlock = blocks.filter(isGCBlock)[0];
            if(gcBlock) offers.push([ridersInBlock(gcBlock, 1)[0], i + 1]);
            const kept = settled(date);
            if(kept && date < todayISO){ fresh.push(kept); return; }
            if(!blocks.length) return;
            const notGC = blocks.filter(b=>!isGCBlock(b));
            // prefer the block actually titled as the stage result; a
            // neutralised stage carries a "time gaps" block instead
            const res = notGC.filter(b=>/result/i.test(b.slice(0,240)))[0] || notGC[0] || "";
            const top3 = ridersInBlock(res, 3);
            if(top3.length === 3) fresh.push({date, top3});
          });
          if(fresh.length) stages = fresh;
          /* The main article carries the standings too, and before any
             split article exists it is the only place they appear. It
             competes on the stage number in its caption rather than
             filling in only when nothing else was found: gated behind a
             leader that had been carried forward, it could never be
             reached, because a carried value is always truthy. */
          for(const t of texts){
            const at = gcStageFrom(t);
            if(at) offers.push([gcLeaderFrom(t), at]);
          }
          /* The value carried from the previous run competes rather than
             being replaced by whatever happened to parse. It is offered
             last, so a fresh reading of the same stage supersedes it
             while an older one cannot: stages 12 onwards live in a split
             article that does not exist until the race reaches them, and
             on a run that reaches only the stage 1-11 article, its "GC
             after stage 11" must not walk a stage-12 leader backwards. */
          offers.push([leader, leaderStage]);
          const pick = freshestLeader(offers);
          if(pick){ leader = pick.leader; leaderStage = pick.leaderStage; }
        }
      }
    }
    /* Start and expected-finish times from the official race site, for
       today's stage and tomorrow's. Fetched fresh each run because
       timetables shift; at most two small requests per race per run.
       Times are the site's local clock, made absolute via the race's
       fixed UTC offset. */
    /* A timetable is a fact about a day, and it does not stop being
       true once the day passes. The fetch window only covers today and
       the next two, and the stages array is rebuilt each run from
       settled podiums, so without this a past stage silently reverted
       to "All day". Carry any previously known times forward, filling
       only what is missing so a freshly fetched time still wins, and
       merging into the settled entry rather than displacing it. */
    const TIME_KEYS = ["start","startUtc","finish","finishUtc"];
    prevStages.forEach(p=>{
      if(!p || !p.date || !TIME_KEYS.some(k=>p[k] != null)) return;
      let entry = stages.find(x=>x && x.date === p.date);
      if(!entry){ entry = {date:p.date}; stages.push(entry); }
      TIME_KEYS.forEach(k=>{ if(entry[k] == null && p[k] != null) entry[k] = p[k]; });
    });
    stages.sort((a,b)=>a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    if(rc.official){
      let fetched = 0;
      for(let i = 0; i < rc.dates.length; i++){
        const date = rc.dates[i];
        const ahead = Date.parse(date) - Date.parse(todayISO);
        if(ahead > 2*86400000) break;              // not published this far out
        const known = stages.find(x=>x && x.date === date && x.startUtc != null);
        /* Today and the next two are refetched because timetables shift.
           An earlier day is fetched only to fill a gap — a stage whose
           times were lost before they were carried forward. */
        if(ahead < 0 && known) continue;
        if(fetched >= 4) break;                    // bound the work per run
        fetched++;
        try{
          const res = await fetch(rc.official.base + (i+1), {headers:{
            "user-agent":WIKI_UA, "accept":"text/html"}, signal:AbortSignal.timeout(15000)});
          if(!res.ok) continue;
          /* Scripts first: their contents are not page text and can
             carry digits that look like a clock. */
          const text = (await res.text())
            .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
            .replace(/<[^>]+>/g, " ");
          /* The label depends on the stage type, and the site puts a
             space before the colon: a mass-start stage is neutralised
             and has an expected arrival, while a time trial has a first
             start and a last arrival. */
          const st  = text.match(/(?:Neutrali[sz]ed|First)\s+start\s*:?\s*(\d{1,2})[:h.](\d{2})/i);
          const fin = text.match(/(?:Expected|Last)\s+arrival\s*:?\s*(\d{1,2})[:h.](\d{2})/i);
          if(!st) continue;
          const p2 = x => String(x).padStart(2, "0");
          const at = m => Date.parse(date + "T" + p2(m[1]) + ":" + m[2] + ":00" + rc.official.tz);
          let entry = stages.find(x=>x.date===date);
          if(!entry){ entry = {date}; stages.push(entry); }
          entry.start = p2(st[1]) + ":" + st[2];
          entry.startUtc = at(st);
          if(fin){ entry.finish = p2(fin[1]) + ":" + fin[2]; entry.finishUtc = at(fin); }
        }catch(e){ /* timetable is a nicety — never let it cost a run */ }
      }
    }
    stages.sort((a,b)=>a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    if(stages.length || leader) cyclingOut.push({race:rc.name, oneDay:!!rc.oneDay, leader, leaderStage, stages});
  }
  const podiums = cyclingOut.reduce((a,r)=>a+podiumCount(r), 0);
  console.log("Cycling (Wikipedia): " + podiums + " stage podium" + (podiums===1?"":"s")
    + " across " + cyclingOut.length + " race(s)");
}catch(e){
  console.warn("  ! cycling results skipped — " + (e && e.message || e));
  if(prevCycling.length && !cyclingOut.length) cyclingOut.push(...prevCycling);
}


/* ============================================================
   MEN'S INTERNATIONAL RUGBY UNION

   Two independent sources, deliberately kept independent. ESPN carries
   the six numbered rugby leagues; World Rugby's own match feed carries
   the Pacific Nations Cup and the World Rugby Nations Cup, which ESPN
   has no league for at all, and the Nations Championship finals
   weekend, which ESPN's copy of that competition omits.

   Neither may suppress the other. A competition reachable through only
   one of them must still appear when the other is unreachable, so each
   adapter is wrapped on its own and a failure is recorded rather than
   thrown. What could not be reached is reported; nothing is filled in.
   ============================================================ */
const RUGBY_BACK_DAYS = 5;      // the browser applies the exact 3-local-day
                                // cutoff; the file keeps a superset, because
                                // "three local days" is 26 hours wider in
                                // Auckland than in Vancouver and the build
                                // does not know where the reader is
const rugbyFrom = now - RUGBY_BACK_DAYS*DAY, rugbyTo = now + RUGBY_FORWARD*DAY;
const rugbyReject = new Set();
const rugbySourceErrors = [];
const rugbyCompsSeen = {};

/* Years the window touches. A window that straddles New Year needs both,
   and ESPN answers a whole season to ?dates=YYYY — the same request that
   returns 15 Six Nations fixtures for 2026 and nothing for 2027. */
const rugbyYears = [...new Set([
  new Date(rugbyFrom).getUTCFullYear(), new Date(rugbyTo).getUTCFullYear()
])];

/* ---- ESPN, one league at a time ---- */
const espnRugby = [];
for(const [compId, cfg] of Object.entries(RUGBY_COMPS)){
  /* Not every competition has an ESPN league. The Pacific Nations Cup
     and the World Rugby Nations Cup have none, which is a fact about
     the source and not a failure to reach it — recorded as such so the
     log does not report a working source as broken. */
  if(!cfg.espn){ rugbyCompsSeen[compId] = {espn:"none"}; continue; }
  let reached = false, kept = 0;
  for(const year of rugbyYears){
    let r = null;
    try{
      r = await get(ESPN + "rugby/" + cfg.espn + "/scoreboard?dates=" + year);
    }catch(err){
      rugbySourceErrors.push("ESPN " + compId + " " + year + ": " + (err && err.message || err));
      continue;
    }
    if(r === null) continue;                    // 404 or a failure already warned
    reached = true;
    for(const ev of r.events || []){
      const f = fromEspnEvent(ev, compId, rugbyReject);
      if(f){ espnRugby.push(f); kept++; }
    }
  }
  /* An empty competition is normal — The Rugby Championship publishes
     nothing until it is scheduled — but "we asked and got nothing" and
     "we never got an answer" are different claims and are recorded as
     different things. */
  rugbyCompsSeen[compId] = {espn: reached ? kept : null};
}

/* ---- World Rugby's own feed ---- */
const WR_API = "https://api.wr-rims-prod.pulselive.com/rugby/v3/match";
const WR_PAGE = 100;
const wrRugby = [];
let wrReached = false;
try{
  const iso = ms => new Date(ms).toISOString().slice(0,10);
  const qs = p => WR_API + "?startDate=" + iso(rugbyFrom) + "&endDate=" + iso(rugbyTo)
    + "&sort=asc&pageSize=" + WR_PAGE + "&page=" + p;
  /* This host answers 429 to a burst, so the pages are walked in order
     with a pause, and a rate-limited page is retried once rather than
     silently leaving a hole in the middle of the window. */
  let page = 0, pages = 1;
  while(page < pages && page < 40){
    let body = null;
    for(let attempt = 0; attempt < 3 && !body; attempt++){
      if(attempt) await new Promise(r=>setTimeout(r, 1500*attempt));
      try{
        const res = await fetch(qs(page), {headers:{"user-agent":WIKI_UA, "accept":"application/json"},
          signal:AbortSignal.timeout(20000)});
        if(res.status === 429) continue;        // backs off on the next pass
        if(!res.ok) break;
        body = await res.json();
      }catch(e){ /* retried, then given up on below */ }
    }
    if(!body){ rugbySourceErrors.push("World Rugby: page " + page + " unavailable"); break; }
    wrReached = true;
    pages = (body.pageInfo && body.pageInfo.numPages) || 1;
    for(const m of body.content || []){
      const f = fromWrMatch(m, rugbyReject);
      if(f) wrRugby.push(f);
    }
    page++;
    await new Promise(r=>setTimeout(r, 350));
  }
}catch(err){
  rugbySourceErrors.push("World Rugby: " + (err && err.message || err));
}
for(const compId of Object.keys(RUGBY_COMPS)){
  const seen = rugbyCompsSeen[compId] || (rugbyCompsSeen[compId] = {espn:null});
  if(seen.espn === undefined) seen.espn = null;
  seen.wr = wrReached ? wrRugby.filter(f=>f.comp === compId).length : null;
}

/* One list, ids first and nations-plus-kickoff only where the id
   namespaces do not overlap.

   ESPN is concatenated first on purpose rather than by accident: where
   both sources carry a fixture the base copy's kickoff is the one kept,
   and ESPN agreed with World Rugby on every fixture already played
   while disagreeing with it on several still to come. Where they do
   disagree the other reading is recorded on the fixture as altStart. */
const rugbyAll = dedupe(espnRugby.concat(wrRugby));
/* Old results are dropped here rather than in the browser so the file
   does not carry a season of finished matches to every visitor. The
   browser applies the exact local-calendar rule on top of this. */
const rugbyOut = rugbyAll.filter(f =>
  f.start <= rugbyTo && (!isTerminal(f.status) || f.start >= rugbyFrom))
  /* __src is a merge hint about which feed a venue came from; it has
     done its job by now and does not belong in the shipped file. */
  .map(f => f.venue ? Object.assign({}, f, {venue:(({__src, ...v}) => v)(f.venue)}) : f);

if(rugbyReject.size){
  console.warn("\n  !! " + rugbyReject.size + " rugby side(s) matched no nation and are not a known "
    + "non-test side — check the name against the feed:");
  [...rugbyReject].sort().forEach(n=>console.warn("     " + n));
  console.warn("");
}
/* A competition neither source answered for. Distinct from one that
   answered with nothing: The Rugby Championship legitimately publishes
   no 2026 fixtures yet, and that is not the same as not being asked. */
const rugbyUnavailable = Object.entries(rugbyCompsSeen)
  .filter(([,v]) => (v.espn === null || v.espn === "none") && v.wr === null)
  .map(([k]) => RUGBY_COMPS[k].label);
console.log("Rugby: " + rugbyOut.length + " fixture(s) in window from "
  + (espnRugby.length ? "ESPN" : "") + (espnRugby.length && wrRugby.length ? " + " : "")
  + (wrRugby.length ? "World Rugby" : "") + (!espnRugby.length && !wrRugby.length ? "no source" : "")
  + " (" + espnRugby.length + " + " + wrRugby.length + " before dedup)");
Object.entries(rugbyCompsSeen).forEach(([k,v])=>{
  const label = RUGBY_COMPS[k].label;
  const say = x => x === null ? "unreachable" : x === "none" ? "no league" : x;
  const bits = ["espn=" + say(v.espn), "wr=" + say(v.wr)];
  console.log("    " + label.padEnd(26) + " " + bits.join("  "));
});
const rugbyDisputed = rugbyOut.filter(f => f.altStart != null);
if(rugbyDisputed.length){
  console.warn("  ! " + rugbyDisputed.length + " kickoff(s) reported differently by the two sources; "
    + "the ESPN reading is shown and the other is kept as altStart:");
  rugbyDisputed.forEach(f => console.warn("     " + f.home.name + " v " + f.away.name
    + "  " + new Date(f.start).toISOString() + " vs " + new Date(f.altStart).toISOString()
    + " (" + f.altSource + ")"));
}
if(rugbyUnavailable.length){
  console.warn("  ! no source answered for: " + rugbyUnavailable.join(", ")
    + " — reported as unavailable rather than shown as empty");
}
if(rugbySourceErrors.length){
  console.warn("  ! rugby source problems: " + rugbySourceErrors.length);
  rugbySourceErrors.forEach(e=>console.warn("     " + e));
}

/* A roster entry that matched no fixture at all is almost always a name
   that drifted, not a team with an empty schedule. Say so loudly: this
   failure is invisible in the app, where it just looks like a team that
   never plays. */
const matched = new Set();
fixtures.forEach(f=>{ if(f.home.id) matched.add(f.home.id); if(f.away.id) matched.add(f.away.id); });
const unmatched = ROSTER.filter(([id])=>!matched.has(id)).map(([id,comp,name])=>id+" ("+name+", "+comp+")");
if(unmatched.length){
  console.warn("\n  !! " + unmatched.length + " roster team(s) matched no fixture — check the name against the feed:");
  unmatched.forEach(u=>console.warn("     " + u));
  console.warn("");
}
const withScore = fixtures.filter(f=>f.score).length;
const byComp = {};
fixtures.forEach(f=>{ byComp[f.comp] = (byComp[f.comp]||0)+1; });

if(!fixtures.length){
  console.error("No fixtures built — refusing to overwrite data.json with an empty file.");
  process.exit(1);
}
// Never replace a healthy file with a much thinner one: a partial outage
// upstream should leave yesterday's good data in place.
if(previous && previous.fixtures && previous.fixtures.length > 20 &&
   fixtures.length < previous.fixtures.length * 0.5){
  console.error("Built " + fixtures.length + " fixtures against " + previous.fixtures.length +
    " previously — looks like an upstream outage. Keeping the existing file.");
  process.exit(1);
}

/* Don't rewrite the file just to move a timestamp. The build stamps
   `generated`, which differs on every run, so writing unconditionally
   meant a commit and a site rebuild every time — including all through
   the off-season when nothing had moved. Write when the fixtures
   actually changed, or when the stamp is old enough that the page would
   otherwise start treating the file as stale. */
const MAX_AGE = 6*3600000;
const cyclingSame = previous && JSON.stringify(previous.cycling || []) === JSON.stringify(cyclingOut);
const rugbySame = previous && JSON.stringify(previous.rugby || []) === JSON.stringify(rugbyOut);
if(previous && cyclingSame && rugbySame && JSON.stringify(previous.fixtures) === JSON.stringify(fixtures)){
  const age = now - (Date.parse(previous.generated) || 0);
  if(age < MAX_AGE){
    console.log("No fixture changed and the file is " + Math.round(age/60000) +
      " min old — leaving it alone.");
    process.exit(0);
  }
  console.log("No fixture changed, but the file is " + Math.round(age/3600000) +
    "h old — refreshing the stamp.");
}

const out = {
  generated: new Date(now).toISOString(),
  window: { from: new Date(now - BACK*DAY).toISOString(), to: new Date(now + FORWARD*DAY).toISOString() },
  source: "ESPN public scoreboard API",
  counts: { fixtures: fixtures.length, withScore, byComp, requests: calls, failed: failures,
            unmatchedTeams: unmatched, cyclingPodiums: cyclingOut.reduce((a,r)=>a+podiumCount(r),0),
            rugby: rugbyOut.length, rugbyByComp: rugbyOut.reduce((a,f)=>{a[f.comp]=(a[f.comp]||0)+1;return a;},{}),
            /* Named in the file so the page can say a competition is
               unavailable instead of implying the feed is complete. */
            rugbyUnavailable, rugbyUnknownSides: [...rugbyReject].sort(),
            rugbyDisputedKickoffs: rugbyDisputed.length },
  fixtures,
  cycling: cyclingOut,
  rugby: rugbyOut
};
writeFileSync(new URL("../data.json", import.meta.url), JSON.stringify(out) + "\n");
console.log("Wrote data.json — " + fixtures.length + " fixtures, " + withScore + " with scores, " +
  rugbyOut.length + " rugby, " + calls + " requests, " + failures + " failed");
console.log("  " + Object.entries(byComp).map(([k,v])=>k+":"+v).join("  "));
