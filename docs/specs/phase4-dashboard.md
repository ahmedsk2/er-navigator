# Phase 4 spec: the dashboard

Written by the lead (Fable). The maths is done and tested (`src/lib/domain/aggregates.ts`, fixture with hand-computed answers, independently re-derived). This phase is the page: port the prototype's `Dashboard` sections one to one on top of `dashboard(all, range, now)`.

## Already in the repo

`dashboard()` returns everything the page shows: `tiles`, `thresholds`, `weeks`, `byPrimary` (top 8), `byStage`, `byDept` (top 8), `consults`, `investigations`, `admission`, `byShift`, `byWeekday`, `byDispo`, `otherQueue`, plus `total` and `inRange`. Every row carries `ids` for drill-down. `MIN_N` and `fmtHours` are in `time.ts`. The board (Phase 3) already has the shell, the tab bar and the case-list row component; reuse the row for drill-down lists.

## Route and data

- `/dashboard` (every role). Query: `?r=7|30|90|all` (default 30), `?drill=<key>` for a drill-down list.
- Server component: load all non-voided cases with the fields `CaseForStats` needs (one query with includes: reasons with reason and stage names, consults with department name, investigations, primary reason), map to `CaseForStats` in `src/lib/cases/stats-mapper.ts` (unit-tested: a resolved case with two consults maps to the expected shape), call `dashboard()`, render. `now` is the request time; the page does not poll (a reload is fine for leadership).
- Drill-down: every bar and table row is a link to `/dashboard?r=…&drill=<section>:<name>`; the server resolves the ids from the same `dashboard()` output and renders the case list (board rows) with a "‹ Dashboard" link and the count. Unknown drill keys fall back to the dashboard.

## Sections, in the prototype's order and wording

1. Title "Dashboard", subtitle "{inRange} of {total} cases".
2. Range chips: 7 days, 30 days, 90 days, All time.
3. Tiles: "Open now", "Open past 6h" (danger colour), "Median LOS, resolved" ("n<3" when `resolvedN < MIN_N`, else `fmtHours`).
4. "Cases past each threshold" table: Threshold (coloured by band) / Open now / All cases; tap a row to drill; footnote "Tap a row to see the cases. Open now counts wait so far; All cases counts total stay including resolved."
5. "By week: cases and median stay" (only when more than one week): bars = cases, line = median hours; Recharts `ComposedChart`, bars in accent-soft with accent stroke, line in danger; footnote as the prototype.
6. "Primary delay reason": horizontal bars (accent).
7. "Journey stage where delays occur": horizontal bars (ink).
8. "Departments involved": horizontal bars (band-h12 colour, the prototype's plum).
9. "Consulted team response, median": table Team / n / To seen / To reply with the n<3 rule per row; empty-state copy from the prototype.
10. "Investigation turnaround, median from order": table Test / n / To done / To result.
11. "Admission chain, median": three rows; empty-state copy.
12. "By shift": table Shift / Cases / Median stay.
13. "By day of week" (only when more than one day): horizontal bars (muted).
14. "Final disposition": horizontal bars (ok colour), labels from `DISPOSITION_LABELS`.
15. "Other reasons awaiting review ({n})": list of stage · MRN and the text, each linking to the case; empty copy as the prototype.

Charts: Recharts 3, client components with `ResponsiveContainer`; horizontal bar height `max(120, rows * 30)`; labels at the bar end; tooltip formatting hours with `fmtHours`. Load the `dataviz` skill before writing chart code and keep its rules: one scale per chart, chart text from the theme tokens, no chart junk. The page must render without JavaScript except the charts (tables and tiles are server-rendered HTML).

## Print

`/dashboard` gets a print stylesheet that hides chips and links and keeps every section; Phase 5 reuses it for `/report`.

## Tests

- Unit: `stats-mapper.ts` (Prisma shape → `CaseForStats`), drill key parsing.
- Route/page: `/dashboard` requires a session; `?drill=` with an unknown key renders the dashboard, not an error.
- Playwright (mobile and desktop): with the e2e fixture cases seeded, the tiles show the expected counts, the threshold table has four rows, tapping "Over 6h" lists the right MRNs, the range chip changes the subtitle, the Other queue shows the seeded Other text. Screenshots of the dashboard and one drill-down at both viewports under `design/screens/phase4-*`.
- Second Lighthouse run recorded.

## Do not

- Do not reimplement any aggregate in the page; call `dashboard()`. Do not compute medians client-side. No export, no admin, no schema change.
