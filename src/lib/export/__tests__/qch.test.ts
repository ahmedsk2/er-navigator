import { describe, expect, it } from 'vitest'
import { fmtHm } from '../format'
import {
  QCH_COLUMNS,
  QCH_GROUP_HEADER,
  QCH_HEADER,
  qchReadMeRows,
  qchRow,
  qchSheet,
} from '../qch'
import type { ExportRange } from '../range'
import { caseWith } from './phase8.fixture'

/**
 * The QCH `Navigator sheet` row, column by column.
 *
 * The whole row is asserted as one literal rather than cell by cell, because the sheet is
 * positional: what matters is not only that a value is right but that it is in the right column
 * and that the columns the app cannot fill are present and blank. Seventy cells, one expectation.
 *
 * Riyadh is UTC+3 and every time cell is the Riyadh clock, so the instants below are written in
 * UTC with their Riyadh time in a comment.
 */
const RANGE: ExportRange = { from: '2026-09-01', to: '2026-09-01', status: 'all', format: 'qch' }

const investigation = (over: Record<string, unknown>) =>
  ({
    type: 'CT',
    orderedAt: null,
    collectedAt: null,
    receivedAt: null,
    doneAt: null,
    preliminaryAt: null,
    resultedAt: null,
    ...over,
  }) as never

/**
 * A case with something in every column the app can fill: an area, a CTAS, a lab, three imaging
 * rows given out of order, three consults given out of order, a reason under each of the four
 * stages the sheet has a column for, an isolation admission, and two updates.
 */
const FULL = caseWith({
  mrn: '3200001',
  status: 'RESOLVED',
  areaName: 'Acute area',
  ctas: 2,
  registrationAt: new Date('2026-09-01T05:00:00Z'), // 08:00
  triageAt: new Date('2026-09-01T05:20:00Z'), // 08:20
  physicianAt: new Date('2026-09-01T06:30:00Z'), // 09:30
  decisionAt: new Date('2026-09-01T09:00:00Z'), // 12:00
  departedAt: new Date('2026-09-01T12:15:00Z'), // 15:15
  resolvedAt: new Date('2026-09-01T12:15:00Z'),
  admOrderAt: new Date('2026-09-01T09:30:00Z'), // 12:30
  handoverAt: new Date('2026-09-01T11:45:00Z'), // 14:45
  disposition: 'ADMITTED',
  wardCode: 'ICU',
  isolation: true,
  investigations: [
    investigation({
      type: 'XR',
      orderedAt: new Date('2026-09-01T07:00:00Z'),
      doneAt: new Date('2026-09-01T07:30:00Z'),
      resultedAt: new Date('2026-09-01T08:30:00Z'),
    }),
    investigation({
      type: 'LAB',
      orderedAt: new Date('2026-09-01T05:30:00Z'), // 08:30
      collectedAt: new Date('2026-09-01T05:45:00Z'),
      receivedAt: new Date('2026-09-01T06:00:00Z'),
      resultedAt: new Date('2026-09-01T07:00:00Z'), // 10:00
    }),
    investigation({
      type: 'US',
      orderedAt: new Date('2026-09-01T08:00:00Z'), // 11:00
      doneAt: new Date('2026-09-01T08:30:00Z'), // 11:30
      resultedAt: new Date('2026-09-01T09:30:00Z'), // 12:30
    }),
    investigation({
      type: 'CT',
      orderedAt: new Date('2026-09-01T06:00:00Z'), // 09:00
      doneAt: new Date('2026-09-01T06:40:00Z'), // 09:40
      preliminaryAt: new Date('2026-09-01T07:00:00Z'), // 10:00
      resultedAt: new Date('2026-09-01T08:00:00Z'), // 11:00
    }),
  ],
  consults: [
    { departmentName: 'Orthopedics', consultedAt: new Date('2026-09-01T10:00:00Z'), seenAt: null, repliedAt: null },
    {
      departmentName: 'Internal Medicine',
      consultedAt: new Date('2026-09-01T07:00:00Z'), // 10:00
      seenAt: new Date('2026-09-01T08:00:00Z'), // 11:00
      repliedAt: new Date('2026-09-01T07:45:00Z'), // 10:45, the earlier of the two
    },
    { departmentName: 'ICU', consultedAt: new Date('2026-09-01T08:30:00Z'), seenAt: null, repliedAt: null }, // 11:30
  ],
  reasonRows: [
    { stageName: 'Investigations', reasonName: 'Lab: delay in processing' },
    { stageName: 'Investigations', reasonName: 'Imaging: report delay' },
    { stageName: 'Referral / consulted team', reasonName: 'Awaiting consulted team response/callback' },
    { stageName: 'Disposition decision', reasonName: 'Awaiting senior/attending sign-off' },
    { stageName: 'Admission process', reasonName: 'No bed available on accepting ward' },
  ],
  updates: [
    { at: new Date('2026-09-01T06:00:00Z'), text: 'Bed requested', authorName: 'Nadia Navigator' }, // 09:00
    { at: new Date('2026-09-01T10:00:00Z'), text: 'Chased ward', authorName: 'Nadia Navigator' }, // 13:00
  ],
  updatesCount: 2,
})

