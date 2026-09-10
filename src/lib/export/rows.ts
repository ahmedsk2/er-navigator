/**
 * The workbook's rows, as pure functions — the prototype's `ExportPanel.download()` (docs/
 * reference/ERNavigatorTracker.jsx), sheet for sheet and column for column.
 *
 * Nothing here touches Prisma, Excel or the request: a sheet is a header array and an array of
 * rows of text, numbers and blanks, so the columns can be asserted against the dashboard fixture
 * without a database and without parsing a file back.
 *
 * Two places where the prototype's object literal decided something for it, made explicit here:
 *
 *   - "Left ED" appears twice in its row object — once as its own key and once as the last
 *     milestone — so the later assignment wins and the sheet ends up with ONE such column, in the
 *     early position, holding the milestone's value. That is exactly what `CASES_HEADER` and
 *     `casesRow` produce.
 *   - The Investigations sheet's step columns differ per test type, and `json_to_sheet` unioned
 *     whatever keys the first rows happened to have. Here the union is fixed in taxonomy order,
 *     so the header does not depend on which test was ordered first that week.
 */
import type { CaseForStats } from '@/src/lib/domain/aggregates'
import {
  ADMISSION_STEPS,
  DISPOSITION_LABELS,
  INVESTIGATION_LABELS,
  INVESTIGATION_STEPS,
  MILESTONES,
  PAYER_LABELS,
  SHIFT_LABELS,
  TRANSFER_STEPS,
} from '@/src/lib/domain/taxonomy'
import { MIN_N, duration, elapsedHours } from '@/src/lib/domain/time'
import { fmtAt, fmtHours2, yesOrBlank } from './format'
import { riyadhWeekday, type ExportRange, EXPORT_STATUS_LABELS } from './range'

/** One appended note. `CaseUpdate` is append-only, so this is the whole of its history. */
export type ExportUpdate = { at: Date; text: string; authorName: string }

/**
 * A case as the workbook needs it: everything the dashboard maths already reads, plus the columns
 * only the sheet shows. Still no PHI — the MRN, times, taxonomy labels and display names.
 */
/**
 * Phase 8 widened `CaseForStats` with most of the journey, the ward code, CTAS and the ED area,
 * so what is left here is only what the workbook alone shows: the room, the rest of the transfer
 * chain, the referral details, isolation, the note, the labels and the update text. Phase 10 adds
 * the working diagnosis; the payer arrives on `CaseForStats` with the dashboard's own select.
 */
export type CaseForExport = CaseForStats & {
  /** The one-line working diagnosis (Phase 10), or null. */
  diagnosis: string | null
  navigatorName: string
  /** The navigator's login, which the QCH sheet's "ID Number" column carries beside the name. */
  navigatorUsername: string
  /** "Stage: reason", the prototype's `${stageOf(c.primary).name}: ${reasonLabel(c.primary)}`. */
  primaryReasonLabel: string | null
  reasonLabels: ReadonlyArray<string>
  /**
   * The same reasons unjoined, in the same taxonomy order. The QCH sheet has one delay-reason
   * column per stage (lab, imaging, decision, consult, admission), so it needs the stage each
   * reason was recorded under, not the rendered "Stage: reason" label.
   */
  reasonRows: ReadonlyArray<{ stageName: string; reasonName: string }>
  referralTrackingNo: string | null
  transferFacility: string | null
  isolation: boolean
  resolutionNote: string | null
  updates: ReadonlyArray<ExportUpdate>
}

/**
 * A tabular sheet: one bold, frozen header row and text or numeric cells under it.
 *
 * `groupHeader` is the QCH sheet's second dimension (Phase 8): the August collection sheet writes
 * its image and consultation groups on one row and their sub-columns on the next, and the
 * receiving side matches on both, so a sheet may declare a row above `header`. Everything else
 * leaves it undefined and gets the single header row it always had.
 */
export type Sheet = { name: string; header: string[]; rows: Cell[][]; groupHeader?: string[] }

/**
 * One cell: text, a number, or null for a blank. Every number in these workbooks is an hours
 * figure from `fmtHours2`, which the writer formats "0.00" (the text the cells used to hold)
 * while leaving it a number Excel can sum, average and chart (Ahmed, 10 September); a missing
 * hours figure is null rather than '' so the cell is blank to a chart as well. "n<3" stays text.
 */
export type Cell = string | number | null

const STATUS_LABELS = { OPEN: 'Open', RESOLVED: 'Resolved', VOIDED: 'Voided' } as const

/** Every milestone but "Left ED", which owns column 4 beside the hours it is measured to. */
const MILESTONE_COLUMNS = MILESTONES.filter(([field]) => field !== 'departedAt')

const join = (parts: ReadonlyArray<string>): string => parts.filter(Boolean).join('; ')

// --- Cases ------------------------------------------------------------------------------------

