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
  PAINKILLER_BANDS,
  PETHIDINE_DOSES_MG,
  TREATED_BANDS,
  UNIT_TYPES,
  adaaSummary,
  admissionToUnitBands,
  benchmark,
  leftAt,
  unitTypeOf,
  type AdaaKpi,
  type AdaaSummaryRow,
  type Answer,
  type Benchmark,
  type KpiCase,
} from '@/src/lib/domain/kpi'
import { MIN_N } from '@/src/lib/domain/time'
import { dayOffset, fmtAt, fmtFormDate, fmtFormTime } from './format'
import { EXPORT_STATUS_LABELS, riyadhDateKey, type ExportRange } from './range'
import { caseFilterRows, type Sheet, type SummaryRow } from './rows'
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

/**
 * Columns I–N: the form's pain-management block, filled from decision F's fields.
 *
 * The form asks each question as a Yes/No, so an unanswered one is blank rather than a "No" — the
 * receiving side counts the Yes answers and a false No would be a wrong denominator. The dose is
 * written only when it is one of the three the form's dropdown offers: `kpi.ts` puts anything else
 * in no band and lists it under the dashboard's Documentation section, and pasting a fourth value
 * into the form would break its own validation.
 */
export function answerYesNo(answer: Answer | null): string {
  if (answer === 'YES') return 'Yes'
  if (answer === 'NO') return 'No'
  return ''
}

export function pethidineDose(c: KpiCase): string {
  if (c.pethidinePrescribed !== 'YES') return ''
  const mg = c.pethidineDoseMg
  return mg != null && (PETHIDINE_DOSES_MG as ReadonlyArray<number>).includes(mg) ? String(mg) : ''
}

/**
 * I sickle-cell, J painkiller prescribed, K its day offset, L pethidine, M the dose, N the time.
 * K and N stay blank when the dose fell on the Riyadh day before the registration; the answers and
 * the dose are written as they are (`painkillerBeforeRegistrationDay`).
 */
function painBlock(c: KpiCase): string[] {
  const hideTime = painkillerBeforeRegistrationDay(c)
  return [
    answerYesNo(c.sickleCellTreatment),
    answerYesNo(c.painkillerPrescribed),
    hideTime ? '' : dayOffset(c.registrationAt, c.painkillerAt),
    answerYesNo(c.pethidinePrescribed),
    pethidineDose(c),
    hideTime ? '' : fmtFormTime(c.painkillerAt),
  ]
}

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
 * The form's Discharge Type vocabulary, over the dispositions this app has. Decision E added
 * Deceased and Referred to UCC, which the form has answers for; LAMA was declined and is still not
 * a disposition here, and an admission is not a discharge, so those rows stay blank.
 */
const DISCHARGE_TYPES: Record<string, string> = {
  DISCHARGED_HOME: 'Home',
  DISCHARGED_DAMA: 'DAMA',
  TRANSFERRED: 'Another Health Facility',
  DECEASED: 'Deceased',
  REFERRED_UCC: 'Referred to UCC',
}

export function dischargeType(disposition: string | null): string {
  return disposition ? (DISCHARGE_TYPES[disposition] ?? '') : ''
}

/**
 * The form dates a visit from its registration and offers only "days LATER" columns, so a triage
 * on the Riyadh day BEFORE the registration (an ambulance patient triaged at 23:50 and clerked at
 * 00:30) cannot be written into it: the offset would be negative, and a blank would date the
 * triage a day late. Such a row keeps its triage cells blank, and the Read me counts it so the
 * data collector enters it by hand (Phase 8 review).
 */
export function triageBeforeRegistrationDay(c: KpiCase): boolean {
  return c.triageAt != null && riyadhDateKey(c.triageAt) < riyadhDateKey(c.registrationAt)
}

