# Game Day North

A single-page tracker for which of your teams are playing, and **which Canadian service each game is actually on**.

Schedules are easy to find. "Where is this on, in Canada?" is not — no sports API publishes Canadian broadcast rights, and the deals change between seasons. This page treats that as the hard problem and is honest about how much it knows.

## What it does

- **Multiple teams at once**, across NHL, NBA, NFL, MLB, MLS, the Premier League and UEFA club competitions
- **Men's international rugby union** as a single follow — the Six Nations, the Nations Championship, the Pacific Nations Cup, test matches and Lions Tests, with nations you can star
- **Tennis as a sport** — switch on ATP or WTA and see what is being played, narrowed to a tournament if you want, with set scores, round and court, and players you can star
- **Where to watch** per game — Sportsnet, TSN, Prime Video, Fubo, DAZN, Apple TV, RDS, TVA Sports, CTV, MLB.TV, NBA League Pass, Premier Sports
- **Coverage check** — mark the services you subscribe to under **My services** in the header, and every game is flagged *You have it* or *Needs DAZN*
- **Scores with a global on/off switch**, spoiler-safe: a hidden game still shows that it's live and where it's carried, with a per-game reveal
- **In the Race** — a collapsed strip under recent results: where your club sits against the line that decides its season, opening into the places either side of it
- **Agenda by day and a month calendar**, league-coloured
- **Honest unknowns** — `Time TBC` with the date it gets confirmed, `Opponent TBD` with the draw date, `Carrier TBC` where no Canadian rights holder could be verified, and no location at all where the source states none

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

## Rugby is followed by competition, not by team

Every other sport here starts from "which teams do you follow". International
rugby does not: there are ten or so relevant nations, they play in windows a
few weeks long, and the question is *what internationals are on*, not *when
does my team play*. So rugby is one switch — **Men's International Rugby** —
and turning it on shows every supported fixture.

Nations can be **starred**, which marks them and nothing else. Starring
Ireland does not hide New Zealand v South Africa. That is the whole point of
the separation, and it is why the star set lives apart from the team
selection: it is also where per-nation notifications will read from when
they exist.

Rugby is **off unless you ask for it**. It is not in the default set, no
existing link or stored preference can turn it on, and with it off the page
makes no rugby request of any kind.

### What is in scope

Senior men's fifteen-a-side international rugby union: the Men's Six
Nations, the Nations Championship, the World Rugby Nations Cup, the Pacific
Nations Cup, The Rugby Championship and the Rugby World Cup when they are
scheduled, official test matches, and British & Irish Lions **Tests**.

Not in scope, and actively filtered out: club and domestic rugby, women's
rugby, sevens, rugby league, U20 and age-grade, and uncapped or invitational
XV fixtures.

That filtering is harder than it sounds, because **neither source flags
it**. ESPN's British and Irish Lions league carries ten fixtures of which
four are Tests; the other six are Super Rugby clubs and two invitational
sides, filed under the same competition with nothing to tell them apart.
World Rugby's "Rugby's Greatest Rivalry" is the same shape. So a fixture is
a test only when **both sides resolve in a registry of test-playing
nations** — and a name that is neither a nation nor a recognised non-test
side is reported loudly rather than dropped, because that is how a feed
renaming a country gets noticed.

Two traps worth naming, both real:

- **"Lions" is a South African franchise.** The Johannesburg Lions play New
  Zealand three days after the actual Test, in the same feed. The touring
  side is matched on its full name and never on the word alone.
- **"Argentina XV" is not Argentina.** Uncapped XV sides appear in the
  men's international bucket, so no suffix-trimming rule may ever be applied
  to a rugby name — the club-name helper elsewhere in this repo would turn
  one straight into the other.

### Two sources, kept independent

| Source | Carries |
| --- | --- |
| ESPN's numeric rugby leagues | Six Nations, Nations Championship, Rugby Championship, Rugby World Cup, Lions Tour, International Test Match |
| World Rugby's own match feed | Pacific Nations Cup and World Rugby Nations Cup, which ESPN has no league for at all, plus the Nations Championship finals weekend that ESPN's copy omits |