export const CASES_HEADER: string[] = [
  'MRN',
  'Status',
  'Registration',
  'Left ED',
  'Total ED hours (resolved)',
  'Hours waiting so far (open)',
  'Weekday',
  'Shift',
  // Phase 8: every KPI in both ED decks and in the Adaa form is reported per CTAS, and the
  // monthly deck splits everything by ED area, so both sit beside the shift they qualify.
  'CTAS',
  'ED area',
  // Phase 10 (Ahmed, 10 September): what the patient came in with, and who pays. Beside the ED
  // area for the same reason CTAS is beside the shift — they qualify the case, not the delay.
  'Working diagnosis',
  'Payer',
  'Navigator',
  'Stages',
  'Primary reason',
  'All reasons',
  'Other text',
  'Departments',
  'Referral tracking no.',
  'Receiving facility',
  'Disposition',
  'Ward',
  'Isolation',
  'Med admin informed',
  ...MILESTONE_COLUMNS.map(([, label]) => label),
  ...ADMISSION_STEPS.map(([, label]) => label),
  'Order to bed (h)',
  ...TRANSFER_STEPS.map(([, label]) => label),
  'Note',
]

export function casesRow(c: CaseForExport, now: Date): Cell[] {
  const elapsed = elapsedHours(c, now)
  return [
    c.mrn,
    STATUS_LABELS[c.status],
    fmtAt(c.registrationAt),
    fmtAt(c.departedAt),
    c.status === 'RESOLVED' ? fmtHours2(elapsed) : null,
    c.status === 'OPEN' ? fmtHours2(elapsed) : null,
    riyadhWeekday(c.registrationAt),
    c.shift ? SHIFT_LABELS[c.shift] : '',
    c.ctas == null ? '' : String(c.ctas),
    c.areaName ?? '',
    c.diagnosis ?? '',
    c.payer ? PAYER_LABELS[c.payer] : '',
    c.navigatorName,
    join(c.stageNames),
    c.primaryReasonLabel ?? '',
    join(c.reasonLabels),
    join(c.otherTexts.map((o) => o.text)),
    join(c.departmentNames),
    c.referralTrackingNo ?? '',
    c.transferFacility ?? '',
    c.disposition ? (DISPOSITION_LABELS[c.disposition as keyof typeof DISPOSITION_LABELS] ?? c.disposition) : '',
    c.wardCode ?? '',
    yesOrBlank(c.isolation),
    fmtAt(c.medAdminInformedAt),
    ...MILESTONE_COLUMNS.map(([field]) => fmtAt(c[field])),
    ...ADMISSION_STEPS.map(([field]) => fmtAt(c[field])),
    fmtHours2(duration(c.admOrderAt, c.bedAssignedAt)),
    ...TRANSFER_STEPS.map(([field]) => fmtAt(c[field])),
    c.resolutionNote ?? '',
  ]
}

export function casesSheet(cases: ReadonlyArray<CaseForExport>, now: Date): Sheet {
  return { name: 'Cases', header: CASES_HEADER, rows: cases.map((c) => casesRow(c, now)) }
}

// --- Consults ---------------------------------------------------------------------------------

export const CONSULTS_HEADER: string[] = [
  'MRN',
  'Team',
  'Consulted at',
  'Seen at',
  'Replied at',
  'Consult to seen (h)',
  'Consult to reply (h)',
]

/**
 * One row per team per case — but only where a consult time was actually entered. A department
 * chip with no times is a plan, not a consult, and `consultRows()` on the dashboard already
 * ignores it; the sheet must agree or the two disagree on n.
 */
export function consultsSheet(cases: ReadonlyArray<CaseForExport>): Sheet {
  const rows = cases.flatMap((c) =>
    c.consults
      .filter((x) => x.consultedAt)
      .map((x) => [
        c.mrn,
        x.departmentName,
        fmtAt(x.consultedAt),
        fmtAt(x.seenAt),
        fmtAt(x.repliedAt),
        fmtHours2(duration(x.consultedAt, x.seenAt)),
        fmtHours2(duration(x.consultedAt, x.repliedAt)),
      ]),
  )
  return { name: 'Consults', header: CONSULTS_HEADER, rows }
}

// --- Investigations ---------------------------------------------------------------------------

/** Every step label any test type has, in taxonomy order, de-duplicated. Stable per release. */
export const INVESTIGATION_STEP_LABELS: string[] = [
  ...new Set(Object.values(INVESTIGATION_STEPS).flatMap((steps) => steps.map(([, label]) => label))),
]

export const INVESTIGATIONS_HEADER: string[] = [
  'MRN',
  'Test',
  ...INVESTIGATION_STEP_LABELS,
  'Order to result (h)',
]