/**
 * The same guard for the painkiller (columns K and N): the ambulance patient dosed at 23:55 and
 * clerked at 00:30 has no "days later" the form can hold either, and a blank offset beside the
 * time would date the dose a day late. Such a row keeps its Yes/No answers and its dose and leaves
 * the two time cells blank; the Read me counts it (Phase 8b review C1).
 */
export function painkillerBeforeRegistrationDay(c: KpiCase): boolean {
  return c.painkillerAt != null && riyadhDateKey(c.painkillerAt) < riyadhDateKey(c.registrationAt)
}

export function adaaRow(c: KpiCase): string[] {
  const base = c.registrationAt
  const left = leftAt(c)
  const hideTriage = triageBeforeRegistrationDay(c)
  return [
    c.mrn,
    fmtFormDate(base),
    fmtFormTime(base),
    hideTriage ? '' : dayOffset(base, c.triageAt),
    hideTriage ? '' : fmtFormTime(c.triageAt),
    c.ctas == null ? '' : String(c.ctas),
    dayOffset(base, c.physicianAt),
    fmtFormTime(c.physicianAt),
    ...painBlock(c),
    dayOffset(base, c.decisionAt),
    fmtFormTime(c.decisionAt),
    admissionType(c.disposition == null || c.disposition === 'ADMITTED' ? c.wardCode : null),
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
  // Phase 8b, appended so nothing to the left of them moves: KPI 7 is deaths over every tracked
  // case in the group (open included, the form's own denominator), KPI 8 the door-to-painkiller
  // total in the same shape as the three interval columns above.
  'KPI 7 % deceased',
  'KPI 8 door to painkiller (total minutes)',
]

/** The form's Summary Sheet rows 34–36: the bands, the doses, and what each is counted out of. */
export const ADAA_PAIN_HEADER: string[] = [
  'CTAS',
  'Painkiller prescribed',
  ...PAINKILLER_BANDS.map((b) => b.name),
  'Pethidine prescribed',
  ...PETHIDINE_DOSES_MG.map((mg) => `${mg} mg`),
  'Door to painkiller (total minutes)',
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
      pct(row.deceasedShare, row.total),
      whole(row.kpi8TotalMin),
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
      // KPI 7 has no benchmark in the form; KPI 8 is coloured by its mean, like KPI 1 to 3.
      null,
      meanFill('kpi8', row.kpi8TotalMin, row.kpi8N),
    ],
  }
}

/**
 * One Pain Killer Statistics line per CTAS row. The counts are `kpi.ts`'s — `painkiller` is one
 * number per `PAINKILLER_BANDS` entry and `pethidine` one per dose — and the two "prescribed"
 * columns are the denominators they are counted out of, which is not the same number: a painkiller
 * prescribed with no time given is in no band at all.
 */
function painLine(row: AdaaSummaryRow): SummaryRow {
  return {
    cells: [
      CTAS_LABELS[row.ctas],
      String(row.painkillerYesN),
      ...row.painkiller.map(String),
      String(row.pethidineYesN),
      ...row.pethidine.map(String),
      whole(row.kpi8TotalMin),
    ],
    bold: row.ctas === 'overall',
    fills: [
      null,
      null,
      ...row.painkiller.map(() => null),
      null,
      ...row.pethidine.map(() => null),
      meanFill('kpi8', row.kpi8TotalMin, row.kpi8N),
    ],
  }
}

const HEADING = (text: string): SummaryRow => ({ cells: [text], bold: true })
const BLANK: SummaryRow = { cells: [] }

