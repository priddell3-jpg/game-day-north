# Game Day North What's On / competition disclosure design QA

Date: 2026-09-09

## Visual truth

- User's current iPhone baseline: `/Users/patrick/Desktop/Screenshot 2026-09-09 at 3.45.22 PM.png`
- Implemented source: `src/page.html`
- Built web output: `index.html`
- Synced iOS web bundle: `ios/App/App/public/`

## Viewports and states checked

- 390 × 844 responsive viewport, normal list state with the competition
  disclosure collapsed. Capture: `/private/tmp/gdn-rail-390-final.png`.
- 390 × 844 responsive viewport with the competition disclosure open.
  Capture: `/private/tmp/gdn-filters-open-390.png`.
- 320 × 844 narrow-phone viewport, normal list state.
  Capture: `/private/tmp/gdn-rail-320-top.png`.
- The supplied iPhone baseline and the 390 px implementation capture were
  inspected together in the same comparison input.

The in-app browser reserves 15 px for its scrollbar, so the measured page
content widths were 375 px and 305 px. The document scroll width did not exceed
either content width. The What's On strip has 901 px of content in a 347 px
rail at 390 px, and in a 277 px rail at 320 px, confirming independent manual
horizontal scrolling without horizontal page overflow.

## Visual comparison

- The header retains the existing Game Day North identity and compact two-row
  control treatment, while staying legible at 320 px.
- The What's On label remains on the light surface and the swipe rail remains a
  single, compact dark band.
- Rail items show matchup names and one quiet state label only: start time,
  Live, or Final/finished. They do not duplicate scores, carrier names, service
  names, competition icons, or team badges.
- Cycling uses the existing race name plus stage label.
- The permanently expanded competition chips from the baseline are replaced by
  one compact `Competitions / All 7 showing / Change` row. Opening it exposes
  the same multi-select chips and clear/show-all control.
- The compact row gives the schedule more room while keeping competition
  filtering discoverable. Border, radius, colour, type and spacing continue to
  use the app's existing visual system.

## Behaviour and interaction checks

- Today's personal events remain in the rail after completion. Ordering is Live
  first, upcoming chronologically next, then finished events with the most
  recently finished closest to the unfinished group.
- The count reports all personal events happening today, not only live events.
- The rail is based on the user's followed schedule and is independent of the
  temporary competition filter.
- Hiding MLS removed MLS rows from the schedule but left the followed MLS rail
  item visible. Tapping that rail item restored MLS, jumped to the exact game
  row, moved focus there and applied the brief highlight.
- List/Calendar, score visibility, team selection, service selection and the
  existing competition multi-select remain operational.
- Competition open/closed state is preserved while the list rerenders.
- Browser console warnings/errors: none.

## Build verification

- Automated tests: 875 passed, 0 failed.
- Web build: passed.
- Capacitor iOS asset build/sync: passed.
- Built web `dist/index.html` and bundled iOS `public/index.html`: byte-for-byte
  identical.
- Responsive visual comparison and interaction checks: passed.
- The final native Dynamic Island/safe-area check should be done by pressing Run
  in the already-open Xcode project; the shipped safe-area CSS is unchanged.

final result: passed
