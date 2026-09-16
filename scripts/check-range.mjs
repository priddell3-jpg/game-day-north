#!/usr/bin/env node
/**
 * One ranged request must equal one request per day.
 *
 * This repository documented, correctly at the time, that a
 * YYYYMMDD-YYYYMMDD range returned only the first day for the North
 * American leagues. On 2026-09-09 that was measured to be no longer
 * true, and the fixture build moved onto one ranged request per
 * competition. On 2026-09-15 the form changed again: ESPN began
 * answering it with HTTP 400, on every league, and the build stopped
 * publishing for a day. The build now falls back to one request per day
 * when the range is refused, so an outage of this kind no longer stops
 * it — but this check is still the thing that says, directly and the
 * night it happens, what the range is doing.
 *
 * Two failures, both non-zero:
 *
 *   - the range answers, and covers fewer events than the days inside
 *     it. That is the silent truncation this was written for.
 *   - the range does not answer at all — an HTTP error, a timeout. On
 *     the night of 2026-09-15 this script saw exactly that, logged it as
 *     "could not be checked", and exited 0, which reported the very
 *     failure it exists to detect as a pass. An error on the ranged
 *     request IS the finding.
 *
 * "Nothing could be compared" — every league out of season — is neither
 * a pass nor a failure and exits 0, but only when the ranged requests
 * themselves answered. Eight small requests a night, deliberately not
 * part of the fixture build, so a check failing never stops fixtures
 * being published.
 */
import { pathToFileURL } from "node:url";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/";
export const CHECK = { NHL: "hockey/nhl", NBA: "basketball/nba", NFL: "football/nfl", MLB: "baseball/mlb" };
const DAY = 86400000;
const key = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");

/* Everything that reaches the network or the terminal is injected, so
   the decision — what exits non-zero and why — can be tested against
   saved answers without eight live requests. */
export async function checkRanges({ fetchImpl = globalThis.fetch, now = Date.now(), log = console } = {}){
  async function ids(url){
    const r = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20000) });
    if(!r.ok) throw new Error("HTTP " + r.status + " for " + url);
    const j = await r.json();
    return new Set((j.events || []).map(e => String(e.id)));
  }

  /* Yesterday and the two days before it: settled, small, and certain to
     contain fixtures for at least one of the four leagues whatever the
     time of year. */
  const end = now - DAY;
  const days = [end - 2*DAY, end - DAY, end];
  let failed = 0, checked = 0, rangedErrors = 0;
  const empty = [];

  for(const [comp, path] of Object.entries(CHECK)){
    let ranged;
    try{
      ranged = await ids(ESPN + path + "/scoreboard?dates=" + key(days[0]) + "-" + key(end) + "&limit=1000");
    }catch(err){
      /* The ranged request not answering is not "could not be checked".
         It is the answer: the form the build prefers is not being
         served, and the build is on its per-day fallback. */
      failed++; rangedErrors++;
      log.error("FAIL " + comp + ": the ranged request itself failed — " + (err && err.message || err));
      log.error("     scripts/fetch-data.mjs will have fallen back to one request per day for "
        + comp + ". The range is the cheap plan and it is not being served.");
      continue;
    }
    let perDay;
    try{
      perDay = new Set();
      for(const d of days) (await ids(ESPN + path + "/scoreboard?dates=" + key(d) + "&limit=1000")).forEach(x => perDay.add(x));
    }catch(err){
      log.warn("  ! " + comp + " could not be checked — a single-day request failed: " + (err && err.message || err));
      continue;
    }

    if(!perDay.size){ empty.push(comp); continue; }      // out of season, nothing to compare
    checked++;
    const missing = [...perDay].filter(x => !ranged.has(x));
    if(missing.length){
      failed++;
      log.error("FAIL " + comp + ": the range returned " + ranged.size + " of " + perDay.size
        + " events the individual days returned. " + missing.length + " missing.");
      log.error("     scripts/fetch-data.mjs trusts a range that answers to cover its whole span. "
        + "If this is a revert upstream, the fixture build is losing everything past day one.");
    }else{
      log.log("ok   " + comp + ": range " + ranged.size + " covers all " + perDay.size + " from the days");
    }
  }

  if(empty.length) log.log("     out of season, nothing to compare: " + empty.join(", "));
  let code;
  if(failed){
    log.error("\n" + failed + " league(s) failed"
      + (rangedErrors ? " — " + rangedErrors + " of them because the ranged request itself errored" : "")
      + ". The range behaviour has changed.");
    code = 1;
  }else if(!checked){
    log.warn("Nothing could be compared. Not a pass and not a failure.");
    code = 0;
  }else{
    log.log("\nRanges still cover their whole span across " + checked + " league(s).");
    code = 0;
  }
  return { code, checked, failed, rangedErrors, empty };
}

/* Run only when invoked as a script. Imported by its test, this file
   must make no request. */
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
  const result = await checkRanges();
  process.exit(result.code);
}
