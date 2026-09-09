# Phase 8: reports and collection fields from the ED decks and sheets

Context and the reasoning: `docs/specs/phase8-brief.md`. Rules for every slice: the hard rules in
`CLAUDE.md`; no patient identifier beyond the MRN; nothing from the source files (names, MRNs,
physician names) enters the repository; no new dependency; tests first where a test can express
the behaviour; `pnpm typecheck`, `pnpm lint`, `pnpm test` (dev database) and the relevant
Playwright specs green before handing back; do not edit `docs/CHANGELOG.md`, `docs/PLAN.md` or
`docs/RUNBOOK.md` (the lead writes those from your report); commit format `[ERN-P8.{n}]
imperative summary`.

Sequence: Slice D (schema and fields) and the lead's `src/lib/domain/kpi.ts` first, in parallel;
Slices E and F on top of both.

## The KPI module (lead): `src/lib/domain/kpi.ts`

Pure functions over `KpiCase`, a structural subset of `CaseForStats` once Slice D has widened it.
Everything E and F need to compute comes from here; they render and lay out, they do not
compute. Tested with a hand-computed fixture like `aggregates.ts`.

```ts
export type KpiConsult = { departmentName: string; consultedAt: Date | null; seenAt: Date | null; repliedAt: Date | null }
export type KpiInvestigation = {
  type: 'LAB' | 'CT' | 'US' | 'XR'
  orderedAt: Date | null; collectedAt: Date | null; receivedAt: Date | null
  doneAt: Date | null; preliminaryAt: Date | null; resultedAt: Date | null
}
export type KpiCase = {
  id: string; mrn: string; status: 'OPEN' | 'RESOLVED' | 'VOIDED'
  registrationAt: Date; triageAt: Date | null; physicianAt: Date | null; decisionAt: Date | null
  departedAt: Date | null; resolvedAt: Date | null
  admOrderAt: Date | null; bedRequestedAt: Date | null; bedAssignedAt: Date | null; handoverAt: Date | null
  transferRequestedAt: Date | null; medAdminInformedAt: Date | null
  disposition: string | null; wardCode: string | null; ctas: number | null; areaName: string | null
  stageNames: ReadonlyArray<string>; updatesCount: number; lastUpdateAt: Date | null
  consults: ReadonlyArray<KpiConsult>; investigations: ReadonlyArray<KpiInvestigation>
}

export type IdRow = { name: string; value: number; ids: string[] }            // a count with a drill-down
export type ShareRow = { name: string; n: number; within: number; ids: string[]; withinIds: string[]; share: number | null } // share = within / n, null when n < MIN_N
export type StatRow = { name: string; n: number; ids: string[]; med: number | null }  // hours; med null when n < MIN_N

export const STAY_BANDS: ReadonlyArray<{ name: string; min: number; max: number | null }>  // '<6 h', '6–<8 h', '8–<10 h', '10–<12 h', '12–<24 h', '24+ h'
export function stayBands(cases, now): IdRow[]
export type Headline = { cases: number; episodes: number; med: number | null; mean: number | null; min: number | null; max: number | null; atLeast10: number; atLeast12: number; longest: { id: string; mrn: string; hours: number } | null }
export function headline(cases, now): Headline                                  // med/mean/min/max null when n < MIN_N
export function previousRange(all, range, now): KpiCase[]                       // the period of the same length before `inRange`'s
export function longestStays(cases, now, n = 10): Array<{ id; mrn; hours; status; stageNames; disposition; lastUpdateAt }>
export type Actions = { any: IdRow; none: IdRow; byKind: IdRow[] }              // kinds: 'Update written', 'Medical admin informed', 'Bed requested (fax)', 'Transfer requested'
export function actionsDocumented(cases): Actions
export function outcomes(cases): IdRow[]                                        // resolved by disposition label + 'Still open'
export type Completeness = { noReason: IdRow; openQuiet12h: IdRow; resolvedNoDisposition: IdRow; outOfOrder: IdRow }
export function completeness(cases, now): Completeness
export function repeatVisits(cases): Array<{ mrn: string; ids: string[] }>
export type TimelineStep = { key: string; label: string; at: Date; fromPrevious: number | null }  // hours since the previous recorded step
export function timeline(c): TimelineStep[]                                     // every recorded milestone, consult step and investigation step, in time order
// Adaa
export type AdaaKpi = 'kpi1' | 'kpi2' | 'kpi3' | 'kpi4' | 'kpi5' | 'kpi6'
export type Benchmark = 'world' | 'acceptable' | 'improve' | 'unacceptable'
export function benchmark(kpi: AdaaKpi, value: number): Benchmark               // KPI 1–3 in minutes, 4–6 as a share 0..1
export const ADAA_BENCHMARKS: Record<AdaaKpi, { unit: 'minutes' | 'share'; bands: ... }>
export function kpi1Minutes(c): number | null   // door (earlier of registration, triage) to physician
export function kpi2Minutes(c): number | null   // physician to decision
export function kpi3Minutes(c): number | null   // decision to left ED
export function doorToDispositionHours(c): number | null  // registration to left ED, resolved only
export const TREATED_BANDS  // '≤4 h', '4–6 h', '6–12 h', '12–24 h', '24–48 h', '48–72 h', '>72 h' (Adaa columns AH–AN)
export type AdaaSummaryRow = { ctas: 1|2|3|4|5|'unknown'|'overall'; total: number; kpi1TotalMin: number|null; kpi1N: number; kpi1Med: number|null; kpi2..; kpi3..; treated: number[] /* per TREATED_BANDS */; withinFourShare: number|null; damaShare: number|null; nonUrgentShare: number|null }
export function adaaSummary(cases): AdaaSummaryRow[]   // one row per CTAS 1..5, 'unknown' when there are cases without CTAS, then 'overall'
export const UNIT_TYPES = ['ICU', 'Ward'] as const; export function unitTypeOf(wardCode): 'ICU' | 'Ward' | null  // ICU-type: ICU, CCU, PICU, NICU, AICU
export const ADMISSION_BANDS  // '≤30 min', '≤1 h', '1–4 h', '>4 h' (order to left ED)
export function admissionToUnitBands(cases): Array<{ unit: 'ICU' | 'Ward'; bands: IdRow[] }>
// QCH working targets (August sheet thresholds)
export const TARGETS: ReadonlyArray<{ key: 'lab60' | 'imaging90' | 'consult60' | 'decision150' | 'toWard30'; name: string; minutes: number }>
export function targets(cases): ShareRow[]           // one per target; unit of analysis: case for decision150/toWard30, investigation row for lab60/imaging90, consult row for consult60 (ids are case ids)
export function examToConsult(cases): StatRow[]       // physician contact to consult request, by department
export const TURNAROUND_BANDS  // '≤30 min', '31–60', '61–90', '91–120', '121–240', '>240'
export function turnaroundBands(cases): Array<{ type: 'LAB'|'CT'|'US'|'XR'; orderToResult: IdRow[]; doneToReport: IdRow[] }>  // imaging: earlier of preliminary/official for orderToResult
export function byCtas(cases, now): StatRow[]        // '1'..'5', 'Not recorded'
export function byArea(cases, now): StatRow[]
```

