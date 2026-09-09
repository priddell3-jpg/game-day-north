# How this app should model sports that aren't teams

**Status: the tennis branch is paused, not cancelled.** Nothing is merged; `main` is
untouched. This note records what the experiment established and recommends the model to
build on.

---

## The branch, and how to unwind it

`feature/tennis-mvp`, PR #1 (draft), also tagged **`experiment/tennis-mvp-v1`** so the work
survives even if the branch is deleted or rebased.

**It ships dark.** Tennis is switched on by adding a tour to `gdn.tennisTours`, which starts
empty. Verified in a browser with storage cleared: a first-time visitor makes **zero**
`/api/tennis` requests and sees no tennis row, no ATP/WTA chip and no picker section. The
empty set is the feature flag; there is no second switch to add.

Almost all of it is additive — new files (`scripts/lib/tennis.mjs`, `api/tennis.js`, four
test files, three fixtures), new CSS selectors, new `COMPS`/`RIGHTS`/`SRC` rows that other
sports never match. Four things touch shared code and are what a revert has to think about:

| Shared change | If tennis is removed |
| --- | --- |
| `matchupLabel()` — names who is playing, any sport | Keep. Works for teams and cycling on its own. |
| `railCard()` extracted, each card in a `try` | Keep. One bad card can no longer blank the whole rail. |
| Rail ordering reads the match for tennis | Revert to the inline `stateOf()` version. |
| State keys `tennisTours` / `tennisEvents`, `keptFrom()` | Remove with the feature. |

**Two commits on this branch are not tennis and should not be held hostage by it:**
`023991a` and `a92f2b3` fix the CI trigger — a pull request whose branch conflicts with its
base silently runs no workflow at all, which is why PR #1 ran no tests for a day — and stop
the refresh job committing to feature branches. Those are worth cherry-picking to `main`
whatever happens to tennis.

---

## What the data actually looks like

Measured against live ESPN payloads, not assumed.

| | Tennis | UFC | Cycling | Team sports |
| --- | --- | --- | --- | --- |
| Nesting | event → grouping → competition | event → competition | race → stage | one event per game |
| Events live at once | 4 | 1 | a few | — |
| Items per event | 28–153 | 1–13 | ~21 stages | 1 |
| Useful lookahead | **~2 days** | a full month, populated | a full season | a full season |
| Raw payload | 1.94 MB | 21 KB | — | — |
| Is the event a household name? | Slams yes, the rest no | **yes** — "UFC 331: Van vs. Pantoja 2" | yes | — |

Two numbers decide the argument. A UFC card is **1–13 fights** and the whole of September is
**9 events, 48 fights, 21 KB** — an event-first view is simply a list of things people
already say out loud. A Grand Slam is **153 singles matches in one event**, and tennis
publishes draws only about two days ahead, so there is no honest "what's on next month" to
show at all.

---

## The recommendation: hybrid, with a deliberate asymmetry

**Select by the thing that has a schedule. Star the people.**

Not player-first, not event-first — the two axes do different jobs and should not compete.

### Why not player-first

It is what the branch built first, and it was wrong. It fails at the front door: answering
*what tennis is on today* required already knowing a name. It also produces an empty board
for most of the year, because a player is in a draw perhaps twenty weeks in fifty-two, and a
fighter appears two or three times. The app's other sports never do this — a team plays all
season.

### Why not event-first alone

It is right for discovery and wrong for allegiance. It works beautifully for UFC and for
cycling. It strains exactly where tennis is most interesting: "All Tennis" during US Open
qualifying is **96 matches in one day**, which buries every other sport on the board and
gives no way to say *but I care about this one person in it*.

### The asymmetry that resolves it

The app already follows **things that have their own schedule** — a team, a competition, an
event, a race. A person does not have a schedule; they appear inside other things'
schedules, sporadically. So:

- **`follows`** — schedule-bearing ids: teams, competitions, tournaments, fight cards.
  These decide *what is on the board*.
- **`stars`** — participant ids: players, fighters, riders. These decide *what stands out
  on it*. Pin to the top of their day, highlight the row, drive alerts. **They never filter.**

Starring can never empty the board, and following never requires knowing a name.

**The clinching argument is the app's own premise.** This page exists to answer *where can I
watch it*, and **broadcast rights attach to competitions and events, never to people**. The
tennis rights table already keys on tournament, because that is the only thing it can key
on. The axis you select along should be the axis the answer lives on.

### What it costs

Little, because it is mostly already built:

- Cycling already works this way — the race is schedule-bearing, riders appear in podiums.
- Tennis is one rename away: `tennisTours`/`tennisEvents` become the general `follows` set.
- The starring layer is new but small, sport-agnostic, and purely presentational — no
  fetching, no filtering, no per-sport logic.

### UFC, concretely

UFC is **easier than tennis**, not harder: no grouping layer, ~10 fights per card, month
lookahead that is actually populated, and a 21 KB payload that needs no server-side
reduction at all. The event names are the product. Following "UFC" as a competition gives a
correct, complete, human-sized board on day one; starring a fighter then pins their bout
within the card. The parser is strictly simpler than the tennis one already written.

The order I would build in: **UFC next, not more tennis.** It validates the model on the
easy case, and the starring layer it needs is the same layer that fixes tennis's
Slam-swamping problem.

---

## Open questions this note does not settle

- Whether starring should also apply to team sports (star a player, pin their club's games).
- Whether a very large event should collapse under a header in the day list — the 96-match
  problem is real whatever the selection model, and grouping may solve it more cheaply than
  filtering does.
- Canadian carriage for UFC is unverified. Tennis already resolves most WTA and non-US-Open
  Slam coverage to **Coverage TBD**; UFC would need its own primary-source pass before any
  service badge is shown.
