# P2 refactor plan

Two maintainability changes, deliberately **not** started. Both touch data
the app's honesty depends on, and both are safer as their own reviewed
change than as a tail on a correctness pass.

They are independent. Either can ship without the other. If only one is
done, do the **team manifest** first: it is smaller, its failure mode is
loud, and it removes a duplication that has already caused three bugs.

---

## Change A — `RIGHTS` into committed, schema-validated data

### Why

`RIGHTS` is an ordered rules table living in `src/page.html`. It is the
answer to the product's actual question, and it is hand-maintained
against primary sources. Today that means editing a JavaScript array
inside a 1,900-line HTML file, where a stray comma is a runtime error and
a wrong `comp` key fails silently by simply never matching.

Nothing validates it. Nothing notices an expired deal, a duplicate rule,
or a carrier id that no longer exists.

### What stays in code

Predicate evaluation. A rule's `when` is a function over a game
(`stage`, `hour`, `dow`, `has(teamId)`), and turning that into data means
inventing an expression language — more risk than the problem justifies.
The split is: **conditions declared as data, evaluated by named
predicates in code.**

### Proposed shape — `data/rights.json`

```jsonc
{
  "version": 1,
  "checked": "2026-08-22",
  "carriers": {
    "sportsnet": { "label": "Sportsnet",  "kind": "tv",     "service": "sportsnet" },
    "flobikes":  { "label": "FloBikes",   "kind": "stream", "service": "flobikes"  }
  },
  "sources": {
    "rogers-nhl": {
      "label": "Rogers–NHL 12-year agreement",
      "url": "https://about.rogers.com/...",
      "quality": "primary"        // primary | secondary | aggregator
    }
  },
  "rules": [
    {
      "id": "nhl-prime-wed",
      "comp": "NHL",
      "priority": 100,            // explicit, replacing array order
      "carriers": ["prime"],
      "confidence": "confirmed",  // confirmed | expected | unknown
      "source": "rogers-nhl",
      "checked": "2026-08-22",
      "validFrom": "2026-10-01",
      "validTo": "2027-06-30",
      "when": { "predicate": "dayOfWeek", "args": { "days": [3] } },
      "note": "Prime Video holds Wednesdays exclusively from 2026-27."
    }
  ]
}
```

`when.predicate` names a function in a fixed registry in the page:
`always`, `dayOfWeek`, `hourRange`, `stageIs`, `matchdayIn`, `hasTeam`,
`allOf`, `anyOf`. An unknown predicate name is a validation failure, not
a silent non-match.

### Validator — `scripts/validate-rights.mjs`, run in CI

Fails the build on:

- a `carriers[]` entry not present in `carriers`
- a `source` not present in `sources`
- a `when.predicate` not in the registry, or args of the wrong shape
- two rules with the same `id`
- a rule whose `validTo` has passed (**warn** within 60 days, **fail**
  once expired — an expired deal is a wrong answer, not a stale comment)
- duplicate `(comp, priority)` pairs, which make order ambiguous
- two rules for the same `comp` whose conditions provably overlap, for
  the decidable predicates (`dayOfWeek`, `hourRange`, `stageIs`); report
  as **warn**, since deliberate overlap resolved by priority is legitimate
- `confidence: "confirmed"` with a source whose `quality` is not
  `primary` — the confidence claim must be backed by the source class

### Migration sequence

1. Add `data/rights.json` alongside the existing table. Add the validator
   and wire it into CI. **No behaviour change.**
2. Add a test asserting the JSON resolves to the *same carrier decision*
   as the in-page table for a fixed corpus of fixtures drawn from
   `data.json` — every competition, every stage, both DST regimes.
3. Only once that test passes for every fixture: switch `resolveRights`
   to read the JSON, delete the in-page table in the same commit.
4. `build.js` inlines `data/rights.json` into `index.html` at build time,
   so the page stays a single self-contained file and the client makes no
   extra request. This is the one build change required.

### Risks

- **Silent carriage change.** Mitigated by step 2: the corpus test must
  show byte-identical decisions before the old table is removed.
