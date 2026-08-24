/* Wikipedia cycling-result parsing, kept apart from the fetching so it
   can be exercised against saved wikitext without touching the network.

   These are the shapes that cost real debugging: results are runs of
   {{cyclingresult}} templates rather than wiki tables, a naive table
   parser confidently returned a citation publisher as a podium
   finisher, and the rank must be numeric so a neutralised stage (ranks
   shown as an em dash) and a team time trial (no rider column at all)
   both correctly yield nothing. */

export const isGCBlock = b => /general classification/i.test(b.slice(0,240));

export function resultBlocks(text){
  const marks = [], re = /\{\{\s*cyclingresult start\b/gi;
  let m;
  while((m = re.exec(text))) marks.push(m.index);
  return marks.map((at,i)=>{
    const seg = text.slice(at, marks[i+1] !== undefined ? marks[i+1] : text.length);
    const e = seg.search(/\{\{\s*cyclingresult end\s*\}\}/i);
    return e >= 0 ? seg.slice(0, e) : seg;
  });
}

export function ridersInBlock(block, n){
  const out = [], re = /\{\{\s*cyclingresult\s*\|\s*\d+\s*\|\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gi;
  let m;
  while((m = re.exec(block)) && out.length < n){
    const name = (m[2] || m[1]).replace(/\s+/g," ").trim();
    if(name && !out.includes(name)) out.push(name);
  }
  return out.slice(0, n);
}

export function gcLeaderFrom(text){
  const at = text.search(/\|\+\s*General classification after stage/i);
  if(at < 0) return null;
  const seg = text.slice(at, at + 4000);
  const m = seg.match(/\{\{\s*Flag athlete\s*\|\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/i);
  if(!m) return null;
  return (m[2] || m[1]).replace(/\s+/g," ").trim();
}

export function stageSections(text){
  // "==Stage 4==" headings, tolerant of spacing and === depth
  const found = {};
  const re = /^=+\s*Stage\s+(\d+)\b[^=\n]*=+\s*$/gim;
  const marks = []; let m;
  while((m = re.exec(text))) marks.push({n:+m[1], at:m.index});
  marks.forEach((mk, i)=>{
    found[mk.n] = text.slice(mk.at, marks[i+1] ? marks[i+1].at : text.length);
  });
  return found;
}

/* Significant words in a title. Years are excluded because every
   article in a season carries one, and the vocabulary of cycling is
   excluded because it is shared by every race and the season overview
   alike — "2026 Tour of Guangxi" and "2026 UCI World Tour" have "tour"
   in common and nothing else. What is left is the distinctive part: the
   place or the race. */
export const TITLE_GENERIC = new Set(["uci","world","tour","race","racing","grand","prix",
  "cycliste","classic","cycling","road","men","mens","women","womens","stage","edition"]);
export const titleWords = t => new Set(String(t||"").toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .split(/[^a-z0-9]+/)
  .filter(w=>w.length >= 3 && !/^\d+$/.test(w) && !TITLE_GENERIC.has(w)));

/** Does the answering title still describe what was asked for?
    A title that does not exist can still answer by redirecting to a
    season overview, and parsing that would attribute one page's
    contents to a race it says nothing about. An empty request side
    means there is nothing to judge, so the answer is accepted. */
export function titleMatches(requested, answered){
  const want = titleWords(requested), have = titleWords(answered);
  if(!want.size) return true;
  return [...want].some(w => have.has(w));
}
