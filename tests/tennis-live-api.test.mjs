import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GET } from "../api/tennis.mjs";

const fixture = name => readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");

async function withFeeds(fn){
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  const calls = [];
  Date.now = () => Date.parse("2026-08-24T20:00:00Z");
  globalThis.fetch = async (url, init) => {
    calls.push({url:String(url), init});
    const name = String(url).includes("/atp/") ? "tennis-atp-scoreboard.json" : "tennis-wta-scoreboard.json";
    return new Response(fixture(name), {status:200, headers:{"content-type":"application/json"}});
  };
  try{ return await fn(calls); }
  finally{ globalThis.fetch = realFetch; Date.now = realNow; }
}

test("the live endpoint only calls the two fixed tennis scoreboards", async () => {
  await withFeeds(async calls => {
    const response = await GET(new Request("https://example.test/api/tennis?url=https://evil.test"));
    assert.equal(response.status, 200);
    assert.deepEqual(calls.map(x=>x.url), [
      "https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard",
      "https://site.api.espn.com/apis/site/v2/sports/tennis/wta/scoreboard"
    ]);
    assert.ok(calls.every(x=>x.init.headers.accept === "application/json"));
    const body = await response.json();
    assert.ok(Array.isArray(body.matches));
    assert.ok(Array.isArray(body.tournaments));
    assert.ok(Number.isFinite(Date.parse(body.generated)));
  });
});

test("one cached answer is shared for five minutes", async () => {
  await withFeeds(async () => {
    const response = await GET();
    assert.match(response.headers.get("cache-control"), /s-maxage=300/);
    assert.match(response.headers.get("cache-control"), /stale-while-revalidate=60/);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });
});

test("an upstream failure exposes no internal detail and is never cached", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("down", {status:503});
  try{
    const response = await GET();
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {error:"Tennis scores are temporarily unavailable"});
  }finally{ globalThis.fetch = realFetch; }
});
