# Game Day North

A single-page tracker for which of your teams are playing, and **which Canadian service each game is actually on**.

Schedules are easy to find. "Where is this on, in Canada?" is not — no sports API publishes Canadian broadcast rights, and the deals change between seasons. This page treats that as the hard problem and is honest about how much it knows.

## What it does

- **Multiple teams at once**, across NHL, NBA, NFL, MLB, MLS, the Premier League and UEFA club competitions
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

Two sources, in precedence order:

1. **ESPN's public API**, called from the browser on load and again while a game is on. North American leagues come from the per-team season schedule; soccer competitions answer a whole month at a time. Scores are topped up from the scoreboard, which is the only endpoint that reflects a game in progress.
2. **`LIVE_FIXTURES`** — a small hand-checked set with Canadian listings, used where the API can't be reached.

Canadian carriage always comes from the rights table, never from ESPN, whose broadcast data is US-facing.

**No code path invents a score or a fixture.** Where something can't be fetched the page says so and links to the deployment that can. That matters because it runs in two places: on GitHub Pages it reaches the API, while inside the claude.ai artifact viewer a strict CSP blocks all outside requests. The same file feature-detects and degrades honestly.

### Endpoint quirks worth knowing

Three of these cost real debugging time:

- A game is filed under its **US Eastern date**. A 7:05pm EDT game is the 21st to ESPN and the 22nd in UTC; ask for the wrong one and the day comes back empty.
- The **season schedule carries no live score**. A finished game can still read `STATUS_SCHEDULED` 0-0 there. Only the scoreboard endpoint has the result.
- A **`YYYYMMDD-YYYYMMDD` range looks like it works and silently returns only the first day.** Soccer accepts `YYYYMM` for a whole month; the North American leagues do not, so they use per-team season schedules instead.

Sources fail independently. Out-of-season cup competitions 404 as a matter of course, and one of those must never be able to blank the rest of the page.

## Running it

```bash
node build.js        # wraps src/page.html into a standalone index.html
python3 -m http.server 8000
```

`src/page.html` is the source of truth. It has no `<!doctype>`, `<head>` or `<body>` because the claude.ai artifact host supplies them; `build.js` wraps it for anywhere else. No dependencies, no build step beyond that, no backend.

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
