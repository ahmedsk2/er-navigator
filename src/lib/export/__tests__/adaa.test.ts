import { describe, expect, it } from 'vitest'
import {
  ADAA_HEADER,
  ADAA_SUMMARY_HEADER,
  BENCHMARK_FILL,
  adaaManualSheet,
  adaaReadMeRows,
  adaaRow,
  adaaSummaryRows,
  admissionType,
  dischargeType,
} from '../adaa'
import { dayOffset, fmtFormDate, fmtFormTime } from '../format'
import type { ExportRange } from '../range'
import { caseWith } from './phase8.fixture'

/**
 * The Adaa `ED KPIs manual` row, column by column.
 *
 * The columns are the official form's and the rows are pasted into it, so every expectation here
 * is a literal: the header text (which the receiving file matches on), the twenty cells of a
 * fully recorded case, and the same twenty for a case that recorded almost nothing, where what
 * matters is which cells are blank.
 *
 * Asia/Riyadh is UTC+3, so the fixture below registers at 22:30 on 01-Sep Riyadh and everything
 * after it falls on 02-Sep: that is the "calendar days later" arithmetic across midnight, which
 * is the one piece of date maths in this sheet that a UTC server gets wrong by default.
 */
const RANGE: ExportRange = { from: '2026-09-01', to: '2026-09-02', status: 'all', format: 'adaa' }

/** Registered 22:30 Riyadh; triaged, seen, decided and gone on the following Riyadh day. */
const OVERNIGHT = caseWith({
  status: 'RESOLVED',
  mrn: '3200001',
  ctas: 3,
  registrationAt: new Date('2026-09-01T19:30:00Z'), // 22:30 Riyadh, 01-Sep
  triageAt: new Date('2026-09-01T21:10:00Z'), // 00:10 Riyadh, 02-Sep
  physicianAt: new Date('2026-09-01T22:00:00Z'), // 01:00 Riyadh, 02-Sep
  decisionAt: new Date('2026-09-02T04:00:00Z'), // 07:00 Riyadh, 02-Sep
  departedAt: new Date('2026-09-02T07:15:00Z'), // 10:15 Riyadh, 02-Sep
  resolvedAt: new Date('2026-09-02T07:15:00Z'),
  disposition: 'ADMITTED',
  wardCode: 'PICU',
})

describe('the ED KPIs manual header', () => {
  it('is the official form’s twenty columns, in order and unedited', () => {
    expect(ADAA_HEADER).toHaveLength(20)
    expect(ADAA_HEADER[0]).toBe('Patient ID / Mandatory')
    expect(ADAA_HEADER[5]).toBe('CTAS Level / (1,2,3,4 or 5)')
    // The form's own wording, typo and unfinished sentence included: the receiving file matches on it.
    expect(ADAA_HEADER[8]).toBe('Was the treatment identified for Sicklecell condition?')
    expect(ADAA_HEADER[10]).toBe('Calendar Days later for Pain of pain killer administration /')
    expect(ADAA_HEADER[19]).toBe('Time of Disposition / (hh:mm)')
  })
})

