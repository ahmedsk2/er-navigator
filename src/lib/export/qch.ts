/**
 * The QCH navigator sheet: the navigators' own August collection log, filled from the app.
 *
 * Seventy columns in the original's order and — deliberately — the original's spelling, typos
 * and capitalisation included ("DISOPSITION", "Adissional", "ADMIITE"): the people who receive
 * this file match on the header text, so a tidied header is a broken hand-off. The one column
 * that is not reproduced is the patient's name, which never leaves the hospital system through
 * this app (`docs/specs/phase8-brief.md` §6).
 *
 * The original has two header rows — the image and consultation groups on the first, their
 * sub-columns on the second — so `QCH_COLUMNS` declares both at once and the two rows are
 * derived from it, which is what stops them drifting apart.
 *
 * Where the app does not record something the column is present and blank rather than dropped:
 * the receiving spreadsheet is positional. The `Read me` sheet lists every one of them.
 */
import { fmtClock } from '@/src/lib/cases/local-time'
import { doorToDispositionHours, leftAt, type KpiConsult, type KpiInvestigation } from '@/src/lib/domain/kpi'
import { DISPOSITION_LABELS, INVESTIGATION_LABELS, STAGES } from '@/src/lib/domain/taxonomy'
import { duration } from '@/src/lib/domain/time'
import { fmtAt, fmtFormDate, fmtFormTime, fmtHm } from './format'
import { EXPORT_STATUS_LABELS, type ExportRange } from './range'
import type { CaseForExport, Sheet, SummaryRow } from './rows'
import { freePart, tablePart, type WorkbookPart } from './workbook'

export const QCH_SHEET = 'Navigator sheet'
export const QCH_READ_ME_SHEET = 'Read me'

/** Appendix A stage names, by code, so a column asks for the stage rather than for a string. */
function stageNamed(code: string): string {
  const found = STAGES.find((s) => s.code === code)
  if (!found) throw new Error(`the taxonomy has no "${code}" stage`)
  return found.name
}

const STAGE = {
  investigations: stageNamed('inv'),
  referral: stageNamed('ref'),
  decision: stageNamed('dispo'),
  admission: stageNamed('adm'),
} as const

export type QchColumn = { group?: string; name: string }

const IMAGE_SUBCOLUMNS: ReadonlyArray<string> = [
  'Type of image',
  'Imaging Order time',
  'Imaging Order time complete',
  'Time of official report',
  'Time of preliminary report',
  'Reason of Delay more than 90 minutes',
]

const CONSULT_SUBCOLUMNS: ReadonlyArray<string> = [
  'consultation',
  'TIME OF CONSULTATION',
  'Speciality',
  'TIME OF RESPONSE',
  'Adissional investigation',
  'Result of investigation',
  'Decision',
  'Delay Reason more than 1 H',
]

const grouped = (group: string, names: ReadonlyArray<string>): QchColumn[] =>
  names.map((name) => ({ group, name }))

export const QCH_COLUMNS: ReadonlyArray<QchColumn> = [
  { name: 'Date' },
  { name: 'MRN' },
  { name: 'Area Assigned' },
  { name: 'ER MD name' },
  { name: 'CTAS Level' },
  { name: 'Time of Arrival' },
  { name: 'Time of Seen by MD' },
  { name: 'Treatment Plan Shared' },
  { name: 'Lab Ordered' },
  { name: 'Lab Order Time' },
  { name: 'Time of completing lab' },
  { name: 'Reason of Delay more than 1 H' },
  { name: 'Images Requested' },
  ...grouped('Image 1', IMAGE_SUBCOLUMNS),
  ...grouped('Image 2', IMAGE_SUBCOLUMNS),
  { name: 'ER-MD Decision' },
  { name: 'TIME OF MD Decision' },
  { name: 'FROM SEEN TO DECIDE' },
  { name: 'Reason of Delay from ER-MD Decision more than 2h,30 m' },
  ...grouped('CONSULTATION 1', CONSULT_SUBCOLUMNS),
  ...grouped('CONSULTATION 2', CONSULT_SUBCOLUMNS),
  { name: 'FROM CONSLTION TO D/C' },
  { name: 'FROM CONSLTION TIME TO ADMIITE' },
  { name: 'Final Decision' },
  { name: 'TIME OF DISPOSTION' },
  { name: 'DOOR TO DISOPSITION' },
  { name: 'intructions given by doctor' },
  { name: 'Family Engagement' },
  { name: 'TIME OF ADMISSION ORDER' },
  { name: 'ADMISSION ORDER IN ISTRUCTION' },
  { name: 'ADMISSION WARD' },
  { name: 'Referral to Case Management' },
  { name: 'Complex care Cordinator comment' },
  { name: 'Complex care Coordinator Action' },
  { name: 'Case Manager Name' },
  { name: 'Time of call case manger' },
  { name: 'Time of case manger replay' },
  { name: 'Time of Disposition TO WARD' },
  { name: 'order to disposition /H' },
  { name: 'DOOR TO DISOPSITION FOR ADMISSON PT' },
  { name: 'Delay admission to ward more than 30 minutes from admission order' },
  { name: 'Comments/Notes' },
  { name: 'ED NAVIGATOR NAME' },
  { name: 'ID Number' },
  { name: 'ED NAVIGATOR NAME 2' },
  { name: 'Reviewed By' },
]

