import { describe, expect, it } from 'vitest'
import { EMPTY_FILTER } from '@/src/lib/domain/case-filter'
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

/**
 * A case carrying everything Phase 8b added that this sheet has a column for: both discharge
 * answers, the whole case-management block, and a supervisor's review mark. Nothing else, so a
 * cell that should not have moved can be told apart from one that should.
 */
const COLLECTED = caseWith({
  mrn: '3200002',
  status: 'RESOLVED',
  registrationAt: new Date('2026-09-01T05:00:00Z'), // 08:00
  departedAt: new Date('2026-09-01T12:00:00Z'),
  resolvedAt: new Date('2026-09-01T12:00:00Z'),
  disposition: 'DISCHARGED_HOME',
  instructionsGiven: 'YES',
  familyEngagement: 'NOT_SURE',
  caseMgmtReferral: 'COMPLEX_CARE',
  caseMgmtCriteria: 'MEETS',
  caseMgmtAction: 'ENROLLED',
  caseMgmtCalledAt: new Date('2026-09-01T07:00:00Z'), // 10:00
  caseMgmtRepliedAt: new Date('2026-09-01T08:30:00Z'), // 11:30
  reviewedAt: new Date('2026-09-01T13:00:00Z'),
  reviewedByName: 'Sami Supervisor',
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
      '', // intructions given by doctor: not answered on this case
      '', // Family Engagement: not answered either
      '12:30',
      '', // ADMISSION ORDER IN ISTRUCTION
      'ICU / ISOLATION',
      '', // Referral to Case Management: no referral on this case
      '', // Complex care Cordinator comment
      '', // Complex care Coordinator Action
      '', // Case Manager Name: a staff name, which this app does not hold
      '', // Time of call case manger
      '', // Time of case manger replay
      '15:15',
      '2:45',
      '7:15',
      'No bed available on accepting ward',
      '09:00 Bed requested | 13:00 Chased ward',
      'Nadia Navigator',
      'nadia',
      '', // ED NAVIGATOR NAME 2
      '', // Reviewed By: not marked reviewed
    ])
  })

  /**
   * Phase 8b, decisions B, D, E, G and H. Every one of these columns was present and blank until
   * Slice H; each is asserted by name rather than by position, so the block below reads as the
   * list of what changed.
   */
  it('fills the discharge answers, the case-management block and the review mark', () => {
    const row = qchRow(COLLECTED)
    const cell = (name: string) => row[QCH_GROUP_HEADER.indexOf(name)]
    expect(cell('intructions given by doctor')).toBe('Yes')
    expect(cell('Family Engagement')).toBe('Not sure')
    expect(cell('Referral to Case Management')).toBe('Complex care co.')
    expect(cell('Complex care Cordinator comment')).toBe('Meeting criteria')
    expect(cell('Complex care Coordinator Action')).toBe('enrolled')
    expect(cell('Time of call case manger')).toBe('10:00')
    expect(cell('Time of case manger replay')).toBe('11:30')
    expect(cell('Reviewed By')).toBe('Sami Supervisor')
    // The one column in the block that stays blank, and why: it names a member of staff.
    expect(cell('Case Manager Name')).toBe('')
  })

  it('writes the sheet’s own case-management words, not the editor’s chips', () => {
    const other = qchRow(
      caseWith({ caseMgmtReferral: 'CASE_MANAGER', caseMgmtCriteria: 'NOT_MEETING', caseMgmtAction: 'FOR_ENROLLMENT' }),
    )
    expect(other[QCH_GROUP_HEADER.indexOf('Referral to Case Management')]).toBe('Case manager')
    expect(other[QCH_GROUP_HEADER.indexOf('Complex care Cordinator comment')]).toBe('Not meeting criteria')
    expect(other[QCH_GROUP_HEADER.indexOf('Complex care Coordinator Action')]).toBe('for enrollment')
  })

  it('leaves every Phase 8b column blank on a case that recorded none of it', () => {
    const empty = qchRow(caseWith({}))
    for (const name of [
      'intructions given by doctor',
      'Family Engagement',
      'Referral to Case Management',
      'Complex care Cordinator comment',
      'Complex care Coordinator Action',
      'Case Manager Name',
      'Time of call case manger',
      'Time of case manger replay',
      'Reviewed By',
    ]) {
      expect(empty[QCH_GROUP_HEADER.indexOf(name)], `${name} is blank`).toBe('')
    }
  })

  it('writes the two answers as No where they were answered No', () => {
    const no = qchRow(caseWith({ instructionsGiven: 'NO', familyEngagement: 'NO' }))
    expect(no[QCH_GROUP_HEADER.indexOf('intructions given by doctor')]).toBe('No')
    expect(no[QCH_GROUP_HEADER.indexOf('Family Engagement')]).toBe('No')
  })

  it('gives an MRI an image block of its own, after the CT (decision G)', () => {
    const scanned = qchRow(
      caseWith({
        investigations: [
          investigation({ type: 'MRI', orderedAt: new Date('2026-09-01T08:00:00Z'), doneAt: new Date('2026-09-01T09:00:00Z') }),
          investigation({ type: 'CT', orderedAt: new Date('2026-09-01T06:00:00Z') }),
        ],
      }),
    )
    const image1 = QCH_GROUP_HEADER.indexOf('Image 1')
    const image2 = QCH_GROUP_HEADER.indexOf('Image 2')
    expect(scanned[image1]).toBe('CT')
    expect(scanned[image2]).toBe('MRI')
    expect(scanned[image2 + 1]).toBe('11:00') // its order time
    expect(scanned[image2 + 2]).toBe('12:00') // scan done
    expect(scanned[QCH_GROUP_HEADER.indexOf('Images Requested')]).toBe('Yes')
  })

  it('writes Deceased and Referred to UCC verbatim into both decision columns (decision E)', () => {
    const resolved = (disposition: string) =>
      qchRow(
        caseWith({
          status: 'RESOLVED',
          disposition,
          departedAt: new Date('2026-09-01T09:00:00Z'),
          resolvedAt: new Date('2026-09-01T09:00:00Z'),
        }),
      )
    const dead = resolved('DECEASED')
    expect(dead[QCH_GROUP_HEADER.indexOf('ER-MD Decision')]).toBe('Deceased')
    expect(dead[QCH_GROUP_HEADER.indexOf('Final Decision')]).toBe('Deceased')
    const ucc = resolved('REFERRED_UCC')
    expect(ucc[QCH_GROUP_HEADER.indexOf('ER-MD Decision')]).toBe('Referred to UCC')
    expect(ucc[QCH_GROUP_HEADER.indexOf('Final Decision')]).toBe('Referred to UCC')
    // Neither went to a ward, so the two ward columns stay blank.
    expect(dead[QCH_GROUP_HEADER.indexOf('Time of Disposition TO WARD')]).toBe('')
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
    // Phase 13 (decision A): the nursing handover was the preferred value in this column and a
    // third admission signal. It is merged into "Left ED", so an open case with an order has no
    // ward time at all until it leaves, and a resolved admitted one has its departure (15:15 in
    // the full row above).
    const open = caseWith({ status: 'OPEN', disposition: null, admOrderAt: new Date('2026-09-01T07:00:00Z') })
    expect(qchRow(open)[QCH_GROUP_HEADER.indexOf('Time of Disposition TO WARD')]).toBe('')
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

  /** Phase 13 (decision A): the sentence used to offer the nursing handover first. */
  it('explains the ward time as the departure, with no mention of a handover', () => {
    expect(text).toContain(
      'Time of Disposition TO WARD is the departure from the ED, and is blank for a patient who was never admitted.',
    )
    expect(text).not.toContain('nursing handover')
  })

  it('names every column that is present and blank', () => {
    for (const column of [
      'ER MD name',
      'Treatment Plan Shared',
      'Adissional investigation',
      'ADMISSION ORDER IN ISTRUCTION',
      'Case Manager Name',
      'ED NAVIGATOR NAME 2',
    ]) {
      expect(text, `${column} is explained`).toContain(column)
    }
  })

  it('says how the columns Slice H filled are filled, and no longer calls them unrecorded', () => {
    expect(text).toContain('written as Yes, No or Not sure')
    expect(text).toContain('"Case manager" or "Complex care co."')
    expect(text).toContain('"Meeting criteria" or "Not meeting criteria"')
    expect(text).toContain('"enrolled" or "for enrollment"')
    expect(text).toContain('Reviewed By is the display name of the supervisor who marked the case reviewed')
    expect(text).toContain('An MRI is written as the image type "MRI"')
    expect(text).toContain('CT, ultrasound, X-ray, MRI order')
    // The one column of the block that is still blank is still explained as such.
    expect(text).toContain('ER Navigator holds no staff names beyond the app’s own users')
    expect(text).not.toContain('The whole case-management block')
    expect(text).not.toContain('Both discharge-quality items')
    expect(text).not.toContain('A supervisor review mark per case.')
  })

  it('says the two new dispositions are written verbatim rather than folded into "Other"', () => {
    expect(text).toContain('The August dropdown has no Deceased and no referral to the UCC')
    expect(text).toContain('write "Deceased" and "Referred to UCC" verbatim')
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

  /**
   * Phase 10. The navigators' sheet from a filtered export holds part of their log, and the Read
   * me says which part: the case filter right under the status filter, and no such row without one.
   */
  it('names the case filter under the status filter, and only when there is one', () => {
    const generatedAt = new Date('2026-09-01T12:00:00Z')
    const plain = qchReadMeRows({ cases: [FULL], range: RANGE, generatedAt })
    const labels = plain.map((r) => r.cells[0])
    expect(labels).not.toContain('Case filter')
    expect(labels[labels.indexOf('Status filter') + 1]).toBe('Rows written')

    const narrowed = qchReadMeRows({
      cases: [FULL],
      range: { ...RANGE, filter: { ...EMPTY_FILTER, dept: ['ICU'] } },
      generatedAt,
      filterLine: 'Team: ICU',
    })
    const status = narrowed.findIndex((r) => r.cells[0] === 'Status filter')
    expect(narrowed[status + 1]?.cells).toEqual(['Case filter', 'Team: ICU'])
    expect(narrowed.filter((_, i) => i !== status + 1)).toEqual(plain)
  })
})
