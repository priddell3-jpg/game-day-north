/* The cycling season, read rather than typed.
 *
 * The race list in src/page.html (const CYCLING) is hand-typed, and for
 * a month in 2026 nothing noticed that the Road World Championships
 * were not in it. Nothing could have: the list was never compared with
 * anything. This file is the comparison, and the calendar that makes
 * the comparison mostly unnecessary.
 *
 * Everything here is pure. The build fetches the articles; this reads
 * them, and refuses to produce anything it cannot stand behind — a
 * table that does not parse yields nothing, never a guess.
 *
 * Wikipedia is the source for the same reason it is the source of the
 * stage results: the MediaWiki API is open to automation, where
 * ProCyclingStats has reserved against it.
 */

/* ---- which articles ---------------------------------------------------- */

export const seasonTitle = year => year + " UCI World Tour";
/* The World Championships are not a WorldTour race and are in no
   WorldTour calendar, which is precisely how they were missed: a check
   against the season article alone would have passed every day of that
   month. They are watched by name. */
export const worldsTitle = year => year + " UCI Road World Championships";

const flat = s => String(s || "").toLowerCase().normalize("NFD")
  .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/* A season article that does not exist yet still answers, by redirect:
   "2027 UCI World Tour" lands on "UCI World Tour", the article about
   the competition. The results fetch tolerates a redirect that shares a
   word with the request; here the year is the whole point, so the
   answer must be the article that was asked for and no other. */
export const sameTitle = (requested, answered) => !!flat(requested) && flat(requested) === flat(answered);

