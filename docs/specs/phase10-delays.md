# Phase 10: the delay fields, the filters, the case summary, where the time goes

Ahmed's six requests of 10 September, decided with the recommended defaults (the brief page
`scratchpad/er-navigator-phase10-brief.html`): (1) the delay reasons with "Other" free text exist;
add an in-app microphone button where the browser offers speech recognition; (2) a one-line
"Working diagnosis" beside CTAS; (3) a per-case summary sheet in the shape of the weekly deck's
ranked-table row plus its time sequence, with Copy as text; (4) a filter bar on the board, the
dashboard and the export page: stage, reason, ED area, department, CTAS, payer, disposition, with
include / exclude and "among others" / "the lone finding", carried in the address; (5) a
dashboard section "Where the time goes": front end, decision, after the decision; (6) a payer on
the case: Government, Insured, Self-pay, with a "By payer" table.

Rules for every slice: the hard rules in `CLAUDE.md`; MRN only (the diagnosis is a clinical line,
not an identifier; the same 10-digit warning applies to it as to every free text); no new
dependency; tests first where a test can express the behaviour; `pnpm typecheck`, `pnpm lint`,
`pnpm test` (dev database) and the whole Playwright suite at both viewports green before handing
back; do not edit `docs/CHANGELOG.md`, `docs/PLAN.md` or `docs/RUNBOOK.md`; commit format
`[ERN-P10.{n}] imperative summary`. Every contract the Phase 9 spec lists under "Contracts that
stay" still holds; a slice that must change a test selector says so in its report with the reason.

Sequence: the lead's data kit (P10.1) first; then Slice 10A and the lead's KPI section in
parallel; then Slices 10B and 10C in parallel on top, with the lead's "By payer" table. One
adversarial review of the merged tree, one deploy.

## Data kit (lead, P10.1)

- `prisma/schema.prisma`: `enum Payer { GOVERNMENT INSURED SELF_PAY }` beside `Answer`;
  `Case.diagnosis String?` (free text, ≤ 80 characters by zod, identifier-warned) and
  `Case.payer Payer?` after `areaId`. Migration `20260910140000_diagnosis_payer`, nullable, no
  default, no grant, prose header in the house style (`CREATE TYPE "Payer"`, `ALTER TABLE "Case"
  ADD COLUMN "diagnosis" TEXT, ADD COLUMN "payer" "Payer"`). `tests/unit/phi-guard.test.ts` stays
  green (neither name matches its pattern).
- `src/lib/domain/taxonomy.ts`: `PAYER_LABELS = { GOVERNMENT: 'Government', INSURED: 'Insured',
  SELF_PAY: 'Self-pay' }` and `PAYERS` in that order, under the Phase 8b vocabularies, with the
  "additions, nothing renamed" note.
- `src/lib/cases/stats-mapper.ts`: `payer: true` in `CASE_STATS_SELECT`; `code: true` under
  `reasons.reason.stage`; `toCaseForStats` sets `payer: row.payer` and builds `stageCodes` next to
  `stageNames` (distinct, in stage order). `stats-mapper.test.ts` key list and `reason()` helper
  updated.
- `src/lib/domain/aggregates.ts` and `kpi.ts`: `export type Payer = 'GOVERNMENT' | 'INSURED' |
  'SELF_PAY'` (a literal union, as `Answer` is); `CaseForStats` and `KpiCase` gain
  `payer: Payer | null` and `stageCodes: ReadonlyArray<string>`. Every full literal gains the two
  keys: `aggregates.fixture.ts`, `kpi.test.ts` `base()`, `phase8.fixture.ts`, `stats-mapper.test.ts`
  `row()`, `tests/e2e/dashboard.spec.ts` (the `KpiCase`-shaped literal), `src/lib/cases/timeline.ts`
  `NOT_READ`.
- Nothing else. The draft, the editor, the exports and the board are Slice 10A's.

## Slice 10A (Opus agent): the two fields and the microphone

