import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFromPage } from "./helpers/page.mjs";
import { checkedAlerts, clipAlertText, ALERT_MAX, ALERT_TITLE_MAX, ALERT_BODY_MAX, ALERT_ID_MAX } from "../src/alert-list.mjs";

/* Game-time alerts: "Remind me about my teams' games", at a time the
   viewer picks (the morning of, or 3 h, 2 h, 1 h or 30 min before), in
   the iOS app only. Most cases below run at thirty minutes, the timing
   the feature first shipped with; the timing cases are at the end. The page decides which games and what to say; the
   bridge checks the list and hands it to the notification centre. Both
   halves are tested here as they ship — the page functions pulled out of
   src/page.html, the validator imported from the file the bridge
   bundles. */

const PAGE = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
const BRIDGE = readFileSync(new URL("../src/native-bridge.js", import.meta.url), "utf8");
const PRIVACY = readFileSync(new URL("../privacy.html", import.meta.url), "utf8");

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
/* A Sunday afternoon, well clear of any Emirates NBA Cup night. */
const NOW = Date.parse("2026-11-29T20:00:00Z");

const SELECTION = ["REMIND_CHOICES", "REMIND_DEFAULT", "REMIND_MORNING_HOUR", "REMIND_WINDOW", "REMIND_MAX",
  "REMIND_TITLE_MAX", "REMIND_BODY_MAX", "REMIND_SLACK", "pad", "ymd", "localKey", "fmtTime",
  "fullName", "remindChoice", "alertKey", "alertId", "alertGames", "alertClip", "alertCarriers", "alertText",
  "gameAlerts", "morningDay", "morningAt", "alertShort", "morningAlerts", "alertList"];

/* A page scope with a board of its own. `rights`, when given, stands in
   for resolveRights so the wording can be checked against each
   confidence directly; without it the real table is evaluated. */
function page(opts = {}){
  const box = { games: opts.games || [], picks: opts.picks || [], hidden: opts.hidden || [], rights: opts.rights || null };
  globalThis.__gdnAlertBox = box;
  const pre = "const box = globalThis.__gdnAlertBox;\n"
    + "const DAY = 86400000;\n"
    + "let remindWhen = " + JSON.stringify(opts.when || "30") + ";\n"
    + "const GAMES = box.games;\n"
    + "const selected = new Set(box.picks);\n"
    + "const hiddenComps = new Set(box.hidden);\n"
    + "const SOCCER = {EPL:1, MLS:1};\n"
    + "const tourneyOf = () => null;\n"
    + (opts.rights ? "const resolveRights = g => box.rights(g);\nconst listingDay = ms => new Date(ms).toISOString().slice(0,10);\n" : "");
  const names = opts.rights ? SELECTION
    : ["SRC", "CHECKED", "RIGHTS", "ZONE_IANA", "_zoneFmt", "zoneParts", "listingDay", "resolveRights", ...SELECTION];
  return loadFromPage(names, pre);
}

const club = (id, city, name) => ({ id, city, name, abbr: id.slice(0, 3).toUpperCase(), home: "NHL" });
const VAN = club("van-nhl", "Vancouver", "Canucks");
const TOR = club("tor-nhl", "Toronto", "Maple Leafs");
const EDM = club("edm", "Edmonton", "Oilers");
const CGY = club("cgy", "Calgary", "Flames");
let eid = 400000;
const game = (home, away, start, extra = {}) => ({
  eid: String(++eid), comp: "NHL", home, away, start, stage: "",
  localDow: new Date(start).getUTCDay(), slotHour: new Date(start).getUTCHours(),
  result: { status: "scheduled", label: "", score: null }, ...extra });
const CONFIRMED = () => ({ carriers: [{ name: "Sportsnet", kind: "tv" }], confidence: "confirmed" });

/* --- which games --- */

test("a followed team's games in the next fourteen days are chosen, nearest first", () => {
  const later = game(VAN, EDM, NOW + 3 * DAY);
  const sooner = game(CGY, VAN, NOW + 5 * HOUR);
  const notMine = game(EDM, CGY, NOW + 6 * HOUR);
  const P = page({ games: [later, notMine, sooner], picks: ["van-nhl"], rights: CONFIRMED });
  assert.deepEqual(P.alertGames(NOW), [sooner, later]);
  const list = P.alertList(NOW);
  assert.equal(list.length, 2);
  assert.equal(list[0].at, sooner.start - 30 * MIN, "thirty minutes before the start");
  assert.equal(P.remindChoice("30").lead, 30 * MIN);
});

