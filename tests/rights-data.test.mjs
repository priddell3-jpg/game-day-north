import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { loadFromPage } from "./helpers/page.mjs";

/* The rights table lives in data/rights.json. The build inlines it into
   the page, and data.json carries it too, so a fix reaches installed apps
   without a new build. These tests hold the three things that makes
   possible: the file is valid, every build carries it, and the page
   adopts a downloaded copy safely. */

const require_ = createRequire(import.meta.url);
const { readRights, rightsProblems, rightsRevised, stripComments, CONDITIONS } = require_("../scripts/lib/rights.cjs");
const RAW = readFileSync(new URL("../data/rights.json", import.meta.url), "utf8");
const DOC = readRights();
const read = rel => readFileSync(new URL(rel, import.meta.url), "utf8");

const NAMES = ["RIGHTS_BUNDLED", "compileRights", "RIGHTS_STATE", "SERVICES", "CARRIER_SERVICE", "SRC", "RIGHTS",
  "CHECKED", "adoptRights", "ZONE_IANA", "_zoneFmt", "zoneParts", "listingDay", "resolveRights"];
const fresh = () => loadFromPage(NAMES, "const tourneyOf = () => null;");

const team = id => ({ id, name: id, abbr: id.slice(0, 3).toUpperCase() });
const game = (comp, home, away, startIso, extra = {}) => ({
  comp, home: team(home), away: team(away), start: Date.parse(startIso), stage: "",
  localDow: new Date(startIso).getUTCDay(), slotHour: 15, ...extra });
const names = r => r.carriers.map(c => c.name);
const copy = () => JSON.parse(JSON.stringify(DOC));

test("data/rights.json passes the strict check that guards publishing", () => {
  assert.deepEqual(rightsProblems(DOC), []);
  assert.equal(DOC.schema, 1);
  assert.match(DOC.checked, /^\d{4}-\d{2}-\d{2}$/);
});

test("every rule cites a source the file holds, and every condition is one the page knows", () => {
  for(const r of DOC.rules){
    assert.ok(DOC.sources[r.src], r.comp + ": " + r.src);
    for(const k of Object.keys(r.if || {})) assert.ok(CONDITIONS.includes(k), r.comp + ": " + k);
  }
});

test("the page compiles the bundled copy into one rule per row of the file", () => {
  const page = fresh();
  assert.equal(page.RIGHTS.length, DOC.rules.length);
  assert.equal(page.RIGHTS_STATE.source, "bundled");
  assert.equal(page.CHECKED, DOC.checked);
  assert.equal(page.RIGHTS_STATE.revised, rightsRevised(DOC));
  /* A rule's src is the very object in SRC, as it was when the table was
     JavaScript; code that compares sources by identity keeps working. */
  for(const r of page.RIGHTS) assert.ok(Object.values(page.SRC).includes(r.src), r.note);
});

test("comments never ship: the build strips every \"//\" key", () => {
  assert.ok(RAW.includes('"//"'), "the file is commented for whoever edits it");
  const stripped = JSON.stringify(stripComments(JSON.parse(RAW)));
  assert.ok(!stripped.includes('"//"'));
  assert.deepEqual(stripComments({ "//": "x", a: [{ "//": ["note"] }, { b: 1, "//": "y" }] }), { a: [{ b: 1 }] });
});

test("the built page carries the rights inline, with no way for a note to close the script", () => {
  execFileSync(process.execPath, ["build.js"], { cwd: new URL("..", import.meta.url), stdio: "pipe" });
  const html = read("../index.html");
  assert.ok(!html.includes("/*__RIGHTS__*/"), "the placeholder was replaced");
  const at = html.indexOf("const RIGHTS_BUNDLED = ");
  assert.ok(at > 0);
  const literal = html.slice(at, html.indexOf(";\n", at));
  assert.ok(literal.includes('"schema":1'));
  assert.ok(!literal.includes("<"), "every < inside the inlined rights is escaped");
  assert.ok(!literal.includes('"//"'));
});

test("a document this build cannot trust is refused whole", () => {
  const page = fresh();
  const bad = [
    null, [], "rights",
    Object.assign(copy(), { schema: 2 }),
    (() => { const d = copy(); delete d.sources.none; return d; })(),
    (() => { const d = copy(); d.rules[0].carriers = [{ name: "TSN", kind: "radio" }]; return d; })(),
    (() => { const d = copy(); d.rules[0].src = "nowhere"; return d; })(),
    (() => { const d = copy(); d.sources.fubo.url = "http://insecure.example"; return d; })(),
    Object.assign(copy(), { rules: [] })
  ];
  for(const d of bad) assert.equal(page.compileRights(d), null, JSON.stringify(d && d.schema));
});

