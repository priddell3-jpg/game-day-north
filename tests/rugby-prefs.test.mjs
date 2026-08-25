import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage } from "./helpers/page.mjs";

const SRC = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");

/* Adding rugby must cost nobody their setup. A link written before rugby
   existed, and a browser holding storage written before rugby existed,
   both have to keep working and neither may end up with rugby switched
   on — a competition nobody asked for appearing on the page would be
   exactly the kind of guess this project does not make. */

/* The shipped initialiser, run against a supplied hash and storage. */
function initWith(hash, store){
  const block = /\(function initState\(\)\{[\s\S]*?\n\}\)\(\);/.exec(SRC);
  assert.ok(block, "initState must exist");
  const decls = loadFromPage(["DEFAULT_TEAMS", "RUGBY_FOLLOW"], "");
  const body = `
    const location = {hash: ${JSON.stringify(hash)}, pathname:"/", search:"", origin:"https://example.test"};
    const history = {replaceState(){}};
    const store = ${JSON.stringify(store)};
    const LS = { get(k, d){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : d; },
                 set(k, v){ store[k] = v; } };
    const DEFAULT_TEAMS = ${JSON.stringify(decls.DEFAULT_TEAMS)};
    const RUGBY_FOLLOW = ${JSON.stringify(decls.RUGBY_FOLLOW)};
    let selected, services, hiddenComps, showScores, rugbyStars;
    ${block[0]}
    const rugbyOn = () => selected.has(RUGBY_FOLLOW);
    return {selected:[...selected], services:[...services], hidden:[...hiddenComps],
            showScores, stars:[...rugbyStars], rugbyOn: rugbyOn()};`;
  return new Function(body)();
}

/* ---------------- links written before rugby existed ---------------- */

test("an old share link still selects exactly the teams it named", () => {
  const s = initWith("#t=van-nhl.liv.tor-mlb&s=sportsnet.dazn&x=EFL&sc=0", {});
  assert.deepEqual(s.selected, ["van-nhl", "liv", "tor-mlb"]);
  assert.deepEqual(s.services, ["sportsnet", "dazn"]);
  assert.deepEqual(s.hidden, ["EFL"]);
  assert.equal(s.showScores, false);
});

test("an old share link leaves rugby off and starred nations empty", () => {
  const s = initWith("#t=van-nhl.liv&s=sportsnet", {});
  assert.deepEqual(s.stars, []);
  assert.equal(s.rugbyOn, false);
});

test("a bare link falls back to the default teams, which contain no rugby", () => {
  const s = initWith("", {});
  assert.deepEqual(s.selected, ["van-nhl", "van-mls", "tor-mlb", "tor-nba", "liv"]);
  assert.equal(s.rugbyOn, false);
  assert.deepEqual(s.stars, []);
});

test("an unknown key in a link is ignored rather than breaking the parse", () => {
  const s = initWith("#t=liv&zz=whatever&s=fubo", {});
  assert.deepEqual(s.selected, ["liv"]);
  assert.deepEqual(s.services, ["fubo"]);
});

/* ---------------- storage written before rugby existed ---------------- */

test("old localStorage keeps its teams, services, hidden comps and score setting", () => {
  const s = initWith("", {"gdn.teams":["tor-nhl","edm"], "gdn.services":["tsn"],
                          "gdn.hidden":["FAC"], "gdn.scores":false});
  assert.deepEqual(s.selected, ["tor-nhl", "edm"]);
  assert.deepEqual(s.services, ["tsn"]);
  assert.deepEqual(s.hidden, ["FAC"]);
  assert.equal(s.showScores, false);
  assert.equal(s.rugbyOn, false);
  assert.deepEqual(s.stars, []);
});

test("storage with no rugby key at all yields no stars and no rugby", () => {
  const s = initWith("", {"gdn.teams":["liv"]});
  assert.deepEqual(s.stars, []);
  assert.equal(s.rugbyOn, false);
});