test("the window is fourteen days: the last moment inside it is in, the next is out", () => {
  const edge = game(VAN, EDM, NOW + 14 * DAY);
  const beyond = game(VAN, CGY, NOW + 14 * DAY + 1);
  const P = page({ games: [beyond, edge], picks: ["van-nhl"], rights: CONFIRMED });
  assert.equal(P.REMIND_WINDOW, 14 * DAY);
  assert.deepEqual(P.alertGames(NOW), [edge]);
});

test("a game that has started, finished, or is inside its last half hour gets no reminder", () => {
  const started = game(VAN, EDM, NOW - HOUR, { result: { status: "live", label: "2nd", score: [1, 0] } });
  const finished = game(VAN, CGY, NOW - 5 * HOUR, { result: { status: "final", label: "Final", score: [3, 2] } });
  const tooClose = game(VAN, TOR, NOW + 20 * MIN);
  const exactlyDue = game(VAN, TOR, NOW + 30 * MIN);
  const ok = game(VAN, TOR, NOW + 31 * MIN);
  /* A final the feed has not moved off a future slot is still a final. */
  const settledEarly = game(VAN, EDM, NOW + 2 * DAY, { result: { status: "final", label: "Final", score: [1, 0] } });
  const P = page({ games: [started, finished, tooClose, exactlyDue, ok, settledEarly], picks: ["van-nhl"], rights: CONFIRMED });
  assert.deepEqual(P.alertList(NOW).map(a => a.at), [ok.start - 30 * MIN]);
  for(const a of P.alertList(NOW)) assert.ok(a.at > NOW, "every reminder is in the future");
});

test("a hidden competition is skipped, and so is anything that is not a team's game", () => {
  const nhl = game(VAN, EDM, NOW + DAY);
  const mls = game(club("van-mls", "Vancouver", "Whitecaps"), club("tfc", "Toronto", "FC"), NOW + 2 * DAY, { comp: "MLS" });
  const rugby = game(VAN, EDM, NOW + DAY, { rugby: true });
  const tennis = game(VAN, EDM, NOW + DAY, { tennis: true });
  const stage = { comp: "UCI", home: VAN, away: null, start: NOW + DAY, event: true };
  const picks = ["van-nhl", "van-mls"];
  const all = page({ games: [nhl, mls, rugby, tennis, stage], picks, rights: CONFIRMED });
  assert.deepEqual(all.alertGames(NOW), [nhl, mls]);
  const hidden = page({ games: [nhl, mls, rugby, tennis, stage], picks, hidden: ["MLS"], rights: CONFIRMED });
  assert.deepEqual(hidden.alertGames(NOW), [nhl]);
});

test("no more than fifty are scheduled, and they are the fifty nearest", () => {
  const games = [];
  for(let i = 0; i < 70; i++) games.push(game(VAN, EDM, NOW + HOUR + i * 4 * HOUR));
  const P = page({ games: games.slice().reverse(), picks: ["van-nhl"], rights: CONFIRMED });
  assert.equal(P.REMIND_MAX, 50);
  assert.equal(P.REMIND_MAX, ALERT_MAX, "the page's cap is the bridge's");
  assert.ok(P.REMIND_MAX < 64, "under the 64 pending notifications iOS keeps");
  const list = P.alertList(NOW);
  assert.equal(list.length, 50);
  assert.deepEqual(list.map(a => a.at), games.slice(0, 50).map(g => g.start - 30 * MIN));
  assert.deepEqual(checkedAlerts(list, NOW), list, "and the bridge accepts exactly what the page builds");
});

test("nobody followed means nothing scheduled", () => {
  const P = page({ games: [game(VAN, EDM, NOW + DAY)], picks: [], rights: CONFIRMED });
  assert.deepEqual(P.alertList(NOW), []);
});

/* --- ids --- */

test("the notification id is a stable positive 31-bit integer", () => {
  const P = page({ rights: CONFIRMED });
  const again = page({ rights: CONFIRMED });
  for(const key of ["NHL:401802345", "MLS:van-mls:tfc:2026-12-01", "", "x"]){
    const id = P.alertId(key);
    assert.ok(Number.isInteger(id) && id >= 1 && id <= ALERT_ID_MAX, key + " -> " + id);
    assert.equal(id, again.alertId(key), "the same in a fresh page");
  }
  /* Pinned: a change to the hash would orphan nothing (every pass
     replaces the whole list) but it should not happen by accident. */
  assert.equal(P.alertId("NHL:401802345"), 1793944612);
  assert.notEqual(P.alertId("NHL:401802345"), P.alertId("NHL:401802346"));
});

