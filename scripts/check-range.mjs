#!/usr/bin/env node
/**
 * One ranged request must equal one request per day.
 *
 * This repository documented, correctly at the time, that a
 * YYYYMMDD-YYYYMMDD range returned only the first day for the North
 * American leagues. That is no longer true, and the whole fixture build
 * now rests on it staying untrue: one ranged request per competition
 * replaces both the per-team season schedules and the per-date
 * scoreboards.
 *
 * If ESPN reverts the behaviour, every league silently loses everything
 * except its first day, the per-competition floor catches it on the next
 * build, and someone has to work out why. This is the cheaper signal:
 * eight small requests a night that say so directly.
 *
 * Exits non-zero when a range disagrees with the days inside it.
 */
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/";
const CHECK = { NHL: "hockey/nhl", NBA: "basketball/nba", NFL: "football/nfl", MLB: "baseball/mlb" };
const DAY = 86400000;
const key = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");

async function ids(url){
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if(!r.ok) throw new Error("HTTP " + r.status + " for " + url);
  const j = await r.json();
  return new Set((j.events || []).map(e => String(e.id)));
}

/* Yesterday and the two days before it: settled, small, and certain to
   contain fixtures for at least one of the four leagues whatever the
   time of year. */
const end = Date.now() - DAY;
const days = [end - 2*DAY, end - DAY, end];
let failed = 0, checked = 0, empty = [];

for(const [comp, path] of Object.entries(CHECK)){
  try{
    const ranged = await ids(ESPN + path + "/scoreboard?dates=" + key(days[0]) + "-" + key(end) + "&limit=1000");
    const perDay = new Set();
    for(const d of days) (await ids(ESPN + path + "/scoreboard?dates=" + key(d) + "&limit=1000")).forEach(x => perDay.add(x));

    if(!perDay.size){ empty.push(comp); continue; }      // out of season, nothing to compare
    checked++;
    const missing = [...perDay].filter(x => !ranged.has(x));
    if(missing.length){
      failed++;
      console.error("FAIL " + comp + ": the range returned " + ranged.size + " of " + perDay.size
        + " events the individual days returned. " + missing.length + " missing.");
      console.error("     scripts/fetch-data.mjs depends on a range covering its whole span. "
        + "If this is a revert upstream, the fixture build is losing everything past day one.");
    }else{
      console.log("ok   " + comp + ": range " + ranged.size + " covers all " + perDay.size + " from the days");
    }
  }catch(err){
    console.warn("  ! " + comp + " could not be checked — " + (err && err.message || err));
  }
}

if(empty.length) console.log("     out of season, nothing to compare: " + empty.join(", "));
if(!checked && !failed){
  console.warn("Nothing could be compared. Not a pass and not a failure.");
  process.exit(0);
}
if(failed){ console.error("\n" + failed + " league(s) disagree. The range behaviour has changed."); process.exit(1); }
console.log("\nRanges still cover their whole span across " + checked + " league(s).");