/** Row 1: the group name where there is one, the column's own name where there is not. */
export const QCH_GROUP_HEADER: string[] = QCH_COLUMNS.map((c) => c.group ?? c.name)
/** Row 2: the sub-column name under a group, blank under a plain column. */
export const QCH_HEADER: string[] = QCH_COLUMNS.map((c) => (c.group ? c.name : ''))

// --- values -------------------------------------------------------------------------------------

/** The ER-MD Decision dropdown, over the dispositions this app has. */
const ER_MD_DECISIONS: Record<string, string> = {
  ADMITTED: 'Admission',
  DISCHARGED_HOME: 'Discharge',
  DISCHARGED_DAMA: 'DAMA',
  TRANSFERRED: 'Transfer',
  LEFT_WITHOUT_BEING_SEEN: 'Other',
  OTHER: 'Other',
}

function erMdDecision(c: CaseForExport): string {
  if (c.disposition) return ER_MD_DECISIONS[c.disposition] ?? 'Other'
  // The August sheet's "Referral": still in the department, waiting on a consulted team.
  return c.status === 'OPEN' && c.consults.length > 0 ? 'Referral' : ''
}

const yesNo = (present: boolean): string => (present ? 'Yes' : 'No')

const earlier = (a: Date | null, b: Date | null): Date | null => {
  if (!a) return b
  if (!b) return a
  return a.getTime() <= b.getTime() ? a : b
}

/** The delay reasons the case carries under one stage, in taxonomy order. */
function reasonsOf(c: CaseForExport, stageName: string): string {
  return c.reasonRows
    .filter((r) => r.stageName === stageName)
    .map((r) => r.reasonName)
    .join('; ')
}

/**
 * The Investigations stage holds both lab and imaging reasons, and the sheet has a column for
 * each. Appendix A prefixes every lab reason with "Lab:", so that prefix is the split; anything
 * else recorded under the stage (imaging, transport to imaging, an Admin addition, "Other")
 * belongs to the imaging column, so nothing a navigator typed is dropped.
 */
function investigationReasons(c: CaseForExport, lab: boolean): string {
  return c.reasonRows
    .filter((r) => r.stageName === STAGE.investigations && r.reasonName.startsWith('Lab:') === lab)
    .map((r) => r.reasonName)
    .join('; ')
}

const EMPTY_IMAGE: string[] = IMAGE_SUBCOLUMNS.map(() => '')

function imageBlock(i: KpiInvestigation | undefined, reasons: string): string[] {
  if (!i) return EMPTY_IMAGE
  return [
    INVESTIGATION_LABELS[i.type],
    fmtFormTime(i.orderedAt),
    fmtFormTime(i.doneAt),
    fmtFormTime(i.resultedAt),
    fmtFormTime(i.preliminaryAt),
    reasons,
  ]
}

const EMPTY_CONSULT: string[] = ['No', ...CONSULT_SUBCOLUMNS.slice(1).map(() => '')]

function consultBlock(k: KpiConsult | undefined, reasons: string): string[] {
  if (!k) return EMPTY_CONSULT
  return [
    'Yes',
    fmtFormTime(k.consultedAt),
    k.departmentName,
    fmtFormTime(earlier(k.seenAt, k.repliedAt)),
    '',
    '',
    '',
    reasons,
  ]
}

/** CT, then ultrasound, then X-ray: the order the sheet's two image blocks are filled in. */
const IMAGING_ORDER = ['CT', 'US', 'XR'] as const