## Slice D (Opus agent): CTAS, ED area, preliminary report; the stats loader

Schema (`prisma/schema.prisma`): `Case.ctas Int?` (1..5, checked by zod not the database);
`Case.areaId String?` with relation to a new model `EdArea { id, code @unique, name, active,
sortOrder, cases Case[] }`; `CaseInvestigation.preliminaryAt DateTime?` (imaging rows only; a
LAB row keeps it null). Migration `20260910090000_ctas_area_preliminary` generated with
`prisma migrate diff --from-schema-datamodel <copy of the previous schema> --to-schema-datamodel
prisma/schema.prisma --script` (the shadow database does not work here; runbook), read by eye.
The app role gets its grants from `prisma/sync-app-role.ts` automatically; nothing to revoke on
`EdArea`.

Seed (`prisma/seed.ts`, insert-if-missing, never updating): areas `RESUS` "Resuscitation area",
`ACUTE` "Acute area", `RAZ` "Rapid assessment zone", `POOL` "Pooling area", `ISO` "Isolation",
`NEGP` "Negative pressure room". Add them to `src/lib/domain/taxonomy.ts` as `ED_AREAS` (this
list is NOT in Appendix A; note that in the comment) and to the seed count line.

Admin: `src/lib/admin/lists.ts` gains `ListKind 'area'` with the same rename / reorder /
deactivate operations and audit rows as wards; `ListsPanel` shows "ED areas". Retired handling
follows the Phase 7 pattern (`loadReferenceForCase` includes a retired area the case carries).

