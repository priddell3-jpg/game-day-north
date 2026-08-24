import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFromPage } from "./helpers/page.mjs";

const { provenanceOf } = loadFromPage(["provenanceOf"]);

/* An outage can leave three kinds of record on screen at once. They are
   not equally trustworthy and must not share a label: a committed
   schedule may have moved since it was built, the baked list is a small
   hand-checked set that was never going to be current, and a remembered
   result is a score this browser already saw. */

const committed  = {fromFeed:true,   home:{id:"h"}, away:{id:"a"}};
const baked      = {baked:true,      home:{id:"h"}, away:{id:"a"}};
const remembered = {remembered:true, home:{id:"h"}, away:{id:"a"}};
const live       = {espn:true,       home:{id:"h"}, away:{id:"a"}};

test("a committed fixture is marked stale only when the data is stale", () => {
  assert.equal(provenanceOf(committed, false), null);
  assert.equal(provenanceOf(committed, true).kind, "stale");
  assert.match(provenanceOf(committed, true).label, /stale/i);
});

test("a baked fallback says so whether or not anything is stale", () => {
  for(const stale of [true, false]){
    const p = provenanceOf(baked, stale);
    assert.equal(p.kind, "baked");
    assert.match(p.label, /hand-checked/i);
    assert.doesNotMatch(p.label, /stale/i);
  }
});

test("a remembered result stays labelled as recalled locally", () => {
  for(const stale of [true, false]){
    const p = provenanceOf(remembered, stale);
    assert.equal(p.kind, "remembered");
    assert.match(p.label, /recalled|browser/i);
    assert.doesNotMatch(p.label, /stale/i);
  }
});

test("a freshly fetched fixture carries no provenance note at all", () => {
  assert.equal(provenanceOf(live, false), null);
  assert.equal(provenanceOf(live, true), null);
});

test("a mixed outage view labels each record for what it is", () => {
  const view = [committed, baked, remembered, live];
  const labels = view.map(g => { const p = provenanceOf(g, true); return p ? p.kind : "none"; });
  assert.deepEqual(labels, ["stale", "baked", "remembered", "none"]);
  // and no single label is applied across the board
  const distinct = new Set(labels.filter(l => l !== "none"));
  assert.equal(distinct.size, 3);
});

test("a record that is both remembered and from the file reads as remembered", () => {
  // mergeReal keeps a known final and marks it remembered; that is the
  // more specific and more honest of the two claims
  const both = {fromFeed:true, remembered:true, home:{id:"h"}, away:{id:"a"}};
  assert.equal(provenanceOf(both, true).kind, "remembered");
});

test("nothing here throws on a missing or empty record", () => {
  assert.equal(provenanceOf(null, true), null);
  assert.equal(provenanceOf(undefined, false), null);
  assert.equal(provenanceOf({}, true), null);
});