export function adaaSummaryRows(cases: ReadonlyArray<KpiCase>): SummaryRow[] {
  const summary = adaaSummary(cases)
  const rows: SummaryRow[] = [
    HEADING('ED statistics, tracked cases'),
    { cells: ADAA_SUMMARY_HEADER, bold: true },
    ...summary.map(summaryLine),
    BLANK,
    HEADING('Admission to unit (admission order to leaving the ED)'),
    { cells: ['Unit', ...ADMISSION_BANDS.map((b) => b.name)], bold: true },
  ]
  const byUnit = admissionToUnitBands(cases)
  for (const unit of UNIT_TYPES) {
    const found = byUnit.find((u) => u.unit === unit)
    rows.push({ cells: [unit, ...(found?.bands ?? []).map((b) => String(b.value))] })
  }
  rows.push(
    BLANK,
    HEADING('Pain Killer Statistics (KPI 8)'),
    { cells: ADAA_PAIN_HEADER, bold: true },
    ...summary.map(painLine),
  )
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
  /** `describeFilter` of the range's case filter; absent when the export has none (Phase 10). */
  filterLine?: string
}): SummaryRow[] {
  const { cases, range } = input
  const noCtas = cases.filter((c) => c.ctas == null).length
  const triageHidden = cases.filter(triageBeforeRegistrationDay).length
  const painkillerHidden = cases.filter(painkillerBeforeRegistrationDay).length
  const last = cases.length + 1
  return [
    HEADING('Adaa ED KPIs — read me'),
    BLANK,
    { cells: ['Population', 'Tracked cases only: the cases ER Navigator holds. Not the whole ED.'] },
    { cells: ['Range (registration date)', `${range.from} to ${range.to}`] },
    { cells: ['Status filter', EXPORT_STATUS_LABELS[range.status]] },
    ...caseFilterRows(input.filterLine),
    { cells: ['Rows written', String(cases.length)] },
    { cells: ['Rows with no CTAS recorded', String(noCtas)] },
    { cells: ['Rows whose triage cells were left blank (triage on the day before registration; enter by hand)', String(triageHidden)] },
    {
      cells: [
        'Rows whose painkiller time was left blank (painkiller given on the day before registration; enter by hand)',
        String(painkillerHidden),
      ],
    },
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
        'KPI 6 here is DAMA only. LAMA is still not a disposition in ER Navigator (decision E added Deceased and Referred to UCC and declined LAMA), so this figure remains a lower bound on the form’s "LAMA or DAMA".',
      ],
    },
    {
      cells: [
        'KPI 7 is the Deceased dispositions divided by every tracked case in the range, open ones included — the form’s own denominator, "total patients". A rate over resolved cases alone would rise and fall within a week as cases close.',
      ],
    },
    {
      cells: [
        'KPI 8 is the door to the painkiller being given, for the cases where one was prescribed and a time was recorded. The Pain Killer Statistics block under the admission block counts those cases into the form’s four bands and the pethidine prescriptions into its three doses, per CTAS; the two "prescribed" columns beside them are the denominators, which are not the same number.',
      ],
    },
    {
      cells: [
        'A painkiller recorded as prescribed with no time given, or a pethidine with no dose or a dose that is not 50, 100 or 150 mg, is in no band and in no dose column. Those cases are listed on the dashboard’s Documentation section so they can be completed while the case is fresh.',
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
        'Columns I to N (sickle-cell treatment, painkiller prescribed, its calendar-day offset, pethidine, the dose and the time given) are filled from the case’s pain-management block. Each question is blank where it was not answered, never "No": the form counts the Yes answers, so a false No would be a wrong denominator. The dose is written only when it is one of the form’s three.',
      ],
    },
    {
      cells: [
        'Admission Type is filled only for a patient who was admitted, or who is still in the ED with a ward already recorded; a ward left on a patient who was then discharged, transferred or left is not reported as an admission. It is blank when no ward was recorded. Discharge Type is blank for an admission, for "left without being seen" and for "other".',
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
  filterLine?: string
}): WorkbookPart[] {
  return [
    tablePart(adaaManualSheet(input.cases)),
    freePart({
      name: ADAA_SUMMARY_SHEET,
      widths: [20, 16, 16, 16, 18, 11, 11, 11, 11, 11, 11, 11, 18, 16, 16, 20],
      rows: adaaSummaryRows(input.cases),
    }),
    freePart({ name: READ_ME_SHEET, widths: [30, 96], rows: adaaReadMeRows(input) }),
  ]
}
