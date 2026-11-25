/* The Canadian rights document, data/rights.json, as the build and the
 * data job read it.
 *
 * The rights used to live in src/page.html as JavaScript. That put them
 * inside the iOS binary, so every rights fix waited for an App Store
 * review. They are data now: build.js inlines this file into the page
 * (the copy every build ships with), and scripts/fetch-data.mjs copies it
 * into data.json, which installed apps download. The page prefers the
 * downloaded copy and falls back to its own.
 *
 * Two checks guard that path. This one is strict and runs where a mistake
 * can still be fixed: in the tests and in the data job, which refuses to
 * publish a document that fails it. The page has a second, defensive
 * check of its own (compileRights), because an installed app must cope
 * with whatever a server hands it.
 *
 * CommonJS for the same reason as inline.cjs: build.js is CommonJS, the
 * data job and the tests are ES modules, and all three need it.
 */
const fs = require("fs");
const path = require("path");

const RIGHTS_FILE = path.join(__dirname, "..", "..", "data", "rights.json");
const SCHEMA = 1;
const KINDS = ["tv", "stream"];
const CONFIDENCE = ["confirmed", "expected", "unknown"];
const CARRIER_CONFIDENCE = ["confirmed", "expected"];
/* The conditions a rule's `if` may hold. The page knows exactly these;
   it skips a rule carrying any other, so an older app never matches more
   games than the rule meant. */
