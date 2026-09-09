# Phase 3 spec: the board and the handover sheet

Written by the lead (Fable). Port the prototype's `Board` and the app shell (`ERNavigatorTracker` bottom tab bar, floating "+ New case") one to one. Locked plan section 5.2 wins on permissions; the prototype wins on behaviour.

## Already in the repo

Phase 1 auth and shell, Phase 2 case editor and actions, `src/lib/domain/time.ts` (`elapsedHours`, `band`, `fmtHours`), tokens, the `Section`/`Chip`/`Button` components from Phase 2.

## Route and data

- `/` (every role) becomes the board. Server component loads cases for the chosen filter (`open` default, `resolved`, `all`; VOIDED never shows on the board) with the fields the rows need: mrn, registrationAt, status, departedAt, resolvedAt, primary reason name, department names (from consults), disposition, ward code, `createdAt`, latest `CaseUpdate.createdAt`. One query with `include`, no N+1.
- Sorting: by elapsed hours descending (`elapsedHours(c, now)`), computed on the server for the initial render and on the client on every tick.
- Search: MRN substring (digits only; non-digits stripped as the prototype does), client side over the loaded list; filters persist in the URL query (`?f=resolved&q=8515`) so a refresh keeps them.
- Polling: the client re-fetches every 30 s through a route handler `GET /api/board?f=...` that returns the same row shape as JSON (`cache-control: no-store`), and re-renders. `now` also ticks every 30 s so clocks move between fetches. No server-sent events in v1 (Phase 8).

## Rows (exactly the prototype's information design)

- Left 6 px band coloured by `band(elapsed)`; `none` → the neutral band token.
- Line 1: MRN (16 px, 700, tabular) and "reg dd/mm HH:mm" (12 px muted, tabular).
- Line 2: primary reason label, then " · " and the department names if any; single line, ellipsis.
- Line 3: resolved → "{disposition} · {ward}" in the ok colour; open → staleness: "No update for {h}" in amber ink (`--color-band-h4-ink`, weight 600) when the last activity is 2 h or older, otherwise "Updated {h} ago" muted. Last activity = the latest of `createdAt` and the newest update.
- Right: the elapsed clock (20 px, 700, tabular) coloured by band.
- The whole row is a link to `/cases/[id]`; 44 px minimum height; keyboard reachable.

## Header and controls

- Title "ER board" (22 px) and the counts strip "{open} open · {past6} past 6h · {past12} past 12h" (tabular, muted).
- MRN search input (numeric keyboard) and the three filter chips Open / Resolved / All.
- Empty states as the prototype's copy, minus the "load sample data" sentence (no sample loader in production, locked plan section 7): "No open cases. Tap New case when a patient passes the threshold." / "No case matching {q}." / "Nothing here yet."

## Shell

- Bottom tab bar: Board, Dashboard (Phase 4; until then a placeholder page), Export (Phase 5; placeholder), and for ADMIN an Admin tab (Phase 6; placeholder). Hidden in print.
- Floating "+ New case" button (ink background, white text, `--shadow-float`) bottom right above the tab bar; hidden for VIEWER; absent on `/cases/*`.
- The header shows the user's display name and a Logout control (from Phase 1) in an overflow menu, not a sidebar.

## Handover print sheet

`@media print` on the board: hide search, chips, tab bar, FAB and the clocks' colour; show a print header "Qatif Central Hospital, Emergency Department. ER Navigator handover" with the date-time (Asia/Riyadh) and the current user's name; rows become a table (MRN, registered, elapsed, primary reason, teams, last update text, ward/disposition) in 11 px with hairlines; page breaks avoided inside rows. A "Print handover" button in the overflow menu calls `window.print()`.

## Tests

- Unit: sort order with null elapsed last; staleness threshold at exactly 2 h; MRN search strips non-digits; counts strip numbers on a fixture.
- Route handler: `GET /api/board` requires a session (401 without), never returns VOIDED cases, respects `f`.
- Playwright (mobile): the board lists a seeded open case with its band and clock; searching narrows; the Resolved filter shows a resolved case; the New case FAB is absent for a VIEWER; a print-media emulation screenshot of the handover sheet.
- Screenshots: board at both viewports with about eight seeded cases across all bands (seed through the e2e fixture script), and the print sheet (`page.emulateMedia({ media: 'print' })`).
- First Lighthouse run (mobile) on the board, recorded in `docs/CHANGELOG.md`: performance and accessibility numbers, no gate yet (gate at Phase 7, ≥ 90).

## Do not

- No dashboard maths, no export, no realtime transport, no new schema, no sample-data loader, no change to the case editor beyond the Back link target.