Neither may suppress the other. Each is fetched and parsed on its own, a
failure in one is recorded rather than thrown, and a competition reachable
through only one source still appears when the other is unreachable. What
could not be reached is **reported as unavailable** — which is a different
claim from a competition that answered with nothing. The Rugby Championship
publishes no 2026 fixtures under its own ESPN league; that is an empty
competition, not a broken one, and the build says so.

Fixtures are merged on **the source's own event id first**. Those ids are
authoritative only within the source that minted them — ESPN says `603247`
where World Rugby says a UUID — so they are namespaced, two ids from the
*same* source never merge however alike the fixtures look, and only where
the namespaces do not overlap does the fallback apply: both nations, plus
kickoffs within six hours. Nations alone is not enough, because South Africa
play New Zealand three times in four weeks.

Where the two disagree, the more specific competition wins over the
catch-all test bucket, and **World Rugby's venue wins** — ESPN files the
Perth Test as "Perth, Scotland" and the Jujuy Test as "San Salvador, El
Salvador", because `address.state` is a US field being made to hold a
country.

They also sometimes disagree about the **kickoff itself**, by fifteen to
sixty minutes. ESPN's reading is the one shown, because it agreed with World
Rugby on every fixture already played and is self-consistent across a series
where World Rugby is not — but that is a judgement, so the other reading is
kept on the fixture as `altStart` and counted in the build log rather than
discarded.

### Time, and the international date line

Every kickoff is stored as one absolute UTC instant, and every question
about a *day* is asked of `Intl` for the zone it is being asked about. No
offset is ever baked: Vancouver is UTC-8 for part of the year and UTC-7 for
the rest, which is why the label is **PT** and never "PST".

A Saturday afternoon in Auckland is Friday evening in Vancouver, and both
are true. The page groups the fixture under the reader's day — correctly —
and adds a short note saying whose Saturday it was: *Sat in Nigata*. That
note appears only where the two calendars actually differ, and only where
the venue's own UTC offset is known, because guessing one is how a fixture
ends up labelled with the wrong day in the wrong city.

### What is kept

Completed matches for the previous **three local calendar days**, upcoming
ones for at most **ninety**. Whole calendar days, walked with the local-date
setters rather than by subtracting seventy-two hours: on the two days a year
the clocks move, a flat subtraction lands at 23:00 and takes an extra day of
results with it.

Anything **unresolved is kept regardless of age**. A match abandoned
mid-second-half and never resolved is precisely the fixture someone is still
looking for, and age is not what should retire it.

Because "three local days" starts twenty-one hours earlier in Auckland than
in Vancouver and the build does not know where the reader is, the committed
file keeps a deliberate superset and the browser applies the exact rule.

### Following a rugby match that is on

The existing sixty-second model, with one competition-shaped difference:
rugby is polled because rugby is switched on, not because a followed nation
is playing. Starring Ireland must not stop the page following Argentina v
Australia.

**Nothing here reads a clock.** Eighty minutes of rugby routinely takes a
hundred, extra time is normal in a knockout, and a match can be stopped and
restarted — so a fixture is over only when the source says `completed`, an
unrecognised status reads as *unresolved* rather than as a result, and a
match past its kickoff that the feed still calls scheduled is exactly the
one worth asking about again. Half-time, delays and suspensions all keep the
poll running.

The two sources are asked separately here too, so a World Rugby outage
cannot cost the Six Nations its live scores — and a rugby failure is caught
on its own and can never set `liveOK`, which is the page's claim about
whether the *sports* API answered. There is no Vercel cron; the existing
GitHub Actions refresh is what rebuilds the file.

One quirk carried over from the other sports and confirmed for rugby:
**ESPN files a rugby event under its US Eastern date.** A 00:00 UTC kickoff
answers to the previous day, and asking for the UTC date returns an empty
scoreboard.

### Canadian carriage

