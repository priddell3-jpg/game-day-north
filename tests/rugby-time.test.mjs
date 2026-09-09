import { test } from "node:test";
import assert from "node:assert/strict";
import { localDayKey, localMidnight, venueDayNote, withinWindow,
         RESULT_DAYS, FORWARD_DAYS } from "../scripts/lib/rugby.mjs";

/* International rugby is the sport where the reader's calendar and the
   venue's routinely disagree. A Saturday afternoon in Auckland is Friday
   evening in Vancouver, and both statements are true.

   So: every kickoff is one absolute instant, and every question about a
   DAY is asked of Intl for the zone it is being asked about. No offset
   is ever baked. Vancouver is UTC-8 for part of the year and UTC-7 for
   the rest, which is why the label is "PT" and never "PST". */

const ZONES = [
  "Pacific/Auckland", "Australia/Sydney", "Asia/Tokyo", "Africa/Johannesburg",
  "Europe/London", "Europe/Paris", "America/Argentina/Buenos_Aires",
  "America/Vancouver", "America/Toronto"
];

test("every required zone resolves a day without throwing", () => {
  const ms = Date.parse("2026-11-07T14:10:00Z");
  for(const z of ZONES){
    const k = localDayKey(ms, z);
    assert.match(k, /^\d{4}-\d{2}-\d{2}$/, z);
  }
});

/* ---------------- the date line ---------------- */

test("a Saturday match in Auckland is Friday in Vancouver", () => {
  // Bledisloe Cup, Auckland, 2026-10-10T07:10Z. Local kickoff is
  // 8:10pm Saturday in Auckland and 12:10am Saturday in Vancouver.
  const ms = Date.parse("2026-10-10T07:10:00Z");
  assert.equal(localDayKey(ms, "Pacific/Auckland"), "2026-10-10");
  assert.equal(localDayKey(ms, "America/Vancouver"), "2026-10-10");
  // and the one that actually crosses: Sydney, 2026-10-17T05:00Z
  const syd = Date.parse("2026-10-17T05:00:00Z");
  assert.equal(localDayKey(syd, "Australia/Sydney"), "2026-10-17");
  assert.equal(localDayKey(syd, "America/Vancouver"), "2026-10-16");
  assert.equal(localDayKey(syd, "America/Toronto"), "2026-10-17");
});

test("the venue note appears only where the calendars actually differ", () => {
  const syd = Date.parse("2026-10-17T05:00:00Z");
  assert.equal(venueDayNote(syd, 11, "America/Vancouver"), "Sat");
  assert.equal(venueDayNote(syd, 11, "Australia/Sydney"), "");
  const akl = Date.parse("2026-10-10T07:10:00Z");
  assert.equal(venueDayNote(akl, 13, "America/Vancouver"), "",
    "same date in both places, so nothing to explain");
});

test("with no known venue offset nothing is claimed about the venue's day", () => {
  const ms = Date.parse("2026-10-17T05:00:00Z");
  assert.equal(venueDayNote(ms, null, "America/Vancouver"), "");
  assert.equal(venueDayNote(ms, undefined, "America/Vancouver"), "");
});

test("a Tokyo kickoff crosses back over the line for a Canadian reader", () => {
  // Pacific Nations Cup semi-final, Osaka, 2026-09-12T07:00Z.
  const ms = Date.parse("2026-09-12T07:00:00Z");
  assert.equal(localDayKey(ms, "Asia/Tokyo"), "2026-09-12");
  assert.equal(localDayKey(ms, "America/Vancouver"), "2026-09-12");
  const jp = Date.parse("2026-09-05T05:50:00Z");         // Japan v Canada
  assert.equal(localDayKey(jp, "Asia/Tokyo"), "2026-09-05");
  assert.equal(localDayKey(jp, "America/Vancouver"), "2026-09-04");
  assert.equal(venueDayNote(jp, 9, "America/Vancouver"), "Sat");
});

test("a match crossing local midnight lands on the day it starts", () => {
  // 2026-11-14T00:00Z is 7pm on the 13th in Toronto and 4pm on the 13th
  // in Vancouver, and the 14th in London.
  const ms = Date.parse("2026-11-14T00:00:00Z");
  assert.equal(localDayKey(ms, "America/Toronto"), "2026-11-13");
  assert.equal(localDayKey(ms, "America/Vancouver"), "2026-11-13");
  assert.equal(localDayKey(ms, "Europe/London"), "2026-11-14");
  assert.equal(localDayKey(ms, "Pacific/Auckland"), "2026-11-14");
});

/* ---------------- daylight saving, both hemispheres ---------------- */