const CONDITIONS = ["teams", "day", "dow", "hourFrom", "stage", "tournamentIs", "tournamentHas", "major"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/* "//" keys are comments for whoever edits the file. They never ship:
   a comment-only entry in an array is dropped, and a "//" key anywhere
   else is removed. */
function stripComments(value){
  if(Array.isArray(value)){
    return value
      .filter(v => !(v && typeof v === "object" && !Array.isArray(v)
        && Object.keys(v).length > 0 && Object.keys(v).every(k => k === "//")))
      .map(stripComments);
  }
  if(value && typeof value === "object"){
    const out = {};
    for(const [k, v] of Object.entries(value)) if(k !== "//") out[k] = stripComments(v);
    return out;
  }
  return value;
}

function readRights(file = RIGHTS_FILE){
  return stripComments(JSON.parse(fs.readFileSync(file, "utf8")));
}

const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
const isStrList = v => Array.isArray(v) && v.length > 0 && v.every(s => typeof s === "string" && s.length > 0);
const validDate = s => typeof s === "string" && DATE.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"))
  && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

/** Every problem with a (comment-stripped) rights document, as sentences.
    An empty list means it is safe to publish. */
function rightsProblems(doc){
  const out = [];
  if(!isObj(doc)) return ["the document is not an object"];
  if(doc.schema !== SCHEMA) out.push("schema is " + JSON.stringify(doc.schema) + ", expected " + SCHEMA);
  if(!validDate(doc.checked)) out.push("top-level checked is not a YYYY-MM-DD date");

  const services = isObj(doc.services) ? doc.services : (out.push("services is not an object"), {});
  for(const [id, s] of Object.entries(services)){
    if(!isObj(s) || typeof s.label !== "string" || !s.label) out.push("service " + id + " has no label");
    else if(!KINDS.includes(s.kind)) out.push("service " + id + " has kind " + JSON.stringify(s.kind));
  }
  const carrierService = isObj(doc.carrierService) ? doc.carrierService : (out.push("carrierService is not an object"), {});
  for(const [name, id] of Object.entries(carrierService)){
    if(!Object.prototype.hasOwnProperty.call(services, id)) out.push("carrier " + name + " maps to unknown service " + JSON.stringify(id));
  }
  const sources = isObj(doc.sources) ? doc.sources : (out.push("sources is not an object"), {});
  if(!isObj(sources.none)) out.push("sources has no `none` entry, which a game no rule matches falls back to");
  for(const [key, s] of Object.entries(sources)){
    if(!isObj(s) || typeof s.label !== "string" || !s.label) out.push("source " + key + " has no label");
    else if(typeof s.url !== "string" || (s.url !== "" && !/^https:\/\/[^\s"<>]+$/.test(s.url))) out.push("source " + key + " url is not https");
  }

  if(!Array.isArray(doc.rules) || doc.rules.length === 0){
    out.push("rules is not a non-empty list");
    return out;
  }
  const fallback = new Set();
  doc.rules.forEach((r, i) => {
    const at = "rule " + (i + 1) + (isObj(r) && r.comp ? " (" + r.comp + ")" : "");
    if(!isObj(r)){ out.push(at + " is not an object"); return; }
    const allowed = ["comp", "if", "carriers", "confidence", "note", "src", "checked"];
    for(const k of Object.keys(r)) if(!allowed.includes(k)) out.push(at + " has unknown key " + JSON.stringify(k));
    if(typeof r.comp !== "string" || !r.comp) out.push(at + " has no comp");
    if(!CONFIDENCE.includes(r.confidence)) out.push(at + " has confidence " + JSON.stringify(r.confidence));
    if(typeof r.note !== "string" || !r.note) out.push(at + " has no note");
    if(typeof r.src !== "string" || !Object.prototype.hasOwnProperty.call(sources, r.src)) out.push(at + " cites unknown source " + JSON.stringify(r.src));
    if(r.checked !== undefined && !validDate(r.checked)) out.push(at + " checked is not a YYYY-MM-DD date");
    if(!Array.isArray(r.carriers)) out.push(at + " carriers is not a list");
    else r.carriers.forEach((c, j) => {
      const cat = at + " carrier " + (j + 1);
      if(!isObj(c) || typeof c.name !== "string" || !c.name) out.push(cat + " has no name");
      else {
        if(!KINDS.includes(c.kind)) out.push(cat + " (" + c.name + ") has kind " + JSON.stringify(c.kind));
        if(c.confidence !== undefined && !CARRIER_CONFIDENCE.includes(c.confidence)) out.push(cat + " (" + c.name + ") has confidence " + JSON.stringify(c.confidence));
        for(const k of Object.keys(c)) if(!["name", "kind", "confidence"].includes(k)) out.push(cat + " has unknown key " + JSON.stringify(k));
      }
    });
    if(r.carriers && r.carriers.length === 0 && r.confidence !== "unknown") out.push(at + " names no carrier but is not `unknown`");
    if(r.if !== undefined){
      if(!isObj(r.if) || Object.keys(r.if).length === 0){ out.push(at + " has an empty or invalid `if`"); }
      else for(const [k, v] of Object.entries(r.if)){
        if(!CONDITIONS.includes(k)){ out.push(at + " has unknown condition " + JSON.stringify(k)); continue; }
        if(k === "teams" || k === "tournamentIs" || k === "tournamentHas"){ if(!isStrList(v)) out.push(at + " " + k + " is not a list of names"); }
        else if(k === "day"){ if(!Array.isArray(v) || !v.length || !v.every(validDate)) out.push(at + " day is not a list of YYYY-MM-DD dates"); }
        else if(k === "dow"){ if(!Array.isArray(v) || !v.length || !v.every(n => Number.isInteger(n) && n >= 0 && n <= 6)) out.push(at + " dow is not a list of 0-6"); }
        else if(k === "hourFrom"){ if(!Number.isInteger(v) || v < 0 || v > 23) out.push(at + " hourFrom is not an hour 0-23"); }
        else if(v !== true) out.push(at + " " + k + " must be true");
      }
    }
    /* A rule with no condition catches every remaining game of its
       competition, so anything after it for the same competition can
       never match: almost always an ordering mistake. */
    if(typeof r.comp === "string"){
      if(fallback.has(r.comp)) out.push(at + " comes after an unconditional " + r.comp + " rule and can never match");
      if(r.if === undefined) fallback.add(r.comp);
    }
  });
  return out;
}

/** The newest checked date in the document: the day its last verified
    edit was made, as long as edits carry a per-row checked, which the
    file asks for. The page uses it to keep a newer bundled copy over an
    older downloaded one. */
function rightsRevised(doc){
  let best = typeof doc.checked === "string" ? doc.checked : "";
  for(const r of doc.rules || []) if(r && typeof r.checked === "string" && r.checked > best) best = r.checked;
  return best;
}

module.exports = { RIGHTS_FILE, SCHEMA, CONDITIONS, stripComments, readRights, rightsProblems, rightsRevised };
