/* Men's senior international rugby union — source-agnostic normalisation.
 *
 * Shared by the build script and exercised directly by the tests. The
 * rules here are the ones that decide whether a fixture is a test match
 * at all, and every one of them was written against a real payload that
 * would otherwise have put the wrong thing on the page.
 *
 * The three that matter most:
 *
 *   - A tour feed is not a test feed. ESPN's British and Irish Lions
 *     league carries ten fixtures, of which four are Tests; the rest are
 *     Super Rugby clubs and two invitational sides. World Rugby's
 *     "Rugby's Greatest Rivalry" is the same shape. Nothing in either
 *     payload flags the difference, so a fixture counts as a test only
 *     when both sides resolve in the nation registry below.
 *
 *   - "Lions" is a South African franchise. The Johannesburg Lions play
 *     New Zealand in that same feed, three days after the actual Test.
 *     Matching loosely on the word would have filed a provincial warm-up
 *     as a British and Irish Lions Test, so the touring side is matched
 *     on its full name and never on "Lions" alone.
 *
 *   - "Argentina XV" and "Australia XV" are uncapped sides that appear
 *     against the USA in World Rugby's men's international bucket. They
 *     normalise to something other than the nation and are rejected on
 *     that basis; no suffix-trimming rule may ever be applied to a
 *     rugby name, or the XV sides become their nations.
 */

/* Normalisation is deliberately blunt and deliberately NOT
   suffix-trimming. The club-name helper elsewhere in this repo strips
   "FC"/"CF"/"SC"; doing anything of that kind here would collapse
   "Argentina XV" into "Argentina". */
export const normNation = x => String(x || "")
  .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]/g, "");

/* Senior men's test-playing sides. First entry is the label shown, the
   rest are names the feeds actually use or plausibly will. The slug is
   derived from the label and is what a starred nation is stored as, so
   it must stay stable: changing one silently unstars it for everyone. */
const NATION_ROWS = [
  ["Argentina"], ["Australia"], ["England"], ["France"], ["Ireland"],
  ["Italy"], ["Japan"], ["New Zealand"], ["Scotland"], ["South Africa"],
  ["Wales"], ["Fiji"], ["Samoa"], ["Tonga"], ["Georgia"], ["Romania"],
  ["Portugal"], ["Spain"], ["Uruguay"], ["Chile"], ["Canada"],
  ["United States", "United States of America", "USA", "US"],
  ["Namibia"], ["Zimbabwe"], ["Kenya"], ["Ivory Coast", "Cote d'Ivoire"],
  ["Algeria"], ["Morocco"], ["Tunisia"], ["Senegal"], ["Uganda"],
  ["Madagascar"], ["Ghana"], ["Nigeria"], ["Zambia"], ["Botswana"],
  ["Mauritius"], ["Rwanda"], ["Burundi"], ["Tanzania"], ["Cameroon"],
  ["Hong Kong", "Hong Kong China"], ["Korea", "South Korea"],
  ["Malaysia"], ["Singapore"], ["Sri Lanka"], ["China"],
  ["Chinese Taipei", "Taiwan"], ["India"], ["Philippines"], ["Thailand"],
  ["United Arab Emirates", "UAE"], ["Qatar"], ["Kazakhstan"],
  ["Saudi Arabia"], ["Guam"], ["Laos"], ["Cambodia"], ["Indonesia"],
  ["Nepal"], ["Pakistan"], ["Bangladesh"], ["Mongolia"], ["Brunei"],
  ["Uzbekistan"], ["Lebanon"], ["Papua New Guinea"], ["Cook Islands"],
  ["Solomon Islands"], ["Vanuatu"], ["Netherlands", "Holland"],
  ["Belgium"], ["Germany"], ["Switzerland"], ["Austria"], ["Poland"],
  ["Czechia", "Czech Republic"], ["Slovakia"], ["Slovenia"], ["Croatia"],
  ["Serbia"], ["Bosnia-Herzegovina", "Bosnia and Herzegovina"],
  ["Montenegro"], ["Kosovo"], ["Bulgaria"], ["Hungary"], ["Ukraine"],
  ["Moldova"], ["Lithuania"], ["Latvia"], ["Estonia"], ["Finland"],
  ["Sweden"], ["Norway"], ["Denmark"], ["Luxembourg"], ["Malta"],
  ["Cyprus"], ["Israel"], ["Turkey", "Turkiye"], ["Andorra"],
  ["Monaco"], ["San Marino"], ["Greece"], ["Brazil"], ["Colombia"],
  ["Paraguay"], ["Peru"], ["Venezuela"], ["Costa Rica"], ["Guatemala"],
  ["Mexico"], ["Jamaica"], ["Barbados"], ["Bermuda"],
  ["Trinidad and Tobago", "Trinidad & Tobago"], ["Cayman Islands"],
  ["Guyana"], ["Bahamas"], ["Saint Lucia", "St Lucia"],
  ["Saint Vincent and the Grenadines", "St Vincent and the Grenadines",
   "St Vincent & the Grenadines"], ["Curacao"],
  /* The touring side is a test-playing entity in its own right. Matched
     on the full name only — see the header note about the franchise. */
  ["British and Irish Lions", "British & Irish Lions", "British and Irish Lions XV",
   "British Irish Lions"]
];