Modelled per competition and never per nation — Ireland appear in the Six
Nations, the Nations Championship and a summer tour test, and a rule keyed
on "Ireland" would get two of those three wrong.

| Competition | Canada | Confidence |
| --- | --- | --- |
| Men's Six Nations | Premier Sports | confirmed |
| Nations Championship | Premier Sports | confirmed |
| Quilter Autumn Nations Series | DAZN | confirmed |
| British & Irish Lions | — | unknown |
| Everything else | — | unknown |

The 2025 Lions tour was on DAZN in Canada. That is a fact about 2025 and not
about the next tour, which is sold separately and has no announced Canadian
carriage, so it is recorded as **unknown** with the old listing named in the
note rather than carried forward. Anything unverified shows **Coverage TBD**
and is never marked *You have it*.

## Race — why a game matters

Three questions, one page. **Games** is what is happening, **Where to watch**
is where you can see it, and **Race** is why it is worth watching at all.

A Race card is never a standings table. It shows the line that decides a
season — the last wild card, the fourth Champions League place, the last safe
position above relegation — with the places either side of it and the clubs
you follow. A button opens the full table for anyone who wants it. On a phone
a card is four or five rows.

The section sits **under recent results and above the schedule**, and it
arrives **shut**. Closed it costs one row, and that row does the work:

```
In the Race   2 RELEVANT
Blue Jays 1.5 back · Liverpool 2 pts from the UCL places
```

Whether it is open is remembered. Which cards are expanded to a full table is
not — that is a momentary "let me see the rest" rather than a preference.

### It appears because of your teams, not because standings exist

Standings exist all year for every league and almost none of that is worth a
place on your schedule. Visibility is one table of season-progress bands,
applied to every competition rather than written per league. Progress is games
played over season length, never a calendar date, so the rule is the
competition's own shape.

| Band | Season played | Behaviour |
| --- | --- | --- |
| early | under a quarter | Auto shows nothing at all |
| mid | a quarter | a club within **2** places of the line |
| late | three fifths | within **3** places |
| final | seven eighths | within **4**, and a race may stand on its own |

So three matches into a Premier League season nothing is drawn, however close
the table looks; by the run-in the title, the Champions League places, Europe
and relegation are all in scope. Following one hockey team shows no baseball
table, and a club that has played no matches is not in a race yet whatever
position a freshly seeded table gives it.

### One primary race per club, chosen by value

A club near the foot of a table is in a relegation battle. It is not also in
the title race merely because the two share a table, and listing both is
noise. So each followed club claims **one** race, and a card survives only if
some club claimed it, or it was pinned, or the closing weeks make it worth
watching on its own.

Distance decides which races a club is *in*. It is a poor guide to which one
matters, because a club fifth in the Premier League sits exactly on the Europa
line and one place off the Champions League line — and the story is the place
it is chasing, not the one it is standing on. So each race carries a declared
value and the most valuable of the close ones wins:

| Premier League race | Value | In Auto |
| --- | --- | --- |
| Relegation battle | 1 | yes |
| Title race | 2 | yes |
| Champions League places | 3 | yes |
| European places | 4 | **no — pin only** |

Value cannot reach past a line a club is standing on: a race more than two
places further away than the nearest one is not competing on value at all,
which is what stops the title race claiming a club that is level with the
Champions League cutoff four places below it. The same two numbers order the
board, so when the caps bite it is the least valuable race that goes.

Every competition declares its own values in the same table — survival before
the prize at the top, the prize before the places under it — so nothing here
is a rule about one league.

A card then shows the clubs it is actually for, not every club you follow in
that table. Showing all of them produced a relegation card that opened on the
league leader with two rows of ellipsis before reaching the actual fight. A
club whose own race did not survive the caps joins the nearest surviving one
rather than disappearing. At most two cards per competition and four in total.

### Auto, pin, hide

The default is Auto and needs no setting up. Inside the open section a
**Customize** list offers every race you could have, for the competitions you
follow, with three states each:

- **Auto** — the bands and values above decide.
- **Pin** — show it whenever there is a table to draw. A pin overrides the
  season phase and the Auto exclusions; it cannot invent standings nobody has
  played for. This is how the European places are seen.
- **Hide** — never show it.

A race Auto never surfaces says so in the list, so one that does not appear is
a decision rather than a mystery.

Preferences live in `gdn.races.prefs`, keyed on the stable race id, so hiding
the European places stays hidden when the zone that defines its line moves
from fifth to eighth. They are kept well away from team selection: changing
one never changes which teams you follow. A hidden race keeps its row in the
list, because otherwise there is no way back.

### Cutoffs are read from the source wherever the source states one

How many places qualify is not a constant. The Premier League sent **five**
clubs to the Champions League in 2025-26 and sends **four** in 2026-27, and
both numbers are in this repo's test fixtures precisely so that neither can be
hardcoded. So:

| Race | Where the line comes from |
| --- | --- |
| Champions League places, European places, relegation | ESPN's own per-position qualification notes |
| Champions League top 8 and top 24 | the same notes, read as a run of qualifying zones from the top |
| MLB wild card | the published games-behind column, which is measured *against the line* — the club reading `-` is the line |
| NFL division races | the same column, which in a division measures against the lead |
| NFL playoff places, top seed | **the only hand-held numbers**, carried with a note and a checked date the way a rights row is |

Every card says underneath it which of these it used.

### A zone label describes a position, not a team

At matchday one the Champions League table labels ranks 25 to 36 **Eliminated**
— and six of those clubs have played no match at all. The label is true about
the position and false about the club, so labels are used to find where a line
falls and are **never printed against a club**. The one per-team verdict shown
is ESPN's clinch letter, because that one is published per team; a letter that
is not in the known set is shown as nothing rather than guessed at.

### A carried table says that it is carried

If a standings source misses a run, its last good answer is kept so that one
outage does not empty the board. That kindness has a hard end at **48 hours**,
which is the same number in the build and in the page, so the file never ships
a group the page would refuse to draw and nobody is ever looking at standings
older than that however long a source stays down.

Below that limit the card is drawn, and it says on its face what it is: an
amber **Not current** chip with how long ago the table was actually read, and
a line under it saying this is where the table stood, not where it stands. If
the leading card is a carried one, the shut panel's headline says so too,
because a headline read at a glance is exactly where a stale figure would pass
for a live one. The age is measured from the last time the source answered,
not the last time the build ran, so a group cannot be quietly refreshed into
looking new.

A new season ends it immediately, whatever the age. A league answering in
February with a table nothing has been played in produces no usable group and
looks exactly like an outage, and carrying last season's final table into that
gap would be the most confident wrong answer this app could give.

### When there is nothing to say, it says nothing

A competition whose standings are missing, unreadable, or older than the
browser is willing to trust produces **no card** — not a card announcing a
problem. The home page has one job and an error panel is not it. The build
records what it could not read in `counts.standingsUnavailable`, which is
where a fuller standings view will surface it later.

The section is also hidden entirely while **scores are off**. Every figure in
it is a result, and a table that moved overnight tells you the outcome as
surely as a scoreline does.

### How it is built

`scripts/lib/race.mjs` normalises a standings payload into groups; the build
writes them to `data.json` under `standings`, structurally separate from the
fixtures and sharing nothing with them but the team id. No browser asks a
standings endpoint. Six requests per build cover four competitions, and the
volatile figures ESPN publishes beside them — playoff percentages, magic
numbers — are deliberately not read, because they move on every run whether or
not a game has been played and would put a commit and a site rebuild on the
schedule rather than on the results.

Adding the NHL, the NBA or MLS is a row in `RACE_SOURCES` and a row in the
page's `RACES` table. Nothing else changes.

## Data

**Every fixture on this page is a real one.** There is no schedule generator: what you see came from a published feed, and where the feed has nothing, the page shows nothing.

Sources, in precedence order:

