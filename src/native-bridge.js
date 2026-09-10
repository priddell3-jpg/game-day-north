import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

const WEB_APP_URL = "https://game-day-north.vercel.app/";
const DATA_URL = new URL("data.json", WEB_APP_URL).href;
const CACHE_DIRECTORY = "GameDayNorth";
const CACHE_PATH = CACHE_DIRECTORY + "/data.json";
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

async function writeCachedSchedule(data) {
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
  writeCachedSchedule,
  readCachedSchedule,
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
