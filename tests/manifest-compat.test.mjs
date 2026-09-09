import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage } from "./helpers/page.mjs";

/* Nobody's board may change.
 *
 * The six lists are gone and every club now comes from data/teams.json.
 * The equivalence tests prove the manifest reproduces those lists; these
 * prove the thing that actually matters to a person, which is that what
 * they already have still works. Ids live in two places outside this
 * repository's control — a share link somebody sent, and a browser's
 * localStorage — and neither gets a migration.
 */

const root = new URL("../", import.meta.url);
const SRC = readFileSync(new URL("src/page.html", root), "utf8");
const LEGACY = JSON.parse(readFileSync(new URL("tests/fixtures/legacy-team-lists.json", root), "utf8"));
const FROZEN = JSON.parse(readFileSync(new URL("tests/fixtures/frozen-team-ids.json", root), "utf8"));

/* The shipped initialiser, run against a supplied hash and storage.
   Same approach as tests/rugby-prefs.test.mjs, for the same reason: it
   is the real code, not a restatement of it. */
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
    return {selected:[...selected], services:[...services], hidden:[...hiddenComps],
            showScores, stars:[...rugbyStars]};`;
  return new Function(body)();
}

/* The board, built the way the page builds it. */
function board(){
  const P = loadFromPage(["TEAM_MANIFEST", "SOCCER", "fullName", "TEAMS", "DEFAULT_TEAMS"]);
  P.TEAM_MANIFEST.teams.concat(P.TEAM_MANIFEST.events).forEach(e => {
    P.TEAMS[e.id] = {id:e.id, home:e.comp, city:e.city || "", name:e.name, abbr:e.abbr,
      tz:e.tz, color:e.color, comps: [e.comp].concat(e.extraComps || []),
      ...(e.feedName ? {feed:e.feedName} : {}), ...(e.displayName ? {display:e.displayName} : {})};
  });
  return P;
}

/* ============================ share links ============================ */

test("a share link built from today's ids decodes to the same board", () => {
  /* Every followable id, in one link, as somebody could genuinely have
     sent. If any id stopped resolving, this is where it shows. */
  const ids = LEGACY.TEAM_ROWS.map(r => r[0]);
  const s = initWith("#t=" + ids.join("."), {});
  assert.deepEqual(s.selected, ids, "every id in the link came back, in order");
});

test("the links people actually hold still work", () => {
  const s = initWith("#t=van-nhl.liv.tor-mlb&s=sportsnet.dazn&x=EFL&sc=0", {});
  assert.deepEqual(s.selected, ["van-nhl", "liv", "tor-mlb"]);
  assert.deepEqual(s.services, ["sportsnet", "dazn"]);
  assert.deepEqual(s.hidden, ["EFL"]);
  assert.equal(s.showScores, false);
});

test("every id a link could carry still names the same club", () => {
  /* The ledger binds an id to the club it names. A link is just a list
     of those ids, so if the binding holds, so does every link ever
     sent. */
  const P = board();
  for(const [id, want] of Object.entries(FROZEN.ids)){
    if(want.group !== "teams" && want.group !== "events") continue;
    const t = P.TEAMS[id];
    assert.ok(t, id + " no longer resolves — a share link naming it would silently drop it");
    assert.equal(t.home, want.comp, id + " changed competition");
  }
});

/* ============================ saved boards ============================ */

test("a localStorage board written before this change still loads", () => {
  /* Written by the shipped app before the manifest existed: raw ids, no
     version, no migration path. It has to keep working untouched. */
  const before = {
    "gdn.teams": ["van-nhl", "van-mls", "tor-mlb", "tor-nba", "liv", "kc", "int"],
    "gdn.services": ["sportsnet", "prime"],
    "gdn.hidden": ["FAC"],
    "gdn.scores": false
  };
  const s = initWith("", before);
  assert.deepEqual(s.selected, before["gdn.teams"], "every saved id survived");
  assert.deepEqual(s.services, before["gdn.services"]);
  assert.deepEqual(s.hidden, before["gdn.hidden"]);
  assert.equal(s.showScores, false);
});

test("a saved board of every club still loads whole", () => {
  const ids = LEGACY.ROSTER.map(r => r[0]);
  const s = initWith("", { "gdn.teams": ids });
  assert.deepEqual(s.selected, ids);
});

test("a saved board naming a club that no longer exists is not a crash", () => {
  /* Not a promise that it renders — an id nothing knows resolves to no
     club and simply shows nothing. The promise is that it does not take
     the rest of the board down with it. */
  const s = initWith("", { "gdn.teams": ["liv", "no-such-club", "tor-mlb"] });
  assert.ok(s.selected.includes("liv") && s.selected.includes("tor-mlb"));
});

/* ============================ the default board ============================ */

test("the default board is the same five clubs in the same order", () => {
  const P = board();
  assert.deepEqual(P.DEFAULT_TEAMS, LEGACY.DEFAULT_TEAMS,
    "order is what a first-time visitor sees, so it is part of the promise");
  assert.deepEqual(P.DEFAULT_TEAMS, ["van-nhl", "van-mls", "tor-mlb", "tor-nba", "liv"]);
});

test("a first visit with nothing saved gets exactly that board", () => {
  const s = initWith("", {});
  assert.deepEqual(s.selected, LEGACY.DEFAULT_TEAMS);
});

test("the default board renders the names it always rendered", () => {
  const P = board();
  const rendered = P.DEFAULT_TEAMS.map(id => P.fullName(P.TEAMS[id]));
  assert.deepEqual(rendered,
    ["Vancouver Canucks", "Vancouver Whitecaps", "Toronto Blue Jays", "Toronto Raptors", "Liverpool"],
    "including the two that override the plain city-and-name derivation");
});

/* ============================ every club, not just the defaults ============================ */

test("every club renders exactly the name it rendered before", () => {
  /* The one test that would catch a manifest whose displayName or city
     had drifted: it rebuilds what the old lists would have shown and
     compares club for club. */
  const P = board();
  const SOCCER = P.SOCCER;
  const wasNamed = row => {
    const [id, comp, city, name] = row;
    return LEGACY.CLUB_NAMES[id] || (SOCCER[comp] ? name : (city + " " + name));
  };
  const differed = [];
  for(const row of LEGACY.TEAM_ROWS){
    const now = P.fullName(P.TEAMS[row[0]]);
    if(now !== wasNamed(row)) differed.push(row[0] + ": was " + wasNamed(row) + ", now " + now);
  }
  assert.deepEqual(differed, []);
});

test("every club still enters exactly the competitions it entered", () => {
  const P = board();
  const wasComps = row => {
    const comps = row[1] === "EPL" ? ["EPL", "EFL", "FAC"] : [row[1]];
    return row[7] ? comps.concat(["UCL"]) : comps;
  };
  const differed = [];
  for(const row of LEGACY.TEAM_ROWS){
    const now = P.TEAMS[row[0]].comps;
    if(JSON.stringify(now) !== JSON.stringify(wasComps(row)))
      differed.push(row[0] + ": was " + wasComps(row).join("/") + ", now " + now.join("/"));
  }
  assert.deepEqual(differed, [], "a club losing a competition loses those fixtures silently");
});

test("every club keeps its colour, abbreviation and timezone", () => {
  const P = board();
  const differed = [];
  for(const [id, comp, city, name, abbr, tz, color] of LEGACY.TEAM_ROWS){
    const t = P.TEAMS[id];
    if(t.abbr !== abbr) differed.push(id + " abbr " + abbr + " -> " + t.abbr);
    if(t.tz !== tz) differed.push(id + " tz " + tz + " -> " + t.tz);
    if(t.color !== color) differed.push(id + " colour " + color + " -> " + t.color);
    if(t.city !== city) differed.push(id + " city " + city + " -> " + t.city);
    if(t.name !== name) differed.push(id + " name " + name + " -> " + t.name);
  }
  assert.deepEqual(differed, []);
});