1. **`data.json`, built by a scheduled GitHub Action.** One machine talks to the sports API every three hours and commits the result, so an ordinary visit is a single request to this repo's own domain. One ranged request covers a whole competition's window — 25 requests for the entire file, where per-team season schedules took 125 — and a competition that vanishes between runs stops the build rather than publishing a file with a league missing. See `scripts/fetch-data.mjs`.
2. **Live top-up.** Anything in progress is read straight from ESPN, because a file rebuilt every thirty minutes cannot follow a game.
3. **Direct fetch**, if `data.json` is missing or more than 90 minutes old — a stalled job degrades to the old behaviour rather than an empty page.
4. **`LIVE_FIXTURES`** — a small hand-checked set with Canadian listings, for when nothing can be reached.
5. **Remembered results** — a final score, once seen, is kept in that browser for a week, so a game you missed still shows its score when the feed is down. Each stored row carries the source's event id (store `v3`), so a recalled result meets the fed copy of the same fixture on the same primary key as everything else. A `v2` store is migrated rather than discarded — a row without an id reads correctly as a row that has none — and a store is deduplicated on load, which clears out the pairs written before the club comparison was fixed.

Canadian carriage always comes from the rights table, never from ESPN, whose broadcast data is US-facing.

**No code path invents a score or a fixture.** Where something can't be fetched, the page says so.

### Endpoint quirks worth knowing

Each of these cost real debugging time and is handled in both the client and the build script:

- A game is filed under its **US Eastern date**. A 7:05pm EDT game is the 21st to ESPN and the 22nd in UTC; ask for the wrong one and the day comes back empty.
- The **season schedule carries no live score**, and omits games entirely. A finished game can read `STATUS_SCHEDULED` 0-0 there, so it is queried for fixtures and never trusted for a result; the scoreboard supplies both, and the copy carrying a score wins.
- **A `YYYYMMDD-YYYYMMDD` range used to return only the first day. It no longer does.** Re-measured on 9 Sep 2026 against one request per day, by event id: baseball 273 against 273, the Premier League 30 against 30, the NFL 32 against 32, nothing missing. The whole fixture build now rests on that, so `scripts/check-range.mjs` re-checks it nightly and says so directly if it ever reverts.
- **`limit` is honoured to exactly 1000 and silently collapses to 25 above it**, so the most generous-looking value returns almost nothing. A response that comes back exactly full is indistinguishable from a truncated one, so it is never believed: the range is halved and asked again, and a single day still at the ceiling stops the build. Baseball needs this — 13 events a day league-wide is about 1,090 across the window.
- **A result is asked for by its own event id, not by the day it falls on.** The date scoreboard is one page for a whole day, so every score on that date depends on that page being complete, and a fixture missing from it is one nothing can settle — Royals at Blue Jays on 26 Aug 2026 sat at `scheduled` for hours after the final out while `summary?event=401816683` had the full result. Status and scores live under `header.competitions[0]`; the rest of the response — boxscore, play-by-play, odds, standings, 892 KB of it for one baseball game — is parsed and dropped. A summary states no venue there, filing one under `gameInfo`, so a top-up patches the fixture rather than replacing it and the venue already known survives. The date scoreboard is still queried: it discovers games the season schedule omits, and it is the only thing a fixture carrying no event id can be asked about.
- Sources fail independently. Out-of-season cup competitions 404 as a matter of course, and one of those must never be able to blank the rest of the page.
- A fixture and a scoreboard event are matched on **the source's own event id first**, never on team ids. The committed file mints a synthetic id for any club it could not map to the roster, so one club reads `feed:EPL:FUL` in the file and `ful` from ESPN; comparing those raw left a game showing as scheduled while it was live at 1-2. Team identity decides only which way round the score goes, and a score whose orientation cannot be established is dropped rather than guessed.
- **A fixture's location is a fact about the fixture, not the home club.** ESPN states `competitions[0].venue` on nearly every soccer and North American event — of 704 soccer fixtures in the file at full rosters, one carries none, a Champions League tie involving a club from a smaller association — on both the scoreboard and the per-team season schedule. That is what the location line uses. It previously read the home team's nominal city and showed it only when that city happened to differ textually from the club's name, which was wrong twice: an English club is usually named after its town, so `Liverpool` hosting at `Liverpool` compared equal and the line vanished while `Vancouver Whitecaps` kept it; and a club's city is not the match's location — the 2026 League Cup final is filed as "Manchester City at Arsenal" and played at Wembley. There is deliberately **no club-to-ground mapping**, because a mapping is exactly what breaks when a match moves. Stated by the source, or blank. ESPN's `team.location` is not a town for soccer (it reads "Ipswich Town", "New York City FC"); it is kept only because the roster matches against it.
- **A standings response is not in standings order.** Eliminated teams are hoisted to the front of the array: the American League list opens on a fifteenth seed, and a completed AFC season closes on the first. A group is ordered by a published seed, rank or games-behind figure, and one that has none of those is dropped rather than shown in the order it arrived — which is why the NFL shows no playoff picture in week one, when every seed is `0`.
- **The same stat name means different things in different standings views.** In the wild-card view the overall record is blank, division win percentage reads `0.000`, and games behind is measured against the third wild-card place with a *negative* value for a club holding a cushion. Each source in `RACE_SOURCES` records which view it reads.
- **The MLB response disagrees with itself about the season**, saying 2027 at the top of the payload while its own standings block says 2026. The standings block is the one read, and it is what stops last season's final table being carried over an empty new one during an outage.
- **A qualification colour can arrive malformed.** The Premier League's Europa League zone currently comes back as `##B5E7CE`, with two hashes. It is repaired if it can be, and dropped if it cannot.
- **`data.json` is served with `max-age=600`.** The page re-reads it every minute while a game is on, so it asks for a revalidation instead of accepting a copy the browser may hold for ten minutes — otherwise a score the scheduled job has already committed stays invisible. An unchanged file costs a 304 and no body; the API calls keep ordinary caching.

