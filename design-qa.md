# Game Day North iOS header / What's on design QA

Date: 2026-09-09

## Visual truth

- Pre-change iPhone Simulator capture: `/private/tmp/gdn-audit-ios-safe-area/01-current-simulator.png`
- Selected implementation target: `/Users/patrick/.codex/generated_images/01a087cd-16f2-7d52-9b3f-0c488ab5eb5b/exec-18585deb-f526-4b8c-ade8-50d47721cece.png`
- Implemented source: `src/page.html`
- Built web output: `index.html`
- Synced iOS web bundle: `ios/App/App/public/`

## Viewports and states checked

- 390 × 844 responsive viewport, team picker open, live committed fixture data loaded.
  Capture: `/private/tmp/gdn-qa-390-final.png`.
- 320 × 844 narrow-phone viewport, normal list state.
  Capture: `/private/tmp/gdn-320-final.png`.
- Side-by-side target / implementation comparison:
  `/private/tmp/gdn-comparison-final.png`.

The browser reserves 15 px for its desktop scrollbar, so the measured content
widths were 375 px and 305 px respectively. In both states the document scroll
width equalled the content width: no horizontal page overflow. The What's on
strip scrolls independently when its full matchup text needs more room.

## Visual comparison

- The header keeps the existing Game Day North type, colours, controls and
  compact two-row phone treatment.
- The mobile padding no longer overrides the shared horizontal gutter.
- `safe-area-inset-top`, `safe-area-inset-left` and `safe-area-inset-right` are
  reserved in the shipped CSS for the iOS WebView.
- “What's on” is on the light page surface above the dark strip.
- The strip contains full matchup names and quiet, trustworthy times only.
  It contains no scores, result status, league icon, carrier or service name.
- Cycling labels are race name plus stage. A cycling time is omitted when the
  source does not know it.
- The selected mock shows three illustrative fixtures. The live fixture data
  had one unfinished followed fixture by the end of QA; finished fixtures were
  correctly absent rather than retained to mimic the mock.
- Browser screenshots do not expose an iOS native safe-area inset. The final
  Dynamic Island spacing therefore still needs one native Xcode run after the
  synced web assets are picked up.

## Interaction and accessibility checks

- My teams opens the team picker and preserves the existing selection count.
- List and Calendar continue to switch views and update pressed state.
- A What's on item switches Calendar back to List when needed, scrolls to the
  matching full schedule row, moves programmatic focus there and briefly
  highlights it.
- The 390 px jump test focused the exact matching `data-game-id` row.
- Each strip item has a descriptive “Jump to … in the schedule” accessible
  name.
- Browser console warnings/errors: none.

## Iteration history

1. Replaced the duplicate score cards with a names-and-times strip.
2. Moved the What's on label outside the dark strip.
3. Added iOS safe-area padding and restored horizontal gutters erased by the
   former mobile padding shorthand.
4. Tightened vertical header spacing.
5. Compressed the 320 px controls and removed the segment's auto margin so the
   Services control stays on the second row.
6. Hid the rail scrollbar while retaining touch/trackpad horizontal scrolling.

## Verification status

- Automated tests: 870 passed, 0 failed.
- Web build: passed.
- Capacitor iOS asset build/sync: passed.
- Responsive browser comparison and interactions: passed.
- Updated native simulator capture: pending. The command-line environment
  cannot reach CoreSimulatorService / SwiftPM's nested sandbox; Xcode itself is
  already open and can run the synced build.

final result: blocked — final native safe-area confirmation requires pressing
Run in Xcode and checking the refreshed iPhone 17 Pro simulator screen.
