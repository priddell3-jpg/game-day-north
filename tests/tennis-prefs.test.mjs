import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFromPage } from "./helpers/page.mjs";

/* Tennis adds a preference. Everything already stored in someone's
   browser, and every link already sent to someone else, predates it — so
   the rule is that an absent "p" is an empty set and nothing else
   changes. A viewer who has never picked a player must be unable to tell
   that tennis shipped. */

const { playerIdsFrom } = loadFromPage(["playerIdsFrom"]);

const shareWith = (state) => {
  globalThis.__s = state;
  const { shareLink } = loadFromPage(["shareLink"], `
    const selected = new Set(globalThis.__s.teams || []);
    const services = new Set(globalThis.__s.services || []);
    const hiddenComps = new Set(globalThis.__s.hidden || []);
    const players = new Set(globalThis.__s.players || []);
    const showScores = globalThis.__s.scores !== false;
    const location = {origin: "https://example.test", pathname: "/gdn/"};
  `);
  return shareLink();
};

/* --- reading what is already stored --- */

test("a stored preference written before tennis existed yields no players", () => {
  assert.deepEqual(playerIdsFrom(undefined), []);
  assert.deepEqual(playerIdsFrom(null), []);
  assert.deepEqual(playerIdsFrom([]), []);
});

test("stored player ids are kept", () => {
  assert.deepEqual(playerIdsFrom(["11399", "15548"]), ["11399", "15548"]);
});

test("ids that arrive as numbers are still ids", () => {
  assert.deepEqual(playerIdsFrom([11399, 15548]), ["11399", "15548"]);
});

test("anything that is not an ESPN athlete id is discarded", () => {
  assert.deepEqual(playerIdsFrom([
    "11399", "-3", "", "abc", "<script>", "../../etc/passwd", "1e5",
    "999999999999999", null, undefined, {}, [], "12 34"
  ]), ["11399"]);
});

test("a hostile stored value cannot throw the page over on the way in", () => {
  for(const bad of ["nonsense", 42, {a: 1}, true]){
    assert.doesNotThrow(() => playerIdsFrom(bad));
  }
});

/* --- links --- */

test("an old link with only teams still opens, and follows nobody", () => {
  // "#t=liv.tor-mlb" — the shape every link written before this feature has
  const h = {}; "t=liv.tor-mlb".split("&").forEach(kv => { const [k, v] = kv.split("="); h[k] = v; });
  assert.equal(h.p, undefined);
  assert.deepEqual(playerIdsFrom(h.p ? h.p.split(".") : []), []);
});

test("a link carrying players follows exactly those", () => {
  const h = {};
  "t=liv&p=11399.15548".split("&").forEach(kv => { const [k, v] = kv.split("="); h[k] = v; });
  assert.deepEqual(playerIdsFrom(h.p.split(".")), ["11399", "15548"]);
});

test("a link with a junk player list opens with nobody rather than failing", () => {
  const h = {};
  "t=liv&p=<script>.null.-3".split("&").forEach(kv => { const [k, v] = kv.split("="); h[k] = v; });
  assert.deepEqual(playerIdsFrom(h.p.split(".")), []);
});

test("a link built with no players is exactly the link it always was", () => {
  const link = shareWith({teams: ["liv", "tor-mlb"], players: []});
  assert.equal(link, "https://example.test/gdn/#t=liv.tor-mlb");
  assert.equal(link.includes("p="), false);
});

test("players are appended after the keys older builds already read", () => {
  const link = shareWith({teams: ["liv"], services: ["tsn"], hidden: ["NFL"],
    scores: false, players: ["11399"]});
  assert.match(link, /#t=liv&s=tsn&x=NFL&sc=0&p=11399$/);
  // an older build reading key=value pairs finds everything it knows first
  const pairs = link.split("#")[1].split("&").map(kv => kv.split("=")[0]);
  assert.deepEqual(pairs.slice(0, 4), ["t", "s", "x", "sc"]);
});

test("a link round-trips through the reader that wrote it", () => {
  const link = shareWith({teams: ["liv"], players: ["11399", "15548"]});
  const h = {};
  link.split("#")[1].split("&").forEach(kv => { const [k, v] = kv.split("="); h[k] = v; });
  assert.deepEqual(playerIdsFrom(h.p.split(".")), ["11399", "15548"]);
  assert.deepEqual(h.t.split("."), ["liv"]);
});
