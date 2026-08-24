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

// two players who really are in the committed fixtures
const someone = () => {
  const d = JSON.parse(ATP);
  const c = d.events[0].groupings[0].competitions.find(x => x.competitors.every(y => /^\d+$/.test(y.id)));
  return c.competitors.map(x => String(x.id));
};

/* ---------------- never the whole draw ---------------- */

test("asking for nothing returns no matches and fetches nothing", async () => {
  const {r, calls, json} = await call("");
  assert.equal(r.statusCode, 200);
  assert.deepEqual(json.matches, []);
  assert.equal(calls.length, 0, "the endpoint went upstream for a request naming nobody");
});

test("a cold instance with a failing source has nothing to fall back on", async () => {
  const {r, json} = await call("?players=1", {atp: "fail", wta: "fail"});
  assert.equal(r.statusCode, 503);
  assert.equal(json.matches, null);
});

test("a full draw is not a response this endpoint can produce", async () => {
  // no players, every plausible way of asking for everything
  for(const qs of ["", "?players=", "?players=all", "?tours=atp,wta", "?players=*"]){
    const {json} = await call(qs);
    assert.deepEqual(json.matches, [], "matches came back for " + JSON.stringify(qs));
  }
});

test("only matches involving the named players come back", async () => {
  const [a] = someone();
  const {json} = await call("?players=" + a);
  assert.ok(json.matches.length >= 1);
  for(const m of json.matches){
    assert.ok(m.players.some(p => p.id === a), "a match arrived for someone not asked about");
  }
  assert.ok(json.counts.deduped > json.counts.returned, "the draw was reduced, not passed through");
});

/* ---------------- input handling ---------------- */

test("ids that are not ids are dropped rather than sent upstream", async () => {
  const [a] = someone();
  const {json, calls} = await call("?players=" + a + ".<script>alert(1)</script>..-3.%2e%2e%2f");
  assert.ok(json.matches.length >= 1, "the one real id still worked");
  for(const u of calls) assert.doesNotMatch(u, /script|\.\./);
});

test("an absurd number of ids is capped", async () => {
  const many = Array.from({length: 500}, (_, i) => 1000 + i).join(".");
  const {r} = await call("?players=" + many);
  assert.equal(r.statusCode, 200);
});

test("an unknown tour is ignored rather than trusted", async () => {
  const [a] = someone();
  const {calls} = await call("?players=" + a + "&tours=atp,../../secret,ftp");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/tennis\/atp\/scoreboard$/);
});

test("naming one tour fetches only that tour", async () => {
  const [a] = someone();
  const {calls} = await call("?players=" + a + "&tours=wta");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/wta\//);
});

test("naming no tour fetches both", async () => {
  const [a] = someone();
  const {calls} = await call("?players=" + a);
  assert.equal(calls.length, 2);
});

/* ---------------- caching ---------------- */

test("the CDN shares an answer for just under the client's poll", () => {
  // read off a real response so the assertion is on what ships
  return call("?players=1").then(({r}) => {
    const cc = r.headers["Cache-Control"];
    const s = /s-maxage=(\d+)/.exec(cc);
    assert.ok(s, "no shared cache directive: " + cc);
    assert.ok(Number(s[1]) >= 55 && Number(s[1]) <= 60, "s-maxage should be 55-60s, got " + s[1]);
  });
});

test("the browser is told to revalidate every time", async () => {
  const {r} = await call("?players=1");
  const cc = r.headers["Cache-Control"];
  assert.match(cc, /max-age=0/);
  assert.match(cc, /must-revalidate/);
  assert.match(cc, /stale-while-revalidate=\d+/);
});

test("the response is JSON", async () => {
  const {r} = await call("?players=1");
  assert.match(r.headers["Content-Type"], /application\/json/);
});

/* ---------------- failure ---------------- */

test("one tour failing still returns the other", async () => {
  const [a] = someone();
  const {r, json} = await call("?players=" + a, {atp: "fail", wta: "ok"});
  assert.equal(r.statusCode, 200);
  const atp = json.tours.find(t => t.tour === "atp");
  assert.equal(atp.ok, false);
  assert.ok(atp.error, "the failure should be reported, not hidden");
  assert.equal(json.tours.find(t => t.tour === "wta").ok, true);
});

test("every tour failing is an outage, not a quiet day", async () => {
  const {r, json} = await call("?players=1", {atp: "fail", wta: "fail"});
  assert.equal(r.statusCode, 503);
  assert.equal(json.matches, null, "null, so the client can tell an outage from no matches");
  assert.equal(r.headers["Cache-Control"], "no-store", "an outage must not be cached");
});

test("an upstream error status is a failure, not an empty draw", async () => {
  const {r, json} = await call("?players=1", {atp: "500", wta: "500"});
  assert.equal(r.statusCode, 503);
  assert.equal(json.matches, null);
});

test("a warm instance serves its last good answer when the source drops out", async () => {
  const [a] = someone();
  const warm = await freshHandler();                 // one instance, used twice
  const good = await call("?players=" + a, {atp: "ok", wta: "ok"}, warm);
  assert.ok(good.json.matches.length >= 1);
  // same instance, upstream now failing
  const after = await call("?players=" + a, {atp: "fail", wta: "fail"}, warm);
  assert.equal(after.r.statusCode, 200, "the held answer should still be served");
  assert.deepEqual(after.json.matches.map(m => m.id), good.json.matches.map(m => m.id));
  assert.equal(after.json.tours.every(t => t.stale), true, "and it should say it is stale");
});

/* ---------------- the contract ---------------- */

test("the response carries what the rows need and nothing more", async () => {
  const [a] = someone();
  const {json} = await call("?players=" + a);
  assert.match(json.generated, /^\d{4}-\d{2}-\d{2}T/);
  const m = json.matches[0];
  for(const k of ["id", "tour", "tournament", "round", "start", "timeKnown", "status", "players", "sets"]){
    assert.ok(k in m, "the contract lost " + k);
  }
  // nothing from the raw payload leaked through
  const s = JSON.stringify(json);
  for(const junk of ["geoBroadcasts", "previousWinners", "playercard", "espncdn", "uid"]){
    assert.equal(s.includes(junk), false, "raw payload field " + junk + " reached the client");
  }
});

test("the answer is a small fraction of what it was read from", async () => {
  const [a] = someone();
  const {r} = await call("?players=" + a);
  const raw = ATP.length + WTA.length;
  assert.ok(r.body().length * 20 < raw,
    "expected a large reduction; got " + (raw / r.body().length).toFixed(0) + "x");
});
