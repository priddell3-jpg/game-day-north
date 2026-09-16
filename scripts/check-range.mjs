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
 * when the range is refused, so a refusal no longer stops it — and this
 * check no longer calls a refusal a failure.
 *
 * One thing fails this check: a range that ANSWERS, and covers fewer
 * events than the days inside it. That is the silent truncation the
 * build cannot see, because a short answer and a complete one look the
 * same. A refused range — HTTP 400 — is a handled condition: the build
 * is on its per-day plan, which costs requests rather than fixtures, and
 * that is said plainly in the log and exits 0. Any other error on the
 * ranged request is "could not be checked", also exit 0. "Nothing to
 * compare" — every league out of season — is a plain log line and
 * exit 0.
 *
 * The one thing this must never do again is what it did on the night of
 * 2026-09-15: exit 0 while saying nothing useful about a range that was
 * not being served. Handled is fine. Silent is not.
 *
 * Eight small requests a night, deliberately not part of the fixture
 * build, so a check failing never stops fixtures being published.
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
    if(!r.ok){ const e = new Error("HTTP " + r.status + " for " + url); e.status = r.status; throw e; }
    const j = await r.json();
    return new Set((j.events || []).map(e => String(e.id)));
  }

  /* Yesterday and the two days before it: settled, small, and certain to
     contain fixtures for at least one of the four leagues whatever the
     time of year. */
  const end = now - DAY;
  const days = [end - 2*DAY, end - DAY, end];
  let failed = 0, checked = 0, errors = 0;
  const empty = [], refused = [];

  for(const [comp, path] of Object.entries(CHECK)){
    let ranged;
    try{
      ranged = await ids(ESPN + path + "/scoreboard?dates=" + key(days[0]) + "-" + key(end) + "&limit=1000");
    }catch(err){
      /* Refused is handled: the build asks one day at a time when the
         range answers 400, so this is the plan the build is on, not an
         incident. Anything else is a request that did not answer, which
         says nothing either way about the range's behaviour. */
      if(err && err.status === 400){
        refused.push(comp);
        log.log("refused " + comp + ": the ranged request answered HTTP 400 — build is on the per-day plan");
      }else{
        errors++;
        log.warn("  ! " + comp + " could not be checked — the ranged request failed: " + (err && err.message || err));
      }
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
  if(refused.length) log.log("\nranges refused — build is on the per-day plan for " + refused.join(", ")
    + " (" + refused.length + " of " + Object.keys(CHECK).length + " leagues). Handled, not an incident: "
    + "scripts/fetch-data.mjs asks one day at a time when a range answers 400.");
  let code;
  if(failed){
    log.error("\n" + failed + " league(s) returned a range that covers fewer events than its days. "
      + "The range behaviour has changed, silently.");
    code = 1;
  }else if(!checked){
    log.log("Nothing to compare: no league answered with events in the window.");
    code = 0;
  }else{
    log.log("\nRanges still cover their whole span across " + checked + " league(s).");
    code = 0;
  }
  return { code, checked, failed, refused, errors, empty };
}

/* Run only when invoked as a script. Imported by its test, this file
   must make no request. */
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
  const result = await checkRanges();
  process.exit(result.code);
}
