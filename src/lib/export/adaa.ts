/**
 * The Adaa ED KPIs workbook: the national form's input columns, its summary block, and a Read me.
 *
 * The decision behind the shape is in `docs/specs/phase8-brief.md` §6: the official file is
 * twenty thousand formula rows with external references, and a programmatic write into it does
 * not survive reliably. So this workbook produces the form's *inputs* — sheet `ED KPIs manual`,
 * columns A–T in the form's own order, headers and value vocabulary — and a `KPI summary` sheet
 * computed the way the form's Summary computes it. Pasting A2:T… into the official file takes a
 * minute and leaves its formulas intact.
 *
 * Nothing here computes a KPI. Every figure on the summary sheet comes from `adaaSummary()`,
 * `admissionToUnitBands()` and `benchmark()` in `src/lib/domain/kpi.ts`, which is the one place
 * the definitions live; this module formats and lays out.
 *
 * Two definitions worth restating because a reader of the sheet will ask:
 *  - the DOOR (KPI 1 and KPI 5) is the earlier of registration and triage — but column C is the
 *    *registration* time, because that is what the form's own input column asks for;
 *  - the TIME OF DISPOSITION is when the patient left the ED, so an open case has none and the
 *    form's formulas leave its KPIs blank, which is exactly what the spec asks for.
 */
import {
  ADMISSION_BANDS,
  TREATED_BANDS,
  UNIT_TYPES,
  adaaSummary,
  admissionToUnitBands,
  benchmark,
  leftAt,
  unitTypeOf,
  type AdaaKpi,
  type AdaaSummaryRow,
  type Benchmark,
  type KpiCase,
} from '@/src/lib/domain/kpi'
import { MIN_N } from '@/src/lib/domain/time'
import { dayOffset, fmtAt, fmtFormDate, fmtFormTime } from './format'
import { EXPORT_STATUS_LABELS, type ExportRange } from './range'
import type { Sheet, SummaryRow } from './rows'
import { freePart, tablePart, type WorkbookPart } from './workbook'

export const ADAA_MANUAL_SHEET = 'ED KPIs manual'
export const ADAA_SUMMARY_SHEET = 'KPI summary'
export const READ_ME_SHEET = 'Read me'

/**
 * Columns A–T of the official `ED KPIs 1-6 - manual` sheet, in its order and with its wording.
 * The receiving side matches on these, so nothing here is tidied up: the form writes the unit
 * after a slash, spells "Sicklecell" as one word, and leaves column K's sentence unfinished.
 */
export const ADAA_HEADER: string[] = [
  'Patient ID / Mandatory',
  'Date / (DD-MMM-YYYY)',
  'Registration Time / (hh:mm)',
  'Calendar Days later for triage time / (Enter if > 0)',
  'Triage Time / (hh:mm)',
  'CTAS Level / (1,2,3,4 or 5)',
  'Calendar Days later for seen by physician / (Enter if > 0)',
  'Physician Exam Time / (hh:mm)',
  'Was the treatment identified for Sicklecell condition?',
  'Was a Pain Killer Prescribed?',
  'Calendar Days later for Pain of pain killer administration /',
  'Was Pethidine Prescribed?',
  'Prescribed Dose',
  'Time of Pain Killer Administration / (hh:mm)',
  'Calendar Days later for time of decision / (Enter if > 0)',
  'Time of Decision / (hh:mm)',
  'Admission Type / (leave blank if no admission)',
  'Discharge Type / (leave blank if no discharge)',
  'Calendar Days later for Disposition',
  'Time of Disposition / (hh:mm)',
]

/** Columns I–N: the pain-management block. A clinical record, not a navigation one — see Read me. */
const PAIN_BLOCK: string[] = ['', '', '', '', '', '']

/**
 * The form's Admission Type vocabulary. `unitTypeOf` already sorts the critical-care codes from
 * the wards; the form keeps PICU and NICU as their own answers, so those two are named again
 * here. No ward recorded means no admission, and the column is blank.
 */
export function admissionType(wardCode: string | null): string {
  const unit = unitTypeOf(wardCode)
  if (!unit) return ''
  const code = (wardCode ?? '').trim().toUpperCase().split(/[\s/]/)[0] ?? ''
  return code === 'PICU' || code === 'NICU' ? code : unit
}

/**
 * The form's Discharge Type vocabulary, over the dispositions this app has. Deceased, LAMA and
 * "referred to UCC" are not dispositions here (brief §5), and an admission is not a discharge,
 * so those rows are blank and the Read me says why.
 */
const DISCHARGE_TYPES: Record<string, string> = {
  DISCHARGED_HOME: 'Home',
  DISCHARGED_DAMA: 'DAMA',
  TRANSFERRED: 'Another Health Facility',
}

export function dischargeType(disposition: string | null): string {
  return disposition ? (DISCHARGE_TYPES[disposition] ?? '') : ''
}