Where neither copy carries an event id, two fixtures count as the same game only when both clubs match **and** they start within four hours — not merely on the same date, or a baseball doubleheader would collapse into one game.

"Both clubs match" means **every name a club is known by**, not one id each. A single id could not answer it: the reader that resolves a club to the roster answers `kcr` and the reader that could not answer `feed:MLB:KC`, and those never compare equal. That is what put one game in Recent results twice — a live read and the committed file describing the same Royals fixture, neither of them wrong.

### What gets polled, and when

A live score is a number that changes, so following one means asking again. Asking too often is rude to a free endpoint and flattens a phone battery, so the rules are narrow and all in one place:

- Only fixtures involving a **followed team**, and only while **Scores on** is enabled — with scores hidden there is no number on screen to keep current.
- Every **60 seconds** while a fixture is active or its status is unknown. That deliberately includes halftime, delays, extra time, overtime and shootouts: ESPN reports all of them as `state: "in"`, and the page reads that field rather than trying to recognise each phase by name.
- **Nothing once ESPN says `completed: true` or `state: "post"`.** A final is asked about once and then left alone; the scheduled rebuild of `data.json` carries the rare post-final correction.
- **Elapsed time never ends a game.** A delay, extra innings and a postponement are indistinguishable from a clock, so only the source can say a game is over.
- **One refresh at a time.** The minute poll, the quarter-hour poll, the team picker and a returning tab can all ask at once; a caller that asks while a pass is running joins it rather than starting a second.
- **Paused while the tab is hidden**, with one immediate refresh when it comes back.
- **Cycling is never polled.** A stage podium is a result, not a live feed, and there is no live cycling source to poll; it arrives with the committed file.
- **Tennis polls on its own loop**, against `/api/tennis` rather than ESPN directly, and only for the tours that actually have a live or unresolved match in view. It follows the same rules otherwise: one request at a time, paused with the tab, stopped once the source calls a match final, retired or walkover. The team and cycling paths are untouched by it.

A fixture that has already been given a score is still polled while it is under way. Not doing that is what once froze a match at its halftime score for the rest of the night.

