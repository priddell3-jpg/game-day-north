/* Date helpers shared by the build script and mirrored by the page.
   Kept in one place because the rule they encode — that ESPN files a
   game under its US Eastern date — is the source of a whole class of
   silent, empty-day bugs. */

/* America/New_York is not a fixed offset. It is UTC-4 in daylight time
   and UTC-5 outside it, and the changeover lands mid-season in both
   directions. The previous implementation subtracted four hours
   unconditionally, so for roughly four months of the year every game
   whose UTC hour fell between 04:00 and 04:59 was filed a day late —
   late West Coast starts, exactly the ones most likely to be looked up
   the next morning. Ask the platform for the wall clock instead. */
const DATE_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric", month: "2-digit", day: "2-digit"
});
const CLOCK_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

/* formatToParts rather than a formatted string: the order of a locale's
   date parts is not something to depend on. */
function partsOf(fmt, ms){
  const out = {};
  for(const p of fmt.formatToParts(new Date(ms))) out[p.type] = p.value;
  return out;
}

/** Eastern calendar date of an instant, as YYYYMMDD — ESPN's format. */
export function easternDate(ms){
  const p = partsOf(DATE_PARTS, ms);
  return p.year + p.month + p.day;
}

/** The same date as YYYY-MM-DD, for comparing against ISO day strings. */
export function easternISO(ms){
  const p = partsOf(DATE_PARTS, ms);
  return p.year + "-" + p.month + "-" + p.day;
}

/** Offset in hours at an instant: -4 in daylight time, -5 outside it.
    Read the Eastern wall clock, treat it as though it were UTC, and the
    gap back to the real instant is the offset. */
export function easternOffsetHours(ms){
  const d = partsOf(DATE_PARTS, ms), t = partsOf(CLOCK_PARTS, ms);
  const wallAsUTC = Date.UTC(+d.year, +d.month - 1, +d.day, +t.hour, +t.minute);
  return Math.round((wallAsUTC - ms) / 3600000);
}
