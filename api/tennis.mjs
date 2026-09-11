import { normalizeTennis } from "../scripts/lib/tennis.mjs";

/*
 * A deliberately narrow live-data endpoint. ESPN publishes tennis as
 * current tournament scoreboards rather than one small event response,
 * so the reduction has to happen somewhere other than the browser. This
 * function asks only the two fixed tennis feeds, keeps singles, and sends
 * the compact contract the page already knows how to render.
 *
 * There is no caller-supplied upstream URL, no secret, and no write. The
 * edge cache means many viewers checking the same match share one upstream
 * answer instead of each downloading both multi-megabyte scoreboards.
 */
const FEEDS = Object.freeze([
  "https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard",
  "https://site.api.espn.com/apis/site/v2/sports/tennis/wta/scoreboard"
]);
const SOURCE_LIMIT = 8 * 1024 * 1024;
const OUTPUT_LIMIT = 2 * 1024 * 1024;
const CACHE_SECONDS = 300;

async function scoreboard(url){
  const response = await fetch(url, {
    headers: {accept: "application/json"},
    signal: AbortSignal.timeout(12000)
  });
  if(!response.ok) throw new Error("Upstream HTTP " + response.status);
  const text = await response.text();
  if(new TextEncoder().encode(text).byteLength > SOURCE_LIMIT)
    throw new Error("Upstream response is too large");
  return JSON.parse(text);
}

export async function GET(){
  try{
    const now = Date.now();
    const payloads = await Promise.all(FEEDS.map(scoreboard));
    const result = normalizeTennis(payloads, {now});
    const body = JSON.stringify(result);
    if(new TextEncoder().encode(body).byteLength > OUTPUT_LIMIT)
      throw new Error("Normalised response is too large");
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=0, s-maxage=" + CACHE_SECONDS + ", stale-while-revalidate=60",
        "x-content-type-options": "nosniff"
      }
    });
  }catch(error){
    console.error("Tennis live refresh failed", error && error.message || error);
    return Response.json({error: "Tennis scores are temporarily unavailable"}, {
      status: 502,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      }
    });
  }
}