Each poll spends **at most eight summary requests and twelve scoreboard requests**. The two are not comparable — a summary buys one game and a scoreboard buys a whole day — so they are budgeted separately. Fixtures that have kicked off are asked about first, since a game that has not started cannot have a score; neither cap binds on an ordinary evening, and what reaches one is a backlog of finished games, which can wait a minute.

### What the list puts first

The page answers one question — what is on, and where can I watch it — so the
list is ordered to answer it and then get out of the way.

1. The welcome banner, for a first visit only.
2. The competition filters.
3. A one-line hint pointing at **My services**, until a first subscription is
   marked. Then never again.
4. **Recent results**, collapsed. Its summary is written to be useful while it
   is shut — "last 3 days · 4 games · 4 final scores" — so opening it is a
   choice rather than the only way to learn anything. That summary is
   spoiler-safe: **with scores hidden it counts games and stops**, because how
   many have a final score is itself a fact about the outcomes. Three settled
   out of four says the fourth was postponed, and a count that moves while a
   game is on says it just finished. Whether it is open is remembered per
   viewer in `localStorage`, under `gdn.results.open`.
5. The day sections, today first.
6. The rights table and the data note — reference, not answer.

Results used to sit below the schedule, which meant scrolling past every
fixture in the window to see last night's score, which is the thing people
check first in the morning.