/* ---- dates --------------------------------------------------------------- */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december"];
const monthOf = w => MONTHS.indexOf(String(w || "").toLowerCase());
const iso = (y, m, d) => {
  const t = new Date(Date.UTC(y, m, d));
  /* 31 June is not a date, and Date would quietly call it 1 July. */
  if(t.getUTCFullYear() !== y || t.getUTCMonth() !== m || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
};
export const addDays = (isoDate, n) =>
  new Date(Date.parse(isoDate + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export const daysBetween = (a, b) =>
  Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

/* Wikitext that is markup rather than words: references, templates,
   link targets, cell attributes. */
export function plain(cell){
  let s = String(cell || "");
  s = s.replace(/<ref[^>]*\/>/gi, "").replace(/<ref[\s\S]*?<\/ref>/gi, "");
  s = s.replace(/<[^>]+>/g, " ");
  for(let i = 0; i < 4 && /\{\{[^{}]*\}\}/.test(s); i++) s = s.replace(/\{\{[^{}]*\}\}/g, "");
  s = s.replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, "");
  s = s.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1").replace(/\[\[([^\]]*)\]\]/g, "$1");
  return s.replace(/&nbsp;/g, " ").replace(/''+/g, "").replace(/\s+/g, " ").trim();
}
/* A table cell is "| attributes | content" or just "| content". The
   attributes never contain a link or a template, so the split is on the
   first bar that is outside both. */
export function cellContent(line){
  let s = String(line || "").replace(/^\s*[|!]\s?/, "");
  let depth = 0;
  for(let i = 0; i < s.length; i++){
    const two = s.slice(i, i + 2);
    if(two === "[[" || two === "{{"){ depth++; i++; continue; }
    if(two === "]]" || two === "}}"){ depth--; i++; continue; }
    if(s[i] === "|" && depth === 0){
      const before = s.slice(0, i);
      if(/^[^\[\]{}]*=[^\[\]{}]*$/.test(before) || /^\s*(scope|style|align|colspan|rowspan)\b/i.test(before))
        return s.slice(i + 1).trim();
      break;
    }
  }
  return s.trim();
}

/* "20–25 January", "1 February", "28 April – 3 May", "17–21 June 2026".
   The year is the season's unless the text states one; a range that
   runs backwards has crossed New Year. Anything else is not a date this
   can vouch for and answers null. */
export function parseDateRange(text, year){
  const s = plain(text).replace(/[‒-―−]/g, "-").replace(/\s*-\s*/g, "-").trim();
  const m = /^(\d{1,2})(?: ([A-Za-z]+))?(?: (\d{4}))?(?:-(\d{1,2})(?: ([A-Za-z]+))?(?: (\d{4}))?)?$/.exec(s);
  if(!m) return null;
  const [, d1, mon1, y1, d2, mon2, y2] = m;
  const endMonth = monthOf(d2 ? mon2 : mon1);
  const startMonth = mon1 ? monthOf(mon1) : endMonth;
  if(endMonth < 0 || startMonth < 0) return null;
  const stated = Number(y2 || y1);
  const endYear0 = stated || Number(year);
  if(!Number.isFinite(endYear0) || !endYear0) return null;
  let startYear = Number(y1) || endYear0;
  let endYear = endYear0;
  if(!d2) return (x => x ? { start: x, end: x } : null)(iso(startYear, startMonth, Number(d1)));
  if(!y1 && !y2 && (startMonth > endMonth)) endYear = startYear + 1;
  if(!y1 && y2 && startMonth > endMonth) startYear = endYear - 1;
  const start = iso(startYear, startMonth, Number(d1)), end = iso(endYear, endMonth, Number(d2));
  if(!start || !end || end < start) return null;
  return { start, end };
}

/* ---- tables ---------------------------------------------------------------- */

/* Every wikitable in the text, as rows of raw cell lines. A row is
   whatever sits between two "|-" lines; a cell is a line starting with
   "|" or "!". Cells written several to a line ("| a || b") are split. */
export function tables(text){
  const out = [];
  const re = /\{\|[\s\S]*?\n\|\}/g;
  let m;
  while((m = re.exec(String(text || "")))){
    const rows = m[0].split(/\n\|-[^\n]*/).map(chunk => {
      const cells = [];
      for(const line of chunk.split("\n")){
        if(/^\{\|/.test(line) || /^\|\}/.test(line) || /^\|\+/.test(line)) continue;
        if(/^[|!]/.test(line)){
          const head = line[0] === "!";
          for(const part of line.slice(1).split(head ? /!!|\|\|/ : /\|\|/)) cells.push({ head, raw: "|" + part });
        }else if(cells.length){
          cells[cells.length - 1].raw += "\n" + line;
        }
      }
      return cells;
    }).filter(r => r.length);
    out.push(rows);
  }
  return out;
}
const headerIndex = (row, re) => row.findIndex(c => c.head && re.test(plain(cellContent(c.raw))));
const firstLink = raw => {
  const m = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/.exec(String(raw || "").replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, ""));
  return m ? { target: m[1].trim(), text: (m[2] || m[1]).trim() } : null;
};

/* ---- the season -------------------------------------------------------------- */

/** The races of a season article: name, article, start and end.
    Returns [] when no table with a Race and a Date column is found, or
    when any row of it cannot be read — a calendar with a hole in it is
    a calendar that says a race is not happening. */
export function parseSeasonCalendar(wikitext, year){
  for(const rows of tables(wikitext)){
    const head = rows.find(r => headerIndex(r, /^race$/i) >= 0 && headerIndex(r, /^dates?$/i) >= 0);
    if(!head) continue;
    const at = { race: headerIndex(head, /^race$/i), date: headerIndex(head, /^dates?$/i) };
    const out = [];
    let broken = false;
    for(const r of rows){
      if(r === head) continue;
      if(r.length <= Math.max(at.race, at.date)) continue;        // a caption or a spanning note
      const link = firstLink(r[at.race].raw);
      const name = link ? link.text : plain(cellContent(r[at.race].raw));
      const when = parseDateRange(cellContent(r[at.date].raw), year);
      if(!name || !when){ broken = true; break; }
      out.push({ race: name, article: link ? link.target : null, start: when.start, end: when.end,
        oneDay: when.start === when.end });
    }
    if(broken || !out.length) return [];
    return out;
  }
  return [];
}

/** A championship's dates, from the infobox of its own article. */
export function parseChampionship(wikitext, year, title){
  const m = /^\|\s*dates?\s*=\s*(.+)$/im.exec(String(wikitext || ""));
  const when = m ? parseDateRange(m[1], year) : null;
  if(!when) return null;
  return { race: String(title || "").replace(/^\d{4}\s+/, ""), article: title || null,
    start: when.start, end: when.end, oneDay: when.start === when.end, series: "worlds" };
}

/* ---- stages ---------------------------------------------------------------- */

const TYPE_TAG = [[/team time trial/i, " (TTT)"], [/individual time trial|time trial/i, " (ITT)"]];

/** The stages of a stage race, from the "Stage characteristics" table of
    its article: [{n, date, label, route, km, page}].

    Returns null unless the table is complete and consistent: stages
    numbered from 1 (a prologue may precede them) without a gap, on
    dates that only go forward, and — where the caller states them —
    starting and ending on the race's own dates and matching its stage
    count. Rest days are rows with a date and no stage, and are dropped,
    which is the whole reason this is read rather than derived: a Grand
    Tour's dates cannot be spread across its range. */
export function parseStageTable(wikitext, year, expect = {}){
  for(const rows of tables(wikitext)){
    const head = rows.find(r => headerIndex(r, /^stage$/i) >= 0 && headerIndex(r, /^dates?$/i) >= 0);
    if(!head) continue;
    const at = { stage: headerIndex(head, /^stage$/i), date: headerIndex(head, /^dates?$/i),
      course: headerIndex(head, /^(course|route)$/i), km: headerIndex(head, /^distance$/i),
      type: headerIndex(head, /^type$/i) };
    const out = [];
    for(const r of rows){
      if(r === head || r.length < 2) continue;
      const stageCell = cellContent(r[at.stage] ? r[at.stage].raw : "");
      const label0 = plain(stageCell);
      if(/^total/i.test(label0)) continue;
      const when = parseDateRange(cellContent(r[at.date] ? r[at.date].raw : ""), year);
      if(!when || when.start !== when.end) return null;
      const rest = r.some(c => /rest day/i.test(c.raw));
      if(rest) continue;
      const prologue = /^p(rologue)?$/i.test(label0);
      const n = prologue ? 0 : Number((/^(\d+)[a-z]?$/i.exec(label0) || [])[1]);
      if(!prologue && !Number.isFinite(n)) return null;
      /* The Type column spans two cells, an icon and a word, so the
         word sits one past where the header says the column starts. */
      const typeText = at.type >= 0 ? r.slice(at.type).map(c => plain(cellContent(c.raw))).join(" ") : "";
      const tag = (TYPE_TAG.find(([re]) => re.test(typeText)) || [, ""])[1];
      const kmRaw = at.km >= 0 && r[at.km] ? r[at.km].raw : "";
      const km = Number((/\{\{\s*convert\s*\|\s*([\d.]+)\s*\|\s*km/i.exec(kmRaw) || /([\d.]+)\s*km/i.exec(plain(kmRaw)) || [])[1]);
      const route = at.course >= 0 && r[at.course] ? plain(cellContent(r[at.course].raw)).replace(/\s+to\s+/g, " – ") : "";
      const link = firstLink(stageCell);
      out.push({ n, date: when.start, label: (prologue ? "Prologue" : "Stage " + n) + (prologue ? "" : tag),
        route, km: Number.isFinite(km) ? km : 0,
        page: link && !/^#/.test(link.target) ? link.target : null });
    }
    if(!out.length) return null;
    const numbered = out.filter(s => s.n > 0);
    if(!numbered.length) return null;
    for(let i = 0; i < numbered.length; i++) if(numbered[i].n !== i + 1) return null;
    for(let i = 1; i < out.length; i++) if(out[i].date < out[i - 1].date) return null;
    if(expect.start && out[0].date !== expect.start) return null;
    if(expect.end && out[out.length - 1].date !== expect.end) return null;
    if(expect.stages && numbered.length !== expect.stages) return null;
    return out;
  }
  return null;
}

/** The stage count an article's own infobox states, or null. */
export function statedStages(wikitext){
  const m = /^\|\s*stages\s*=\s*(\d+)/im.exec(String(wikitext || ""));
  return m ? Number(m[1]) : null;
}

/* ---- the pool ---------------------------------------------------------------- */

/** The hand-typed race list, read out of the page's own source. The
    list is a literal — strings, numbers, arrays — and is evaluated as
    one; nothing else in the page is run. */
export function poolFromPage(src){
  const m = /^const CYCLING = (\[[\s\S]*?\n\]);/m.exec(String(src || ""));
  if(!m) throw new Error("src/page.html no longer declares `const CYCLING = [` — the season check has nothing to compare against");
  const list = new Function("return " + m[1] + ";")();
  return list.map(r => {
    const dates = r.oneDay ? [r.oneDay] : (r.stages || []).map(s => s[0]);
    return { race: r.race, short: r.short || r.race, oneDay: !!r.oneDay, dates,
      stages: r.stages || null, start: dates[0] || null, end: dates[dates.length - 1] || null };
  });
}

/* Words that name a kind of race rather than a race. Two names that
   share only these share nothing: "UAE Tour" and "Tour of Guangxi" are
   both tours. */
const GENERIC = new Set(["tour", "grand", "prix", "classic", "classics", "race", "cycliste", "ciclista",
  "cycling", "the", "and", "men", "mens", "uci", "road", "elite"]);
export const raceWords = name => flat(name).split(" ").filter(w => w.length >= 3 || /^\d+$/.test(w));

/** Whether two names are the same race. Every word of the shorter name
    must appear in the longer, and at least one of them must be a word
    that names something. */
export function sameRace(a, b){
  const wa = raceWords(a), wb = raceWords(b);
  if(!wa.length || !wb.length) return false;
  const [few, many] = wa.length <= wb.length ? [wa, new Set(wb)] : [wb, new Set(wa)];
  if(!few.every(w => many.has(w))) return false;
  return few.some(w => !GENERIC.has(w));
}

/** The pool entry for a season race: the same race, in the same year. */
export function inPool(race, pool){
  const year = String(race.start).slice(0, 4);
  return (pool || []).find(p => p.start && String(p.start).slice(0, 4) === year
    && (sameRace(p.race, race.race) || sameRace(p.short, race.race))) || null;
}

/** Season races the hand-typed pool does not hold. */
export function missingRaces(season, pool){
  return (season || []).filter(r => !inPool(r, pool))
    .map(r => ({ race: r.race, start: r.start, end: r.end, ...(r.series ? { series: r.series } : {}) }));
}

/** The misses worth acting on: races still to come, or finished on or
    after `cutoff`. A race that ended before the app was looking is not
    a miss anybody can do anything about, and thirty of those in a log
    are how the one that matters goes unread. */
export const dueMissing = (missing, cutoff) => (missing || []).filter(m => m.end >= cutoff);

/* ---- the calendar the page reads -------------------------------------------- */

/* A stage race with no stage list can still be placed when it is short:
   a week-long race has no rest days, so every day of its range is a day
   of racing. Past this many days it is a Grand Tour, it has rest days,
   and only its first and last days are certain. */
export const NO_REST_DAYS_UP_TO = 9;

/** One race as the page will draw it: a name, a year, and a row per day
    of racing. `from` says where the rows came from, in descending order
    of how much is known:

      article — the race's own stage table
      hand    — the hand-typed stage list in the page
      season  — a one-day race, which needs nothing but its date
      range   — the season's start and end alone

    A `range` Grand Tour carries only its first and last day and is
    marked `partial`, because the days between are not known to be days
    of racing. */
export function calendarEntry(race, poolEntry, stages){
  const name = poolEntry ? poolEntry.short : race.race;
  const base = { race: name, year: Number(String(race.start).slice(0, 4)), start: race.start, end: race.end,
    oneDay: !!race.oneDay, ...(race.article ? { article: race.article } : {}),
    ...(poolEntry ? { hand: poolEntry.race } : {}) };
  if(race.oneDay){
    return { ...base, from: "season", rows: [[race.start, "One-day race", "", 0]] };
  }
  if(stages && stages.length){
    return { ...base, from: "article", rows: stages.map(s => [s.date, s.label, s.route, s.km]) };
  }
  if(poolEntry && poolEntry.stages && poolEntry.stages.length){
    return { ...base, from: "hand", rows: poolEntry.stages.map(s => s.slice(0, 4)) };
  }
  const span = daysBetween(race.start, race.end) + 1;
  if(span <= NO_REST_DAYS_UP_TO){
    const rows = [];
    for(let i = 0; i < span; i++) rows.push([addDays(race.start, i), "Day " + (i + 1) + " of " + span, "", 0]);
    return { ...base, from: "range", rows };
  }
  return { ...base, from: "range", partial: true,
    rows: [[race.start, "Race starts", "", 0], [race.end, "Final stage", "", 0]] };
}

/** Where a calendar race's results are read from, in the shape the
    build's CYCLING_SOURCES uses. Null when there is nothing to key a
    result to: a stage race whose stage dates are not known. */
export function sourceFor(entry, stages){
  if(!entry.article) return null;
  if(entry.oneDay) return { name: entry.race, dates: [entry.start], oneDay: true, pages: [entry.article], generated: true };
  if(entry.from !== "article" && entry.from !== "hand") return null;
  const numbered = entry.rows.filter(r => /^Stage \d+/.test(r[1]));
  if(!numbered.length) return null;
  const split = [...new Set((stages || []).map(s => s.page).filter(Boolean))];
  return { name: entry.race, dates: numbered.map(r => r[0]),
    pages: split.filter(p => p !== entry.article).concat([entry.article]), generated: true };
}
