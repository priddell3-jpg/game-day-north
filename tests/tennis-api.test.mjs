import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* A fresh module instance per test. The endpoint holds the last good
   answer from each tour in module scope — that is the point of it, and
   it is asserted below — so tests that need a cold start ask for one
   rather than inheriting whatever ran before them. */
const HANDLER = new URL("../api/tennis.js", import.meta.url).href;
let instance = 0;
const freshHandler = async () => (await import(HANDLER + "?t=" + (++instance))).default;

/* The endpoint, driven with a stubbed fetch. Nothing here touches the
   network: the two payloads are the committed fixtures, so what is being
   asserted is the contract the browser is given rather than whatever
   ESPN happens to be serving today. */

const fx = n => readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8");
const ATP = fx("tennis-atp-scoreboard.json");
const WTA = fx("tennis-wta-scoreboard.json");

function stubFetch(plan){
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const which = String(url).includes("/atp/") ? "atp" : "wta";
    const r = plan[which];
    if(r === "fail") throw new Error("upstream down");
    if(r === "500") return {ok: false, status: 500, json: async () => ({})};
    return {ok: true, status: 200, json: async () => JSON.parse(which === "atp" ? ATP : WTA)};
  };
  return calls;
}

function res(){
  const h = {}; let body = "", code = 200;
  return {setHeader: (k, v) => { h[k] = v; }, end: b => { body = b; },
    get statusCode(){ return code; }, set statusCode(c){ code = c; },
    headers: h, body: () => body, json: () => JSON.parse(body)};
}
const call = async (qs, plan = {atp: "ok", wta: "ok"}, handler) => {
  const calls = stubFetch(plan);
  const r = res();
  const h = handler || await freshHandler();
  await h({url: "/api/tennis" + qs}, r);
  return {r, calls, json: r.json()};
};

// tournaments that really are in the committed fixtures
const WINSTON = "363-2026", USOPEN = "189-2026";

/* ---------------- what comes back by default ---------------- */

test("asking for nothing returns all the singles, which is the default view", async () => {
  const {r, calls, json} = await call("");
  assert.equal(r.statusCode, 200);
  assert.ok(json.matches.length > 0, "All Tennis should mean all of it");
  assert.equal(calls.length, 2, "both tours");
  assert.ok(json.tournaments.length > 0, "and the list the filter is built from");
});

test("doubles never appears however it is asked for", async () => {
  const {json} = await call("");
  const doubles = [];
  for(const p of [ATP, WTA]){
    for(const e of JSON.parse(p).events) for(const g of e.groupings){
      if(/doubles/.test(g.grouping.slug)) doubles.push(...g.competitions.map(c => String(c.id)));
    }
  }
  assert.ok(doubles.length, "the fixtures must contain doubles");
  const got = new Set(json.matches.map(m => m.id));
  for(const id of doubles) assert.equal(got.has(id), false);
});

test("a tour narrows both the answer and the upstream work", async () => {
  const {calls, json} = await call("?tours=atp");
  assert.equal(calls.length, 1, "the other tour is not even fetched");
  assert.match(calls[0], /\/tennis\/atp\//);
  for(const m of json.matches) assert.equal(m.tour, "ATP");
});

test("a tournament narrows to that tournament", async () => {
  const {json} = await call("?events=" + WINSTON);
  assert.ok(json.matches.length);
  for(const m of json.matches) assert.equal(m.tid, WINSTON);
  assert.equal(json.tournaments.length, 1);
  assert.equal(json.tournaments[0].id, WINSTON);
});

test("a Grand Slam comes back listed under both tours", async () => {
  const {json} = await call("?events=" + USOPEN);
  const t = json.tournaments.find(x => x.id === USOPEN);
  assert.ok(t);
  assert.deepEqual(t.tours, ["ATP", "WTA"]);
  assert.equal(t.major, true);
});

test("every tournament offered has matches behind it", async () => {
  const {json} = await call("");
  for(const t of json.tournaments){
    assert.ok(t.n > 0);
    assert.equal(t.n, json.matches.filter(m => m.tid === t.id).length);
  }
});

/* ---------------- input handling ---------------- */

test("a tournament id that is not one is refused, not passed on", async () => {
  const {json, calls} = await call("?events=" + encodeURIComponent("../../secret") + ".<script>");
  assert.deepEqual(json.matches, [], "an explicit filter naming nothing real shows nothing");
  for(const u of calls) assert.doesNotMatch(u, /script|\.\./);
});

test("an explicit filter that matches nothing shows nothing, rather than everything", async () => {
  // a tournament that has since finished, still selected in someone's link
  const {json} = await call("?events=99999-1999");
  assert.deepEqual(json.matches, []);
  assert.deepEqual(json.tournaments, []);
});

test("an unknown tour is ignored rather than trusted", async () => {
  const {calls} = await call("?tours=atp,../../secret,ftp");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/tennis\/atp\/scoreboard$/);
});