describe('the Navigator sheet header', () => {
  it('is the August sheet’s seventy columns, one short of its seventy-one', () => {
    expect(QCH_COLUMNS).toHaveLength(70)
    expect(QCH_GROUP_HEADER).toHaveLength(70)
    expect(QCH_HEADER).toHaveLength(70)
  })

  it('never reproduces the patient name column', () => {
    const every = [...QCH_GROUP_HEADER, ...QCH_HEADER].join(' ').toLowerCase()
    expect(every).not.toContain('patient name')
    expect(every).not.toContain('name of patient')
  })

  it('puts the group on the first row and the sub-column on the second, plain columns on the first', () => {
    expect(QCH_GROUP_HEADER.slice(0, 3)).toEqual(['Date', 'MRN', 'Area Assigned'])
    expect(QCH_HEADER.slice(0, 3)).toEqual(['', '', ''])
    const image1 = QCH_GROUP_HEADER.indexOf('Image 1')
    expect(QCH_GROUP_HEADER.slice(image1, image1 + 6)).toEqual(Array(6).fill('Image 1'))
    expect(QCH_HEADER.slice(image1, image1 + 6)).toEqual([
      'Type of image',
      'Imaging Order time',
      'Imaging Order time complete',
      'Time of official report',
      'Time of preliminary report',
      'Reason of Delay more than 90 minutes',
    ])
  })

  it('keeps the original’s spelling, because the receiving side matches on it', () => {
    expect(QCH_GROUP_HEADER).toContain('DOOR TO DISOPSITION')
    expect(QCH_GROUP_HEADER).toContain('FROM CONSLTION TIME TO ADMIITE')
    expect(QCH_GROUP_HEADER).toContain('ADMISSION ORDER IN ISTRUCTION')
    expect(QCH_GROUP_HEADER).toContain('intructions given by doctor')
    expect(QCH_GROUP_HEADER).toContain('Complex care Cordinator comment')
    expect(QCH_HEADER).toContain('Adissional investigation')
  })
})

