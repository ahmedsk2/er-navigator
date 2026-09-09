import { describe, expect, it } from 'vitest'
import { FIXTURE, NOW } from '@/src/lib/domain/__tests__/aggregates.fixture'
import { dashboard, type CaseForStats } from '@/src/lib/domain/aggregates'
import { elapsedHours } from '@/src/lib/domain/time'
import { riyadhDateKey, type ExportRange } from '../range'
import {
  CASES_HEADER,
  CONSULTS_HEADER,
  INVESTIGATIONS_HEADER,
  UPDATES_HEADER,
  casesSheet,
  consultsSheet,
  dataSheets,
  investigationsSheet,
  summaryRows,
  updatesSheet,
  type CaseForExport,
} from '../rows'

/**
 * The row builders on the dashboard fixture (src/lib/domain/__tests__/aggregates.fixture.ts),
 * whose twelve cases and their hand-computed answers are already the basis of the Phase 4 tests.
 *
 * The fixture is a `CaseForStats`; the workbook needs a few more columns, so `asExport()` adds
 * them with the empty values a case that never reached a ward or a transfer really has. Two cases
 * are enriched by hand where a column would otherwise never be exercised.
 */
const asExport = (c: CaseForStats, extra: Partial<CaseForExport> = {}): CaseForExport => ({
  ...c,
  navigatorName: 'Nadia Navigator',
  navigatorUsername: 'nadia',
  primaryReasonLabel: c.primaryReasonName ? `${c.stageNames[0] ?? 'Registration'}: ${c.primaryReasonName}` : null,
  reasonLabels: c.primaryReasonName ? [`${c.stageNames[0] ?? 'Registration'}: ${c.primaryReasonName}`] : [],
  reasonRows: c.primaryReasonName
    ? [{ stageName: c.stageNames[0] ?? 'Registration', reasonName: c.primaryReasonName }]
    : [],
  medAdminInformedAt: null,
  triageAt: null,
  roomAt: null,
  physicianAt: null,
  decisionAt: null,
  handoverAt: null,
  transferRequestedAt: null,
  transferAcceptedAt: null,
  transportArrivedAt: null,
  referralTrackingNo: null,
  transferFacility: null,
  wardCode: null,
  isolation: false,
  resolutionNote: null,
  updates: [],
  ...extra,
})

const CASES: CaseForExport[] = FIXTURE.map((c) => {
  if (c.id === 'C5')
    return asExport(c, {
      wardCode: 'ICU',
      isolation: true,
      handoverAt: c.bedAssignedAt,
      medAdminInformedAt: c.admOrderAt,
      triageAt: c.registrationAt,
      resolutionNote: 'Admitted to ICU',
      updates: [
        { at: c.registrationAt, text: 'Bed requested', authorName: 'Nadia Navigator' },
        { at: c.departedAt!, text: 'Resolved: Admitted', authorName: 'Sami Supervisor' },
      ],
    })
  if (c.id === 'C6')
    return asExport(c, {
      referralTrackingNo: 'RCC-4471',
      transferFacility: 'Dammam Central',
      transferRequestedAt: c.registrationAt,
      updates: [{ at: c.registrationAt, text: 'CT ordered', authorName: 'Nadia Navigator' }],
    })
  return asExport(c)
})

/** The default range for the fixture's NOW: 2026-09-01 to 2026-09-08, every status. */
const RANGE: ExportRange = { from: '2026-09-01', to: '2026-09-08', status: 'all', format: 'navigator' }

/** What the query returns for that range: non-voided, registered on one of those Riyadh days. */
const filtered = CASES.filter((c) => {
  const key = riyadhDateKey(c.registrationAt)
  return c.status !== 'VOIDED' && key >= RANGE.from && key <= RANGE.to
})

const column = (header: string[], name: string): number => {
  const i = header.indexOf(name)
  if (i < 0) throw new Error(`no "${name}" column`)
  return i
}

const rowFor = (sheetRows: string[][], mrn: string): string[] => {
  const row = sheetRows.find((r) => r[0] === mrn)
  if (!row) throw new Error(`no row for MRN ${mrn}`)
  return row
}