/** One case as one form row. Every offset is measured from the Riyadh date in column B. */
export function adaaRow(c: KpiCase): string[] {
  const base = c.registrationAt
  const left = leftAt(c)
  return [
    c.mrn,
    fmtFormDate(base),
    fmtFormTime(base),
    dayOffset(base, c.triageAt),
    fmtFormTime(c.triageAt),
    c.ctas == null ? '' : String(c.ctas),
    dayOffset(base, c.physicianAt),
    fmtFormTime(c.physicianAt),
    ...PAIN_BLOCK,
    dayOffset(base, c.decisionAt),
    fmtFormTime(c.decisionAt),
    admissionType(c.wardCode),
    dischargeType(c.disposition),
    dayOffset(base, left),
    fmtFormTime(left),
  ]
}

export function adaaManualSheet(cases: ReadonlyArray<KpiCase>): Sheet {
  return { name: ADAA_MANUAL_SHEET, header: ADAA_HEADER, rows: cases.map(adaaRow) }
}

// --- the summary sheet -------------------------------------------------------------------------

export const ADAA_SUMMARY_HEADER: string[] = [
  'CTAS',
  'Total patients',
  'Door to Doctor (total minutes)',
  'Doctor to Decision (total minutes)',
  'Decision to Disposition (total minutes)',
  ...TREATED_BANDS.map((b) => b.name),
  'KPI 5 % within 4 h',
  'KPI 6 % DAMA',
]

/**
 * The benchmark bands as cell fills. The hues are the app's own band tokens (`app/globals.css`:
 * `--color-band-ok`, `--color-accent`, `--color-band-h4`, `--color-band-h6`), lightened to a
 * tint so black cell text stays readable — a spreadsheet has no ink token to pair with a fill.
 */
export const BENCHMARK_FILL: Record<Benchmark, string> = {
  world: 'FFD9EFE4',
  acceptable: 'FFE3F1F4',
  improve: 'FFF7E7C4',
  unacceptable: 'FFF6D8D4',
}

export const BENCHMARK_LABELS: Record<Benchmark, string> = {
  world: 'World class',
  acceptable: 'Acceptable',
  improve: 'Needs improvement',
  unacceptable: 'Unacceptable',
}

const CTAS_LABELS: Record<AdaaSummaryRow['ctas'], string> = {
  1: 'CTAS 1',
  2: 'CTAS 2',
  3: 'CTAS 3',
  4: 'CTAS 4',
  5: 'CTAS 5',
  unknown: 'CTAS not recorded',
  overall: 'Total',
}

const whole = (v: number | null): string => (v == null ? '' : String(Math.round(v)))

/** A share as the app renders one: "n<3" below MIN_N, blank when there was nothing to measure. */
function pct(share: number | null, n: number): string {
  if (share != null) return `${(share * 100).toFixed(1)}%`
  return n === 0 ? '' : `n<${MIN_N}`
}

/**
 * The colour on a total-minutes cell is the colour of its MEAN — total ÷ the number of cases the
 * KPI could be measured on — which is what the official Summary sheet colours. The Read me says
 * so, because the number in the cell is the total and the colour is not about the total.
 */
function meanFill(kpi: AdaaKpi, total: number | null, n: number): string | null {
  if (total == null || n === 0) return null
  const band = benchmark(kpi, total / n)
  return band ? BENCHMARK_FILL[band] : null
}

function summaryLine(row: AdaaSummaryRow): SummaryRow {
  const shareFill = row.withinFourShare == null ? null : BENCHMARK_FILL[benchmark('kpi5', row.withinFourShare) ?? 'unacceptable']
  return {
    cells: [
      CTAS_LABELS[row.ctas],
      String(row.total),
      whole(row.kpi1TotalMin),
      whole(row.kpi2TotalMin),
      whole(row.kpi3TotalMin),
      ...row.treated.map(String),
      pct(row.withinFourShare, row.treatedN),
      pct(row.damaShare, row.resolvedN),
    ],
    bold: row.ctas === 'overall',
    fills: [
      null,
      null,
      meanFill('kpi1', row.kpi1TotalMin, row.kpi1N),
      meanFill('kpi2', row.kpi2TotalMin, row.kpi2N),
      meanFill('kpi3', row.kpi3TotalMin, row.kpi3N),
      ...row.treated.map(() => null),
      shareFill,
      null,
    ],
  }
}

const HEADING = (text: string): SummaryRow => ({ cells: [text], bold: true })
const BLANK: SummaryRow = { cells: [] }