describe('qchRow', () => {
  it('fills every column the app records and leaves every other one blank', () => {
    expect(qchRow(FULL)).toEqual([
      '01-Sep-2026',
      '3200001',
      'Acute area',
      '', // ER MD name
      '2',
      '08:00',
      '09:30',
      '', // Treatment Plan Shared
      'Yes',
      '08:30',
      '10:00',
      'Lab: delay in processing',
      'Yes',
      // Image 1: the CT, because the blocks are filled in CT, US, X-ray order.
      'CT',
      '09:00',
      '09:40',
      '11:00',
      '10:00',
      'Imaging: report delay',
      // Image 2: the ultrasound. The X-ray has no block and is not shown.
      'Ultrasound',
      '11:00',
      '11:30',
      '12:30',
      '', // no preliminary read on the ultrasound
      'Imaging: report delay',
      'Admission',
      '12:00',
      '2:30',
      'Awaiting senior/attending sign-off',
      // Consultation 1: the earliest, and its response is the earlier of seen and replied.
      'Yes',
      '10:00',
      'Internal Medicine',
      '10:45',
      '', // Adissional investigation
      '', // Result of investigation
      '', // Decision
      'Awaiting consulted team response/callback',
      // Consultation 2: the second earliest. The third consult is not shown.
      'Yes',
      '11:30',
      'ICU',
      '',
      '',
      '',
      '',
      'Awaiting consulted team response/callback',
      '', // admitted, so there is no consult-to-discharge
      '2:30',
      'Admitted',
      '15:15',
      '7:15',
      '', // intructions given by doctor
      '', // Family Engagement
      '12:30',
      '', // ADMISSION ORDER IN ISTRUCTION
      'ICU / ISOLATION',
      '', // Referral to Case Management
      '', // Complex care Cordinator comment
      '', // Complex care Coordinator Action
      '', // Case Manager Name
      '', // Time of call case manger
      '', // Time of case manger replay
      '14:45',
      '2:15',
      '7:15',
      'No bed available on accepting ward',
      '09:00 Bed requested | 13:00 Chased ward',
      'Nadia Navigator',
      'nadia',
      '', // ED NAVIGATOR NAME 2
      '', // Reviewed By
    ])
  })

  it('is one cell per column', () => {
    expect(qchRow(FULL)).toHaveLength(QCH_COLUMNS.length)
    expect(qchRow(caseWith({}))).toHaveLength(QCH_COLUMNS.length)
  })

  it('writes No, not a blank, where nothing was ordered or consulted', () => {
    const row = qchRow(caseWith({}))
    expect(row[8]).toBe('No') // Lab Ordered
    expect(row[12]).toBe('No') // Images Requested
    expect(row[QCH_GROUP_HEADER.indexOf('CONSULTATION 1')]).toBe('No')
    expect(row[QCH_GROUP_HEADER.indexOf('CONSULTATION 2')]).toBe('No')
    // Nothing was decided and no team was asked, so there is no ER-MD decision to report.
    expect(row[QCH_GROUP_HEADER.indexOf('ER-MD Decision')]).toBe('')
  })

  it('calls an open case with a consult outstanding a Referral', () => {
    const row = qchRow(
      caseWith({
        consults: [{ departmentName: 'ICU', consultedAt: new Date('2026-09-01T06:00:00Z'), seenAt: null, repliedAt: null }],
      }),
    )
    expect(row[QCH_GROUP_HEADER.indexOf('ER-MD Decision')]).toBe('Referral')
  })

  it('measures consult to discharge only for a patient who was not admitted', () => {
    const discharged = qchRow(
      caseWith({
        status: 'RESOLVED',
        disposition: 'DISCHARGED_HOME',
        departedAt: new Date('2026-09-01T09:00:00Z'), // 12:00
        resolvedAt: new Date('2026-09-01T09:00:00Z'),
        consults: [{ departmentName: 'ICU', consultedAt: new Date('2026-09-01T06:00:00Z'), seenAt: null, repliedAt: null }],
      }),
    )
    expect(discharged[QCH_GROUP_HEADER.indexOf('FROM CONSLTION TO D/C')]).toBe('3:00')
    expect(discharged[QCH_GROUP_HEADER.indexOf('DOOR TO DISOPSITION FOR ADMISSON PT')]).toBe('')
  })

  it('leaves the two ward columns blank for a patient who never went to a ward', () => {
    const discharged = qchRow(
      caseWith({
        status: 'RESOLVED',
        disposition: 'DISCHARGED_HOME',
        departedAt: new Date('2026-09-01T09:00:00Z'),
        resolvedAt: new Date('2026-09-01T09:00:00Z'),
      }),
    )
    expect(discharged[QCH_GROUP_HEADER.indexOf('Time of Disposition TO WARD')]).toBe('')
    expect(discharged[QCH_GROUP_HEADER.indexOf('order to disposition /H')]).toBe('')
  })

  it('leaves the two ward time columns blank for a patient discharged with a ward still on the case (Phase 8 review C1)', () => {
    const home = caseWith({
      status: 'RESOLVED',
      registrationAt: new Date('2026-09-01T05:00:00Z'),
      admOrderAt: new Date('2026-09-01T07:00:00Z'),
      departedAt: new Date('2026-09-01T09:00:00Z'),
      resolvedAt: new Date('2026-09-01T09:00:00Z'),
      disposition: 'DISCHARGED_HOME',
      wardCode: 'MMW',
    })
    const row = qchRow(home)
    expect(row[QCH_GROUP_HEADER.indexOf('Time of Disposition TO WARD')]).toBe('')
    expect(row[QCH_GROUP_HEADER.indexOf('order to disposition /H')]).toBe('')
    // Still open with an order: the ward time is the departure or handover when it comes.
    const open = caseWith({ status: 'OPEN', admOrderAt: new Date('2026-09-01T07:00:00Z'), handoverAt: new Date('2026-09-01T08:00:00Z') })
    expect(qchRow(open)[QCH_GROUP_HEADER.indexOf('Time of Disposition TO WARD')]).toBe('11:00')
  })

  it('marks isolation on the ward column, with or without a ward code', () => {
    const ward = QCH_GROUP_HEADER.indexOf('ADMISSION WARD')
    expect(qchRow(caseWith({ wardCode: 'FMW', isolation: true }))[ward]).toBe('FMW / ISOLATION')
    expect(qchRow(caseWith({ wardCode: 'FMW' }))[ward]).toBe('FMW')
    expect(qchRow(caseWith({ isolation: true }))[ward]).toBe('ISOLATION')
    expect(qchRow(caseWith({}))[ward]).toBe('')
  })

  it('sends every non-lab Investigations reason to the imaging column, so nothing is dropped', () => {
    const row = qchRow(
      caseWith({
        investigations: [investigation({ type: 'CT', orderedAt: new Date('2026-09-01T06:00:00Z') })],
        reasonRows: [
          { stageName: 'Investigations', reasonName: 'Lab: delay in processing' },
          { stageName: 'Investigations', reasonName: 'Waiting for transport to imaging' },
          { stageName: 'Investigations', reasonName: 'Other' },
        ],
      }),
    )
    expect(row[11]).toBe('Lab: delay in processing')
    expect(row[QCH_GROUP_HEADER.indexOf('Image 1') + 5]).toBe('Waiting for transport to imaging; Other')
  })

  it('is one row per case on the sheet, with both header rows', () => {
    const sheet = qchSheet([FULL, caseWith({})])
    expect(sheet.name).toBe('Navigator sheet')
    expect(sheet.groupHeader).toEqual(QCH_GROUP_HEADER)
    expect(sheet.header).toEqual(QCH_HEADER)
    expect(sheet.rows).toHaveLength(2)
  })
})