test("the id follows the event, not the row and not the kickoff time", () => {
  const P = page({ rights: CONFIRMED });
  const g = game(VAN, EDM, NOW + DAY);
  const moved = { ...g, start: g.start + 2 * HOUR, id: "NHL-99-van-nhl-edm" };
  assert.equal(P.alertId(P.alertKey(g)), P.alertId(P.alertKey(moved)), "a moved kickoff keeps its id");
  assert.doesNotMatch(/function alertKey\(g\)\{[\s\S]*?\n\}/.exec(PAGE)[0].replace(/\/\*[\s\S]*?\*\//g, ""), /g\.id\b/,
    "the row id is numbered in load order and is never the key");
  /* Without an event id the pairing and its listing date stand in. */
  const bare = { ...g, eid: null };
  assert.equal(P.alertKey(bare), "NHL:van-nhl:edm:" + new Date(g.start).toISOString().slice(0, 10));
  assert.notEqual(P.alertKey(bare), P.alertKey({ ...bare, home: EDM, away: VAN }));
});

test("two games that hash to one id cost the later one its reminder, never the bridge its list", () => {
  const a = game(VAN, EDM, NOW + DAY), b = game(VAN, CGY, NOW + 2 * DAY, { eid: a.eid });
  const P = page({ games: [b, a], picks: ["van-nhl"], rights: CONFIRMED });
  const list = P.alertList(NOW);
  assert.equal(list.length, 1);
  assert.equal(list[0].at, a.start - 30 * MIN);
  assert.doesNotThrow(() => checkedAlerts(list, NOW));
});

/* --- text --- */

test("the title is the visitors at the hosts, by full name", () => {
  const P = page({ rights: CONFIRMED });
  assert.equal(P.alertText(game(TOR, VAN, NOW + DAY)).title, "Vancouver Canucks at Toronto Maple Leafs");
});

test("the carrier wording follows the rights table's confidence", () => {
  const g = game(TOR, VAN, NOW + DAY);
  const body = rights => page({ rights: () => rights }).alertText(g).body;
  assert.equal(body({ carriers: [{ name: "TSN", kind: "tv" }, { name: "Sportsnet", kind: "tv" }], confidence: "confirmed" }),
    "Starts in 30 min · on TSN, Sportsnet");
  assert.equal(body({ carriers: [{ name: "TSN", kind: "tv" }], confidence: "expected" }),
    "Starts in 30 min · expected on TSN");
  assert.equal(body({ carriers: [], confidence: "unknown" }),
    "Starts in 30 min · carrier not confirmed");
  /* A carrier that states its own confidence outranks its rule's. */
  assert.equal(body({ carriers: [{ name: "MLS Season Pass", kind: "stream", confidence: "confirmed" },
                                 { name: "TSN", kind: "tv", confidence: "expected" }], confidence: "expected" }),
    "Starts in 30 min · on MLS Season Pass · expected on TSN");
  /* Unknown stays unknown even when a row lists a name beside it, and a
     confident row with nobody on it is not a carrier either. */
  assert.equal(body({ carriers: [{ name: "TSN", kind: "tv" }], confidence: "unknown" }),
    "Starts in 30 min · carrier not confirmed");
  assert.equal(body({ carriers: [], confidence: "confirmed" }),
    "Starts in 30 min · carrier not confirmed");
});

test("the wording is built from the real rights table", () => {
  const P = page({});
  const nba = (home, away, iso) => ({ comp: "NBA", home: { id: home, name: home, full: true }, away: { id: away, name: away, full: true },
    start: Date.parse(iso), stage: "", localDow: new Date(iso).getUTCDay(), slotHour: 0,
    result: { status: "scheduled", label: "", score: null } });
  /* The same four nights tests/nba-rights.test.mjs resolves. */
  assert.equal(P.alertText(nba("tor-nba", "mem", "2026-11-22T00:30:00Z")).body,
    "Starts in 30 min · on TSN, Sportsnet");
  assert.equal(P.alertText(nba("det", "tor-nba", "2026-11-21T00:00:00Z")).body,
    "Starts in 30 min · on Prime Video");
  assert.match(P.alertText(nba("den", "no", "2026-11-15T01:00:00Z")).body,
    /^Starts in 30 min · expected on TSN, Sportsnet, Prime Video, NBA League Pass$/);
  assert.equal(P.alertText({ ...nba("a", "b", "2026-11-22T00:30:00Z"), comp: "NOPE" }).body,
    "Starts in 30 min · carrier not confirmed");
});

test("a reminder never carries a score", () => {
  /* The worst case: a game carrying a result and a series line, on a
     board whose carriers are known. Nothing of it may reach the text. */
  const g = game(TOR, VAN, NOW + DAY, {
    result: { status: "scheduled", label: "Leafs lead 3-1", score: [7, 5] },
    series: { summary: "TOR leads 3-1" }, remembered: true });
  const P = page({ games: [g], picks: ["van-nhl"], rights: CONFIRMED });
  const [a] = P.alertList(NOW);
  assert.deepEqual(Object.keys(a).sort(), ["at", "body", "id", "title"]);
  assert.equal(a.title, "Vancouver Canucks at Toronto Maple Leafs");
  assert.equal(a.body, "Starts in 30 min · on Sportsnet");
  assert.doesNotMatch(a.title + a.body, /[0-9]+\s*[-–]\s*[0-9]+|lead|7|5/);
  /* And structurally: the functions that write the text never read one. */
  const text = /function alertCarriers\(g\)\{[\s\S]*?\n\}/.exec(PAGE)[0] + /function alertText\(g, choice\)\{[\s\S]*?\n\}/.exec(PAGE)[0];
  assert.doesNotMatch(text.replace(/\/\*[\s\S]*?\*\//g, ""), /result|score|series|label/);
});

test("long names are clipped to the cap rather than refused", () => {
  const long = club("long", "", "A".repeat(200));
  long.full = true;
  const P = page({ games: [game(long, VAN, NOW + DAY)], picks: ["van-nhl"], rights: CONFIRMED });
  const [a] = P.alertList(NOW);
  assert.equal(P.REMIND_TITLE_MAX, ALERT_TITLE_MAX);
  assert.equal(P.REMIND_BODY_MAX, ALERT_BODY_MAX);
  assert.equal(a.title.length, 120);
  assert.match(a.title, /…$/);
  assert.deepEqual(checkedAlerts([a], NOW), [a], "already within what the bridge allows");
});

/* --- bridge validation --- */

const good = (over = {}) => ({ id: 12345, at: NOW + HOUR, title: "Vancouver Canucks at Toronto Maple Leafs",
  body: "Starts in 30 min · on Sportsnet", ...over });

test("the bridge passes a good list through as a clean copy", () => {
  const out = checkedAlerts([good({ extra: "dropped", sound: "x.wav" })], NOW);
  assert.deepEqual(out, [good()]);
  assert.deepEqual(checkedAlerts([], NOW), [], "an empty list is how everything is cancelled");
});

test("the bridge refuses ids that are not positive 31-bit integers", () => {
  for(const id of [0, -1, 1.5, "7", null, undefined, NaN, Infinity, 2 ** 31, 2 ** 53])
    assert.throws(() => checkedAlerts([good({ id })], NOW), /id/, String(id));
  assert.doesNotThrow(() => checkedAlerts([good({ id: 1 }), good({ id: ALERT_ID_MAX })], NOW));
  assert.throws(() => checkedAlerts([good(), good()], NOW), /repeated/);
});

test("the bridge refuses a time that is not in the future", () => {
  for(const at of [NOW, NOW - 1, 0, "2026-12-01T00:00:00Z", new Date(NOW + HOUR), NaN, Infinity, null])
    assert.throws(() => checkedAlerts([good({ at })], NOW), /future/, String(at));
  assert.doesNotThrow(() => checkedAlerts([good({ at: NOW + 1 })], NOW));
});

test("the bridge caps a title at 120 characters and a body at 240, and refuses what is not text", () => {
  const [a] = checkedAlerts([good({ title: "T".repeat(500), body: "  spaced \n out  " + "b".repeat(500) })], NOW);
  assert.equal(a.title.length, ALERT_TITLE_MAX);
  assert.equal(a.body.length, ALERT_BODY_MAX);
  assert.equal(ALERT_TITLE_MAX, 120);
  assert.equal(ALERT_BODY_MAX, 240);
  assert.match(a.body, /^spaced out b/);
  assert.equal(clipAlertText("x".repeat(120)), "x".repeat(120), "exactly at the cap is left alone");
  for(const bad of [{ title: 5 }, { body: null }, { title: ["a"] }, { body: undefined }, { title: "   " }, { title: "" }])
    assert.throws(() => checkedAlerts([good(bad)], NOW), /text|title/, JSON.stringify(bad));
});

test("the bridge refuses more than fifty, and anything that is not a list of objects", () => {
  const many = n => Array.from({ length: n }, (_, i) => good({ id: i + 1 }));
  assert.equal(checkedAlerts(many(50), NOW).length, 50);
  assert.throws(() => checkedAlerts(many(51), NOW), /Too many/);
  for(const bad of [null, undefined, "list", { length: 1 }, [null], ["x"], [7]])
    assert.throws(() => checkedAlerts(bad, NOW), Error, JSON.stringify(bad));
});

test("replace checks the list before it cancels anything, then cancels all pending, then schedules", () => {
  const replace = /function replaceAlerts\(list\) \{[\s\S]*?\n\}/.exec(BRIDGE)[0];
  const check = replace.indexOf("checkedAlerts(list, Date.now())");
  const cancel = replace.indexOf("cancelPendingAlerts()");
  const schedule = replace.indexOf("LocalNotifications.schedule(");
  assert.ok(check > 0 && check < cancel && cancel < schedule, "check, cancel, schedule — in that order");
  const pending = /async function cancelPendingAlerts\(\) \{[\s\S]*?\n\}/.exec(BRIDGE)[0];
  assert.match(pending, /LocalNotifications\.getPending\(\)/, "every pending alert, not a remembered list of ids");
  assert.match(pending, /LocalNotifications\.cancel\(/);
  assert.match(/function clearAlerts\(\) \{[\s\S]*?\n\}/.exec(BRIDGE)[0], /cancelPendingAlerts\(\)/);
  assert.match(BRIDGE, /alerts: Object\.freeze\(\{\s*status: alertStatus,\s*request: requestAlerts,\s*replace: replaceAlerts,\s*clear: clearAlerts\s*\}\)/);
});

test("permission is only ever asked for by request(), and nothing asks at launch", () => {
  assert.equal(BRIDGE.match(/requestPermissions\(/g).length, 1);
  assert.match(/async function requestAlerts\(\) \{[\s\S]*?\n\}/.exec(BRIDGE)[0], /requestPermissions\(\)/);
  assert.match(/async function alertStatus\(\) \{[\s\S]*?\n\}/.exec(BRIDGE)[0], /checkPermissions\(\)/);
  /* On the page, request() is reached from the switch and nowhere else. */
  assert.equal(PAGE.match(/\.request\(\)/g).length, 1);
  assert.match(/function setRemind\(on\)\{[\s\S]*?\n\}/.exec(PAGE)[0], /api\.request\(\)/);
  assert.doesNotMatch(/function syncAlerts\(force\)\{[\s\S]*?\n\}/.exec(PAGE)[0], /request\(/);
});

/* --- the switch, and keeping the phone in step --- */

/* The page's own syncAlerts and setRemind, against a stand-in for the
   bridge that records what it was asked to do. */
function live(opts = {}){
  const calls = [];
  const api = {
    permission: opts.permission || "prompt",
    answer: opts.answer || "granted",
    status: async () => { calls.push("status"); return api.permission; },
    request: async () => { calls.push("request"); api.permission = api.answer; return api.permission; },
    replace: async list => { calls.push(["replace", checkedAlerts(list, Date.now())]); return { scheduled: list.length }; },
    clear: async () => { calls.push("clear"); return { cancelled: 0 }; }
  };
  const box = { games: opts.games || [], picks: ["van-nhl"], hidden: [], rights: CONFIRMED, api, stored: {}, on: !!opts.on, native: opts.native !== false };
  globalThis.__gdnAlertBox = box;
  const pre = "const box = globalThis.__gdnAlertBox;\n"
    + "const DAY = 86400000;\n"
    + "const GAMES = box.games;\n"
    + "const selected = new Set(box.picks);\n"
    + "const hiddenComps = new Set(box.hidden);\n"
    + "const SOCCER = {};\n"
    + "const resolveRights = g => box.rights(g);\n"
    + "const listingDay = ms => new Date(ms).toISOString().slice(0,10);\n"
    + "const window = {GDNNative: {isNative: box.native, alerts: box.api}};\n"
    + "const LS = {get:(k,d)=>d, set:(k,v)=>{ box.stored[k] = v; }};\n"
    + "const renderRemind = () => { box.drawn = {on: remindOn, blocked: remindBlocked}; };\n"
    + "const console = {warn(){}};\n"
    + "let remindOn = box.on, remindBlocked = false, remindSynced = null, remindReady = true;\n"
    + "let remindWhen = " + JSON.stringify(opts.when || "30") + ";\n"
    + "let remindWork = Promise.resolve();\n"
    + "box.hide = id => { hiddenComps.add(id); };\n";
  const P = loadFromPage(["REMIND_KEY", "REMIND_WHEN_KEY", ...SELECTION, "remindApi", "remindQueue", "syncAlerts",
    "setRemind", "setRemindWhen"], pre);
  return { P, api, calls, box, replaced: () => calls.filter(c => Array.isArray(c)).map(c => c[1]) };
}
const soon = () => game(VAN, EDM, Date.now() + DAY);

test("turning it on asks for permission, then schedules; the setting is remembered", async () => {
  const t = live({ games: [soon()] });
  assert.equal(await t.P.setRemind(true), true);
  assert.deepEqual(t.calls.slice(0, 2), ["status", "request"]);
  assert.equal(t.replaced().length, 1);
  assert.equal(t.replaced()[0].length, 1);
  assert.equal(t.box.stored["gdn.remind"], true);
  assert.deepEqual(t.box.drawn, { on: true, blocked: false });
});

test("permission already granted is not asked for again", async () => {
  const t = live({ games: [soon()], permission: "granted" });
  await t.P.setRemind(true);
  assert.ok(!t.calls.includes("request"));
  assert.equal(t.replaced().length, 1);
});

test("refused permission leaves the setting off, schedules nothing, and says where to fix it", async () => {
  for(const t of [live({ games: [soon()], answer: "denied" }), live({ games: [soon()], permission: "denied" })]){
    assert.equal(await t.P.setRemind(true), false);
    assert.equal(t.replaced().length, 0);
    assert.equal(t.box.stored["gdn.remind"], false);
    assert.deepEqual(t.box.drawn, { on: false, blocked: true });
  }
  const draw = /function renderRemind\(\)\{[\s\S]*?\n\}/.exec(PAGE)[0];
  assert.match(draw, /Notifications are off for Game Day North in iOS Settings\./);
});

test("turning it off cancels everything and asks iOS nothing", async () => {
  const t = live({ games: [soon()], permission: "granted", on: true });
  await t.P.setRemind(false);
  assert.deepEqual(t.calls, ["clear"]);
  assert.equal(t.box.stored["gdn.remind"], false);
  await t.P.syncAlerts();
  assert.deepEqual(t.calls, ["clear"], "and nothing is scheduled afterwards");
});

test("a schedule load or a return to the app replaces the list every time", async () => {
  const t = live({ games: [soon()], permission: "granted", on: true });
  assert.equal(await t.P.syncAlerts(true), true);
  assert.equal(await t.P.syncAlerts(true), true);
  assert.equal(t.replaced().length, 2, "replaced again, changed or not");
  assert.deepEqual(t.replaced()[0], t.replaced()[1]);
});

test("saving a choice replaces the list only when it has changed", async () => {
  const t = live({ games: [soon()], permission: "granted", on: true });
  assert.equal(await t.P.syncAlerts(), true);
  assert.equal(await t.P.syncAlerts(), false);
  assert.equal(t.replaced().length, 1, "an unchanged board costs no second replace");
  t.box.games.push(game(VAN, CGY, Date.now() + 2 * DAY));
  assert.equal(await t.P.syncAlerts(), true);
  assert.equal(t.replaced()[1].length, 2, "a new fixture is picked up");
  t.box.games[0].start += 3 * HOUR;
  await t.P.syncAlerts();
  assert.equal(t.replaced().length, 3, "and so is a moved kickoff");
  assert.equal(t.replaced()[2][0].id, t.replaced()[1][0].id, "under the same id");
  t.box.hide("NHL");
  await t.P.syncAlerts();
  assert.deepEqual(t.replaced()[3], [], "hiding the competition empties the list, which cancels them all");
});

test("off, or outside the app, a sync touches nothing", async () => {
  const off = live({ games: [soon()], permission: "granted", on: false });
  await off.P.syncAlerts();
  assert.deepEqual(off.calls, []);
  const web = live({ games: [soon()], permission: "granted", on: true, native: false });
  assert.equal(web.P.remindApi(), null);
  await web.P.syncAlerts();
  await web.P.setRemind(true);
  assert.deepEqual(web.calls, []);
});

test("permission taken away in Settings stops scheduling and is noticed on return", async () => {
  const t = live({ games: [soon()], permission: "granted", on: true });
  await t.P.syncAlerts();
  t.api.permission = "denied";
  await t.P.syncAlerts();
  assert.deepEqual(t.box.drawn, undefined, "an unchanged list is not worth a permission check on every save");
  await t.P.syncAlerts(true);
  assert.deepEqual(t.box.drawn, { on: true, blocked: true });
  assert.equal(t.replaced().length, 1);
  t.api.permission = "granted";
  await t.P.syncAlerts(true);
  assert.deepEqual(t.box.drawn, { on: true, blocked: false });
});

/* --- where it is wired in --- */

test("the setting is off by default, hidden outside the app, and kept out of the share link", () => {
  assert.match(PAGE, /let remindOn = LS\.get\(REMIND_KEY, false\) === true;/);
  assert.match(PAGE, /<div class="remind" id="remindRow" hidden>/);
  assert.match(PAGE, /Remind me about my teams&rsquo; games/);
  const draw = /function renderRemind\(\)\{[\s\S]*?\n\}/.exec(PAGE)[0];
  assert.match(draw, /if\(!remindApi\(\)\)\{ row\.setAttribute\("hidden", ""\); return; \}/);
  assert.match(/function remindApi\(\)\{[\s\S]*?\n\}/.exec(PAGE)[0], /n\.isNative && n\.alerts/);
  assert.doesNotMatch(/function shareLink\(\)\{[\s\S]*?\n\}/.exec(PAGE)[0], /remind/i);
});

test("the list is re-run after a schedule load, on return to the app, and when a choice is saved", () => {
  const refresh = /async function runRefresh\(scope\)\{[\s\S]*?\n\}/.exec(PAGE)[0];
  assert.match(refresh, /if\(held > 0 && !scoresOnly\)\{[\s\S]*?remindReady = true; syncAlerts\(true\);/);
  assert.match(PAGE, /document\.addEventListener\("visibilitychange", \(\)=>\{[\s\S]*?if\(document\.hidden\) return;[\s\S]*?syncAlerts\(true\);/);
  assert.match(/function persist\(\)\{[\s\S]*?\n\}/.exec(PAGE)[0], /syncAlerts\(\)/);
  /* Nothing is replaced before a schedule has loaded in this launch. */
  assert.match(PAGE, /let remindReady = false;/);
  assert.match(/function syncAlerts\(force\)\{[\s\S]*?\n\}/.exec(PAGE)[0], /if\(!api \|\| !remindOn \|\| !remindReady\) return/);
});

test("the privacy policy lists the alert setting among what stays on the device", () => {
  const onDevice = /<h2>What stays on your device<\/h2>[\s\S]*?<\/ul>/.exec(PRIVACY)[0];
  assert.match(onDevice, /your alert setting/);
  assert.match(PRIVACY, /collects no personal data/);
});

/* --- when: the timing choice --- */

test("each lead time schedules that long before the game and says so", () => {
  const g = game(VAN, EDM, NOW + DAY);
  for(const [when, lead, phrase] of [["180", 3 * HOUR, "3 hours"], ["120", 2 * HOUR, "2 hours"],
                                     ["60", HOUR, "1 hour"], ["30", 30 * MIN, "30 min"]]){
    const P = page({ games: [g], picks: ["van-nhl"], rights: CONFIRMED, when });
    const [a] = P.alertList(NOW);
    assert.equal(a.at, g.start - lead, when);
    assert.equal(a.body, "Starts in " + phrase + " · on Sportsnet", when);
  }
});

test("a game too close for the chosen lead gets no reminder, though it would at a shorter one", () => {
  const g = game(VAN, EDM, NOW + 90 * MIN);
  assert.deepEqual(page({ games: [g], picks: ["van-nhl"], rights: CONFIRMED, when: "120" }).alertList(NOW), []);
  assert.equal(page({ games: [g], picks: ["van-nhl"], rights: CONFIRMED, when: "60" }).alertList(NOW).length, 1);
});

test("one hour is the default, and a choice the page no longer offers falls back to it", () => {
  const P = page({ rights: CONFIRMED });
  assert.equal(P.REMIND_DEFAULT, "60");
  assert.equal(P.remindChoice("60").label, "1 hour before");
  assert.equal(P.remindChoice("45").id, "60");
  assert.equal(P.remindChoice(undefined).id, "60");
  assert.deepEqual(P.REMIND_CHOICES.map(c => c.id), ["morning", "180", "120", "60", "30"], "morning first, then nearer");
  assert.match(PAGE, /let remindWhen = remindChoice\(LS\.get\(REMIND_WHEN_KEY, REMIND_DEFAULT\)\)\.id;/);
});

/* The morning cases are built on the local clock of whatever machine runs
   them, as the phone's own clock decides 8 a.m. */
const local = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const EVE = local(2026, 12, 4, 20);        // Fri 4 Dec, 8 p.m.

test("the morning of: one 8 a.m. summary per day a followed team plays, listing that day's games", () => {
  const noon = game(VAN, EDM, local(2026, 12, 5, 12));
  const evening = game(TOR, VAN, local(2026, 12, 5, 19, 30));
  const overnight = game(VAN, CGY, local(2026, 12, 6, 4, 30));   // before 8 a.m.: the previous morning's
  const later = game(EDM, VAN, local(2026, 12, 7, 13));
  const P = page({ games: [later, overnight, evening, noon], picks: ["van-nhl"], rights: CONFIRMED, when: "morning" });
  const list = P.alertList(EVE);
  assert.deepEqual(list.map(a => a.at), [local(2026, 12, 5, 8), local(2026, 12, 7, 8)], "Saturday and Monday; nothing on Sunday");
  const [sat, mon] = list;
  assert.equal(sat.title, "Game day · 3 games");
  assert.equal(sat.body, P.fmtTime(noon.start) + " Oilers at Canucks, on Sportsnet; "
    + P.fmtTime(evening.start) + " Canucks at Maple Leafs, on Sportsnet; "
    + "Tomorrow " + P.fmtTime(overnight.start) + " Flames at Canucks, on Sportsnet");
  assert.equal(mon.title, "Game day");
  assert.notEqual(sat.id, mon.id);
  assert.deepEqual(checkedAlerts(list, EVE), list, "the bridge accepts the summaries as built");
});

test("a morning already past is skipped, and the next one still goes", () => {
  const today = game(VAN, EDM, local(2026, 12, 5, 19));
  const tomorrow = game(VAN, CGY, local(2026, 12, 6, 19));
  const P = page({ games: [today, tomorrow], picks: ["van-nhl"], rights: CONFIRMED, when: "morning" });
  assert.deepEqual(P.alertList(local(2026, 12, 5, 9)).map(a => a.at), [local(2026, 12, 6, 8)]);
});

test("a busy day fills the summary to its cap and counts the rest", () => {
  const games = [];
  for(let i = 0; i < 12; i++) games.push(game(VAN, EDM, local(2026, 12, 5, 9 + i), { eid: "busy" + i }));
  const P = page({ games, picks: ["van-nhl"], rights: CONFIRMED, when: "morning" });
  const [a] = P.alertList(EVE);
  assert.ok(a.body.length <= ALERT_BODY_MAX, a.body.length + " characters");
  assert.match(a.body, /; and \d+ more$/);
  assert.equal(a.title, "Game day · 12 games");
});

test("a summary carries no score either", () => {
  const g = game(TOR, VAN, local(2026, 12, 5, 19), {
    result: { status: "scheduled", label: "Leafs lead 3-1", score: [7, 5] }, series: { summary: "TOR leads 3-1" } });
  const [a] = page({ games: [g], picks: ["van-nhl"], rights: CONFIRMED, when: "morning" }).alertList(EVE);
  assert.doesNotMatch(a.title + a.body, /lead|3-1|\b7\b|\b5\b(?!:)/);
  const text = /function morningAlerts\(now\)\{[\s\S]*?\n\}/.exec(PAGE)[0];
  assert.doesNotMatch(text.replace(/\/\*[\s\S]*?\*\//g, ""), /result|score|series|label/);
});

test("changing the time replaces what is pending with the new timing, and is remembered", async () => {
  const g = game(VAN, EDM, Date.now() + 2 * DAY);
  const t = live({ games: [g], permission: "granted", on: true });
  await t.P.syncAlerts(true);
  assert.equal(t.replaced()[0][0].at, g.start - 30 * MIN);
  await t.P.setRemindWhen("180");
  assert.equal(t.box.stored["gdn.remind.when"], "180");
  assert.equal(t.replaced()[1][0].at, g.start - 3 * HOUR);
  await t.P.setRemindWhen("morning");
  assert.equal(t.replaced()[2][0].body.includes("Oilers at Canucks"), true, "the summary replaces the per-game reminder");
  await t.P.setRemindWhen("bogus");
  assert.equal(t.box.stored["gdn.remind.when"], "60", "an unknown value is stored as the default");
});

test("with reminders off, a new time is kept and nothing is scheduled", async () => {
  const t = live({ games: [soon()], permission: "granted", on: false });
  await t.P.setRemindWhen("120");
  assert.equal(t.box.stored["gdn.remind.when"], "120");
  assert.deepEqual(t.calls, []);
});

test("the choice is in the My teams row, shown only while reminders are on", () => {
  assert.match(PAGE, /<label class="remind-when" id="remindWhenRow" hidden>[\s\S]*?<select id="remindWhen" aria-label="When to remind me"><\/select>/);
  const draw = /function renderRemind\(\)\{[\s\S]*?\n\}/.exec(PAGE)[0];
  assert.match(draw, /REMIND_CHOICES\.map\(/);
  assert.match(draw, /if\(remindOn\) whenRow\.removeAttribute\("hidden"\); else whenRow\.setAttribute\("hidden", ""\);/);
  assert.match(PAGE, /getElementById\("remindWhen"\)\.addEventListener\("change",e=>\{ setRemindWhen\(e\.target\.value\); \}\);/);
  assert.doesNotMatch(/function shareLink\(\)\{[\s\S]*?\n\}/.exec(PAGE)[0], /remindWhen/, "a setting of this phone, not of a board");
});
