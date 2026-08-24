# Game Day North

A single-page tracker for which of your teams are playing, and **which Canadian service each game is actually on**.

Schedules are easy to find. "Where is this on, in Canada?" is not — no sports API publishes Canadian broadcast rights, and the deals change between seasons. This page treats that as the hard problem and is honest about how much it knows.

## What it does

- **Multiple teams at once**, across NHL, NBA, NFL, MLB, MLS, the Premier League and UEFA club competitions
- **Tennis by player** — follow individual ATP and WTA singles players and see only their matches, with set scores, round and court
- **Where to watch** per game — Sportsnet, TSN, Prime Video, Fubo, DAZN, Apple TV, RDS, TVA Sports, CTV, MLB.TV, NBA League Pass
- **Coverage check** — mark the services you subscribe to and every game is flagged *You have it* or *Needs DAZN*
- **Scores with a global on/off switch**, spoiler-safe: a hidden game still shows that it's live and where it's carried, with a per-game reveal
- **Agenda by day and a month calendar**, league-coloured
- **Honest unknowns** — `Time TBC` with the date it gets confirmed, `Opponent TBD` with the draw date, `Carrier TBC` where no Canadian rights holder could be verified

Everything is per-viewer: teams, services and the score toggle live in `localStorage`, so two people on the same link keep their own boards.

## Competitions, not leagues

Broadcast rights attach to a **competition**, not a team. Liverpool in one season plays the Premier League (Fubo), the Champions League (DAZN), the League Cup (DAZN) and the FA Cup (no confirmed Canadian carrier). Modelling carriage per league gets that wrong, so `RIGHTS` is an ordered rules table keyed on competition, stage and matchday, first match wins.

Every row carries a confidence level and a source:

| Level | Meaning |
| --- | --- |
| `confirmed` | Backed by a primary announcement — a league or broadcaster press release |
| `expected` | Derived from a known pattern (regional rights, national windows) but not individually confirmed |
| `unknown` | No Canadian rights holder found. Shown as `Carrier TBC` rather than guessed |

When sources disagree, the primary release wins and the disagreement goes in the row's note. There is a live example in the table: an aggregator lists DAZN Canada for Premier League fixtures while Fubo's own release says exclusive.

## Data

**Every fixture on this page is a real one.** There is no schedule generator: what you see came from a published feed, and where the feed has nothing, the page shows nothing.

Sources, in precedence order:

1. **`data.json`, built by a scheduled GitHub Action.** One machine talks to the sports API every half hour and commits the result, so an ordinary visit is a single request to this repo's own domain. See `scripts/fetch-data.mjs`.
2. **Live top-up.** Anything in progress is read straight from ESPN, because a file rebuilt every thirty minutes cannot follow a game.
3. **Direct fetch**, if `data.json` is missing or more than 90 minutes old — a stalled job degrades to the old behaviour rather than an empty page.
4. **`LIVE_FIXTURES`** — a small hand-checked set with Canadian listings, for when nothing can be reached.
5. **Remembered results** — a final score, once seen, is kept in that browser for a week, so a game you missed still shows its score when the feed is down.

Canadian carriage always comes from the rights table, never from ESPN, whose broadcast data is US-facing.

**No code path invents a score or a fixture.** Where something can't be fetched, the page says so.

### Endpoint quirks worth knowing

Each of these cost real debugging time and is handled in both the client and the build script:

- A game is filed under its **US Eastern date**. A 7:05pm EDT game is the 21st to ESPN and the 22nd in UTC; ask for the wrong one and the day comes back empty.
- The **season schedule carries no live score**, and omits games entirely. A finished game can read `STATUS_SCHEDULED` 0-0 there. Only the scoreboard has the result, so both are queried and the copy carrying a score wins.
- A **`YYYYMMDD-YYYYMMDD` range looks like it works and silently returns only the first day.** Soccer accepts `YYYYMM` for a whole month; the North American leagues do not, so they use per-team season schedules plus per-date scoreboards.
- Sources fail independently. Out-of-season cup competitions 404 as a matter of course, and one of those must never be able to blank the rest of the page.
- A fixture and a scoreboard event are matched on **the source's own event id first**, never on team ids. The committed file mints a synthetic id for any club it could not map to the roster, so one club reads `feed:EPL:FUL` in the file and `ful` from ESPN; comparing those raw left a game showing as scheduled while it was live at 1-2. Team identity decides only which way round the score goes, and a score whose orientation cannot be established is dropped rather than guessed.
- **`data.json` is served with `max-age=600`.** The page re-reads it every minute while a game is on, so it asks for a revalidation instead of accepting a copy the browser may hold for ten minutes — otherwise a score the scheduled job has already committed stays invisible. An unchanged file costs a 304 and no body; the API calls keep ordinary caching.

Where neither copy carries an event id, two fixtures count as the same game only when both clubs match **and** they start within four hours — not merely on the same date, or a baseball doubleheader would collapse into one game.

### What gets polled, and when

A live score is a number that changes, so following one means asking again. Asking too often is rude to a free endpoint and flattens a phone battery, so the rules are narrow and all in one place:

