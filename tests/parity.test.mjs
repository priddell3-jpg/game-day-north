import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFromPage } from "./helpers/page.mjs";
import * as lib from "../scripts/lib/dates.mjs";

/* The build buckets a game by its Eastern date, and so does the page.
   These were two separate implementations — the build assuming a fixed
   offset, the page carrying four hardcoded changeover instants — and
   nothing checked that they agreed. Both now read the zone from the
   platform, and this asserts they land on the same answer, including on
   the days either one used to get wrong. */

const page = loadFromPage(["ZONE_IANA", "zoneParts", "offsetFor", "espnDate"], "const _zoneFmt = {};");

const AROUND_BOUNDARIES = [
  // spring forward, 08 Mar 2026 02:00 local
  "2026-03-08T06:30:00Z", "2026-03-08T06:59:00Z", "2026-03-08T07:01:00Z", "2026-03-08T08:30:00Z",
  // fall back, 01 Nov 2026 02:00 local
  "2026-11-01T05:30:00Z", "2026-11-01T05:59:00Z", "2026-11-01T06:01:00Z", "2026-11-01T07:30:00Z",
  // the band the fixed-offset build got wrong all winter
  "2027-01-15T04:30:00Z", "2027-01-15T04:00:00Z", "2027-01-15T04:59:00Z",
  // late West Coast starts in both regimes
  "2026-08-22T03:30:00Z", "2026-12-20T03:30:00Z", "2027-03-14T06:30:00Z",
  // ordinary middays
  "2026-06-01T16:00:00Z", "2026-12-01T16:00:00Z"
].map(Date.parse);

test("page and build agree on the Eastern date at every boundary case", () => {
  for(const ms of AROUND_BOUNDARIES){
    assert.equal(page.espnDate(ms), lib.easternDate(ms),
      "disagreed at " + new Date(ms).toISOString());
  }
});

test("page and build agree on the Eastern offset at every boundary case", () => {
  for(const ms of AROUND_BOUNDARIES){
    assert.equal(page.offsetFor("ET", ms), lib.offsetFor("ET", ms),
      "disagreed at " + new Date(ms).toISOString());
  }
});

test("agreement holds across every zone the page supports", () => {
  for(const tz of Object.keys(page.ZONE_IANA)){
    for(const ms of AROUND_BOUNDARIES){
      assert.equal(page.offsetFor(tz, ms), lib.offsetFor(tz, ms),
        tz + " disagreed at " + new Date(ms).toISOString());
    }
  }
});

test("the offsets are the real ones, not merely equal to each other", () => {
  const summer = Date.parse("2026-07-01T12:00:00Z"), winter = Date.parse("2026-12-01T12:00:00Z");
  assert.equal(page.offsetFor("ET", summer), -4);
  assert.equal(page.offsetFor("ET", winter), -5);
  assert.equal(page.offsetFor("PT", summer), -7);
  assert.equal(page.offsetFor("PT", winter), -8);
  assert.equal(page.offsetFor("UK", summer), 1);
  assert.equal(page.offsetFor("UK", winter), 0);
  assert.equal(page.offsetFor("CET", summer), 2);
  assert.equal(page.offsetFor("CET", winter), 1);
});

test("European and North American changeovers are not the same week", () => {
  // EU ends 25 Oct 2026, US ends 01 Nov 2026: the old table encoded this
  // by hand, and it is the kind of thing that silently rots
  const between = Date.parse("2026-10-28T12:00:00Z");
  assert.equal(page.offsetFor("UK", between), 0);   // already back to GMT
  assert.equal(page.offsetFor("ET", between), -4);  // still on daylight time
});