export function qchRow(c: CaseForExport): string[] {
  const imaging = IMAGING_ORDER.flatMap((type) => c.investigations.filter((i) => i.type === type))
  const lab = c.investigations.find((i) => i.type === 'LAB')
  // Oldest consult first, so "consultation 1" is the one that was asked for first.
  const consults = [...c.consults].sort(
    (a, b) =>
      (a.consultedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.consultedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
      a.departmentName.localeCompare(b.departmentName),
  )
  const firstConsultAt = consults[0]?.consultedAt ?? null
  const left = leftAt(c)
  const admitted = c.disposition === 'ADMITTED'
  // Admission signals: an order, a ward, or a nursing handover. Without any of them the patient
  // never went to a ward, and the two ward columns are blank rather than repeating the departure.
  const toWard = admitted || (c.disposition == null && (c.admOrderAt || c.wardCode || c.handoverAt)) ? (c.handoverAt ?? left) : null
  const imagingReasons = investigationReasons(c, false)
  const referralReasons = reasonsOf(c, STAGE.referral)

  return [
    fmtFormDate(c.registrationAt),
    c.mrn,
    c.areaName ?? '',
    '', // ER MD name
    c.ctas == null ? '' : String(c.ctas),
    fmtFormTime(c.registrationAt),
    fmtFormTime(c.physicianAt),
    '', // Treatment Plan Shared
    yesNo(!!lab),
    fmtFormTime(lab?.orderedAt ?? null),
    fmtFormTime(lab?.resultedAt ?? null),
    investigationReasons(c, true),
    yesNo(imaging.length > 0),
    ...imageBlock(imaging[0], imagingReasons),
    ...imageBlock(imaging[1], imagingReasons),
    erMdDecision(c),
    fmtFormTime(c.decisionAt),
    fmtHm(duration(c.physicianAt, c.decisionAt)),
    reasonsOf(c, STAGE.decision),
    ...consultBlock(consults[0], referralReasons),
    ...consultBlock(consults[1], referralReasons),
    admitted ? '' : fmtHm(duration(firstConsultAt, left)),
    fmtHm(duration(firstConsultAt, c.admOrderAt)),
    c.disposition ? (DISPOSITION_LABELS[c.disposition as keyof typeof DISPOSITION_LABELS] ?? c.disposition) : '',
    fmtFormTime(left),
    fmtHm(doorToDispositionHours(c)),
    '', // intructions given by doctor
    '', // Family Engagement
    fmtFormTime(c.admOrderAt),
    '', // ADMISSION ORDER IN ISTRUCTION
    [c.wardCode, c.isolation ? 'ISOLATION' : null].filter(Boolean).join(' / '),
    '', // Referral to Case Management
    '', // Complex care Cordinator comment
    '', // Complex care Coordinator Action
    '', // Case Manager Name
    '', // Time of call case manger
    '', // Time of case manger replay
    fmtFormTime(toWard),
    fmtHm(duration(c.admOrderAt, toWard)),
    admitted ? fmtHm(doorToDispositionHours(c)) : '',
    reasonsOf(c, STAGE.admission),
    c.updates.map((u) => `${fmtClock(u.at)} ${u.text}`).join(' | '),
    c.navigatorName,
    c.navigatorUsername,
    '', // ED NAVIGATOR NAME 2
    '', // Reviewed By
  ]
}

export function qchSheet(cases: ReadonlyArray<CaseForExport>): Sheet {
  return {
    name: QCH_SHEET,
    groupHeader: QCH_GROUP_HEADER,
    header: QCH_HEADER,
    rows: cases.map(qchRow),
  }
}

// --- the Read me ---------------------------------------------------------------------------------

const HEADING = (text: string): SummaryRow => ({ cells: [text], bold: true })
const BLANK: SummaryRow = { cells: [] }
const NOT_RECORDED = 'The app does not record this yet (phase 8 brief, section 5).'

/** Every column that is present and empty, and why — the sheet is positional, so none is dropped. */
const BLANK_COLUMNS: ReadonlyArray<[string, string]> = [
  ['ER MD name', `The treating physician names staff on a delay record. ${NOT_RECORDED}`],
  ['Treatment Plan Shared', NOT_RECORDED],
  ['Adissional investigation, Result of investigation, Decision', `The per-consultation follow-up columns. ${NOT_RECORDED}`],
  ['intructions given by doctor, Family Engagement', `Both discharge-quality items. ${NOT_RECORDED}`],
  ['ADMISSION ORDER IN ISTRUCTION', NOT_RECORDED],
  [
    'Referral to Case Management, Complex care Cordinator comment, Complex care Coordinator Action, Case Manager Name, Time of call case manger, Time of case manger replay',
    `The whole case-management block. ${NOT_RECORDED}`,
  ],
  ['ED NAVIGATOR NAME 2', 'Only the navigator who opened the case is recorded; a second name is not.'],
  ['Reviewed By', `A supervisor review mark per case. ${NOT_RECORDED}`],
]

export function qchReadMeRows(input: {
  cases: ReadonlyArray<CaseForExport>
  range: ExportRange
  generatedAt: Date
}): SummaryRow[] {
  const { cases, range } = input
  const droppedImages = cases.filter((c) => c.investigations.filter((i) => i.type !== 'LAB').length > 2).length
  const droppedConsults = cases.filter((c) => c.consults.length > 2).length
  return [
    HEADING('QCH navigator sheet — read me'),
    BLANK,
    { cells: ['Range (registration date)', `${range.from} to ${range.to}`] },
    { cells: ['Status filter', EXPORT_STATUS_LABELS[range.status]] },
    { cells: ['Rows written', String(cases.length)] },
    { cells: ['Generated at', `${fmtAt(input.generatedAt)} (Asia/Riyadh)`] },
    BLANK,
    HEADING('What is different from the August sheet'),
    { cells: ['The patient name column is not reproduced. ER Navigator holds no patient name, national ID or date of birth: only the MRN.'] },
    {
      cells: [
        'The header is two rows, as the original is: the group on the first row, the sub-column on the second. Every header keeps the original spelling, because the receiving side matches on it.',
      ],
    },
    BLANK,
    HEADING('How the columns are filled'),
    { cells: ['Dates are DD-MMM-YYYY and every time is the Asia/Riyadh clock time, hh:mm.'] },
    {
      cells: [
        'The Date column is the registration day. A time recorded after midnight is still shown as its clock time, so a stay that crosses midnight reads like the original sheet does. The ER Navigator workbook has the full timestamps.',
      ],
    },
    { cells: ['Durations (FROM SEEN TO DECIDE, DOOR TO DISOPSITION, order to disposition /H …) are h:mm, like the original’s MOD() cells.'] },
    {
      cells: [
        'The two image blocks are the case’s imaging rows in CT, ultrasound, X-ray order.' +
          (droppedImages > 0
            ? ` ${droppedImages} case(s) in this range have a third imaging row, which the sheet has no column for and does not show.`
            : ' A case with a third imaging row would have it dropped: the sheet has only two blocks.'),
      ],
    },
    {
      cells: [
        'The two consultation blocks are the case’s consults, oldest first.' +
          (droppedConsults > 0
            ? ` ${droppedConsults} case(s) in this range have a third consult, which the sheet has no column for and does not show.`
            : ' A case with a third consult would have it dropped: the sheet has only two blocks.'),
      ],
    },
    {
      cells: [
        'Every delay-reason column is the case’s own taxonomy reasons for that stage, joined with "; " — lab reasons for the lab column, every other Investigations reason for the imaging columns, Referral reasons for the consultations, Disposition-decision reasons for the ER-MD decision, Admission-process reasons for the delay to the ward.',
      ],
    },
    {
      cells: [
        'A reason belongs to the case, not to one image or one consult, so both image blocks and both consultation blocks repeat the case’s reasons for that stage.',
      ],
    },
    { cells: ['ER-MD Decision is the disposition (Admission / Discharge / DAMA / Transfer / Other), or "Referral" while the case is open with a consult outstanding.'] },
    { cells: ['ADMISSION WARD is the ward code, with "/ ISOLATION" appended when the case is flagged as isolation.'] },
    { cells: ['Time of Disposition TO WARD is the nursing handover, or the departure from the ED when no handover was recorded, and is blank for a patient who was never admitted.'] },
    { cells: ['Comments/Notes is every update on the case, oldest first, as "HH:mm text" joined with " | ".'] },
    { cells: ['ED NAVIGATOR NAME and ID Number are the display name and the login of the navigator who opened the case.'] },
    BLANK,
    HEADING('Columns that are present and blank'),
    ...BLANK_COLUMNS.map(([name, why]) => ({ cells: [name, why] })),
  ]
}

export function qchWorkbook(input: {
  cases: ReadonlyArray<CaseForExport>
  range: ExportRange
  generatedAt: Date
}): WorkbookPart[] {
  return [
    tablePart(qchSheet(input.cases)),
    freePart({ name: QCH_READ_ME_SHEET, widths: [44, 96], rows: qchReadMeRows(input) }),
  ]
}