- Only fixtures involving a **followed team**, and only while **Scores on** is enabled — with scores hidden there is no number on screen to keep current.
- Every **60 seconds** while a fixture is active or its status is unknown. That deliberately includes halftime, delays, extra time, overtime and shootouts: ESPN reports all of them as `state: "in"`, and the page reads that field rather than trying to recognise each phase by name.
- **Nothing once ESPN says `completed: true` or `state: "post"`.** A final is asked about once and then left alone; the scheduled rebuild of `data.json` carries the rare post-final correction.
- **Elapsed time never ends a game.** A delay, extra innings and a postponement are indistinguishable from a clock, so only the source can say a game is over.
- **One refresh at a time.** The minute poll, the quarter-hour poll, the team picker and a returning tab can all ask at once; a caller that asks while a pass is running joins it rather than starting a second.
- **Paused while the tab is hidden**, with one immediate refresh when it comes back.
- **Cycling is never polled.** A stage podium is a result, not a live feed, and there is no live cycling source to poll; it arrives with the committed file.
- **Tennis polls on its own loop**, against `/api/tennis` rather than ESPN directly, and only for the tours a followed player actually has a live or unresolved match in. It follows the same rules otherwise: one request at a time, paused with the tab, stopped once the source calls a match final, retired or walkover. The team and cycling paths are untouched by it.

A fixture that has already been given a score is still polled while it is under way. Not doing that is what once froze a match at its halftime score for the rest of the night.

### Tennis is followed by player, not by tournament

Every other sport here is a fixture list you subscribe to by club. Tennis is not: you follow Alcaraz, and the matches that matter are wherever he is drawn that week. So tennis is modelled as players, and nobody is followed by default — a viewer who has never picked one sees no tennis rows and the page makes no tennis request.

ESPN publishes tennis as a tournament containing *groupings* — men's singles, women's doubles, mixed doubles — each containing the *competitions* that are the actual matches. That is a different shape from the one event per game every other sport answers, so it has its own parser in `scripts/lib/tennis.mjs` rather than the team parser being taught to guess.

Three things about that feed are load-bearing:

- **It is about 2 MB across the two tours**, and a Grand Slam is published in full under *both* — the US Open's 239 men's singles matches appear identically in the ATP and the WTA scoreboard. Deduplicating by ESPN's competition id is the only thing that collapses them.
- **Most matches have no usable time.** ESPN says so itself with `timeValid: false`, and an unplayed third round carries a placeholder of midnight Eastern. The day is shown and the clock is not invented.
- **An unfilled slot in a draw is still published as a competitor**, with a negative athlete id and the name `TBD`. It is a placeholder, never a person: it cannot be followed, never reaches the picker, and a line with two of them is not a match at all.

Because of the size, the browser never reads that feed. `api/tennis.js` does, keeps the singles matches involving the players actually being followed, and returns a few kilobytes — about **8× smaller** for the whole singles field and roughly **1000× smaller** for a viewer following two or three players. Vercel's CDN shares each answer for 55 seconds, just under the client's one-minute poll, and browsers are told to revalidate every time. The searchable player list travels with `data.json` instead, so typing a name costs no request.

Identity is ESPN's athlete and competition ids throughout. Names are never a key: they are spelled several ways across a season and two players can share one.

**Canadian coverage is modelled per tournament, never per player.** Following a player tells you nothing about who carries him; the event he is in decides that, and it changes weekly. Two sources were checked — ATP's own broadcaster list (TSN for the tour, Sportsnet for the Canadian Masters) and the US Open's international broadcaster page (TSN and RDS). Neither covers the WTA tour, and a Grand Slam's rights are sold separately from the tour deal, so Melbourne, Paris, Wimbledon and every WTA event outside a Slam resolve to **Coverage TBD** rather than being assumed to follow the tour. Uncertain coverage is never counted as a service you have.

Retention is applied server-side, before anything is sent: a settled match is kept for three days from its start, anything still live or suspended is kept however old it is, and upcoming matches run to a fortnight. Only singles; no doubles, juniors, exhibitions or team competitions in this phase.

### Keeping the roster in step

`ROSTER` in `scripts/fetch-data.mjs` mirrors `TEAM_ROWS` in `src/page.html`. Add a team to one and add it to the other, or the picker will offer a team the build never fetches.

## Running it

```bash
node build.js        # wraps src/page.html into a standalone index.html
python3 -m http.server 8000
```

`src/page.html` is the source of truth: a fragment with no `<!doctype>`, `<head>` or `<body>` of its own. `build.js` wraps it into the standalone `index.html` that GitHub Pages serves. No dependencies, no build step beyond that.

The one piece of server is `api/tennis.js`, a Vercel function — see the tennis section above for why. Everything else still works with the page opened from a file: without it, tennis rows simply never appear. `api/package.json` exists only to mark that directory as ESM, so `build.js` stays a plain CommonJS script.

### GitHub Pages

Settings → Pages → deploy from `main`, folder `/ (root)`. `index.html` is committed, so it serves as-is.

## Keeping it current

A scheduled task refreshes `LIVE_FIXTURES` daily and re-checks the rights table weekly against primary sources. That matters more than it sounds: 2026-27 is the first season of a new 12-year Rogers deal, so Hockey Night in Canada is no longer on CBC, Sportsnet has Saturday and Monday, and Prime Video has Wednesday nights exclusively. Any model of Canadian hockey built on the previous decade is wrong right now.

## Roadmap

- [ ] Service worker + manifest so it installs to an iPhone home screen
- [ ] Web push for pre-game alerts and time changes (iOS 16.4+, home-screen installs only)
- [ ] Cache API responses so a reload isn't a cold fetch
- [ ] Resolve FA Cup Canadian carriage before the third round in January

## License

MIT