describe('adaaRow', () => {
  it('writes every column of a case recorded across Riyadh midnight', () => {
    expect(adaaRow(OVERNIGHT)).toEqual([
      '3200001',
      '01-Sep-2026',
      '22:30',
      '1', // triage is the next Riyadh day, eighteen minutes later
      '00:10',
      '3',
      '1',
      '01:00',
      '', // sickle-cell
      '', // painkiller prescribed
      '', // calendar days later for the painkiller
      '', // pethidine
      '', // dose
      '', // time of administration
      '1',
      '07:00',
      'PICU',
      '', // an admission is not a discharge
      '1',
      '10:15',
    ])
  })

  it('leaves the day offsets blank on a case that stayed inside one Riyadh day', () => {
    const row = adaaRow(
      caseWith({
        status: 'RESOLVED',
        triageAt: new Date('2026-09-01T05:10:00Z'), // 08:10 Riyadh, same day
        physicianAt: new Date('2026-09-01T05:40:00Z'),
        decisionAt: new Date('2026-09-01T08:00:00Z'),
        departedAt: new Date('2026-09-01T09:00:00Z'),
        resolvedAt: new Date('2026-09-01T09:00:00Z'),
        disposition: 'DISCHARGED_HOME',
      }),
    )
    expect(row[3]).toBe('')
    expect(row[6]).toBe('')
    expect(row[14]).toBe('')
    expect(row[18]).toBe('')
    expect(row[17]).toBe('Home')
  })

  it('leaves everything unrecorded blank on an open case with only a registration', () => {
    expect(adaaRow(caseWith({}))).toEqual([
      '1000001',
      '01-Sep-2026',
      '08:00',
      '',
      '',
      '', // no CTAS
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '', // no ward, so no admission type
      '', // still open, so no discharge type
      '', // an open case has no time of disposition
      '',
    ])
  })

  it('is one row per case, in the order it was given them', () => {
    const sheet = adaaManualSheet([OVERNIGHT, caseWith({})])
    expect(sheet.name).toBe('ED KPIs manual')
    expect(sheet.rows.map((r) => r[0])).toEqual(['3200001', '1000001'])
  })
})

describe('the form’s value vocabularies', () => {
  it('keeps PICU and NICU as their own admission types and folds the rest into ICU or Ward', () => {
    expect(admissionType('PICU')).toBe('PICU')
    expect(admissionType('NICU')).toBe('NICU')
    expect(admissionType('AICU')).toBe('ICU')
    expect(admissionType('CCU')).toBe('ICU')
    expect(admissionType('FMW')).toBe('Ward')
    expect(admissionType(null)).toBe('')
  })

  it('maps only the three dispositions the form has a discharge type for', () => {
    expect(dischargeType('DISCHARGED_HOME')).toBe('Home')
    expect(dischargeType('DISCHARGED_DAMA')).toBe('DAMA')
    expect(dischargeType('TRANSFERRED')).toBe('Another Health Facility')
    expect(dischargeType('ADMITTED')).toBe('')
    expect(dischargeType('LEFT_WITHOUT_BEING_SEEN')).toBe('')
    expect(dischargeType(null)).toBe('')
  })
})

describe('the cell formatters the form asks for', () => {
  it('writes the date and the time the way the form parses them', () => {
    expect(fmtFormDate(new Date('2026-09-01T19:30:00Z'))).toBe('01-Sep-2026')
    expect(fmtFormDate(new Date('2026-09-01T21:10:00Z'))).toBe('02-Sep-2026')
    expect(fmtFormTime(new Date('2026-09-01T21:10:00Z'))).toBe('00:10')
    expect(fmtFormDate(null)).toBe('')
    expect(fmtFormTime(null)).toBe('')
  })

  it('counts whole Riyadh calendar days and blanks a zero, as "Enter if > 0" asks', () => {
    const registered = new Date('2026-09-01T19:30:00Z') // 22:30 Riyadh
    expect(dayOffset(registered, new Date('2026-09-01T20:59:00Z'))).toBe('') // 23:59 the same day
    expect(dayOffset(registered, new Date('2026-09-01T21:00:00Z'))).toBe('1') // 00:00 the next day
    expect(dayOffset(registered, new Date('2026-09-03T09:00:00Z'))).toBe('2')
    expect(dayOffset(registered, null)).toBe('')
  })
})