const slugOf = label => label.toLowerCase().normalize("NFD")
  .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const NATIONS = NATION_ROWS.map(row => ({
  slug: slugOf(row[0]), label: row[0], names: row
}));

const NATION_BY_NAME = new Map();
for(const n of NATIONS){
  for(const name of n.names){
    const k = normNation(name);
    if(!NATION_BY_NAME.has(k)) NATION_BY_NAME.set(k, n);
  }
}
export const NATION_BY_SLUG = new Map(NATIONS.map(n => [n.slug, n]));

/** The nation a competitor name refers to, or null. Exact on the
    normalised name: no fuzzy matching, no suffix trimming. */
export function nationOf(name){
  return NATION_BY_NAME.get(normNation(name)) || null;
}

/* Sides that are legitimately in these feeds and are legitimately not
   tests. Listed so the build can drop them silently: they are expected,
   not a data problem, and warning about them every run would train
   whoever reads the log to ignore it. Anything NOT here and not a
   nation is warned about instead, because that is how a feed renaming
   a country gets noticed. */
const KNOWN_NON_TEST = new Set([
  /* invitational and uncapped sides */
  "aunzxv", "firstnationspasifikaxv", "barbarians", "worldxv",
  "argentinaxv", "australiaxv", "irelandxv", "francexv", "englandxv",
  "japanxv", "walesxv", "scotlandxv", "italyxv",
  "southafricaa", "irelanda", "englanda", "walesa", "scotlanda",
  "francea", "italya", "maoriallblacks", "barbarianasia", "barbarianssa",
  /* Super Rugby and provincial sides that appear on tour itineraries */
  "brumbies", "newsouthwaleswaratahs", "waratahs", "queenslandreds",
  "reds", "westernforce", "force", "crusaders", "highlanders",
  "hurricanes", "chiefs", "blues", "moanapasifika", "fijiandrua", "drua",
  "stormers", "sharks", "bulls", "lions", "cheetahs", "griquas",
  "leinster", "munster", "ulster", "connacht", "cardiff", "ospreys",
  "scarlets", "dragons", "glasgowwarriors", "edinburgh"
]);

/** Is this competitor a placeholder for a side not yet decided?
    The Nations Championship finals weekend is published as "NTH 1st v
    STH 1st" and the Pacific Nations Cup final as "Winner M1 v Winner
    M2". Those are real, dated fixtures with a genuinely unknown
    opponent — the page says so rather than dropping them. */
export function isPlaceholderSide(name){
  const s = String(name || "").trim();
  if(!s) return true;
  return /^(nth|sth|north|south|pool [a-z]|group [a-z])\s*\d*(st|nd|rd|th)?$/i.test(s)
      || /^(winner|loser|runner[- ]?up)\b/i.test(s)
      || /^(tbc|tbd|to be confirmed|to be decided)$/i.test(s)
      || /^(q|sf|qf|m)\d+$/i.test(s);
}

export function isKnownNonTest(name){
  return KNOWN_NON_TEST.has(normNation(name));
}

/* ---------------------------------------------------------------
   COMPETITIONS

   Keyed by the id the page uses. `espn` is the numeric rugby league
   identifier; `wr` matches World Rugby's competition label. A
   competition with no ESPN id is reachable only through World Rugby,
   and a competition with no World Rugby pattern only through ESPN —
   neither is a fault, and neither may suppress the other.
   --------------------------------------------------------------- */
