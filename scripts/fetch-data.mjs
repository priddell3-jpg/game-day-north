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
["bay","BUNDES","Bayern Munich"],["psg","LIGUE1","Paris Saint-Germain"],["int","SERIEA","Inter Milan"],
["van-mls","MLS","Vancouver Whitecaps FC"],["tfc","MLS","Toronto FC"],
["mtl-mls","MLS","CF Montreal"],["lafc","MLS","Los Angeles FC"],
["mia","MLS","Inter Miami CF"],["sou","MLS","Seattle Sounders FC"]
];
/* Clubs that enter competitions beyond their own league. */
const EXTRA = { EPL:["EFL","FAC","UCL"], LALIGA:["UCL"], BUNDES:["UCL"], LIGUE1:["UCL"], SERIEA:["UCL"] };

const norm = x => (x||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]/g,"");
const pad = n => String(n).padStart(2,"0");
const NAME_TO_ID = new Map(ROSTER.map(([id,,name])=>[norm(name), id]));

// US Eastern is UTC-4 in DST, UTC-5 otherwise. Close enough for date bucketing.
function easternDate(ms){
  const d = new Date(ms - 4*3600000);
  return d.getUTCFullYear()+pad(d.getUTCMonth()+1)+pad(d.getUTCDate());
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
    return { id: NAME_TO_ID.get(norm(t.displayName)) || null,
             name: t.displayName || t.name || "", abbr: (t.abbreviation||"?").slice(0,4),
             color: t.color ? "#"+String(t.color).replace("#","") : null };
  };
  const sh = num(H.score && H.score.displayValue != null ? H.score.displayValue : H.score);
  const sa = num(A.score && A.score.displayValue != null ? A.score.displayValue : A.score);
  return {
    comp, start, home: side(H), away: side(A), status,
    label: ty.shortDetail || ty.description || (status==="final" ? "Final" : ""),
    score: (status === "scheduled" || sh === null || sa === null) ? null : [sh, sa]
  };
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
  if(f.score && !fixtures[i].score) fixtures[i] = f;   // the copy with a score wins
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
    const id = NAME_TO_ID.get(norm(t.displayName));
    if(id) espnIds[id] = { comp, espn: t.id };
  }
}
for(const [id, meta] of Object.entries(espnIds)){
  const sched = await get(ESPN + PATHS[meta.comp] + "/teams/" + meta.espn + "/schedule");
  (((sched||{}).events)||[]).forEach(ev=>add(parseEvent(ev, meta.comp)));
}

// ...and per-date scoreboards for the near window, which is the only
// place a finished or in-progress game reliably carries its score
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

fixtures.sort((a,b)=>a.start-b.start);
const withScore = fixtures.filter(f=>f.score).length;
const byComp = {};
fixtures.forEach(f=>{ byComp[f.comp] = (byComp[f.comp]||0)+1; });

if(!fixtures.length){
  console.error("No fixtures built — refusing to overwrite data.json with an empty file.");
  process.exit(1);
}
let previous = null;
try{ previous = JSON.parse(readFileSync(new URL("../data.json", import.meta.url), "utf8")); }catch(e){}

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
if(previous && JSON.stringify(previous.fixtures) === JSON.stringify(fixtures)){
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
  counts: { fixtures: fixtures.length, withScore, byComp, requests: calls, failed: failures },
  fixtures
};
writeFileSync(new URL("../data.json", import.meta.url), JSON.stringify(out) + "\n");
console.log("Wrote data.json — " + fixtures.length + " fixtures, " + withScore + " with scores, " +
  calls + " requests, " + failures + " failed");
console.log("  " + Object.entries(byComp).map(([k,v])=>k+":"+v).join("  "));