describe('the KPI summary sheet', () => {
  const rows = adaaSummaryRows([
    OVERNIGHT,
    caseWith({ id: 'C2', ctas: 3, status: 'RESOLVED', departedAt: new Date('2026-09-01T08:00:00Z'), resolvedAt: new Date('2026-09-01T08:00:00Z'), disposition: 'DISCHARGED_DAMA' }),
    caseWith({ id: 'C3' }),
  ])
  const labels = rows.map((r) => r.cells[0])

  it('lays the CTAS levels out as the official Summary does, with the header the spec names', () => {
    expect(rows[1]?.cells).toEqual(ADAA_SUMMARY_HEADER)
    expect(ADAA_SUMMARY_HEADER.slice(0, 5)).toEqual([
      'CTAS',
      'Total patients',
      'Door to Doctor (total minutes)',
      'Doctor to Decision (total minutes)',
      'Decision to Disposition (total minutes)',
    ])
    expect(labels).toEqual(
      expect.arrayContaining(['CTAS 1', 'CTAS 2', 'CTAS 3', 'CTAS 4', 'CTAS 5', 'CTAS not recorded', 'Total']),
    )
    // CTAS 1..5, then the unknown row, then the total: in that order and nothing between them.
    expect(labels.slice(2, 9)).toEqual(['CTAS 1', 'CTAS 2', 'CTAS 3', 'CTAS 4', 'CTAS 5', 'CTAS not recorded', 'Total'])
  })

  it('omits the "CTAS not recorded" row when every case has one', () => {
    expect(adaaSummaryRows([OVERNIGHT]).map((r) => r.cells[0])).not.toContain('CTAS not recorded')
  })

  it('counts the cases and the treated-within bands on the CTAS 3 row', () => {
    const ctas3 = rows.find((r) => r.cells[0] === 'CTAS 3')!
    expect(ctas3.cells[1]).toBe('2')
    // One stay of 3 h (within 4 h) and one of 11 h 45 (6–12 h); the open case is on no band.
    expect(ctas3.cells.slice(5, 12)).toEqual(['1', '0', '1', '0', '0', '0', '0'])
  })

  it('reads "n<3" rather than a share below MIN_N, and blank where nothing was measured', () => {
    const ctas3 = rows.find((r) => r.cells[0] === 'CTAS 3')!
    expect(ctas3.cells[12]).toBe('n<3')
    const ctas1 = rows.find((r) => r.cells[0] === 'CTAS 1')!
    expect(ctas1.cells[12]).toBe('')
  })

  it('colours the KPI columns by their benchmark band and leaves KPI 6 uncoloured', () => {
    const ctas3 = rows.find((r) => r.cells[0] === 'CTAS 3')!
    // Door to doctor is 2 h 30 on the one case that has a physician time: unacceptable.
    expect(ctas3.fills?.[2]).toBe(BENCHMARK_FILL.unacceptable)
    // KPI 6 has no benchmark in the form, so it is never coloured.
    expect(ctas3.fills?.[13]).toBeNull()
  })

  it('puts the admission-to-unit block and a colour key under the CTAS table', () => {
    expect(labels).toContain('Admission to unit (admission order to leaving the ED)')
    expect(labels).toContain('ICU')
    expect(labels).toContain('Ward')
    expect(labels).toContain('Benchmark colours')
  })
})

describe('the Read me', () => {
  const text = adaaReadMeRows({
    cases: [OVERNIGHT, caseWith({ id: 'C3' })],
    range: RANGE,
    generatedAt: new Date('2026-09-02T09:00:00Z'),
  })
    .map((r) => r.cells.join(' '))
    .join('\n')

  it('states the population, the range and the status filter', () => {
    expect(text).toContain('Tracked cases only')
    expect(text).toContain('2026-09-01 to 2026-09-02')
    expect(text).toContain('All')
    expect(text).toContain('Rows written 2')
  })

  it('counts the rows with no CTAS', () => {
    expect(text).toContain('Rows with no CTAS recorded 1')
  })

  it('makes every statement the spec asks for', () => {
    expect(text).toContain('the earlier of registration and triage')
    expect(text).toContain('KPI 6 here is DAMA only')
    expect(text).toContain('lower bound')
    expect(text).toContain('1 h 00.6 min')
    expect(text).toContain('Asia/Riyadh')
    expect(text).toContain('DD-MMM-YYYY')
    expect(text).toContain('KPI 8 cannot be produced')
    expect(text).toContain('KPI 7 (mortality) is not produced')
  })

  it('gives the paste range for exactly the rows written', () => {
    expect(text).toContain('select A2:T3')
    expect(text).toContain('ED KPIs 1-6 - manual')
  })

  it('says there is nothing to paste when the range is empty', () => {
    const empty = adaaReadMeRows({ cases: [], range: RANGE, generatedAt: new Date() })
      .map((r) => r.cells.join(' '))
      .join('\n')
    expect(empty).toContain('There are no rows to paste')
  })
})