test("a rule with a condition this build does not know is skipped, never half-applied", () => {
  const page = fresh();
  const d = copy();
  const epl = d.rules.findIndex(r => r.comp === "EPL");
  d.rules.splice(epl, 0, { comp: "EPL", if: { teams: ["liv"], weather: "rain" },
    carriers: [{ name: "Sportsnet", kind: "tv" }], confidence: "confirmed", note: "from a newer schema", src: "none" });
  const compiled = page.compileRights(d);
  assert.ok(compiled, "the rest of the document is still usable");
  const rule = compiled.rules.find(r => r.note === "from a newer schema");
  assert.equal(rule.when(), false);
  assert.ok(page.adoptRights(d));
  const r = page.resolveRights(game("EPL", "liv", "ars", "2026-12-05T15:00:00Z"));
  assert.deepEqual(names(r), ["Fubo Canada"], "the game falls through to the next rule");
});

test("a downloaded copy replaces the bundled one in place, sources and services included", () => {
  const page = fresh();
  const tables = { SERVICES: page.SERVICES, SRC: page.SRC, RIGHTS: page.RIGHTS };
  const d = copy();
  d.sources.paramount = { label: "Paramount+ release", url: "https://example.com/paramount" };
  d.services.paramount = { label: "Paramount+", kind: "stream" };
  d.carrierService["Paramount+"] = "paramount";
  const ucl = d.rules.find(r => r.comp === "UCL");
  Object.assign(ucl, { carriers: [{ name: "Paramount+", kind: "stream" }], src: "paramount", checked: "2027-07-01" });
  assert.equal(page.adoptRights(d), true);
  assert.equal(page.RIGHTS_STATE.source, "feed");
  assert.equal(page.SERVICES, tables.SERVICES, "the same object, refilled");
  assert.equal(page.RIGHTS, tables.RIGHTS);
  assert.equal(page.CARRIER_SERVICE["Paramount+"], "paramount");
  const r = page.resolveRights(game("UCL", "liv", "rma", "2027-09-15T19:00:00Z"));
  assert.deepEqual(names(r), ["Paramount+"]);
  assert.equal(r.src, page.SRC.paramount);
  assert.equal(r.checked, "2027-07-01");
  assert.equal(page.adoptRights(d), false, "the same document again changes nothing");
});

test("an older downloaded copy never replaces a newer bundled one", () => {
  const page = fresh();
  const d = copy();
  /* Every per-row date back before the bundled table's newest. */
  d.rules.forEach(r => { delete r.checked; });
  d.rules.find(r => r.comp === "EPL").carriers = [{ name: "Sportsnet", kind: "tv" }];
  assert.ok(rightsRevised(d) < page.RIGHTS_STATE.revised);
  assert.equal(page.adoptRights(d), false);
  assert.deepEqual(names(page.resolveRights(game("EPL", "liv", "ars", "2026-12-05T15:00:00Z"))), ["Fubo Canada"]);
});

test("a file with no rights, or rights this build cannot read, leaves the table alone", () => {
  const page = fresh();
  const before = JSON.stringify(page.RIGHTS.map(r => r.note));
  assert.equal(page.adoptRights(undefined), false);
  assert.equal(page.adoptRights(null), false);
  const warn = console.warn; console.warn = () => {};
  try{ assert.equal(page.adoptRights({ schema: 1 }), false); }finally{ console.warn = warn; }
  assert.equal(JSON.stringify(page.RIGHTS.map(r => r.note)), before);
  assert.equal(page.RIGHTS_STATE.source, "bundled");
});

test("the strict check names the mistakes an edit is likely to make", () => {
  const d = copy();
  const efl = d.rules.findIndex(r => r.comp === "EFL");
  d.rules.splice(efl + 1, 0, { comp: "EFL", if: { teams: ["liv"] }, carriers: [], confidence: "unknown", note: "x", src: "none" });
  d.rules.push({ comp: "NHL", if: { dow: [7] }, carriers: [{ name: "TSN", kind: "tv" }], confidence: "sure", note: "x", src: "gone", checked: "2026-13-01" });
  d.carrierService.Nowhere = "missing";
  const problems = rightsProblems(d).join("\n");
  assert.match(problems, /EFL\) comes after an unconditional EFL rule/);
  assert.match(problems, /dow is not a list of 0-6/);
  assert.match(problems, /confidence "sure"/);
  assert.match(problems, /unknown source "gone"/);
  assert.match(problems, /checked is not a YYYY-MM-DD date/);
  assert.match(problems, /Nowhere maps to unknown service "missing"/);
});

test("data.json carries the rights, and a rights-only edit is written and published at once", () => {
  const job = read("../scripts/fetch-data.mjs");
  assert.match(job, /rights: rightsOut/);
  assert.match(job, /rightsSame/);
  assert.match(job, /rightsOut = \(previous && previous\.rights\) \|\| null/, "a bad edit carries the last good copy");
  const workflow = read("../.github/workflows/refresh-data.yml");
  assert.match(workflow, /- "data\/rights\.json"/);
});

test("the page adopts the rights from every schedule it loads", () => {
  const page = read("../src/page.html");
  const load = /async function loadStatic\(\)\{[\s\S]*?\n\}/.exec(page)[0];
  assert.match(load, /adoptRights\(r\.rights\)/);
});
