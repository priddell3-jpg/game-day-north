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

Three layers, in precedence order:

1. **ESPN's public scoreboard API**, called from the browser on load and refreshed while a game is on. Gives real fixtures, real opponents, real scores and real game state. Rendered with a **Listed** badge.
2. **`LIVE_FIXTURES`** — a small set of hand-checked fixtures with Canadian listings, used as a fallback where the API can't be reached.
3. **Projections** — everything beyond that, generated from season shapes and resolved against the rights table.

Canadian carriage always comes from the rights table, never from ESPN, whose broadcast data is US-facing.

**There is no code that invents a score.** Where a score can't be fetched, the page says so and links to the version that can. That matters because the page runs in two places: on GitHub Pages it can reach the API, while inside the claude.ai artifact viewer a strict CSP blocks all outside requests. The same file feature-detects and degrades honestly rather than filling the gap with a plausible number.

### Why the split

Carrier and kickoff time resolve on completely different timelines. Most Canadian deals are all-or-nothing exclusives, so *where* a January fixture lands is knowable in August. *When* is not: Premier League TV picks land about six weeks out, and NFL flex moves come with 12 days' notice, dropping to 6 late in the season. The page shows a confident carrier next to an honest `Time TBC`.

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