test("northern spring forward: Vancouver is PDT, not permanently PST", () => {
  // US DST began 2026-03-08 at 02:00 local.
  const before = Date.parse("2026-03-08T09:59:00Z");   // 01:59 PST
  const after  = Date.parse("2026-03-08T10:01:00Z");   // 03:01 PDT
  assert.equal(localDayKey(before, "America/Vancouver"), "2026-03-08");
  assert.equal(localDayKey(after,  "America/Vancouver"), "2026-03-08");
  // the offset genuinely changed across those two minutes
  const off = ms => (Date.parse(localDayKey(ms, "America/Vancouver") + "T00:00:00Z") - ms);
  assert.notEqual(off(before), off(after));
});

test("northern fall back: a fixed -8 would file the evening a day early", () => {
  // US DST ended 2026-11-01 at 02:00 local. A November evening kickoff
  // in Vancouver is UTC-8; an October one is UTC-7.
  const oct = Date.parse("2026-10-31T05:30:00Z");   // 22:30 PDT on the 30th
  const nov = Date.parse("2026-11-02T07:30:00Z");   // 23:30 PST on the 1st
  assert.equal(localDayKey(oct, "America/Vancouver"), "2026-10-30");
  assert.equal(localDayKey(nov, "America/Vancouver"), "2026-11-01");
  // Holding October's offset into November puts that evening on the
  // wrong day — the exact class of bug a baked offset produces.
  const naive = new Date(nov - 7*3600000).toISOString().slice(0, 10);
  assert.equal(naive, "2026-11-02");
  assert.notEqual(naive, localDayKey(nov, "America/Vancouver"));
});

test("southern spring forward: Auckland and Sydney move the other way", () => {
  // NZDT begins 2026-09-27 at 02:00; AEDT begins 2026-10-04 at 02:00.
  const nzBefore = Date.parse("2026-09-26T12:00:00Z");   // NZST, UTC+12
  const nzAfter  = Date.parse("2026-09-28T11:00:00Z");   // NZDT, UTC+13
  assert.equal(localDayKey(nzBefore, "Pacific/Auckland"), "2026-09-27");
  assert.equal(localDayKey(nzAfter,  "Pacific/Auckland"), "2026-09-29");
  const auBefore = Date.parse("2026-10-03T13:30:00Z");   // AEST, UTC+10
  const auAfter  = Date.parse("2026-10-05T13:30:00Z");   // AEDT, UTC+11
  assert.equal(localDayKey(auBefore, "Australia/Sydney"), "2026-10-03");
  assert.equal(localDayKey(auAfter,  "Australia/Sydney"), "2026-10-06");
});

test("zones without daylight saving are unaffected all year", () => {
  for(const [z, ms, day] of [
    ["Africa/Johannesburg", "2026-07-04T15:40:00Z", "2026-07-04"],
    ["Africa/Johannesburg", "2026-12-04T22:40:00Z", "2026-12-05"],
    ["Asia/Tokyo",          "2026-01-15T16:00:00Z", "2026-01-16"],
    ["Asia/Tokyo",          "2026-07-15T16:00:00Z", "2026-07-16"],
    ["America/Argentina/Buenos_Aires", "2026-08-29T19:00:00Z", "2026-08-29"],
    ["America/Argentina/Buenos_Aires", "2026-02-01T02:30:00Z", "2026-01-31"]
  ]){
    assert.equal(localDayKey(Date.parse(ms), z), day, z + " " + ms);
  }
});

test("London and Paris differ by an hour, and both shift in March", () => {
  // 2026-11-21T20:10Z: 8:10pm in London, 9:10pm in Paris.
  const nov = Date.parse("2026-11-21T20:10:00Z");
  assert.equal(localDayKey(nov, "Europe/London"), "2026-11-21");
  assert.equal(localDayKey(nov, "Europe/Paris"), "2026-11-21");
  // 23:30 UTC in June is the next day in Paris but not in London
  const jun = Date.parse("2026-06-10T23:30:00Z");
  assert.equal(localDayKey(jun, "Europe/London"), "2026-06-11");
  assert.equal(localDayKey(jun, "Europe/Paris"), "2026-06-11");
  const jan = Date.parse("2026-01-10T23:30:00Z");
  assert.equal(localDayKey(jan, "Europe/London"), "2026-01-10");
  assert.equal(localDayKey(jan, "Europe/Paris"), "2026-01-11");
});

/* ---------------- the results cutoff, in local calendar days ---------------- */

test("the cutoff is a local midnight, in every required zone", () => {
  const now = Date.parse("2026-08-25T19:00:00Z");
  for(const z of ZONES){
    const cut = localMidnight(now, z, RESULT_DAYS);
    // it is midnight there
    const parts = new Intl.DateTimeFormat("en-US",
      {timeZone:z, hour:"2-digit", minute:"2-digit", hourCycle:"h23"}).formatToParts(new Date(cut));
    const p = {}; parts.forEach(x => p[x.type] = x.value);
    assert.equal(p.hour + ":" + p.minute, "00:00", z);
    // and it is exactly three calendar days before today, there
    const today = localDayKey(now, z), cutDay = localDayKey(cut, z);
    const diff = (Date.parse(today) - Date.parse(cutDay)) / 86400000;
    assert.equal(diff, RESULT_DAYS, z + ": " + cutDay + " -> " + today);
  }
});