describe('the range the sheets are built from', () => {
  it('is the nine non-voided cases registered in the last seven Riyadh days', () => {
    expect(filtered.map((c) => c.id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C11', 'C12'])
  })
})

describe('casesSheet', () => {
  const sheet = casesSheet(filtered, NOW)

  it('writes exactly one row per filtered case', () => {
    expect(sheet.rows).toHaveLength(filtered.length)
    expect(sheet.rows).toHaveLength(9)
  })

  it('gives every row the full set of columns', () => {
    for (const row of sheet.rows) expect(row).toHaveLength(CASES_HEADER.length)
  })

  it('has one "Left ED" column, in the prototype position, beside the hours it measures', () => {
    expect(CASES_HEADER.filter((h) => h === 'Left ED')).toHaveLength(1)
    expect(CASES_HEADER.slice(0, 6)).toEqual([
      'MRN',
      'Status',
      'Registration',
      'Left ED',
      'Total ED hours (resolved)',
      'Hours waiting so far (open)',
    ])
  })

  it('puts the elapsed hours in the resolved column for a resolved case, to two decimals', () => {
    const c5 = filtered.find((c) => c.id === 'C5')!
    const row = rowFor(sheet.rows, c5.mrn)
    expect(row[column(CASES_HEADER, 'Total ED hours (resolved)')]).toBe(elapsedHours(c5, NOW)!.toFixed(2))
    expect(row[column(CASES_HEADER, 'Total ED hours (resolved)')]).toBe('8.00')
    expect(row[column(CASES_HEADER, 'Hours waiting so far (open)')]).toBe('')
  })

  it('puts the elapsed hours in the open column for an open case, to two decimals', () => {
    const c3 = filtered.find((c) => c.id === 'C3')!
    const row = rowFor(sheet.rows, c3.mrn)
    expect(row[column(CASES_HEADER, 'Hours waiting so far (open)')]).toBe(elapsedHours(c3, NOW)!.toFixed(2))
    expect(row[column(CASES_HEADER, 'Hours waiting so far (open)')]).toBe('13.00')
    expect(row[column(CASES_HEADER, 'Total ED hours (resolved)')]).toBe('')
  })

  it('formats every timestamp as dd/mm HH:mm in Asia/Riyadh', () => {
    // C1 registered 2026-09-08T09:00Z, which is 12:00 on the 8th in Riyadh.
    const row = rowFor(sheet.rows, '100001')
    expect(row[column(CASES_HEADER, 'Registration')]).toBe('08/09 12:00')
    expect(row[column(CASES_HEADER, 'Weekday')]).toBe('Tue')
    // An open case has not left, so the column is blank rather than a dash.
    expect(row[column(CASES_HEADER, 'Left ED')]).toBe('')
  })

  it('writes the Riyadh date of a case that registered after 21:00 UTC', () => {
    // C4 registered 2026-09-07T11:00Z = 14:00 Monday in Riyadh.
    const row = rowFor(sheet.rows, '100004')
    expect(row[column(CASES_HEADER, 'Registration')]).toBe('07/09 14:00')
    expect(row[column(CASES_HEADER, 'Weekday')]).toBe('Mon')
  })

  it('renders the resolved case`s labels, ward, isolation and admission chain', () => {
    const row = rowFor(sheet.rows, '100005')
    expect(row[column(CASES_HEADER, 'Status')]).toBe('Resolved')
    expect(row[column(CASES_HEADER, 'Shift')]).toBe('Morning')
    expect(row[column(CASES_HEADER, 'Disposition')]).toBe('Admitted')
    expect(row[column(CASES_HEADER, 'Ward')]).toBe('ICU')
    expect(row[column(CASES_HEADER, 'Isolation')]).toBe('Yes')
    expect(row[column(CASES_HEADER, 'Departments')]).toBe('MROD; General Surgery')
    expect(row[column(CASES_HEADER, 'Left ED')]).toBe('07/09 17:00')
    // admOrderAt is 27 h before NOW, bedAssignedAt 23 h: four hours.
    expect(row[column(CASES_HEADER, 'Order to bed (h)')]).toBe('4.00')
    expect(row[column(CASES_HEADER, 'Note')]).toBe('Admitted to ICU')
  })

  it('carries the CTAS and the ED area, right after the shift, and blanks them when unrecorded', () => {
    expect(CASES_HEADER.slice(column(CASES_HEADER, 'Shift'), column(CASES_HEADER, 'Shift') + 3)).toEqual([
      'Shift',
      'CTAS',
      'ED area',
    ])
    const c1 = rowFor(sheet.rows, '100001')
    expect(c1[column(CASES_HEADER, 'CTAS')]).toBe('3')
    expect(c1[column(CASES_HEADER, 'ED area')]).toBe('Rapid assessment zone')

    // C2 has neither: two empty cells, not a zero and not a dash.
    const c2 = rowFor(sheet.rows, '100002')
    expect(c2[column(CASES_HEADER, 'CTAS')]).toBe('')
    expect(c2[column(CASES_HEADER, 'ED area')]).toBe('')
  })

  it('leaves the isolation column blank rather than writing "No"', () => {
    expect(rowFor(sheet.rows, '100001')[column(CASES_HEADER, 'Isolation')]).toBe('')
  })

  it('joins the Other free text a nurse typed', () => {
    // C8 is the fixture's Other case; it is outside this range, so build its row on its own.
    const c8 = CASES.find((c) => c.id === 'C8')!
    const row = casesSheet([c8], NOW).rows[0]!
    expect(row[column(CASES_HEADER, 'Other text')]).toBe('Waiting for social worker')
  })

  it('never writes a voided case, because the filter never hands it one', () => {
    expect(sheet.rows.map((r) => r[0])).not.toContain('100010')
  })
})

describe('consultsSheet', () => {
  const sheet = consultsSheet(filtered)

  it('writes one row per consult that has a consulted time', () => {
    const expected = filtered.flatMap((c) => c.consults.filter((x) => x.consultedAt))
    expect(sheet.rows).toHaveLength(expected.length)
    expect(sheet.rows).toHaveLength(5)
  })

  it('measures consult to seen and consult to reply to two decimals', () => {
    // C5's MROD consult: consulted 28 h before NOW, seen 27 h, replied 26.5 h.
    const row = sheet.rows.find((r) => r[0] === '100005' && r[1] === 'MROD')!
    expect(row[column(CONSULTS_HEADER, 'Consult to seen (h)')]).toBe('1.00')
    expect(row[column(CONSULTS_HEADER, 'Consult to reply (h)')]).toBe('1.50')
  })

  it('leaves a missing reply blank instead of guessing', () => {
    const row = sheet.rows.find((r) => r[0] === '100002')!
    expect(row[column(CONSULTS_HEADER, 'Replied at')]).toBe('')
    expect(row[column(CONSULTS_HEADER, 'Consult to reply (h)')]).toBe('')
  })

  it('blanks an out-of-order pair rather than writing a negative duration', () => {
    // C12 was seen before it was consulted; duration() returns null for that.
    const row = sheet.rows.find((r) => r[0] === '100012')!
    expect(row[column(CONSULTS_HEADER, 'Consult to seen (h)')]).toBe('')
  })
})

describe('investigationsSheet', () => {
  const sheet = investigationsSheet(filtered)

  it('has a stable union of every type`s step labels', () => {
    expect(INVESTIGATIONS_HEADER).toEqual([
      'MRN',
      'Test',
      'Ordered',
      'Sample collected',
      'Received by lab',
      'Resulted',
      'Scan done',
      // Phase 8: imaging only, between the scan and the official report.
      'Preliminary report',
      'Reported',
      'Done',
      'Order to result (h)',
    ])
  })

  it('writes the preliminary report on an imaging row and leaves it blank on a lab one', () => {
    // C6's CT: ordered 48 h before NOW, scanned 46 h, read out 45 h, reported 43 h.
    const ct = sheet.rows.find((r) => r[1] === 'CT')!
    expect(ct[column(INVESTIGATIONS_HEADER, 'Preliminary report')]).toBe('06/09 18:00')
    const lab = sheet.rows.find((r) => r[1] === 'Lab')!
    expect(lab[column(INVESTIGATIONS_HEADER, 'Preliminary report')]).toBe('')
    // "Order to result" is still measured to the OFFICIAL report, not the verbal one.
    expect(ct[column(INVESTIGATIONS_HEADER, 'Order to result (h)')]).toBe('5.00')
  })

  it('fills only the columns that belong to the row`s own test type', () => {
    const lab = sheet.rows.find((r) => r[1] === 'Lab')!
    expect(lab[column(INVESTIGATIONS_HEADER, 'Sample collected')]).not.toBe('')
    expect(lab[column(INVESTIGATIONS_HEADER, 'Scan done')]).toBe('')
    // C3's lab: ordered 12 h before NOW, resulted 8 h.
    expect(lab[column(INVESTIGATIONS_HEADER, 'Order to result (h)')]).toBe('4.00')

    const ct = sheet.rows.find((r) => r[1] === 'CT')!
    expect(ct[column(INVESTIGATIONS_HEADER, 'Scan done')]).not.toBe('')
    expect(ct[column(INVESTIGATIONS_HEADER, 'Sample collected')]).toBe('')
    // C6's CT: ordered 48 h before NOW, reported 43 h.
    expect(ct[column(INVESTIGATIONS_HEADER, 'Order to result (h)')]).toBe('5.00')
  })
})

describe('updatesSheet', () => {
  const sheet = updatesSheet(filtered)

  it('writes one row per appended update, with its author', () => {
    expect(sheet.rows).toHaveLength(3)
    expect(sheet.header).toEqual(UPDATES_HEADER)
    const resolved = sheet.rows.find((r) => r[2] === 'Resolved: Admitted')!
    expect(resolved[0]).toBe('100005')
    expect(resolved[3]).toBe('Sami Supervisor')
    expect(resolved[1]).toBe('07/09 17:00')
  })
})

describe('summaryRows', () => {
  const data = dashboard(filtered, 'all', NOW)
  const rows = summaryRows({ data, range: RANGE, generatedAt: NOW })
  const valueOf = (label: string): string[] => {
    const row = rows.find((r) => r.cells[0] === label)
    if (!row) throw new Error(`no "${label}" row`)
    return row.cells
  }

  it('states the range, the status filter and the generated time', () => {
    expect(valueOf('Generated at')[1]).toBe('08/09 15:00')
    expect(valueOf('Range (registration date)')[1]).toBe('2026-09-01 to 2026-09-08')
    expect(valueOf('Status filter')[1]).toBe('All')
    expect(valueOf('Cases in range')[1]).toBe('9')
  })

  it('carries the tiles', () => {
    expect(valueOf('Open now')[1]).toBe('5')
    expect(valueOf('Open past 6h')[1]).toBe('3')
    expect(valueOf('Resolved')[1]).toBe('4')
  })

  it('carries the threshold table', () => {
    // Elapsed in range: 3, 7, 13, 25, 8, 10, 6, 4, 2 — seven of them at or past four hours,
    // four of those still open (7, 13, 25, 4).
    expect(valueOf('Over 12h')).toEqual(['Over 12h', '2', '2'])
    expect(valueOf('Over 4h')).toEqual(['Over 4h', '4', '7'])
  })

  it('renders a median over fewer than three values as n<3', () => {
    // Only two EVENING cases are in this range, so its median is not a number.
    expect(valueOf('Evening')).toEqual(['Evening', '2', 'n<3'])
    // Three NIGHT cases clear MIN_N: elapsed 13, 6 and 4 → median 6.
    expect(valueOf('Night')).toEqual(['Night', '3', '6.00'])
    // Four resolved cases: LOS 8, 10, 6 and 2 → median 7.
    expect(valueOf('Median stay, resolved (h)')[1]).toBe('7.00')
  })

  it('carries the disposition table by label', () => {
    expect(valueOf('Discharged home')).toEqual(['Discharged home', '2'])
  })
})

describe('dataSheets', () => {
  it('is the prototype`s four sheets, in order', () => {
    expect(dataSheets(filtered, NOW).map((s) => s.name)).toEqual([
      'Cases',
      'Consults',
      'Investigations',
      'Updates',
    ])
  })
})
