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
    return { id: idFor(t.displayName),
             name: t.displayName || t.name || "", abbr: (t.abbreviation||"?").slice(0,4),
             // the home club's city is what names the venue in the UI, so it
             // has to survive for clubs outside the followable roster too
             city: t.location || "",
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
    const id = idFor(t.displayName);
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
/* Significant words in a title. Years are excluded because every
   article in a season carries one, and the vocabulary of cycling is
   excluded because it is shared by every race and the season overview
   alike — "2026 Tour of Guangxi" and "2026 UCI World Tour" have "tour"
   in common and nothing else. What is left is the distinctive part: the
   place or the race. */
const TITLE_GENERIC = new Set(["uci","world","tour","race","racing","grand","prix",
  "cycliste","classic","cycling","road","men","mens","women","womens","stage","edition"]);
const titleWords = t => new Set(String(t||"").toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .split(/[^a-z0-9]+/)
  .filter(w=>w.length >= 3 && !/^\d+$/.test(w) && !TITLE_GENERIC.has(w)));

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
    const want = titleWords(title), have = titleWords(got);
    if(want.size && ![...want].some(w=>have.has(w))){
      console.warn("  ! \"" + title + "\" resolved to \"" + got
        + "\" — no shared words, treating as missing; the title needs fixing");
      return null;
    }
    return text;
  }catch(e){ return null; }
}
/* Results are not wiki-table rows. Each classification is a run of
   {{cyclingresult|rank|[[Rider]]|NAT|team|time}} templates introduced by
   {{cyclingresult start|title=...}} and closed by {{cyclingresult end}}.
   Parsing this as a table picked up the first wikilink in the section,
   which is a citation publisher, not a rider. */
function resultBlocks(text){
  const marks = [], re = /\{\{\s*cyclingresult start\b/gi;
  let m;
  while((m = re.exec(text))) marks.push(m.index);
  return marks.map((at,i)=>{
    const seg = text.slice(at, marks[i+1] !== undefined ? marks[i+1] : text.length);
    const e = seg.search(/\{\{\s*cyclingresult end\s*\}\}/i);
    return e >= 0 ? seg.slice(0, e) : seg;
  });
}
const isGCBlock = b => /general classification/i.test(b.slice(0,240));
/* The rank must be a number. A neutralised stage lists its riders under
   an em dash, and a team time trial has no rider column at all: both
   yield nothing, which is the correct answer for "who was on the
   podium". */
function ridersInBlock(block, n){
  const out = [], re = /\{\{\s*cyclingresult\s*\|\s*\d+\s*\|\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gi;
  let m;
  while((m = re.exec(block)) && out.length < n){
    const name = (m[2] || m[1]).replace(/\s+/g," ").trim();
    if(name && !out.includes(name)) out.push(name);
  }
  return out.slice(0, n);
}
/* While a stage race is running, the main article carries the standings
   as an ordinary wikitable of {{Flag athlete}} rows, before any split
   per-stage article exists. That is the only place the current leader
   can be read on day one. */
function gcLeaderFrom(text){
  const at = text.search(/\|\+\s*General classification after stage/i);
  if(at < 0) return null;
  const seg = text.slice(at, at + 4000);
  const m = seg.match(/\{\{\s*Flag athlete\s*\|\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/i);
  if(!m) return null;
  return (m[2] || m[1]).replace(/\s+/g," ").trim();
}
function stageSections(text){
  // "==Stage 4==" headings, tolerant of spacing and === depth
  const found = {};
  const re = /^=+\s*Stage\s+(\d+)\b[^=\n]*=+\s*$/gim;
  const marks = []; let m;
  while((m = re.exec(text))) marks.push({n:+m[1], at:m.index});
  marks.forEach((mk, i)=>{
    found[mk.n] = text.slice(mk.at, marks[i+1] ? marks[i+1].at : text.length);
  });
  return found;
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
    let leader = prev.leader || null;
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
          let leadStage = 0;
          rc.dates.forEach((date, i)=>{
            if(date > todayISO) return;
            const kept = settled(date);
            if(kept && date < todayISO){ fresh.push(kept); return; }
            const sec = sections[i+1];
            if(!sec) return;
            const blocks = resultBlocks(sec);
            const notGC = blocks.filter(b=>!isGCBlock(b));
            // prefer the block actually titled as the stage result; a
            // neutralised stage carries a "time gaps" block instead
            const res = notGC.filter(b=>/result/i.test(b.slice(0,240)))[0] || notGC[0] || "";
            const top3 = ridersInBlock(res, 3);
            if(top3.length === 3) fresh.push({date, top3});
            const gcBlock = blocks.filter(isGCBlock)[0];
            if(gcBlock && i+1 > leadStage){
              const gc = ridersInBlock(gcBlock, 1);
              if(gc.length){ leader = gc[0]; leadStage = i+1; }
            }
          });
          if(fresh.length) stages = fresh;
          // before any split article exists there are no stage sections
          // at all; the main article still carries the standings
          if(!leader){
            for(const t of texts){ const l = gcLeaderFrom(t); if(l){ leader = l; break; } }
          }
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
    if(stages.length || leader) cyclingOut.push({race:rc.name, oneDay:!!rc.oneDay, leader, stages});
  }
  const podiums = cyclingOut.reduce((a,r)=>a+podiumCount(r), 0);
  console.log("Cycling (Wikipedia): " + podiums + " stage podium" + (podiums===1?"":"s")
    + " across " + cyclingOut.length + " race(s)");
}catch(e){
  console.warn("  ! cycling results skipped — " + (e && e.message || e));
  if(prevCycling.length && !cyclingOut.length) cyclingOut.push(...prevCycling);
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
if(previous && cyclingSame && JSON.stringify(previous.fixtures) === JSON.stringify(fixtures)){
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
            unmatchedTeams: unmatched, cyclingPodiums: cyclingOut.reduce((a,r)=>a+podiumCount(r),0) },
  fixtures,
  cycling: cyclingOut
};
writeFileSync(new URL("../data.json", import.meta.url), JSON.stringify(out) + "\n");
console.log("Wrote data.json — " + fixtures.length + " fixtures, " + withScore + " with scores, " +
  calls + " requests, " + failures + " failed");
console.log("  " + Object.entries(byComp).map(([k,v])=>k+":"+v).join("  "));