Case editor (`CaseEditor.tsx`, the first block after the shift select): a "CTAS" chip row (1 2 3
4 5, single-select, tap again to clear) and an "ED area" chip row (active areas, single-select).
Each imaging row gains a "Preliminary report" time between "Scan done" and "Reported". Draft,
`validation.ts` (`ctas` int 1..5 nullable; `areaId` known-or-retired-on-case; `preliminaryAt`
optional), `snapshot`, `diff`, `service.ts` (saved and audited like every other field),
`load.ts` (`draftFromCase`), `warnings.ts` (a preliminary report after the official one is a
warning, not an error). Board and handover print: CTAS and area shown as a small chip after the
MRN when present.

Export (`src/lib/export/rows.ts`): `CTAS` and `ED area` columns after `Shift`; `Preliminary
report` on the Investigations sheet. Report (`/report`): nothing.

Stats loader (`src/lib/dashboard/load.ts`, `src/lib/domain/aggregates.ts`): widen `CaseForStats`
so it satisfies `KpiCase` above: add `triageAt, physicianAt, decisionAt, resolvedAt, handoverAt,
transferRequestedAt, medAdminInformedAt, wardCode, ctas, areaName, updatesCount, lastUpdateAt`
and `preliminaryAt` on investigations. Extend the fixture in `__tests__/aggregates.fixture.ts`
with the new fields (nulls are fine) so the existing hand-computed expectations stay exact.

