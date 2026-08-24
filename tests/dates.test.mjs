import { test } from "node:test";
import assert from "node:assert/strict";
import { easternDate, easternISO, easternOffsetHours } from "../scripts/lib/dates.mjs";

/* The bug this replaces: a fixed UTC-4 assumption. Outside daylight time
   the true offset is UTC-5, so any instant whose UTC hour was 04:00–04:59
   was filed a day late — late West Coast starts, in the depths of the
   NHL and NBA seasons. */

test("daylight time: a late West Coast start keeps its Eastern date", () => {
  // 22 Aug 2026, 03:30 UTC = 23:30 EDT on the 21st
  assert.equal(easternDate(Date.parse("2026-08-22T03:30:00Z")), "20260821");
  assert.equal(easternISO(Date.parse("2026-08-22T03:30:00Z")), "2026-08-21");
});

test("standard time: 04:30 UTC is still the previous Eastern day", () => {
  // 15 Jan 2027, 04:30 UTC = 23:30 EST on the 14th. A fixed -4 gives 00:30
  // on the 15th, which is the wrong day.
  assert.equal(easternDate(Date.parse("2027-01-15T04:30:00Z")), "20270114");
});

test("standard time: the fixed-offset assumption would have been wrong here", () => {
  const ms = Date.parse("2027-01-15T04:30:00Z");
  const naive = new Date(ms - 4*3600000);
  const naiveDate = naive.getUTCFullYear()
    + String(naive.getUTCMonth()+1).padStart(2,"0")
    + String(naive.getUTCDate()).padStart(2,"0");
  assert.equal(naiveDate, "20270115");            // what the old code produced
  assert.equal(easternDate(ms), "20270114");      // what is actually true
  assert.notEqual(naiveDate, easternDate(ms));
});

test("offset is -4 in daylight time and -5 outside it", () => {
  assert.equal(easternOffsetHours(Date.parse("2026-07-01T12:00:00Z")), -4);
  assert.equal(easternOffsetHours(Date.parse("2026-12-01T12:00:00Z")), -5);
});

test("spring-forward boundary", () => {
  // US DST began 08 Mar 2026 at 02:00 local
  assert.equal(easternOffsetHours(Date.parse("2026-03-08T06:59:00Z")), -5);
  assert.equal(easternOffsetHours(Date.parse("2026-03-08T07:01:00Z")), -4);
});

test("fall-back boundary", () => {
  // US DST ended 01 Nov 2026 at 02:00 local
  assert.equal(easternOffsetHours(Date.parse("2026-11-01T05:59:00Z")), -4);
  assert.equal(easternOffsetHours(Date.parse("2026-11-01T06:01:00Z")), -5);
});

test("midday is unambiguous in both regimes", () => {
  assert.equal(easternDate(Date.parse("2026-08-22T16:00:00Z")), "20260822");
  assert.equal(easternDate(Date.parse("2027-01-15T16:00:00Z")), "20270115");
});