export const RUGBY_COMPS = {
  RU6N:   {label:"Six Nations",           short:"Six Nations", espn:"180659", rank:80,
           wr:/^(men'?s )?six nations \d{4}$/i},
  RUNC:   {label:"Nations Championship",  short:"Nations C'ship", espn:"17567", rank:80,
           wr:/^nations championship/i},
  RUWNC:  {label:"World Rugby Nations Cup", short:"Nations Cup", espn:null, rank:70,
           wr:/^world rugby nations cup/i},
  RUTRC:  {label:"The Rugby Championship", short:"Rugby C'ship", espn:"244293", rank:80,
           wr:/^the rugby championship \d{4}$/i},
  RURWC:  {label:"Rugby World Cup",       short:"RWC",        espn:"164205", rank:90,
           wr:/^rugby world cup/i},
  RUPNC:  {label:"Pacific Nations Cup",   short:"Pacific NC",  espn:null, rank:70,
           wr:/^(world rugby )?pacific nations cup/i},
  RULIONS:{label:"British & Irish Lions", short:"Lions",      espn:"268565", rank:85,
           wr:/lions tour/i},
  /* The catch-all. ESPN files everything from a Rugby Championship
     fixture to a Rugby Europe Conference tie under one league id, and
     World Rugby spreads the same matches across several labels. Ranked
     lowest so that when both sources describe one fixture, the named
     competition wins over the bucket. */
  RUTEST: {label:"International Test",    short:"Test",       espn:"289234", rank:10,
           wr:/^(men'?s internationals|bledisloe cup|rugby.s greatest rivalry|asia rugby championship|rugby americas north championship|rugby europe|unions cup|autumn nations series|quilter)/i}
};

/** Which competition a World Rugby label belongs to, or null when it is
    one this product does not carry (a club league, a women's or an
    age-grade competition). */
export function compForWrLabel(label){
  for(const [id, c] of Object.entries(RUGBY_COMPS)){
    if(c.wr && c.wr.test(String(label || ""))) return id;
  }
  return null;
}

/* When two sources describe the same fixture under different
   competitions, the more specific one wins. Six Nations beats the test
   bucket; the bucket never overwrites a named competition. */
export function preferComp(a, b){
  if(!a) return b;
  if(!b) return a;
  const ra = (RUGBY_COMPS[a] || {}).rank || 0, rb = (RUGBY_COMPS[b] || {}).rank || 0;
  return rb > ra ? b : a;
}

/* ---------------------------------------------------------------
   STATUS

   The source says whether a match is over. Nothing here counts minutes.
   Eighty minutes of rugby routinely takes a hundred, extra time exists,
   and a match can be stopped and restarted — so a fixture stays live
   until the feed marks it complete, and an unrecognised status is
   treated as unresolved rather than as a result.
   --------------------------------------------------------------- */

/** ESPN: state is "pre" | "in" | "post" and completed is a boolean.
    Both are read; the name is used only to tell apart the several ways
    a match can end without being played. */
export function espnStatus(type){
  const t = type || {};
  const name = String(t.name || "").toUpperCase();
  if(/POSTPON/.test(name)) return "postponed";
  if(/CANCEL/.test(name)) return "cancelled";
  if(/ABANDON/.test(name)) return "abandoned";
  if(/SUSPEND/.test(name)) return "suspended";
  if(/DELAY/.test(name)) return "delayed";
  if(/HALFTIME|HALF_TIME/.test(name)) return "halftime";
  if(t.completed === true) return "final";
  if(t.state === "post") return "final";
  if(t.state === "in") return "live";
  if(t.state === "pre") return "scheduled";
  return "unknown";                     // never "final" by default
}

/** World Rugby: a short code. "C" is complete and "CC" is cancelled;
    "U" is unstarted. Everything else the feed may emit — and the live
    codes have not been observed from this environment — is unresolved,
    which is the safe direction to be wrong in. */
export function wrStatus(code){
  const s = String(code || "").toUpperCase();
  if(s === "C") return "final";
  if(s === "CC") return "cancelled";
  if(s === "P" || s === "PP") return "postponed";
  if(s === "A" || s === "AB") return "abandoned";
  if(s === "U" || s === "F") return "scheduled";
  if(s === "HT") return "halftime";
  if(s === "L" || s === "LIVE" || s === "L1" || s === "L2") return "live";
  return "unknown";
}

/* Statuses that mean the source has stopped reporting on this fixture.
   Only these end the minute poll, and only these are subject to the
   results cutoff. */
const TERMINAL = new Set(["final", "cancelled", "abandoned"]);
export const isTerminal = s => TERMINAL.has(s);
/* Under way now, in any of the ways rugby is under way. "unknown" is in
   here on purpose: a fixture whose status could not be read is exactly
   the one worth asking about again. */
const ACTIVE = new Set(["live", "halftime", "delayed", "suspended", "unknown"]);
export const isActive = s => ACTIVE.has(s);

/* ---------------------------------------------------------------
   DEDUPLICATION

   Event ids are authoritative, but only within the source that minted
   them: ESPN's 603247 and World Rugby's UUID describe the same Test and
   have nothing in common. So ids are namespaced, two fixtures with
   different ids in the SAME namespace are never merged, and only where
   the namespaces do not overlap does the fallback apply.

   The fallback is both nations plus a bounded kickoff window. Nations
   alone is not enough — South Africa play New Zealand three times in
   four weeks — and a date alone is not enough either, so the pair must
   also start within a few hours of each other.
   --------------------------------------------------------------- */
export const SAME_KICKOFF = 6 * 3600000;

const sideKey = s => s && s.slug ? s.slug : null;

export function sameFixture(a, b){
  const ns = new Map();
  for(const id of a.ids || []){ const i = id.indexOf(":"); ns.set(id.slice(0, i), id); }
  let shared = false;
  for(const id of b.ids || []){
    const i = id.indexOf(":");
    const mine = ns.get(id.slice(0, i));
    if(mine === undefined) continue;
    shared = true;
    if(mine === id) return true;        // same source, same event: settled
  }
  /* Both sources named this fixture and disagreed about which event it
     is. That is a different event, whatever the clubs and clock say. */
  if(shared) return false;

  const ah = sideKey(a.home), aa = sideKey(a.away);
  const bh = sideKey(b.home), ba = sideKey(b.away);
  if(!ah || !aa || !bh || !ba) return false;   // a TBD side cannot anchor a match
  if(Math.abs(a.start - b.start) >= SAME_KICKOFF) return false;
  return (ah === bh && aa === ba) || (ah === ba && aa === bh);
}

/** Fold `next` into `base`, keeping whichever copy actually knows more.
    Neither source is trusted wholesale: one carries the round, the other
    the venue, and the copy with a score wins the score. */
export function mergeFixture(base, next){
  const out = Object.assign({}, base);
  out.ids = [...new Set([...(base.ids || []), ...(next.ids || [])])];
  out.sources = [...new Set([...(base.sources || []), ...(next.sources || [])])];
  out.comp = preferComp(base.comp, next.comp);

  /* A status that says something beats one that says nothing. "unknown"
     never displaces a status a source was willing to state, and a
     terminal status is only replaced by another terminal status. */
  const rank = s => isTerminal(s) ? 3 : isActive(s) && s !== "unknown" ? 2
                  : s === "postponed" ? 2 : s === "scheduled" ? 1 : 0;
  if(rank(next.status) > rank(out.status)){
    out.status = next.status;
    out.label = next.label || out.label;
  }
  if(next.score && !out.score){
    out.score = next.score;
    /* The score belongs to the sides the copy it came from listed, so
       take that copy's orientation with it rather than assuming both
       sources agree on who is at home. */
    if(sideKey(next.home) !== sideKey(out.home) && sideKey(next.home) === sideKey(out.away)){
      out.score = [next.score[1], next.score[0]];
    }
  }
  for(const k of ["round", "label"]) if(!out[k] && next[k]) out[k] = next[k];
  /* Venues merge field by field, not wholesale — but not symmetrically.
     ESPN names the stadium and never the UTC offset, and its country
     field for internationals is unreliable in a way that is easy to
     miss: it files the Perth Test as "Perth, Scotland" and the Jujuy
     Test as "San Salvador, El Salvador", because address.state is a US
     field being used for a country. World Rugby has both right, and
     carries the offset that lets the page say a Sydney kickoff is
     Saturday there and Friday here. So World Rugby's venue leads where
     it exists, and ESPN only fills what it leaves blank. */
  if(next.venue || out.venue){
    const wr = v => (v && v.__src) === "wr";
    const a = out.venue, b = next.venue;
    const lead = wr(b) && !wr(a) ? b : (wr(a) && !wr(b) ? a : (a || b));
    const other = lead === a ? b : a;
    const v = Object.assign({name:"", city:"", country:"", offset:null}, lead || {});
    if(other){
      for(const k of ["name", "city", "country"]) if(!v[k] && other[k]) v[k] = other[k];
      if(v.offset == null && other.offset != null) v.offset = other.offset;
    }
    out.venue = v;
  }
  if(out.timeTBD && !next.timeTBD){ out.start = next.start; out.timeTBD = false; }

  /* The two sources do not always agree on a kickoff. Six fixtures in
     the current window differ by fifteen to sixty minutes — ESPN says
     South Africa v New Zealand kicks off at 15:10Z on 29 August and
     World Rugby says 14:10Z, for a series where the two agreed exactly
     on the match already played.

     The base copy's time is kept, and the build orders ESPN first
     deliberately: it agreed with World Rugby on every settled fixture
     and is self-consistent across a series where World Rugby is not.
     That is a judgement, not a certainty, so the other reading is kept
     beside it rather than discarded — a discarded disagreement is one
     nobody can audit later. */
  if(Math.abs(out.start - next.start) > 2*60000){
    out.altStart = next.start;
    out.altSource = (next.sources || [])[0] || null;
  }
  return out;
}

/** Merge a list of fixtures from any number of sources. */
export function dedupe(list){
  const out = [];
  for(const f of list){
    if(!f) continue;
    const i = out.findIndex(x => sameFixture(x, f));
    if(i < 0) out.push(f);
    else out[i] = mergeFixture(out[i], f);
  }
  return out.sort((a, b) => a.start - b.start);
}

/* ---------------------------------------------------------------
   ADAPTERS

   Parsing only — nothing here touches the network, so every rule below
   is exercised against a committed payload rather than against whatever
   the internet happened to be serving that morning.

   Each adapter returns fixtures or an empty list. Neither is allowed to
   throw its way into the other's results: a competition that only one
   source carries must survive the other source being down.
   --------------------------------------------------------------- */

/** One side of a fixture, resolved against the nation registry.
    Returns null when the name is neither a nation nor a placeholder —
    a club or an invitational XV — which is what disqualifies the whole
    fixture from being a test. */
function sideFrom(name, abbr){
  const nation = nationOf(name);
  if(nation) return {slug:nation.slug, name:nation.label, abbr:abbr || null, tbd:false};
  if(isPlaceholderSide(name)) return {slug:null, name:String(name).trim(), abbr:null, tbd:true};
  return null;
}

/* Which reported numbers are actually a score.

   A fixture that has not been played reads 0-0 in both feeds, and that
   is filler, not a result — so scheduled and postponed never carry one.
   A cancelled match reading 0-0 is the same filler; a cancelled match
   reading 20-0 is a forfeit that was genuinely awarded, and World Rugby
   publishes both. An abandoned match keeps the score it had reached,
   which is the only number anyone is looking for. */
function scoreFrom(status, sh, sa){
  if(sh === null || sa === null) return null;
  if(status === "scheduled" || status === "postponed") return null;
  if(status === "cancelled" && sh === 0 && sa === 0) return null;
  return [sh, sa];
}

const numOr = v => {
  if(v == null) return null;
  const n = parseInt(String(v).replace(/[^0-9-]/g, ""), 10);
  return Number.isNaN(n) ? null : n;
};

/** ESPN rugby scoreboard event → fixture, or null if it is not a men's
    senior test between two recognised sides. `rejects` collects the
    names that caused a drop, so the build can report them. */
export function fromEspnEvent(ev, compId, rejects){
  if(!ev) return null;
  const cp = (ev.competitions && ev.competitions[0]) || ev;
  const cs = cp.competitors || [];
  const H = cs.find(c => c.homeAway === "home") || cs[0];
  const A = cs.find(c => c.homeAway === "away") || cs[1];
  if(!H || !A || !H.team || !A.team) return null;

  const hName = H.team.displayName || H.team.name || "";
  const aName = A.team.displayName || A.team.name || "";
  const home = sideFrom(hName, H.team.abbreviation);
  const away = sideFrom(aName, A.team.abbreviation);
  if(!home || !away){
    for(const n of [!home && hName, !away && aName]){
      if(n && !isKnownNonTest(n) && rejects) rejects.add(n);
    }
    return null;
  }
  /* Two placeholders can be a real fixture; two sides where neither is
     a nation cannot be a test. */
  if(home.tbd && away.tbd && !cp.venue) { /* still allowed — a dated final */ }

  const start = Date.parse(ev.date || cp.date);
  if(!start) return null;
  const id = ev.id != null ? String(ev.id) : (cp.id != null ? String(cp.id) : null);
  if(!id) return null;

  const type = ((cp.status || ev.status || {}).type) || {};
  const status = espnStatus(type);
  const sh = numOr(H.score && H.score.displayValue != null ? H.score.displayValue : H.score);
  const sa = numOr(A.score && A.score.displayValue != null ? A.score.displayValue : A.score);
  const v = cp.venue || null;

  return {
    ids: ["espn:" + id],
    sources: ["espn"],
    comp: compId,
    start,
    /* ESPN publishes timeValid, and where it says the clock is not
       settled the page must not present one. No fixture in the current
       data sets it false, so this path is covered by fixtures only. */
    timeTBD: cp.timeValid === false,
    home, away,
    status,
    label: type.shortDetail || type.description || "",
    score: scoreFrom(status, sh, sa),
    venue: v ? {name:v.fullName || "", city:(v.address || {}).city || "",
                /* address.state is a US field; for an international it
                   holds whatever ESPN has, which is sometimes the wrong
                   country. Kept as a fallback, never preferred. */
                country:(v.address || {}).state || "", offset:null, __src:"espn"} : null,
    round: ""
  };
}

/** World Rugby (Pulselive) match → fixture, or null.
    `sport` is the reliable divider here: MRU is men's rugby union, WRU
    women's, JMU and JWU age-grade, MRS and WRS sevens. It is checked
    before anything else, so a women's or U20 fixture never reaches the
    competition test at all. */
export function fromWrMatch(m, rejects){
  if(!m) return null;
  if(String(m.sport || "").toUpperCase() !== "MRU") return null;
  const compId = compForWrLabel(m.competition);
  if(!compId) return null;                       // club, domestic, or not carried

  const teams = m.teams || [];
  if(teams.length < 2) return null;
  const hName = teams[0].name || "", aName = teams[1].name || "";
  const home = sideFrom(hName, teams[0].abbreviation);
  const away = sideFrom(aName, teams[1].abbreviation);
  if(!home || !away){
    for(const n of [!home && hName, !away && aName]){
      if(n && !isKnownNonTest(n) && rejects) rejects.add(n);
    }
    return null;
  }
  const start = m.time && typeof m.time.millis === "number" ? m.time.millis : null;
  if(!start) return null;
  const id = m.matchId || m.matchAltId;
  if(!id) return null;

  const status = wrStatus(m.status);
  const sc = Array.isArray(m.scores) ? m.scores : [];
  const sh = numOr(sc[0]), sa = numOr(sc[1]);
  const v = m.venue || null;
  /* "TBC" is what this feed puts where a venue is not settled, in the
     stadium field and the city field alike. Carrying it through would
     read as though the match were being played somewhere called TBC. */
  const settled = x => /^(tbc|tbd)$/i.test(String(x || "").trim()) ? "" : (x || "");

  return {
    ids: ["wr:" + id],
    sources: ["wr"],
    comp: compId,
    start,
    timeTBD: false,
    home, away,
    status,
    label: status === "final" ? "FT" : "",
    score: scoreFrom(status, sh, sa),
    venue: v ? {name:settled(v.name), city:settled(v.city), country:settled(v.country),
                /* the venue's own UTC offset, which is what lets the page
                   say "Sat in Auckland" without knowing the stadium */
                offset: typeof m.time.gmtOffset === "number" ? m.time.gmtOffset : null,
                __src:"wr"} : null,
    round: m.eventPhase && m.eventPhase !== "League" ? m.eventPhase : ""
  };
}

/* ---------------------------------------------------------------
   TIME

   Every kickoff is stored as an absolute UTC instant. Everything about
   a calendar day is asked of Intl at the moment it is needed, for the
   zone it is needed in. No offset is ever baked: Vancouver is UTC-8 for
   part of the year and UTC-7 for the rest, and a fixture list is one of
   the few things that spans both.
   --------------------------------------------------------------- */

const _dayFmt = {};
function dayFormatter(tz){
  const key = tz || "";
  let f = _dayFmt[key];
  if(!f){
    f = _dayFmt[key] = new Intl.DateTimeFormat("en-US", Object.assign(
      {year:"numeric", month:"2-digit", day:"2-digit"}, tz ? {timeZone:tz} : {}));
  }
  return f;
}

/** The calendar day an instant falls on, in a given zone, as
    YYYY-MM-DD. Omit the zone for the viewer's own. */
export function localDayKey(ms, tz){
  const p = {};
  for(const part of dayFormatter(tz).formatToParts(new Date(ms))) p[part.type] = part.value;
  return p.year + "-" + p.month + "-" + p.day;
}

/** Midnight starting the local day `daysBack` before the day containing
    `now`, as an absolute instant. This is what makes the results cutoff
    whole calendar days rather than a rolling 72 hours — the difference
    being that a fixture never half-disappears partway through a day. */
export function localMidnight(now, tz, daysBack){
  const key = localDayKey(now, tz);
  const [y, m, d] = key.split("-").map(Number);
  /* Count back in calendar days on the date itself, and do NOT re-read
     the result through the zone. Reading it back was an off-by-one east
     of UTC: an instant chosen as noon UTC is already the next day in
     Auckland, so three days back came out as two. Midnight-UTC has no
     daylight saving of its own, so subtracting whole days from it is
     exact arithmetic on the calendar and nothing else. */
  const back = new Date(Date.UTC(y, m - 1, d) - (daysBack || 0) * 86400000);
  const yy = back.getUTCFullYear(), mm = back.getUTCMonth() + 1, dd = back.getUTCDate();
  const p2 = n => String(n).padStart(2, "0");
  const want = yy + "-" + p2(mm) + "-" + p2(dd);
  /* Find the instant at which that local day begins by bisecting the
     24 hours around its noon: the zone's offset is whatever Intl says
     it is, including on a day that is 23 or 25 hours long. */
  let lo = Date.UTC(yy, mm - 1, dd, 0) - 18 * 3600000;
  let hi = Date.UTC(yy, mm - 1, dd, 0) + 18 * 3600000;
  while(hi - lo > 60000){
    const mid = lo + Math.floor((hi - lo) / 2 / 60000) * 60000;
    if(localDayKey(mid, tz) < want) lo = mid; else hi = mid;
  }
  return hi;
}

/** Concise venue-date context, or "" when the venue's date and the
    viewer's agree. A Saturday afternoon in Auckland is Friday evening in
    Vancouver, and without this the fixture reads as though it moved. */
export function venueDayNote(ms, venueOffsetHours, tz){
  if(venueOffsetHours == null) return "";
  const viewerDay = localDayKey(ms, tz);
  /* Shift the instant by the venue's offset and read it as UTC: that is
     the venue's wall-clock date. */
  const venueDay = localDayKey(ms + venueOffsetHours * 3600000, "UTC");
  if(venueDay === viewerDay) return "";
  const [y, m, d] = venueDay.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {weekday:"short", timeZone:"UTC"})
    .format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/* ---------------------------------------------------------------
   WINDOW

   Completed matches are kept for the previous three local calendar days
   and upcoming ones for at most ninety. Anything unresolved is kept
   whatever its age: a match abandoned mid-second-half and never
   resolved is precisely the fixture someone is still looking for.
   --------------------------------------------------------------- */
export const RESULT_DAYS = 3;
export const FORWARD_DAYS = 90;

export function withinWindow(f, now, tz){
  if(!f) return false;
  if(f.start > now + FORWARD_DAYS * 86400000) return false;
  if(!isTerminal(f.status)) return true;              // live, delayed, unresolved
  return f.start >= localMidnight(now, tz, RESULT_DAYS);
}

export const filterWindow = (list, now, tz) =>
  (list || []).filter(f => withinWindow(f, now, tz));