test("the cutoff stays a whole day across a spring-forward boundary", () => {
  // Three days back from 2026-03-10 in Vancouver crosses the 02:00 jump
  // on the 8th, so those three days are 71 hours, not 72.
  const now = Date.parse("2026-03-10T19:00:00Z");
  const cut = localMidnight(now, "America/Vancouver", 3);
  assert.equal(localDayKey(cut, "America/Vancouver"), "2026-03-07");
  assert.equal(new Date(cut).toISOString(), "2026-03-07T08:00:00.000Z");

  // Subtracting a flat 72 hours from today's local midnight lands at
  // 23:00 on the 6th, and would carry an extra day of results with it.
  const midnightToday = Date.parse("2026-03-10T07:00:00.000Z");   // 00:00 PDT
  const naive = midnightToday - 3*86400000;
  assert.equal(localDayKey(naive, "America/Vancouver"), "2026-03-06");
  assert.notEqual(naive, cut);
  assert.equal(cut - naive, 3600000, "exactly the hour the clocks moved");
});

test("the cutoff stays a whole day across a southern boundary too", () => {
  const now = Date.parse("2026-09-29T06:00:00Z");
  const cut = localMidnight(now, "Pacific/Auckland", 3);
  const today = localDayKey(now, "Pacific/Auckland");
  const cutDay = localDayKey(cut, "Pacific/Auckland");
  assert.equal((Date.parse(today) - Date.parse(cutDay)) / 86400000, 3);
});

test("three local days is a different instant in Auckland and Vancouver", () => {
  // Which is exactly why the build keeps a superset and the browser
  // applies the exact rule.
  const now = Date.parse("2026-08-25T19:00:00Z");
  const nz = localMidnight(now, "Pacific/Auckland", RESULT_DAYS);
  const pt = localMidnight(now, "America/Vancouver", RESULT_DAYS);
  assert.notEqual(nz, pt);
  assert.ok(Math.abs(nz - pt) < 2*86400000, "but within a day and a bit of each other");
});

/* ---------------- the window ---------------- */

const at = (iso, over = {}) => Object.assign({start:Date.parse(iso), status:"final"}, over);

test("a completed match inside three local days is kept", () => {
  const now = Date.parse("2026-08-25T19:00:00Z");
  assert.equal(withinWindow(at("2026-08-24T15:00:00Z"), now, "America/Vancouver"), true);
});

test("a completed match older than three local days is dropped", () => {
  const now = Date.parse("2026-08-25T19:00:00Z");
  assert.equal(withinWindow(at("2026-08-18T15:00:00Z"), now, "America/Vancouver"), false);
});

test("the cutoff is exact to the minute at the boundary", () => {
  const now = Date.parse("2026-08-25T19:00:00Z");
  const cut = localMidnight(now, "America/Vancouver", RESULT_DAYS);
  assert.equal(withinWindow(at(new Date(cut).toISOString()), now, "America/Vancouver"), true);
  assert.equal(withinWindow(at(new Date(cut - 60000).toISOString()), now, "America/Vancouver"), false);
});

test("an older match still unresolved survives the cutoff", () => {
  // A match abandoned mid-second-half and never resolved is exactly the
  // one someone is still looking for. Age is not what retires it.
  const now = Date.parse("2026-08-25T19:00:00Z");
  const old = "2026-07-04T15:40:00Z";                       // seven weeks back
  for(const st of ["live", "halftime", "delayed", "suspended", "unknown", "postponed"]){
    assert.equal(withinWindow(at(old, {status:st}), now, "America/Vancouver"), true, st);
  }
  for(const st of ["final", "cancelled", "abandoned"]){
    assert.equal(withinWindow(at(old, {status:st}), now, "America/Vancouver"), false, st);
  }
});

test("upcoming matches are kept for ninety days and no further", () => {
  const now = Date.parse("2026-08-25T19:00:00Z");
  const inDays = d => at(new Date(now + d*86400000).toISOString(), {status:"scheduled"});
  assert.equal(withinWindow(inDays(89), now, "America/Vancouver"), true);
  assert.equal(withinWindow(inDays(FORWARD_DAYS + 1), now, "America/Vancouver"), false);
});

test("the ninety-day ceiling applies to unresolved matches too", () => {
  const now = Date.parse("2026-08-25T19:00:00Z");
  const far = at(new Date(now + 400*86400000).toISOString(), {status:"unknown"});
  assert.equal(withinWindow(far, now, "America/Vancouver"), false);
});