- **Single-file property.** Inlining at build time preserves it; needs a
  test that the built `index.html` contains no `fetch` for rights data.
- **Editing gets harder, not easier**, if the schema is over-designed.
  Keep `when` to the eight predicates above; add more only when a real
  rule needs one.
- **Expiry failing the build** could block an unrelated change on a
  Sunday. Hence warn-then-fail, with 60 days of notice.

### Tests

- validator: each failure class above, plus a valid file passing
- predicate registry: each predicate against hand-written fixtures
- parity corpus: JSON vs current table across all fixtures in `data.json`
- ordering: priority beats array position; first match still wins
- inlining: built `index.html` contains the rules and no runtime fetch

---

## Change B — one team manifest

### Why

`TEAM_ROWS` in `src/page.html` and `ROSTER` in `scripts/fetch-data.mjs`
are the same list maintained twice. Drift between them is invisible in
the app: a team simply appears to have no games. This has already caused
three separate detachments (`van-mls`, `lafc`, `int`), each found only
because the unmatched-team warning was added afterwards.

### Proposed shape — `data/teams.json`

```jsonc
{
  "version": 1,
  "teams": [
    {
      "id": "van-mls",
      "comp": "MLS",
      "city": "Vancouver",
      "name": "Whitecaps",
      "abbr": "VAN",
      "tz": "PT",
      "color": "#00245E",
      "displayName": "Vancouver Whitecaps",   // what the page calls it
      "feedName": "Vancouver Whitecaps",      // what ESPN calls it
      "aliases": ["Vancouver Whitecaps FC"],  // other names seen in feeds
      "default": true,                         // ships in DEFAULT_TEAMS
      "extraComps": []                         // e.g. ["UCL","EFL","FAC"]
    }
  ]
}
```

This absorbs `TEAM_ROWS`, `ROSTER`, `CLUB_NAMES`, `ESPN_NAME`, `ALIASES`
and `EXTRA` — six lists that must currently agree by hand.

### Migration sequence

1. Generate `data/teams.json` **from** the existing definitions, and add
   a test asserting it reproduces all six exactly. This proves the
   manifest is complete before anything depends on it.
2. `scripts/fetch-data.mjs` imports it and drops `ROSTER`/`ALIASES`/`EXTRA`.
3. `build.js` inlines it into `index.html`; the page drops `TEAM_ROWS`,
   `CLUB_NAMES`, `ESPN_NAME`.
4. Validator in CI: duplicate ids, unknown `comp`, unknown `tz`, missing
   `feedName`, an alias colliding with another team's name, a `default`
   team that does not exist.

**The unmatched-team warning stays.** The manifest removes drift between
two lists; it cannot detect that ESPN renamed a club. That warning is the
only thing that catches the rename, and it earned its place.

### Risks

- **A generated manifest that is subtly wrong** ships bad team data
  everywhere at once. Step 1 exists solely to prevent this: it is not a
  refactor until the equivalence test passes.
- **`build.js` grows a second inline step.** Keep it one function that
  takes a map of placeholder → JSON; do not let it become a bundler.
- **Bigger `index.html`.** Roughly +6KB before compression. Acceptable;
  measure and report it in the commit.

### Tests

- equivalence: manifest reproduces `TEAM_ROWS`, `ROSTER`, `CLUB_NAMES`,
  `ESPN_NAME`, `ALIASES`, `EXTRA` exactly
- validator: each failure class above
- every `default: true` id resolves to a real team
- alias resolution: `idFor()` matches through aliases and suffix rules
- built `index.html` contains the manifest and makes no runtime fetch

---

### Status

**Step 1 is done** — `data/teams.json` exists, reproduces all six lists
plus `DEFAULT_TEAMS`, and is validated. Nothing reads it yet, and a test
holds that line. Steps 2 to 4 are the consumer migration and are a
separate change.

Two departures from the shape above, both made when the real data was in
front of us:

- **`espn`**, the source's own team id, is carried per club. At 265 teams
  the alias list is the thing that would rot; matching on an id the feed
  states does not. Name matching stays as the fallback, so the
  unmatched-team warning still earns its place.
- **`defaults` is an ordered top-level array**, not a per-team boolean.
  `DEFAULT_TEAMS` is ordered and the order is what a first-time visitor's
  board looks like; a boolean loses it.

Four groups rather than one list, because the six lists cover four
different kinds of thing: `teams` (followable), `events` (the men's
WorldTour, which stands in the picker where a team would be), `ghosts`
(real clubs nobody can follow, named by the baked fallback fixtures) and
`feedOnly` (clubs known only by the name the feed uses).

---

## Change C — league-wide fixture fetching

Prerequisite for expanding past 50 teams. Not started.

### The quirk that is no longer true

This repo states, in the README and in `scripts/fetch-data.mjs`, that a
`YYYYMMDD-YYYYMMDD` range silently returns only the first day for the
North American leagues. **Measured on 2026-09-09, it does not.** A ranged
request returned exactly the same event ids as one request per day:

| League | Ranged | Per day | Missing |
| --- | --- | --- | --- |
| MLB | 273 | 273 | 0 |
| Premier League | 30 | 30 | 0 |
| NFL | 32 | 32 | 0 |

One ranged request per competition therefore replaces both the per-team
season schedules and the per-day scoreboards: about 83 requests for 265
teams, against 125 today for 50, against about 282 if the current
per-team approach were simply multiplied.

### The failure mode that must not ship

`limit` is honoured to exactly **1000** and silently collapses to **25**
above it. Worse, the ceiling is reachable: MLB measured 13 events a day,
so a full 84-day window in regular season is roughly 1,092, and NHL
mid-season is around 580 — a thinner margin than September's 449
suggests. **A truncated fixture set that ships silently is the worst
failure in this workstream.**

So the build must:

- **fail loudly** if any response comes back with exactly `limit`
  results, rather than treating a full page as a complete answer;
- **chunk the window per competition** when projected volume approaches
  the ceiling, e.g. two 42-day requests for baseball;
- never pass a `limit` above 1000, since the value that looks most
  generous is the one that returns 25.

### Keeping the old path honest

Add a cheap nightly check: one ranged three-day request must equal three
per-day requests. If ESPN reverts the range behaviour, that surfaces the
day it happens rather than the day someone notices a missing fixture.

### Payload

2,070 fixtures in the window takes `data.json` from 294 KB to roughly
900 KB. GitHub Pages gzips it, so a visitor transfers about 102 KB
against 35.6 KB today. Acceptable, and it means **no per-league file
split** for now.

---

## Open questions, before the roster expands

1. **The Champions League–only clubs.** Fifteen clubs in the current
   field have no supported domestic league. Following one gives roughly
   six matches a season. Either a deliberate, labelled state
   ("Champions League fixtures only") or we fetch their domestic leagues
   too. This bakes into the manifest, so it is answered before the
   clubs are added.
2. **Who owns manifest staleness.** Promotion and relegation rewrite
   about six clubs each summer, and the Champions League–only fifteen
   turn over almost entirely each season. Proposed: a scheduled job that
   diffs ESPN's `/teams` against the manifest and opens an issue on
   drift. Not built until confirmed.
3. **When to split the payload.** 102 KB gzipped is fine, but the fetch
   is all-or-nothing: somebody following three teams downloads all 265.
   A threshold needs naming.

## After the roster expands

Race's Auto rules were designed against a 50-team roster. "Meaningful
races only" and spoiler safety with scores hidden both need re-verifying
at 265 teams, as a separate check.

---

## Sequencing

**B, then C, then A.** B is smaller, its equivalence test is mechanical,
and it removes an active source of bugs. C is the prerequisite for any
roster growth and carries the truncation risk above. A is larger and
touches the table the product's central claim rests on; it deserves an
undistracted review.

Consumer migration for B is its own pull request, after the manifest
lands. Neither should be bundled with unrelated work.
