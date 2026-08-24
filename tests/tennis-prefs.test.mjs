import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage } from "./helpers/page.mjs";

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");

/* Tennis adds two preferences: which tours are on, and which tournaments
   the viewer has narrowed to. Everything already stored in someone's
   browser, and every link already sent to someone else, predates both —
   so the rule is that absent keys mean tennis is off and nothing else
   changes. A viewer who has never switched a tour on must be unable to
   tell that tennis shipped. */

const { keptFrom, isTour, isEventId } = loadFromPage(["keptFrom", "isTour", "isEventId"]);

const shareWith = (state) => {
  globalThis.__s = state;
  const { shareLink } = loadFromPage(["shareLink"], `
    const selected = new Set(globalThis.__s.teams || []);
    const services = new Set(globalThis.__s.services || []);
    const hiddenComps = new Set(globalThis.__s.hidden || []);
    const tennisTours = new Set(globalThis.__s.tours || []);
    const tennisEvents = new Set(globalThis.__s.events || []);
    const showScores = globalThis.__s.scores !== false;
    const location = {origin: "https://example.test", pathname: "/gdn/"};
  `);
  return shareLink();
};

/* --- reading what is already stored --- */

test("a stored preference written before tennis existed switches nothing on", () => {
  for(const empty of [undefined, null, []]){
    assert.deepEqual(keptFrom(empty, isTour), []);
    assert.deepEqual(keptFrom(empty, isEventId), []);
  }
});

test("stored tours and tournaments are kept", () => {
  assert.deepEqual(keptFrom(["ATP", "WTA"], isTour), ["ATP", "WTA"]);
  assert.deepEqual(keptFrom(["189-2026", "363-2026"], isEventId), ["189-2026", "363-2026"]);
});

test("anything that is not one of ours is discarded", () => {
  assert.deepEqual(keptFrom(["ATP", "atp", "ITF", "", "<script>", null, {}], isTour), ["ATP"]);
  assert.deepEqual(keptFrom(
    ["189-2026", "189", "2026", "abc-2026", "189-26", "../../x", "189-2026-2"], isEventId),
    ["189-2026"]);
});

test("a tournament is only ever an id, never a name", () => {
  // sponsors rename these mid-season; a name in the store would rot
  assert.deepEqual(keptFrom(["US Open", "Winston-Salem Open"], isEventId), []);
});

test("a hostile stored value cannot throw the page over on the way in", () => {
  for(const bad of ["nonsense", 42, {a: 1}, true, null]){
    assert.doesNotThrow(() => keptFrom(bad, isTour));
    assert.deepEqual(keptFrom(bad, isTour), []);
  }
});

/* --- links --- */

const parse = link => {
  const h = {};
  (link.split("#")[1] || "").split("&").forEach(kv => { const [k, v] = kv.split("="); h[k] = v; });
  return h;
};

test("an old link with only teams still opens, with tennis off", () => {
  const h = parse("x#t=liv.tor-mlb");
  assert.equal(h.tt, undefined);
  assert.deepEqual(keptFrom(h.tt ? h.tt.split(".") : [], isTour), []);
});

test("a link carrying tours switches on exactly those", () => {
  const h = parse("x#t=liv&tt=ATP.WTA");
  assert.deepEqual(keptFrom(h.tt.split("."), isTour), ["ATP", "WTA"]);
});

test("a link carrying a tournament narrows to it", () => {
  const h = parse("x#t=liv&tt=ATP&te=363-2026");
  assert.deepEqual(keptFrom(h.te.split("."), isEventId), ["363-2026"]);
});

test("a link with a junk filter opens showing everything rather than failing", () => {
  const h = parse("x#t=liv&tt=<script>&te=null");
  assert.deepEqual(keptFrom(h.tt.split("."), isTour), []);
  assert.deepEqual(keptFrom(h.te.split("."), isEventId), []);
});

test("a link built with tennis off is exactly the link it always was", () => {
  const link = shareWith({teams: ["liv", "tor-mlb"], tours: []});
  assert.equal(link, "https://example.test/gdn/#t=liv.tor-mlb");
  assert.equal(link.includes("tt="), false);
  assert.equal(link.includes("te="), false);
});

test("the tournament filter is only carried when there is one", () => {
  const link = shareWith({teams: ["liv"], tours: ["ATP"]});
  assert.match(link, /#t=liv&tt=ATP$/);
});

test("tennis keys are appended after the keys older builds already read", () => {
  const link = shareWith({teams: ["liv"], services: ["tsn"], hidden: ["NFL"],
    scores: false, tours: ["WTA", "ATP"], events: ["363-2026", "189-2026"]});
  assert.match(link, /#t=liv&s=tsn&x=NFL&sc=0&tt=ATP\.WTA&te=189-2026\.363-2026$/);
  const keys = (link.split("#")[1]).split("&").map(kv => kv.split("=")[0]);
  assert.deepEqual(keys.slice(0, 4), ["t", "s", "x", "sc"]);
});

test("the tennis keys are sorted, so the same choice is always the same link", () => {
  const a = shareWith({teams: ["liv"], tours: ["WTA", "ATP"]});
  const b = shareWith({teams: ["liv"], tours: ["ATP", "WTA"]});
  assert.equal(a, b);
});

test("a link round-trips through the reader that wrote it", () => {
  const link = shareWith({teams: ["liv"], tours: ["ATP"], events: ["363-2026"]});
  const h = parse(link);
  assert.deepEqual(keptFrom(h.tt.split("."), isTour), ["ATP"]);
  assert.deepEqual(keptFrom(h.te.split("."), isEventId), ["363-2026"]);
  assert.deepEqual(h.t.split("."), ["liv"]);
});

/* --- the build that followed players --- */

test("a link from the player build still opens, and shows tennis", () => {
  /* An early build followed individual people under "p". Those links are
     read as "this person wanted tennis", which is the nearest honest
     thing this build can offer them. */
  assert.match(SRC, /if\(!tennisTours\.size && \(h\.p \|\| /,
    "an old p= link should switch tennis on rather than being ignored");
  assert.match(SRC, /tennisTours = new Set\(\["ATP", "WTA"\]\)/);
});