Follow the CTAS precedent end to end (the code map's recipe): `src/lib/cases/types.ts`
(`diagnosis: string`, blank is `''`; `payer: Payer | null`), `src/lib/domain/validation.ts`
(`payerSchema`; `diagnosis: freeText(80).nullable().optional()`; `payer: payerSchema.nullable().optional()`;
tests), `src/lib/cases/service.ts` `caseScalarData` (`diagnosis: blankToNull(d.diagnosis)`,
`payer: d.payer ?? null`), `snapshot.ts` (+ its test's `source()`), `load.ts` (`blankDraft`,
`CaseRow`, `draftFromCase`), every `draft()` helper under `tests/db`, the e2e seed
(`tests/e2e/fixtures/dashboard-cases.ts` gains optional `diagnosis` and `payer`).

Editor (`src/components/cases/CaseEditor.tsx`): after the CTAS chip row, a `Field` labelled
"Working diagnosis (optional)" with an `Input maxLength={80}` and the placeholder "one line, e.g.
chest pain, for admission"; the warnings `useMemo` adds `phiWarnings('The working diagnosis',
draft.diagnosis)`. After the ED area row, a `ChoiceRow` labelled "Payer" with Government · Insured
· Self-pay (single select, tap again to clear, `role="group" aria-label="Payer"`, `aria-pressed`).

Board: `payer: true` and `diagnosis: true` in `BOARD_ROW_SELECT`; `BoardRow` gains
`payer: Payer | null` and `diagnosis: string | null`; `identityChips` adds the payer label as a chip
(`data-chip="Insured"`); `BoardRowItem` shows the diagnosis as one truncated line in `text-caption
text-ink-2` between the MRN line and the reason line, on both the phone card and the desktop grid
(desktop: inside the "Waiting on" column above the reason); the handover sheet prints it under the
MRN in the MRN cell (no new column: the sheet's seven column headers are pinned).

Exports: `src/lib/export/rows.ts` `CASES_HEADER` gains "Working diagnosis" and "Payer" after
"ED area" with the cells at the same index (`tests/e2e/cases.spec.ts` asserts the header list
exactly: update it, and say so); `CaseForExport` carries both. `qch.ts`: fill a column only if the
August sheet has one for the diagnosis or the payer (read `QCH_COLUMNS`; if none, leave the sheet
alone and say so in the report). The Adaa sheet is unchanged.

The microphone (`src/components/ui/DictationButton.tsx`, client): a 44 px icon button
(`aria-label="Dictate"` / `"Stop dictating"`, `aria-pressed`) rendered only when
`window.SpeechRecognition || window.webkitSpeechRecognition` exists, decided through
`useSyncExternalStore` with a server fallback of "absent" so the first client render matches the
server (the `InstallPrompt` pattern). While listening it appends final transcripts to the bound
value through an `onText(text)` callback (the caller decides how to merge: append with a space);
`lang` follows `navigator.language`; stops on `onend` / error / second tap; never blocks typing.
Placed inside the Other free-text boxes, the "What changed?" update box, the working diagnosis
and the resolution note. `next.config.ts` Permissions-Policy currently says `microphone=()`, which
denies it to the page itself: change it to `microphone=(self)` and update `tests/e2e/headers.spec.ts`
accordingly (the reason: the app's own origin may listen; no third party can). Add a new `Mic`
and `MicOff` icon to `src/components/icons.tsx` from Lucide 1.43.0 (same licence note). The
iPhone keeps the keyboard microphone (Safari does not expose the API to web apps); the button
simply does not render there.

Tests: `validation.test.ts` (80 characters accepted, 81 refused with path `diagnosis`; a payer
outside the enum refused); `tests/db/cases.test.ts` (create with payer and diagnosis, audit
`after` carries them, save clears an untouched payer); `tests/e2e/cases.spec.ts` (set the payer and
the diagnosis on a new case; the board row shows the `Insured` chip and the diagnosis line; the
export's Cases sheet carries both); a unit test for `DictationButton` is not required (no DOM
harness); the e2e asserts the button is absent under Playwright's Chromium only if the API is
absent there (check `window.SpeechRecognition` in the test and branch). Screenshots
`phase10-fields` at both viewports.

## Lead: where the time goes, and by payer (P10.40+)

`src/lib/domain/kpi.ts`:
- `PHASES`: `front` "Front end" = door → physician (the codes `reg`, `triage`, `resus`, `exam`);
  `decision` "Decision" = physician → disposition decision (`inv`, `ref`, `dispo`); `after`
  "After the decision" = decision → leaving (`adm`, `dc`, `admin`). The three intervals are the
  existing `kpi1Minutes`, `kpi2Minutes`, `kpi3Minutes` in hours; `after` exists only for RESOLVED
  cases (leaving is `endAt`), stated in the module header and the section footnote.
- `phaseSplit(cases, now)` returns, per phase: `n` (cases with the interval measured), `ids`,
  `med` (guarded median hours), `share` (that phase's summed hours over the summed stay, over the
  cases with all three measured; null below MIN_N such cases), `longestN` / `longestIds` (cases
  with all three measured where this phase is the longest; ties to the earlier phase), and
  `reasonsByPhase`: for each phase the stage rows (`StatRow`-like `{ name, n, ids }`) of its
  stages, counting cases carrying at least one reason in that stage, in stage order, zero rows
  kept.
- `byPayer(cases, now)`: `StatRow[]` like `byArea` over `PAYER_LABELS`, "Not recorded" last.
- Hand-computed unit tests on the existing fixture (the map lists the expected front / decision /
  after hours for b, c, d, e), plus an independent recomputation by two verifier agents before the
  section is wired, as in Phase 8b.

`aggregates.ts` (`DashboardKpi.phases`, `.byPayer`; `kpiPanels`), `drill.ts` (sections `phase`
with grid keys `front|median`, `front|longest`, `front|<stage name>` and `payer`; `DashboardData`
type; `resolveDrill`), `sections.tsx` (`WhereTimeGoesSection`: a `DataTable` Phase · Cases ·
Median · Share with a `ShareBar`, a "Longest phase" count table, then per phase a `PanelLabel` and
the stage rows, every row a drill link; `ByPayerSection` like `ByAreaSection`), `DashboardView.tsx`
(screen: "Where the time goes" after "Stay bands"; report: after "Working targets", so the pinned
first three stay; "By payer" after "By area"; nothing between "Outcomes" and "Discharge
communication"), `ReportView` inherits. Tests: `aggregates.test.ts`, `drill.test.ts`, `dashboard.spec.ts`
headings and one drill-down, screenshots `phase10-dashboard` at both viewports.

## Slice 10B (Opus agent): the filter

`src/lib/domain/case-filter.ts` (pure): 
```
type CaseFilter = {
  stage: string[]      // stage codes
  reason: string[]     // reason names
  dept: string[]       // department names
  area: string[]       // ED area codes
  ctas: number[]
  payer: Payer[]
  dispo: Disposition[]
  not: boolean         // exclude the matching cases instead of keeping them
  lone: boolean        // "the lone finding": the case's own set equals the selection
}
```
`parseCaseFilter(params)` (unknown values ignored, the page still renders, like `parseDrill`),
`caseFilterQuery(filter): string` (emits nothing for an empty filter; keys `stage`, `reason`,
`dept`, `area`, `ctas`, `payer`, `dispo` repeated per value, `not=1`, `lone=1`, in that order),
`isEmptyFilter`, `matchesFilter(c, filter)` over a structural subset of `CaseForStats`
(`stageCodes`, `reasonNames`, `departmentNames`, `areaCode`, `ctas`, `payer`, `disposition`), and
`describeFilter(filter, reference)` for the chips' labels. Semantics: within a dimension the
values are OR; across dimensions AND; with `lone`, for the multi-valued dimensions (stage,
reason, dept) the case's set must equal the selected set exactly (single-valued dimensions
behave as before); `not` negates the whole match. `CaseForStats` gains `reasonNames` and
`areaCode` (`stats-mapper.ts` selects `reason.name` and `area.code`; the fixtures gain the keys).

Board: `BoardRow` gains `stageCodes`, `reasonNames` (select `reasons.reason.{name, stage.code}`)
so `matchesFilter` runs over rows; `loadBoard(filter, now, caseFilter)` filters in memory after the
query; `app/(app)/page.tsx` and `app/api/board/route.ts` parse the case filter and the poll URL
carries it (`Board.tsx` poll fetch, `boardHref`, the `replaceState` rewrite); the counters sentence
and the empty state are over the visible (filtered) rows, and the bar's count line reads
"{shown} of {total} open cases" when a filter is active. The `f` and `q` params keep their exact
serialisation (`board.spec.ts` pins `/?f=all`, `/?q=3100002`); the case filter keys are appended
after them and omitted when empty.

Dashboard: `app/(app)/dashboard/page.tsx` parses the filter and applies `matchesFilter` to the
loaded cases before `dashboard()`, so every section, `total` and the previous period are over the
filtered population (a footnote under the headline says "Filtered: {describeFilter}"); `dashboardHref`
gains an optional filter and keeps its exact output when the filter is empty (`drill.test.ts` pins
it); the range chips and every drill link carry the filter; `DrillView` too.

Export: `ExportRange` gains an optional `filter: CaseFilter`; `parseExportRange` reads it,
`exportRangeQuery` / `reportQuery` append it only when non-empty (their exact strings are pinned
when empty); `countCasesForExport` and the workbook apply `matchesFilter` in memory to the same
loaded set so the count and the file agree; `/report` reads it too and prints the filter line.

The bar (`src/components/filter/FilterBar.tsx`, client): a "Filter" button (`aria-expanded`,
`aria-controls`) opening a panel (`role="dialog" aria-label="Filter cases"`, a bottom sheet on the
phone, a popover on a laptop, Escape and outside tap close it) with chip groups per dimension
(`role="group"` with the dimension as its label; options from `loadReference()` passed as props
for stages, reasons grouped under their stage, departments, areas; static lists for CTAS, payer,
disposition), two segmented controls ("Include" / "Exclude", "Among others" / "The lone finding"),
"Apply" navigating to the page's URL with the filter, and "Clear". The active filter renders as
removable chips beside the button, plus the count line. The same component on all three pages.

Tests: `case-filter.test.ts` (parse round-trips, each dimension, `not`, `lone` on multi- and
single-valued dimensions, unknown values ignored, empty query for an empty filter);
`drill.test.ts` and `range.test.ts` unchanged strings when empty and appended when set;
`tests/db/board.test.ts` / `dashboard.test.ts` / `export.test.ts` one filtered load each; e2e:
board (apply a stage filter, rows and count change, the URL carries it, the poll keeps it),
dashboard (the filter line and a changed headline), export (count equals the workbook's rows with
the filter). Screenshots `phase10-filter` at both viewports.

## Slice 10C (Opus agent): the case summary

`src/lib/cases/summary.ts` (pure): `summaryOf(loaded: LoadedCase, reference: ReferenceData,
now: Date): CaseSummary` and `summaryText(summary): string`. The summary: MRN, CTAS, area name,
payer label, working diagnosis; status, registered at, left at or "still in the ED", elapsed hours
and band; classification = the stage names carried; reasons with the primary first and marked,
each with its stage and the Other text if any; teams (department names); documented actions (the
six kinds with counts, from the updates' tags and the recorded escalation, bed-request and
transfer steps, the same rule as `actionsDocumented` in `kpi.ts`), the number of updates and the
last update time; outcome (disposition label, ward code, isolation, reviewed by and when); the
time sequence (the timeline steps with their intervals). No update text and no resolution note
in the summary or the copied text: the summary is for sharing, and free text is where names get
typed. `summaryText` is the deck's shape, one line per row, MRN only.

`src/components/cases/CaseSummarySheet.tsx` (client): a quiet "Summary" `Button`
(`aria-haspopup="dialog"`, `aria-expanded`) opening `role="dialog" aria-modal="true"
aria-label="Case summary"` with the rows as a two-column table, the time sequence as a list, a
"Copy" button (`navigator.clipboard.writeText` in the tap handler, then "Copied." as
`role="status"`; when the clipboard API is absent, select the hidden `<pre data-summary-text>` and
say "Select and copy"), a "Close" button, Escape and outside tap, focus moved into the dialog on
open and back to the trigger on close; a bottom sheet on the phone and a centred dialog on a
laptop. `app/cases/[id]/page.tsx` computes the summary and passes it as a new `summary` slot
rendered in the editor header between "‹ Back" and the clock (the slot pattern the timeline
uses); it is "as of page load", like the timeline.

The board: `app/api/cases/[id]/summary/route.ts` (force-dynamic, `requireUser({ as: 'api' })`,
404 for a voided or unknown case, no-store) returns the summary; `src/components/board/RowSummaryButton.tsx`
(client) sits as a sibling of the row's `<a data-mrn>` inside the `<li>` (never inside the link;
`a[data-mrn]` counts are pinned), a 44 px icon button `aria-label="Summary for {mrn}"`
`data-summary-for={mrn}`, `.no-print`, that fetches the route on tap and opens the same sheet.
`BoardRowItem` stays a server-safe component (`DrillView` renders it).

Tests: `summary.test.ts` in the `timeline.test.ts` style (fixture with a retired reason, a primary,
two consults, tagged and untagged updates, a review; the JSON and the text; the text contains no
update text); e2e in `cases.spec.ts` (open the summary on the case page, the dialog names the MRN,
the primary reason and "Registration"; Copy with `context.grantPermissions(['clipboard-read',
'clipboard-write'])` and the clipboard read back) and `board.spec.ts` (the row button opens the
sheet; `a[data-mrn]` count unchanged). Screenshots `phase10-summary` at both viewports.

## Contracts that stay

Everything in the Phase 9 spec's list, plus: the board's `a[data-mrn][data-band]` one per row;
`/?f=` and `/?q=` serialisation; `dashboardHref` outputs with no filter; `exportRangeQuery` and
`reportQuery` exact strings with no filter; the handover sheet's seven column headers; the report's
first three sections and the "Outcomes" → "Discharge communication" adjacency; `CASE_STATS_SELECT`'s
key list is updated deliberately in the kit and once more in 10B, each time with the test.