export function investigationsSheet(cases: ReadonlyArray<CaseForExport>): Sheet {
  const rows = cases.flatMap((c) =>
    c.investigations.map((x) => {
      const steps = INVESTIGATION_STEPS[x.type]
      const byLabel = new Map<string, Date | null>(steps.map(([field, label]) => [label, x[field]]))
      const last = steps[steps.length - 1]![0]
      return [
        c.mrn,
        INVESTIGATION_LABELS[x.type],
        ...INVESTIGATION_STEP_LABELS.map((label) => fmtAt(byLabel.get(label))),
        fmtHours2(duration(x.orderedAt, x[last])),
      ]
    }),
  )
  return { name: 'Investigations', header: INVESTIGATIONS_HEADER, rows }
}

// --- Updates ----------------------------------------------------------------------------------

export const UPDATES_HEADER: string[] = ['MRN', 'Time', 'Update', 'By']

export function updatesSheet(cases: ReadonlyArray<CaseForExport>): Sheet {
  const rows = cases.flatMap((c) =>
    c.updates.map((u) => [c.mrn, fmtAt(u.at), u.text, u.authorName]),
  )
  return { name: 'Updates', header: UPDATES_HEADER, rows }
}

// --- Summary ----------------------------------------------------------------------------------

/**
 * A free-form sheet: label rows, small tables, and the headings that separate them.
 *
 * `fills` is per cell and is an ARGB string exceljs writes as a solid pattern (Phase 8: the Adaa
 * `KPI summary` sheet colours a figure by its benchmark band). A shorter list, or a null entry,
 * leaves that cell unfilled.
 */
export type SummaryRow = { cells: Cell[]; bold?: boolean; fills?: ReadonlyArray<string | null> }

/** Exactly the shape of `dashboard()` this sheet reads. */
type SummaryData = {
  inRange: number
  tiles: { openNow: number; openPast6: number; resolvedN: number; medianLos: number | null }
  thresholds: ReadonlyArray<{ threshold: number; openNow: number; allCases: number }>
  byShift: ReadonlyArray<{ name: string; n: number; med: number | null }>
  byDispo: ReadonlyArray<{ name: string; value: number }>
}

/** The hard rule: a median over fewer than three values is not a number, it is "n<3". */
function median(value: number | null, n: number): Cell {
  return n < MIN_N ? `n<${MIN_N}` : fmtHours2(value)
}

/**
 * The Phase 10 case filter in words, as a row to go under the status filter — or no row at all,
 * so an unfiltered workbook's notes are the rows they always were. Shared by the Summary here and
 * the Adaa and QCH Read me sheets, which state the range the same way.
 */
export function caseFilterRows(filterLine: string | undefined): SummaryRow[] {
  return filterLine ? [{ cells: ['Case filter', filterLine] }] : []
}

export function summaryRows(input: {
  data: SummaryData
  range: ExportRange
  generatedAt: Date
  /** `describeFilter` of the range's case filter; absent when the export has none (Phase 10). */
  filterLine?: string
}): SummaryRow[] {
  const { data, range } = input
  const rows: SummaryRow[] = [
    { cells: ['ER Navigator export'], bold: true },
    { cells: ['Generated at', fmtAt(input.generatedAt)] },
    { cells: ['Range (registration date)', `${range.from} to ${range.to}`] },
    { cells: ['Status filter', EXPORT_STATUS_LABELS[range.status]] },
    ...caseFilterRows(input.filterLine),
    { cells: ['Cases in range', String(data.inRange)] },
    { cells: [] },
    { cells: ['Open now', String(data.tiles.openNow)] },
    { cells: ['Open past 6h', String(data.tiles.openPast6)] },
    { cells: ['Resolved', String(data.tiles.resolvedN)] },
    { cells: ['Median stay, resolved (h)', median(data.tiles.medianLos, data.tiles.resolvedN)] },
    { cells: [] },
    { cells: ['Cases past each threshold'], bold: true },
    { cells: ['Threshold', 'Open now', 'All cases'], bold: true },
    ...data.thresholds.map((t) => ({
      cells: [`Over ${t.threshold}h`, String(t.openNow), String(t.allCases)],
    })),
    { cells: [] },
    { cells: ['By shift'], bold: true },
    { cells: ['Shift', 'Cases', 'Median stay (h)'], bold: true },
    ...data.byShift.map((s) => ({
      cells: [
        SHIFT_LABELS[s.name as keyof typeof SHIFT_LABELS] ?? s.name,
        String(s.n),
        median(s.med, s.n),
      ],
    })),
    { cells: [] },
    { cells: ['Final disposition'], bold: true },
    { cells: ['Disposition', 'Cases'], bold: true },
    ...data.byDispo.map((d) => ({
      cells: [DISPOSITION_LABELS[d.name as keyof typeof DISPOSITION_LABELS] ?? d.name, String(d.value)],
    })),
  ]
  return rows
}

/** The four data sheets, in the prototype's order, after the Summary. */
export function dataSheets(cases: ReadonlyArray<CaseForExport>, now: Date): Sheet[] {
  return [casesSheet(cases, now), consultsSheet(cases), investigationsSheet(cases), updatesSheet(cases)]
}

export const SHEET_NAMES = ['Summary', 'Cases', 'Consults', 'Investigations', 'Updates'] as const