describe('fmtHm', () => {
  it('is the original’s h:mm text, not a decimal', () => {
    expect(fmtHm(2.5)).toBe('2:30')
    expect(fmtHm(0)).toBe('0:00')
    expect(fmtHm(7.25)).toBe('7:15')
    expect(fmtHm(26.5)).toBe('26:30')
  })

  it('carries the rounding rather than writing sixty minutes', () => {
    expect(fmtHm(1.9994)).toBe('2:00')
  })

  it('is blank for a duration that could not be measured', () => {
    expect(fmtHm(null)).toBe('')
    expect(fmtHm(undefined)).toBe('')
  })
})

describe('the Read me', () => {
  const text = qchReadMeRows({ cases: [FULL], range: RANGE, generatedAt: new Date('2026-09-01T12:00:00Z') })
    .map((r) => r.cells.join(' — '))
    .join('\n')

  it('states the range, the status filter and how many rows it wrote', () => {
    expect(text).toContain('2026-09-01 to 2026-09-01')
    expect(text).toContain('All')
    expect(text).toContain('Rows written — 1')
  })

  it('says the patient name is not reproduced', () => {
    expect(text).toContain('The patient name column is not reproduced')
  })

  it('names every column that is present and blank', () => {
    for (const column of [
      'ER MD name',
      'Treatment Plan Shared',
      'Adissional investigation',
      'intructions given by doctor',
      'ADMISSION ORDER IN ISTRUCTION',
      'Case Manager Name',
      'ED NAVIGATOR NAME 2',
      'Reviewed By',
    ]) {
      expect(text, `${column} is explained`).toContain(column)
    }
  })

  it('counts the imaging and consult rows the two blocks could not hold', () => {
    expect(text).toContain('1 case(s) in this range have a third imaging row')
    expect(text).toContain('1 case(s) in this range have a third consult')
  })

  it('explains the time zone, the h:mm durations and the per-case reasons', () => {
    expect(text).toContain('Asia/Riyadh')
    expect(text).toContain('h:mm')
    expect(text).toContain('A reason belongs to the case, not to one image or one consult')
  })
})