test("a corrupt rugby-stars value cannot break start-up", () => {
  for(const bad of [null, "nonsense", 42, {}]){
    const s = initWith("", {"gdn.teams":["liv"], "gdn.rugby.stars":bad});
    assert.equal(s.rugbyOn, false);
    assert.ok(Array.isArray(s.stars));
  }
});

/* ---------------- links written after rugby existed ---------------- */

test("a rugby link switches rugby on and carries its stars", () => {
  const s = initWith("#t=rugby-intl&rs=ireland.new-zealand", {});
  assert.equal(s.rugbyOn, true);
  assert.deepEqual(s.stars, ["ireland", "new-zealand"]);
});

test("rugby rides in the existing teams parameter, so no new key was needed for it", () => {
  const s = initWith("#t=van-nhl.rugby-intl.liv", {});
  assert.deepEqual(s.selected, ["van-nhl", "rugby-intl", "liv"]);
  assert.equal(s.rugbyOn, true);
});

test("stars without the rugby switch leave rugby off", () => {
  // Nothing may opt someone in by side effect.
  const s = initWith("#t=liv&rs=ireland", {});
  assert.equal(s.rugbyOn, false);
  assert.deepEqual(s.stars, ["ireland"]);
});

test("a stored rugby selection survives a reload", () => {
  const s = initWith("", {"gdn.teams":["rugby-intl","liv"], "gdn.rugby.stars":["wales"]});
  assert.equal(s.rugbyOn, true);
  assert.deepEqual(s.stars, ["wales"]);
});

/* ---------------- writing a link ---------------- */

function shareWith(selected, services, hidden, scores, stars){
  const page = loadFromPage(["shareLink"],
    `const location = {origin:"https://example.test", pathname:"/"};
     const selected = new Set(${JSON.stringify(selected)});
     const services = new Set(${JSON.stringify(services)});
     const hiddenComps = new Set(${JSON.stringify(hidden)});
     const showScores = ${scores};
     const rugbyStars = new Set(${JSON.stringify(stars)});`);
  return page.shareLink();
}

test("a link with no stars is byte-identical to what it was before rugby", () => {
  assert.equal(shareWith(["van-nhl","liv"], ["sportsnet"], ["EFL"], false, []),
    "https://example.test/#t=van-nhl.liv&s=sportsnet&x=EFL&sc=0");
});

test("stars are appended after the existing keys, never inserted among them", () => {
  const link = shareWith(["rugby-intl"], [], [], true, ["ireland","fiji"]);
  assert.equal(link, "https://example.test/#t=rugby-intl&rs=ireland.fiji");
  const withAll = shareWith(["liv","rugby-intl"], ["dazn"], ["FAC"], false, ["wales"]);
  assert.equal(withAll.indexOf("rs="), withAll.length - "rs=wales".length,
    "rs is last, so an older reader parses everything it knows first");
});

test("a link round-trips through the initialiser", () => {
  const link = shareWith(["liv","rugby-intl"], ["dazn"], ["FAC"], false, ["wales","fiji"]);
  const s = initWith(link.slice(link.indexOf("#")), {});
  assert.deepEqual(s.selected, ["liv", "rugby-intl"]);
  assert.deepEqual(s.services, ["dazn"]);
  assert.deepEqual(s.hidden, ["FAC"]);
  assert.equal(s.showScores, false);
  assert.deepEqual(s.stars, ["wales", "fiji"]);
});

/* ---------------- persistence ---------------- */

test("starred nations are written to their own key, leaving the others alone", () => {
  const persist = /function persist\(\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  for(const k of ["gdn.teams", "gdn.services", "gdn.hidden", "gdn.scores", "gdn.alerts"]){
    assert.ok(persist.includes(k), k + " must still be written");
  }
  assert.ok(persist.includes("gdn.rugby.stars"));
});

test("cycling and score settings are untouched by any of this", () => {
  assert.match(SRC, /const RESULTS_KEY = "gdn\.results"/);
  assert.match(SRC, /function attachCycling/);
  assert.match(SRC, /LS\.set\("gdn\.scores",showScores\)/);
});
