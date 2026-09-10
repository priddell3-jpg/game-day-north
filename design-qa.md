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

# Followed races / follow drawer / saved-game design QA

Date: 2026-09-10

## Viewports and states checked

- 390 × 844, normal list state: `/private/tmp/gdn-design-audit/01-top.png`.
- 390 × 844, reorganized follow drawer: `/private/tmp/gdn-design-audit/02-follow-drawer.png`.
- 390 × 844, AL Wild Card followed: `/private/tmp/gdn-design-audit/03-race-followed.png`.
- 320 × 800, narrow list state: `/private/tmp/gdn-design-audit/04-narrow.png`.
- The user's cramped Race-to-date screenshot and the rebuilt 390 px list were
  inspected together. The new measured gap is 18 px.

## Behaviour and interaction checks

- My Teams remains visible at the top of the drawer. League lists, playoff
  races, rugby, tennis and the share link are compact expandable rows.
- Expanding a row and changing a preference keeps that row open through the
  redraw.
- Following the AL Wild Card includes its three current teams within 3.5
  published games of the line. The drawer says `1 race followed`; the header
  and saved My Teams set remain at five.
- Race-added fixtures appear in the schedule with an `In followed race` label.
- Saving the 12:07 PM Blue Jays game moved it above the unsaved 7:00 AM game
  on the same date. Removing the save restored chronological order.
- The What's On strip kept live/upcoming/finished priority rather than being
  reordered by a saved game.
- Both 390 px and 320 px states had no horizontal page overflow. Browser
  console warnings/errors: none.

## Build verification

- Automated tests: 883 passed, 0 failed.
- Web build: passed.
- Capacitor iOS asset build/sync: passed.
- Bundled iOS `public/index.html` and the generated native `dist/index.html`:
  byte-for-byte identical.
- Command-line native compilation could not access the host Simulator service
  under the Codex filesystem sandbox. The already-open Xcode project remains
  the final native launch check.

final result: passed, with native launch to be confirmed in Xcode

---

# Compact header, swipe agenda and adaptive context strip design QA

Date: 2026-09-10

## Visual truth

- Approved direction: `/Users/patrick/.codex/generated_images/01a087cd-16f2-7d52-9b3f-0c488ab5eb5b/exec-7589a905-d9b8-4d9d-8ddd-eb5302c225d2.png`.
- Final 390 × 844 implementation: `/private/tmp/gdn-redesign-final-390.png`.
- Same-input comparison: `/private/tmp/gdn-design-compare.png`.
- Final 320 × 844 implementation: `/private/tmp/gdn-redesign-final-320.png`.
- Open states checked separately: title menu, sports filter, one-race panel,
  and Recent results with five existing production game cards.

The reference pictured a live four-game day; the current feed had no personal
game on September 10, so the implementation comparison shows the designed
zero-today fallback and the next known fixture instead. Live-rail styling and
ordering are covered by the same render path and automated checks.

## Visual comparison

- The header is now one line at both widths: title/menu trigger, score control,
  and List/Calendar switch. The full title fits at 390 px; the score label gives
  way to its accessible eye control at 320 px.
- My Teams and My Services moved into a compact title menu with their current
  counts. The existing full-width drawers remain unchanged behind those rows.
- What's On is a light, horizontally swipeable set of matchup cards. Cards use
  names, sport and time/status only. A live item gets the sole strong red badge,
  a light warm fill and a quiet red border; scores and team icons stay out.
- All sports, In the Race and Recent results share one compact strip. All three
  labels remain one line at 390 and 320 px. When a race is unavailable, the
  remaining controls divide the available width automatically.
- The one available race opens inline without pushing a selector above it.
  Multiple-race markup includes a horizontal selector and the closed label adds
  `+N`.
- Recent results opens inline and reuses the existing game-card renderer. Team
  icons, records, scores, Listed badges, carriers, venues and save controls
  therefore remain identical to the main schedule.
- The detailed game layout was not redesigned. Live rows now use only a very
  light warm surface tint; the previous red left border was removed.
- No horizontal page or header overflow was measured at either phone width.

## Behaviour and interaction checks

- Title menu opens, closes on outside press/Escape, and closes when either setup
  drawer opens. Opening one setup drawer still closes the other.
- Sports, race and results controls are mutually exclusive and retain the
  existing stored race/results open preferences.
- The race control is absent when there is no valid active race or scores are
  hidden. One race shows its short status; multiple races expose a selector.
- Recent results respects the score-visibility setting because it continues to
  use the production row renderer.
- Tennis's top-draw explanation moved beside the first tennis day as a compact
  press disclosure; tennis match rows were not changed.
- What's On still sorts live, upcoming and finished items, keeps finished games
  for the local day, and jumps to the exact detailed row. The See all action
  uses that same jump path.
- Save/bookmark ordering, localStorage preferences, share links, external-link
  routing, offline schedule cache and strict native host rules remain covered by
  the passing suite.
- Browser console errors: none.

## Build verification

- Automated tests: 891 passed, 0 failed.
- Web build: passed; `index.html` regenerated from the shared source.
- Capacitor asset build and iOS copy: passed; the same rebuilt interface is in
  `ios/App/App/public/`.
- Command-line Xcode launch remains blocked by Codex access to the host's
  CoreSimulator/SwiftPM cache folders. The project was already running in the
  user's Xcode simulator before this visual pass and is ready to rerun there.

final result: passed

---

# Focused team and service setup design QA

Date: 2026-09-10

## Interaction result

- Opening My Teams now enters a focused setup state. What's On, the score
  control, the List/Calendar control and the schedule are removed from view;
  `Choose what to follow` begins directly below the sticky header.
- The right side of the header becomes a single `Done` action. Pressing it
  restores the score and view controls, What's On and the schedule without
  changing any selection made in the picker.
- My Services uses the same focused state and is headed `Choose your services`.
- Followed tennis now appears in the top `Following` group with its active
  tour names and a one-press remove action. The existing player stars remain
  stored if tennis is switched back on later.
- Outside setup mode, What's On has a slightly darker surface and bottom rule
  so it reads as a distinct region above the schedule.

## Phone-width verification

- Verified at 390 x 844: My Teams showed only Game Day North and Done in the
  header; score, calendar, What's On and the schedule were not visible.
- Done restored all four normal-view elements. The same replacement was then
  verified for My Services.
- Switched ATP on temporarily, verified `Tennis · ATP · x` appeared in the
  top Following group, used it to switch tennis off, and confirmed it vanished.
- No horizontal page overflow. Browser console warnings/errors: none.

## Build verification

- Automated tests: 895 passed, 0 failed.
- Web build: passed; `index.html` regenerated from the shared source.
- Capacitor asset build and iOS copy: passed; bundled `public/index.html` is
  byte-for-byte identical to the generated native build.
- The host simulator service and SwiftPM diagnostic cache remain inaccessible
  to the command-line sandbox. The refreshed Xcode project is ready for the
  existing interactive simulator to run.

final result: passed, with native relaunch to be confirmed in Xcode
