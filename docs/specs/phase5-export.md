# Phase 5 spec: Excel export and the printed report

Written by the lead (Fable). Locked plan section 5.5; the prototype's `ExportPanel` defines the sheets and columns.

## Already in the repo

Dashboard maths (`dashboard()`), the stats mapper (Phase 4), `fmtHours`, `elapsedHours`, `duration`, the taxonomy labels, the dashboard page and its print stylesheet, the policy (`export.xlsx`, `report.print`: SUPERVISOR, ADMIN, VIEWER; NAVIGATOR may not).

## `/export` page

- Date range (From / To, registration date, defaults: last 7 days), status filter (Open / Resolved / All; VOIDED never exported), the count "{n} cases in range" (live via a route handler `GET /api/export/count?from&to&status`), "Download Excel" (disabled when 0) and "Print report" (opens `/report?from&to&status` in a new tab). Footnote as the prototype: what each sheet contains.
- The Export tab in the shell (Phase 3 placeholder becomes this page); hidden for NAVIGATOR, and the route returns 403 with an `auth.forbidden` audit row.

## `GET /api/export.xlsx?from&to&status` (exceljs, streamed)

Use `exceljs` streaming workbook writer into the response; never build the whole file in memory. Sheets and columns, matching the prototype's export exactly (dates rendered `dd/mm HH:mm` in Asia/Riyadh, hours with two decimals, empty string for null):

1. **Summary**: generated at, range, status filter, the tiles, the threshold table, the by-shift and by-disposition tables (from `dashboard()` restricted to the same range by registration date).
2. **Cases**: one row per case: MRN, Status, Registration, Left ED, Total ED hours (resolved), Hours waiting so far (open), Weekday, Shift, Navigator (display name of `openedBy`), Stages, Primary reason ("Stage: reason"), All reasons, Other text, Departments, Referral tracking no., Receiving facility, Disposition, Ward, Isolation, Med admin informed, the five journey milestones, the four admission steps, Order to bed (h), the three transfer steps, Note.
3. **Consults**: MRN, Team, Consulted at, Seen at, Replied at, Consult to seen (h), Consult to reply (h).
4. **Investigations**: MRN, Test, the type's step columns (label headings), Order to result (h).
5. **Updates**: MRN, Time, Update, By.

Header row bold, columns auto-width from the longest of header and a sample, freeze the header row, filename `ER_Navigator_{from}_to_{to}.xlsx`. Audit `export.xlsx`? No: exports are not mutations; log at info level with the actor id and the range instead (keeps the audit table for changes).

## `/report?from&to&status` (print)

Server-rendered page: hospital header ("Qatif Central Hospital, Emergency Department. ER Navigator report", from the settings placeholder), the range, generated-at (Asia/Riyadh) and the requesting user's display name; then the dashboard sections for that range (tables server-rendered; charts rendered as static SVG by Recharts on the client, acceptable in print), page breaks between major sections, no navigation. A "Print" button calls `window.print()`; the print stylesheet from Phase 4 applies.

## Tests

- Unit: the row builders for each sheet on the aggregates fixture (`aggregates.fixture.ts`): the Cases sheet row count equals the filtered case count; the hours columns equal `elapsedHours`; the Consults sheet has one row per consult with a `consultedAt`; date formatting in Riyadh.
- Route: `/api/export.xlsx` returns 403 for a NAVIGATOR (with an `auth.forbidden` audit row), a valid xlsx for a SUPERVISOR (parse it back with exceljs in the test and assert sheet names and the Cases row count).
- Playwright (desktop): the export page count matches the seeded fixture; the Print report page shows the header and the threshold table. Screenshot `design/screens/phase5-report-desktop-1280x800.png`.

## Do not

- No PHI beyond MRN in any sheet (the row builders take `CaseForStats` and the update texts; never the user table beyond display names). No background jobs. No new schema.