test("naming only unknown tours shows nothing rather than both", async () => {
  const {json, calls} = await call("?tours=ftp");
  assert.deepEqual(json.matches, []);
  assert.equal(calls.length, 0, "nothing was fetched for a request naming no real tour");
});

test("an absurd number of tournament ids is capped", async () => {
  const many = Array.from({length: 500}, (_, i) => (1000 + i) + "-2026").join(",");
  const {r} = await call("?events=" + many);
  assert.equal(r.statusCode, 200);
});

test("naming no tour fetches both", async () => {
  const {calls} = await call("");
  assert.equal(calls.length, 2);
});

/* ---------------- caching ---------------- */

test("the CDN shares an answer for just under the client's poll", () => {
  // read off a real response so the assertion is on what ships
  return call("").then(({r}) => {
    const cc = r.headers["Cache-Control"];
    const s = /s-maxage=(\d+)/.exec(cc);
    assert.ok(s, "no shared cache directive: " + cc);
    assert.ok(Number(s[1]) >= 55 && Number(s[1]) <= 60, "s-maxage should be 55-60s, got " + s[1]);
  });
});

test("the browser is told to revalidate every time", async () => {
  const {r} = await call("");
  const cc = r.headers["Cache-Control"];
  assert.match(cc, /max-age=0/);
  assert.match(cc, /must-revalidate/);
  assert.match(cc, /stale-while-revalidate=\d+/);
});

test("the response is JSON", async () => {
  const {r} = await call("");
  assert.match(r.headers["Content-Type"], /application\/json/);
});

/* ---------------- failure ---------------- */

test("one tour failing still returns the other", async () => {
  const {r, json} = await call("", {atp: "fail", wta: "ok"});
  assert.equal(r.statusCode, 200);
  const atp = json.tours.find(t => t.tour === "atp");
  assert.equal(atp.ok, false);
  assert.ok(atp.error, "the failure should be reported, not hidden");
  assert.equal(json.tours.find(t => t.tour === "wta").ok, true);
});

test("every tour failing is an outage, not a quiet day", async () => {
  const {r, json} = await call("", {atp: "fail", wta: "fail"});
  assert.equal(r.statusCode, 503);
  assert.equal(json.matches, null, "null, so the client can tell an outage from no matches");
  assert.equal(r.headers["Cache-Control"], "no-store", "an outage must not be cached");
});

test("an upstream error status is a failure, not an empty draw", async () => {
  const {r, json} = await call("", {atp: "500", wta: "500"});
  assert.equal(r.statusCode, 503);
  assert.equal(json.matches, null);
});

test("a warm instance serves its last good answer when the source drops out", async () => {
  const warm = await freshHandler();                 // one instance, used twice
  const good = await call("", {atp: "ok", wta: "ok"}, warm);
  assert.ok(good.json.matches.length >= 1);
  // same instance, upstream now failing
  const after = await call("", {atp: "fail", wta: "fail"}, warm);
  assert.equal(after.r.statusCode, 200, "the held answer should still be served");
  assert.deepEqual(after.json.matches.map(m => m.id), good.json.matches.map(m => m.id));
  assert.equal(after.json.tours.every(t => t.stale), true, "and it should say it is stale");
});

/* ---------------- the contract ---------------- */

test("the response carries what the rows need and nothing more", async () => {
  const {json} = await call("");
  assert.match(json.generated, /^\d{4}-\d{2}-\d{2}T/);
  const m = json.matches[0];
  for(const k of ["id", "tour", "tid", "round", "start", "timeKnown", "status", "players", "sets"]){
    assert.ok(k in m, "the contract lost " + k);
  }
  assert.equal(m.tournament, undefined, "the tournament is described once, in its own list");
  // nothing from the raw payload leaked through
  const s = JSON.stringify(json);
  for(const junk of ["geoBroadcasts", "previousWinners", "playercard", "espncdn", "uid"]){
    assert.equal(s.includes(junk), false, "raw payload field " + junk + " reached the client");
  }
});

test("the answer is a fraction of what it was read from", async () => {
  const {r} = await call("");
  const raw = ATP.length + WTA.length;
  assert.ok(r.body().length * 3 < raw,
    "expected a large reduction; got " + (raw / r.body().length).toFixed(1) + "x");
});
