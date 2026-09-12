import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

const WEB_APP_URL = "https://game-day-north.vercel.app/";
const DATA_URL = new URL("data.json", WEB_APP_URL).href;
const CACHE_DIRECTORY = "GameDayNorth";
const CACHE_PATH = CACHE_DIRECTORY + "/data.json";
/* The ETag of the saved schedule, kept beside it. Sent back as
   If-None-Match so an unchanged file costs a 304 and no body instead of
   a whole download, a parse and a rewrite of the saved copy. */
const CACHE_TAG_PATH = CACHE_DIRECTORY + "/data.etag";
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const JSON_HOSTS = new Set([
  "game-day-north.vercel.app",
  "site.api.espn.com",
  "api.wr-rims-prod.pulselive.com"
]);

function checkedJsonUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !JSON_HOSTS.has(url.hostname)) {
    throw new Error("Blocked unexpected data host");
  }
  return url.href;
}

function asJson(value) {
  if (typeof value === "string") {
    if (new TextEncoder().encode(value).byteLength > MAX_JSON_BYTES) {
      throw new Error("JSON response is too large");
    }
    return JSON.parse(value);
  }
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > MAX_JSON_BYTES) {
    throw new Error("JSON response is too large");
  }
  return value;
}

async function getJson(rawUrl, timeout) {
  const url = checkedJsonUrl(rawUrl);
  const response = await CapacitorHttp.get({
    url,
    headers: { accept: "application/json" },
    connectTimeout: timeout || 9000,
    readTimeout: timeout || 9000,
    responseType: "json"
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error("HTTP " + response.status);
  }
  return asJson(response.data);
}

async function readScheduleTag() {
  try {
    const file = await Filesystem.readFile({
      path: CACHE_TAG_PATH,
      directory: Directory.Library,
      encoding: Encoding.UTF8
    });
    const tag = typeof file.data === "string" ? file.data.trim() : "";
    return /^(W\/)?"[^"\r\n]{1,200}"$/.test(tag) ? tag : "";
  } catch (error) {
    return "";
  }
}

async function forgetScheduleTag() {
  try {
    await Filesystem.deleteFile({ path: CACHE_TAG_PATH, directory: Directory.Library });
  } catch (error) {
    // No tag saved yet is the normal case.
  }
}

/* data.json, conditionally. Resolves to { unchanged: true } on a 304 for
   the tag it sent, or to { data, etag } for a changed file. Any other
   status is an error, as it is for every other JSON request. */
async function getSchedule(timeout) {
  const url = checkedJsonUrl(DATA_URL);
  const tag = await readScheduleTag();
  const headers = { accept: "application/json" };
  if (tag) headers["if-none-match"] = tag;
  const response = await CapacitorHttp.get({
    url,
    headers,
    connectTimeout: timeout || 12000,
    readTimeout: timeout || 12000,
    responseType: "json"
  });
  if (response.status === 304) {
    if (!tag) throw new Error("HTTP 304");
    return { unchanged: true };
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error("HTTP " + response.status);
  }
  const etag = response.headers && response.headers.etag;
  return { data: asJson(response.data), etag: typeof etag === "string" ? etag : null };
}

async function writeCachedSchedule(data, etag) {
  const encoded = JSON.stringify(data);
  if (new TextEncoder().encode(encoded).byteLength > MAX_JSON_BYTES) {
    throw new Error("Schedule is too large to cache");
  }
  try {
    await Filesystem.mkdir({
      path: CACHE_DIRECTORY,
      directory: Directory.Library,
      recursive: true
    });
  } catch (error) {
    // The directory already existing is the normal path after first launch.
  }
  await Filesystem.writeFile({
    path: CACHE_PATH,
    data: encoded,
    directory: Directory.Library,
    encoding: Encoding.UTF8
  });
  /* The tag is written after the file, never before: a copy without a
     tag is fetched whole next time, which is the safe direction. */
  if (typeof etag === "string" && etag) {
    await Filesystem.writeFile({
      path: CACHE_TAG_PATH,
      data: etag,
      directory: Directory.Library,
      encoding: Encoding.UTF8
    });
  } else {
    await forgetScheduleTag();
  }
}

async function readCachedSchedule() {
  const file = await Filesystem.readFile({
    path: CACHE_PATH,
    directory: Directory.Library,
    encoding: Encoding.UTF8
  });
  const encoded = typeof file.data === "string" ? file.data : await file.data.text();
  return asJson(encoded);
}

async function openExternal(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") {
    throw new Error("Blocked unsafe external link");
  }
  await Browser.open({ url: url.href });
}

const native = Capacitor.isNativePlatform();

window.GDNNative = Object.freeze({
  isNative: native,
  webUrl: WEB_APP_URL,
  dataUrl: DATA_URL,
  getJson,
  getSchedule,
  writeCachedSchedule,
  readCachedSchedule,
  forgetScheduleTag,
  openExternal
});

if (native) {
  document.addEventListener("click", event => {
    const target = event.target;
    const anchor = target && target.closest ? target.closest("a[href]") : null;
    if (!anchor) return;

    let url;
    try {
      url = new URL(anchor.href, location.href);
    } catch (error) {
      event.preventDefault();
      return;
    }

    if (url.protocol === "https:") {
      event.preventDefault();
      void openExternal(url.href).catch(error => console.error("External link failed", error));
      return;
    }

    if (url.protocol !== "capacitor:") event.preventDefault();
  }, true);
}