**Configuration lives in the header.** *My teams* and *My services* are two
buttons side by side, each opening a full-width drawer under the header — one
at a time, because two of those strips open together leave a phone with no
schedule on screen. The services drawer holds the checkboxes with their
per-service game counts, the coverage summary ("47 of 76 games in the next 90
days are covered by what you have"), and the unconfirmed-carrier note. That
was a panel in the page body, below every fixture: it is set up once and then
almost never touched, which is exactly what should not occupy the answer to
"what is on tonight". The per-row *You have it* / *Needs X* chips are
unchanged.

At 320px the bar wraps to two rows: the wordmark and the view switch, then the
score eye and the two drawer buttons with their short labels. The score
toggle drops to its icon there and keeps an `aria-label`, since it is the
control that decides whether the page spoils a result.

### Knowing when the refresh has stopped

A dead cron looks exactly like a quiet week. On 27 August 2026 the **Refresh
fixtures** schedule stopped firing after 14:31 the previous day; every
workflow that did run was green, the site stayed up, and the only symptom was
a person eventually noticing a finished game still reading "scheduled".
Roughly eight runs were missed before anyone looked.

`.github/workflows/freshness-sentinel.yml` runs hourly and asks **the deployed
site** — not the repository — for `data.json`. A build that commits but never
deploys is the same outage seen from outside, and reading the committed file
would miss it. If `generated` is more than **seven hours** old, or the file is
unreachable or unreadable, it opens a single pinned issue labelled
`stale-data` and rewrites that issue's body on every subsequent check rather
than commenting again. It closes the issue once the served file is current.

Seven hours is two missed runs plus slack. It has to clear the build's own
`MAX_AGE`, which rewrites the stamp at six hours even when no fixture moved,
or the sentinel would be reporting the build working as designed; the tests
assert those numbers still agree with each other rather than that any one of
them is seven.

An alert nobody has watched fire is a hope rather than a safety net, and this
one cannot be exercised by waiting — it only opens an issue when the site is
genuinely stale, which is the thing it exists to prevent. So the workflow
takes a **`drill`** input: run it by hand with `drill` set and the threshold
drops to zero for that run, the alert opens and pins as it would in earnest,
and the next healthy hourly check closes it. A drill issue says so in its
first line and in its title, so that nobody reading the issue history later
takes a deliberate test for an outage that happened; if a real outage were to
reuse that issue, both are rewritten and it stops calling itself a drill. The
schedule cannot trigger a drill — `inputs.drill` is empty on a scheduled run.

The limit, stated because it would otherwise be mistaken for cover: the
sentinel is itself a scheduled workflow. It catches a refresh that has stopped
while Actions is otherwise working, which is the failure that happened. It
cannot catch GitHub's scheduler stopping altogether, because then it stops
too.

### Tennis is a sport, not a list of people

The question this has to answer is *what tennis is on today, and where can I watch it* — which nobody should have to know a player's name to ask. So the top level is the tour: switch on ATP, WTA or both, and the default from there is every tournament in them. Narrow to a tournament only if you want to. Players are **starred**, never selected, exactly as rugby nations are: a star marks a row, it never decides what is on the board.

**It ships dark.** With no tour switched on there are no rows, no chips and no tennis in the file a browser reads. Turning a tour on is a deliberate act.

ESPN publishes tennis as a tournament containing *groupings* — men's singles, women's doubles, mixed doubles — each containing the *competitions* that are the actual matches. That is a different shape from the one event per game every other sport answers, so it has its own parser in `scripts/lib/tennis.mjs` rather than the team parser being taught to guess.

Four things about that feed are load-bearing:

- **It is about 3.6 MB across the two tours**, and a Grand Slam is published in full under *both* — the US Open's men's singles matches appear identically in the ATP and the WTA scoreboard. Deduplicating by ESPN's competition id is the only thing that collapses them.
- **Every competition carries a `tournamentId`**, and the event's own id is `{tournamentId}-{season}`. That is what makes a tournament filter possible at all, and it is why the filter keys on the id rather than the name — sponsors rename these mid-season.
- **Most matches have no usable time.** ESPN says so itself with `timeValid: false`, and an unplayed third round carries a placeholder of midnight Eastern. The day is shown and the clock is not invented.
- **An unfilled slot in a draw is still published as a competitor**, with a negative athlete id and the name `TBD`. It is a placeholder, never a person, and a line with two of them is not a match at all.

Because of the size, the browser never reads that feed. The scheduled build does, keeps the singles, and writes a normalised block into `data.json` beside the fixtures — about **440 bytes a match**, so a Grand Slam day costs roughly 67 KB before compression. Tournament facts are described once in a `tournaments` list rather than repeated on every one of a Slam's hundreds of matches, and that same list is what the picker offers as a filter, so a filter can only ever offer something with matches behind it.

**Tennis keeps its own retention window**, deliberately narrower than the fixture window's eight days back and seventy-five forward. ESPN publishes singles draws about two days either side of today, so seventy-five days forward would be seventy-three days of nothing — false precision that makes the contract look richer than the data. Three days back is a payload decision of its own: a Slam day is 153 matches, and a longer tail buys mostly qualifying rounds nobody asked for. The two numbers are named constants in `scripts/lib/tennis.mjs` so they read as a decision rather than an oversight.

**The tournament list is what is being played this week, not a season calendar.** `?dates=YYYYMM` does return a month of tournaments, but the ones that have not started carry no matches, so they would be options that show nothing.

**Canadian coverage is modelled per tournament**, which is what the rights actually attach to. Two sources were checked — ATP's own broadcaster list (TSN for the tour, Sportsnet for the Canadian Masters) and the US Open's international broadcaster page (TSN and RDS). Neither covers the WTA tour, and a Grand Slam's rights are sold separately from the tour deal, so Melbourne, Paris, Wimbledon and every WTA event outside a Slam resolve to **Coverage TBD** rather than being assumed to follow the tour. Uncertain coverage is never counted as a service you have.

Only singles; no doubles, juniors, exhibitions or team competitions in this phase.

### Keeping the roster in step

`ROSTER` in `scripts/fetch-data.mjs` mirrors `TEAM_ROWS` in `src/page.html`. Add a team to one and add it to the other, or the picker will offer a team the build never fetches.

Rugby needs no such pairing: the nations offered for starring are derived
from the fixtures actually loaded, so the list cannot drift from the feed
and cannot offer a nation with nothing to show. The one list that does have
to be maintained is the nation registry in `scripts/lib/rugby.mjs`, and the
build warns loudly about any competitor name it could not place.

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