export function adaaSummaryRows(cases: ReadonlyArray<KpiCase>): SummaryRow[] {
  const rows: SummaryRow[] = [
    HEADING('ED statistics, tracked cases'),
    { cells: ADAA_SUMMARY_HEADER, bold: true },
    ...adaaSummary(cases).map(summaryLine),
    BLANK,
    HEADING('Admission to unit (admission order to leaving the ED)'),
    { cells: ['Unit', ...ADMISSION_BANDS.map((b) => b.name)], bold: true },
  ]
  const byUnit = admissionToUnitBands(cases)
  for (const unit of UNIT_TYPES) {
    const found = byUnit.find((u) => u.unit === unit)
    rows.push({ cells: [unit, ...(found?.bands ?? []).map((b) => String(b.value))] })
  }
  rows.push(BLANK, HEADING('Benchmark colours'), {
    cells: ['', ...Object.values(BENCHMARK_LABELS)],
    fills: [null, ...Object.keys(BENCHMARK_LABELS).map((b) => BENCHMARK_FILL[b as Benchmark])],
  })
  return rows
}

// --- the Read me -------------------------------------------------------------------------------

/** Every statement the spec asks this sheet to make, with the numbers of this particular export. */
export function adaaReadMeRows(input: {
  cases: ReadonlyArray<KpiCase>
  range: ExportRange
  generatedAt: Date
}): SummaryRow[] {
  const { cases, range } = input
  const noCtas = cases.filter((c) => c.ctas == null).length
  const last = cases.length + 1
  return [
    HEADING('Adaa ED KPIs — read me'),
    BLANK,
    { cells: ['Population', 'Tracked cases only: the cases ER Navigator holds. Not the whole ED.'] },
    { cells: ['Range (registration date)', `${range.from} to ${range.to}`] },
    { cells: ['Status filter', EXPORT_STATUS_LABELS[range.status]] },
    { cells: ['Rows written', String(cases.length)] },
    { cells: ['Rows with no CTAS recorded', String(noCtas)] },
    { cells: ['Generated at', `${fmtAt(input.generatedAt)} (Asia/Riyadh)`] },
    BLANK,
    HEADING('Dates and times'),
    { cells: ['Every date and time is Asia/Riyadh: dates DD-MMM-YYYY, times hh:mm on the 24-hour clock.'] },
    {
      cells: [
        'The "Calendar Days later" columns count whole Riyadh calendar days from the date in column B. A zero is left blank, as the form asks.',
      ],
    },
    BLANK,
    HEADING('Definitions'),
    {
      cells: [
        'The door is the earlier of registration and triage, for KPI 1 and KPI 5 alike, as the form defines it once. Column C is still the registration time, which is what the form asks for.',
      ],
    },
    {
      cells: [
        'The time of disposition is when the patient left the ED: the recorded departure, or the resolution time when no departure was entered. An open case has none, and the form leaves its KPIs blank.',
      ],
    },
    {
      cells: [
        'KPI 6 here is DAMA only. LAMA is not a disposition in ER Navigator, so this figure is a lower bound on the form’s "LAMA or DAMA".',
      ],
    },
    {
      cells: [
        'The "within 1 hour" admission band stops at 1 h 00 min. The official formula reaches 0.04208333 days, which is 1 h 00.6 min, so a case inside those 36 seconds lands one column later here than in the official file.',
      ],
    },
    {
      cells: [
        'On the KPI summary sheet the three total-minutes columns are coloured by their mean (the total divided by the cases that KPI could be measured on), which is what the official Summary colours. A share over fewer than three cases reads "n<3".',
      ],
    },
    BLANK,
    HEADING('Blank until recorded'),
    {
      cells: [
        'Columns I to N (sickle-cell treatment, painkiller prescribed, its calendar-day offset, pethidine, the dose and the time given) are always blank. They are a clinical record rather than a navigation one, so KPI 8 cannot be produced from this app.',
      ],
    },
    {
      cells: [
        'Admission Type is blank when no ward was recorded. Discharge Type is blank for an admission, for "left without being seen" and for "other".',
      ],
    },
    {
      cells: [
        'Deceased, LAMA and "referred to UCC" are not dispositions in ER Navigator, so no row can carry them and KPI 7 (mortality) is not produced.',
      ],
    },
    { cells: ['CTAS is blank where it was not recorded. Those rows are summarised on the "CTAS not recorded" line.'] },
    BLANK,
    HEADING('Pasting into the official form'),
    {
      cells: [
        cases.length === 0
          ? 'There are no rows to paste for this range.'
          : `On the "${ADAA_MANUAL_SHEET}" sheet select A2:T${last}, copy, and paste into the official form’s "ED KPIs 1-6 - manual" sheet from A2. The header row is not pasted.`,
      ],
    },
  ]
}

/** The three sheets, in the order the file opens on. */
export function adaaWorkbook(input: {
  cases: ReadonlyArray<KpiCase>
  range: ExportRange
  generatedAt: Date
}): WorkbookPart[] {
  return [
    tablePart(adaaManualSheet(input.cases)),
    freePart({
      name: ADAA_SUMMARY_SHEET,
      widths: [20, 14, 16, 16, 18, 11, 11, 11, 11, 11, 11, 11, 18, 16],
      rows: adaaSummaryRows(input.cases),
    }),
    freePart({ name: READ_ME_SHEET, widths: [30, 96], rows: adaaReadMeRows(input) }),
  ]
}