Tests: `validation.test.ts` (ctas bounds, area retired rules), `tests/db/cases.test.ts` (save and
resolve with ctas / area / preliminaryAt, audit row carries them), `tests/db/admin.test.ts` (area
list rename / deactivate), e2e in `cases.spec.ts` (set CTAS 3 and an area on a new case, see them
on the board row and in the export's Cases sheet), the PHI guard stays green.

## Slice E (Opus agent): the dashboard, the case timeline, the print sheet

All numbers from `kpi.ts`; the loader is already widened by Slice D. Use the existing
`DashSection`, `BarSection`, `Median`, `Footnote`, drill-down and chart conventions; every new
count row is a drill-down (`DRILL_SECTIONS` grows; `resolveDrill` covers it). Order on the
dashboard, top to bottom, with the existing sections kept where they are:

1. Headline tiles replace the current tile row: cases, episodes, median stay, mean stay,
   range (min–max), "10 h or more" share, longest stay (linked to the case), each with the
   delta against `previousRange` shown as a small "+3 vs previous 30 d" line. Medians below
   MIN_N render "n<3" as everywhere.
2. "Stay bands" histogram (six bands) beside the threshold table.
3. "Pathways": the existing stage bars, relabelled to show the share of cases in the range
   (several per case) with the footnote saying so.
4. "Adaa KPIs, tracked cases only": a panel with KPI 1, 2, 3 (median minutes, coloured by
   `benchmark`), KPI 5 (share within 4 h, coloured) and the treated-within bands, KPI 6 (share
   DAMA), KPI 4 (share CTAS 4–5 among cases with a CTAS). Footnote: "Tracked cases, not the whole
   ED. Benchmarks: Adaa ED KPI definitions." Colours: world class = ok band, acceptable = accent,
   needs improvement = h4, unacceptable = h6 (tokens in `app/globals.css`).
5. "Working targets": five compliance rows from `targets()` (name, within / n, share as a bar,
   drill-down to the cases that missed it).
6. "Admission to unit": the four bands for ICU-type and ward, from `admissionToUnitBands`.
7. "Turnaround": per investigation type the order-to-result bands (stacked bar), and "Exam to
   consult, median" by department from `examToConsult`.
8. "Longest stays": the ranked table (rank, MRN, stay, stages, outcome, last update), each row a
   link to the case.
9. "Actions documented": share with any action, the kinds, and "no action documented" as a
   drill-down.
10. "Outcomes" (replacing the current disposition bars), "By CTAS", "By ED area" (hidden when
    nothing is recorded), "Repeat visits", and "Documentation" (the four completeness rows).

Case page: a "Timeline" section after the updates, listing `timeline(c)` with the clock time and
the interval from the previous step ("+1h 32m"), read-only. Handover print sheet: the same
timeline in compact form. `/report` (the print report): the headline tiles, stay bands, Adaa
panel and working targets, in that order, before the existing tables.

Tests: unit tests for any pure helper you add (none of the computing lives in components);
Playwright in `dashboard.spec.ts` (each new section renders and its drill-down lists the right
MRNs against a seeded fixture), `cases.spec.ts` (timeline shows the recorded steps in order with
intervals), `report.spec.ts` if present. Screenshots at both viewports for the gate:
`design/screens/phase8-dashboard-*`, `phase8-timeline-*`, `phase8-report-*`.

## Slice F (Opus agent): the two new export formats

`src/lib/export/range.ts`: `ExportFormat = 'navigator' | 'adaa' | 'qch'`, default `navigator`,
parsed from `?format=`, part of `exportFilename` (`er-navigator-…`, `adaa-ed-kpis-…`,
`qch-navigator-sheet-…`). `/export` gets a "Format" select above the range with one line of help
per format. `GET /api/export.xlsx` and `/api/export/count` accept it; the audit row's `after`
carries `format`. Same permission (`export.xlsx`), same streaming writer, same range and status
semantics.

**Adaa ED KPIs workbook.** Sheet `ED KPIs manual`: columns A–T exactly as the official form's
`ED KPIs 1-6 - manual` sheet, in this order and with these headers: `Patient ID / Mandatory`,
`Date / (DD-MMM-YYYY)`, `Registration Time / (hh:mm)`, `Calendar Days later for triage time /
(Enter if > 0)`, `Triage Time / (hh:mm)`, `CTAS Level / (1,2,3,4 or 5)`, `Calendar Days later for
seen by physician / (Enter if > 0)`, `Physician Exam Time / (hh:mm)`, `Was the treatment
identified for Sicklecell condition?`, `Was a Pain Killer Prescribed?`, `Calendar Days later for
Pain of pain killer administration /`, `Was Pethidine Prescribed?`, `Prescribed Dose`, `Time of
Pain Killer Administration / (hh:mm)`, `Calendar Days later for time of decision / (Enter if >
0)`, `Time of Decision / (hh:mm)`, `Admission Type / (leave blank if no admission)`, `Discharge
Type / (leave blank if no discharge)`, `Calendar Days later for Disposition`, `Time of
Disposition / (hh:mm)`. Values in the form's vocabulary: Patient ID = MRN; date = registration
date in Riyadh, `DD-MMM-YYYY`; times `hh:mm` Riyadh; the "calendar days later" columns = the
number of Riyadh calendar days between the registration date and that time (0 left blank);
admission type from `unitTypeOf` and the ward (`ICU`, `PICU`, `NICU`, `Ward`; blank when not
admitted); discharge type `Home` for discharged home, `DAMA`, `Another Health Facility` for
transferred, blank otherwise (the app has no Deceased, LAMA or UCC yet: Read me says so);
sickle-cell, painkiller, pethidine, dose, painkiller time blank. One row per case in the range
(open cases included with their recorded times; the form's formulas leave the incomplete KPIs
blank). Sheet `KPI summary`: `adaaSummary()` laid out as the official Summary sheet's "ED
Statistics" block: rows CTAS 1..5 and Total; columns Total patients, Door to Doctor (total
minutes), Doctor to Decision (total minutes), Decision to Disposition (total minutes), then the
treated-within bands, KPI 5 %, KPI 6 % DAMA, the admissions-to-unit bands block below it; cells
coloured by `benchmark` where a benchmark exists. Sheet `Read me`: population (tracked cases in
the range, status filter), what is blank until recorded, the paste instruction ("select A2:T… ,
paste into the official form's `ED KPIs 1-6 - manual` sheet from A2"), and the date/time zone.

**QCH navigator sheet workbook.** Sheet `Navigator sheet` with the August sheet's headers in its
order except the patient name (two header rows like the original: group headers on row 1, the
image and consultation sub-columns on row 2): Date, MRN, Area Assigned, ER MD name (blank), CTAS
Level, Time of Arrival, Time of Seen by MD, Treatment Plan Shared (blank), Lab Ordered (Yes /
No), Lab Order Time, Time of completing lab, Reason of Delay more than 1 H (the case's
Investigations-stage lab reasons, joined), Images Requested (Yes / No), Image 1 and Image 2
(Type of image, Imaging Order time, Imaging Order time complete, Time of official report, Time
of preliminary report, Reason of Delay more than 90 minutes; the two images are the case's
imaging rows in CT, US, XR order; a third is dropped and the Read me says so), ER-MD Decision
(Admission / Discharge / DAMA / Transfer / Other from the disposition, `Referral` when a consult
exists and the case is open), TIME OF MD Decision, FROM SEEN TO DECIDE (h:mm), Reason of Delay
from ER-MD Decision more than 2h,30 m (Disposition-decision-stage reasons), CONSULTATION 1 and 2
(consultation Yes / No, TIME OF CONSULTATION, Speciality, TIME OF RESPONSE (earlier of seen and
replied), Adissional investigation (blank), Result of investigation (blank), Decision (blank),
Delay Reason more than 1 H (Referral-stage reasons)), FROM CONSLTION TO D/C, FROM CONSLTION TIME
TO ADMIITE, Final Decision, TIME OF DISPOSTION, DOOR TO DISOPSITION, intructions given by doctor
(blank), Family Engagement (blank), TIME OF ADMISSION ORDER, ADMISSION ORDER IN ISTRUCTION
(blank), ADMISSION WARD (ward code, `/ ISOLATION` appended when the isolation flag is set),
Referral to Case Management (blank), Complex care Cordinator comment (blank), Complex care
Coordinator Action (blank), Case Manager Name (blank), Time of call case manger (blank), Time
of case manger replay (blank), Time of Disposition TO WARD (handover or left ED), order to
disposition /H, DOOR TO DISOPSITION FOR ADMISSON PT, Delay admission to ward more than 30
minutes from admission order (Admission-stage reasons), Comments/Notes (the updates, newest
last, `HH:mm text` joined with ` | `), ED NAVIGATOR NAME, ID Number (display name and username
of the navigator who opened the case), ED NAVIGATOR NAME 2 (blank), Reviewed By (blank). Durations
as `h:mm` text like the original's `MOD()` cells. A `Read me` sheet listing the blank columns and
why. Keep the spelling of the original headers exactly (the receiving side matches on them).

Tests: unit tests on the row builders with a fixture case (every column, the blank ones asserted
blank, the Riyadh date/day-offset arithmetic across midnight), `tests/db/export.test.ts` or the
existing export test for the three formats, e2e in `export.spec.ts` (choose each format,
download, open with exceljs, assert the header row and a value).
