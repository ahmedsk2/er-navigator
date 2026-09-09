import { describe, expect, it } from 'vitest'
import {
  ADAA_HEADER,
  ADAA_PAIN_HEADER,
  ADAA_SUMMARY_HEADER,
  BENCHMARK_FILL,
  adaaManualSheet,
  adaaReadMeRows,
  adaaRow,
  adaaSummaryRows,
  admissionType,
  answerYesNo,
  dischargeType,
  pethidineDose,
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

  it('leaves Admission Type blank on a patient who was discharged with a ward still on the case (Phase 8 review C1)', () => {
    const home = caseWith({
      status: 'RESOLVED',
      registrationAt: new Date('2026-09-01T05:00:00Z'),
      departedAt: new Date('2026-09-01T09:00:00Z'),
      resolvedAt: new Date('2026-09-01T09:00:00Z'),
      disposition: 'DISCHARGED_HOME',
      wardCode: 'ICU',
    })
    const row = adaaRow(home)
    expect(row[16]).toBe('')
    expect(row[17]).toBe('Home')
    // Admitted: the ward is reported. Open with a ward already recorded: reported too.
    expect(adaaRow(caseWith({ ...home, disposition: 'ADMITTED' }))[16]).toBe('ICU')
    expect(adaaRow(caseWith({ status: 'OPEN', wardCode: 'MMW' }))[16]).toBe('Ward')
  })

  it('blanks the triage cells when the triage fell on the Riyadh day before registration (Phase 8 review C3)', () => {
    const ambulance = caseWith({
      registrationAt: new Date('2026-09-01T21:30:00Z'), // 00:30 Riyadh, 02-Sep
      triageAt: new Date('2026-09-01T20:50:00Z'), // 23:50 Riyadh, 01-Sep
    })
    const row = adaaRow(ambulance)
    expect(row[1]).toBe('02-Sep-2026')
    expect(row[2]).toBe('00:30')
    expect(row[3]).toBe('')
    expect(row[4]).toBe('')
    // A triage earlier the same Riyadh day is written as it is: no offset, its own time.
    const sameDay = caseWith({ registrationAt: new Date('2026-09-01T05:30:00Z'), triageAt: new Date('2026-09-01T05:10:00Z') })
    expect(adaaRow(sameDay).slice(3, 5)).toEqual(['', '08:10'])
  })

  /**
   * Phase 8b, decision F: columns I to N. The block sits between the physician time (H) and the
   * decision offset (O), so the two cells either side of it are asserted with it — a block written
   * one column out would still look right on its own.
   */
  it('writes the pain-management block into columns I to N', () => {
    const pain = caseWith({
      mrn: '3200099',
      registrationAt: new Date('2026-09-01T19:30:00Z'), // 22:30 Riyadh, 01-Sep
      physicianAt: new Date('2026-09-01T22:00:00Z'), // 01:00 Riyadh, 02-Sep
      sickleCellTreatment: 'YES',
      painkillerPrescribed: 'YES',
      painkillerAt: new Date('2026-09-01T22:20:00Z'), // 01:20 Riyadh, the next Riyadh day
      pethidinePrescribed: 'YES',
      pethidineDoseMg: 100,
      decisionAt: new Date('2026-09-02T04:00:00Z'),
    })
    const row = adaaRow(pain)
    expect(row[7]).toBe('01:00') // H, the column before the block
    expect(row.slice(8, 14)).toEqual(['Yes', 'Yes', '1', 'Yes', '100', '01:20'])
    expect(row[14]).toBe('1') // O, the column after it
  })

  it('leaves each pain question blank rather than writing a No the navigator did not give', () => {
    // Nothing answered: six blank cells, not "No" four times.
    expect(adaaRow(caseWith({})).slice(8, 14)).toEqual(['', '', '', '', '', ''])
    // Answered No: the No is written, and the three cells that depend on a Yes stay blank.
    const refused = caseWith({ sickleCellTreatment: 'NO', painkillerPrescribed: 'NO', pethidinePrescribed: 'NO' })
    expect(adaaRow(refused).slice(8, 14)).toEqual(['No', 'No', '', 'No', '', ''])
    expect(answerYesNo('YES')).toBe('Yes')
    expect(answerYesNo('NO')).toBe('No')
    expect(answerYesNo('NOT_SURE')).toBe('')
    expect(answerYesNo(null)).toBe('')
  })

  it('writes the painkiller time with no day offset when it was given the same Riyadh day', () => {
    const sameDay = caseWith({
      registrationAt: new Date('2026-09-01T05:00:00Z'), // 08:00 Riyadh
      painkillerPrescribed: 'YES',
      painkillerAt: new Date('2026-09-01T05:45:00Z'), // 08:45 Riyadh
    })
    expect(adaaRow(sameDay).slice(8, 14)).toEqual(['', 'Yes', '', '', '', '08:45'])
  })

  it('writes only a dose the form’s dropdown has, and only when pethidine was prescribed', () => {
    const with_ = (over: Parameters<typeof caseWith>[0]) => pethidineDose(caseWith(over))
    expect(with_({ pethidinePrescribed: 'YES', pethidineDoseMg: 50 })).toBe('50')
    expect(with_({ pethidinePrescribed: 'YES', pethidineDoseMg: 150 })).toBe('150')
    // Off the list, or missing: blank, and `kpi.ts` puts the case in no band either.
    expect(with_({ pethidinePrescribed: 'YES', pethidineDoseMg: 75 })).toBe('')
    expect(with_({ pethidinePrescribed: 'YES', pethidineDoseMg: null })).toBe('')
    // A dose left on a case whose answer says No is not reported as a prescription.
    expect(with_({ pethidinePrescribed: 'NO', pethidineDoseMg: 100 })).toBe('')
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

  it('maps every disposition the form has a discharge type for, decision E’s two included', () => {
    expect(dischargeType('DISCHARGED_HOME')).toBe('Home')
    expect(dischargeType('DISCHARGED_DAMA')).toBe('DAMA')
    expect(dischargeType('TRANSFERRED')).toBe('Another Health Facility')
    expect(dischargeType('DECEASED')).toBe('Deceased')
    expect(dischargeType('REFERRED_UCC')).toBe('Referred to UCC')
    expect(dischargeType('ADMITTED')).toBe('')
    expect(dischargeType('LEFT_WITHOUT_BEING_SEEN')).toBe('')
    expect(dischargeType(null)).toBe('')
  })

  it('leaves Admission Type alone for the two new dispositions: neither is an admission', () => {
    const dead = caseWith({ status: 'RESOLVED', disposition: 'DECEASED', wardCode: 'ICU', departedAt: new Date('2026-09-01T09:00:00Z'), resolvedAt: new Date('2026-09-01T09:00:00Z') })
    expect(adaaRow(dead)[16]).toBe('')
    expect(adaaRow(dead)[17]).toBe('Deceased')
    expect(adaaRow(caseWith({ ...dead, disposition: 'REFERRED_UCC' }))[16]).toBe('')
    expect(adaaRow(caseWith({ ...dead, disposition: 'REFERRED_UCC' }))[17]).toBe('Referred to UCC')
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

  it('appends KPI 7 and KPI 8 to the CTAS table without moving anything to their left', () => {
    expect(ADAA_SUMMARY_HEADER.slice(-2)).toEqual(['KPI 7 % deceased', 'KPI 8 door to painkiller (total minutes)'])
    // KPI 5 and KPI 6 are still columns 13 and 14: nothing before the two new ones has moved.
    expect(ADAA_SUMMARY_HEADER[12]).toBe('KPI 5 % within 4 h')
    expect(ADAA_SUMMARY_HEADER[13]).toBe('KPI 6 % DAMA')
  })
})

/**
 * Phase 8b: KPI 7, KPI 8 and the form's Pain Killer Statistics block, over cases built for them —
 * one death, one referral to the UCC, and three painkillers that land in three different bands.
 */
describe('the KPI summary sheet, Phase 8b', () => {
  const resolvedAt = new Date('2026-09-01T09:00:00Z')
  const outcome = (id: string, disposition: string) =>
    caseWith({ id, mrn: id, status: 'RESOLVED', ctas: 3, departedAt: resolvedAt, resolvedAt, disposition })
  /** Registered 08:00 Riyadh; the painkiller `minutes` later, so the band is arithmetic, not luck. */
  const pain = (id: string, minutes: number, dose: number | null) =>
    caseWith({
      id,
      mrn: id,
      ctas: 3,
      registrationAt: new Date('2026-09-01T05:00:00Z'),
      painkillerPrescribed: 'YES',
      painkillerAt: new Date(new Date('2026-09-01T05:00:00Z').getTime() + minutes * 60_000),
      pethidinePrescribed: dose == null ? 'NO' : 'YES',
      pethidineDoseMg: dose,
    })

  const cases = [
    outcome('d1', 'DECEASED'),
    outcome('u1', 'REFERRED_UCC'),
    pain('p1', 20, 50),
    pain('p2', 90, null),
    // Prescribed but never timed: counted as prescribed, in no band, and KPI 8 cannot see it.
    caseWith({ id: 'p3', mrn: 'p3', ctas: 3, painkillerPrescribed: 'YES', painkillerAt: null }),
  ]
  const rows = adaaSummaryRows(cases)
  const rowFor = (heading: string, label: string): string[] => {
    const start = rows.findIndex((r) => r.cells[0] === heading)
    const found = rows.slice(start).find((r) => r.cells[0] === label)
    if (!found) throw new Error(`no "${label}" row under "${heading}"`)
    return found.cells
  }

  it('divides the deaths by every tracked case in the group, open ones included', () => {
    // Five cases in all, one of them Deceased: 20.0 %, whatever their status.
    expect(rowFor('ED statistics, tracked cases', 'Total')[14]).toBe('20.0%')
    expect(rowFor('ED statistics, tracked cases', 'Total')[1]).toBe('5')
    // Below MIN_N the share is withheld, exactly as the app withholds it on screen.
    expect(adaaSummaryRows([outcome('d1', 'DECEASED')]).find((r) => r.cells[0] === 'Total')!.cells[14]).toBe('n<3')
  })

  it('totals the door-to-painkiller minutes and colours the cell by their mean', () => {
    const total = rowFor('ED statistics, tracked cases', 'Total')
    expect(total[15]).toBe('110') // 20 + 90 minutes; p3 has no time and is in neither
    // The mean is 55 minutes, which is under an hour: world class.
    const line = rows.find((r) => r.cells[0] === 'Total' && r.cells.length === ADAA_SUMMARY_HEADER.length)!
    expect(line.fills?.[15]).toBe(BENCHMARK_FILL.world)
    expect(line.fills?.[14]).toBeNull() // KPI 7 has no benchmark in the form
  })

  it('lays the Pain Killer Statistics block out per CTAS with its two denominators', () => {
    expect(rows.map((r) => r.cells[0])).toContain('Pain Killer Statistics (KPI 8)')
    expect(ADAA_PAIN_HEADER).toEqual([
      'CTAS',
      'Painkiller prescribed',
      '≤30 min',
      '>30 min–1 h',
      '>1–3 h',
      '>3 h',
      'Pethidine prescribed',
      '50 mg',
      '100 mg',
      '150 mg',
      'Door to painkiller (total minutes)',
    ])
    // Three painkillers prescribed, two of them timed: 20 min in the first band, 90 in the third.
    // One pethidine, 50 mg. The prescribed columns are the denominators, and they do not agree
    // with the bands, which is the point of stating them.
    expect(rowFor('Pain Killer Statistics (KPI 8)', 'Total')).toEqual([
      'Total',
      '3',
      '1',
      '0',
      '1',
      '0',
      '1',
      '1',
      '0',
      '0',
      '110',
    ])
    // Every case here is CTAS 3, so the level row repeats the total and CTAS 1 is empty.
    expect(rowFor('Pain Killer Statistics (KPI 8)', 'CTAS 3').slice(1)).toEqual(['3', '1', '0', '1', '0', '1', '1', '0', '0', '110'])
    expect(rowFor('Pain Killer Statistics (KPI 8)', 'CTAS 1').slice(1)).toEqual(['0', '0', '0', '0', '0', '0', '0', '0', '0', ''])
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
  })

  it('says what KPI 7 and KPI 8 are, and no longer says they cannot be produced', () => {
    expect(text).toContain('LAMA is still not a disposition in ER Navigator')
    expect(text).toContain('KPI 7 is the Deceased dispositions divided by every tracked case in the range, open ones included')
    expect(text).toContain('KPI 8 is the door to the painkiller being given')
    expect(text).toContain('Pain Killer Statistics block')
    // The two lines Slice H removes, because they stopped being true.
    expect(text).not.toContain('KPI 8 cannot be produced')
    expect(text).not.toContain('KPI 7 (mortality) is not produced')
    expect(text).not.toContain('Columns I to N (sickle-cell treatment, painkiller prescribed, its calendar-day offset, pethidine, the dose and the time given) are always blank')
  })

  it('says where a painkiller with no time, or a pethidine with no on-list dose, ends up', () => {
    expect(text).toContain('is in no band and in no dose column')
    expect(text).toContain('dashboard’s Documentation section')
    expect(text).toContain('never "No"')
  })

  it('counts the rows whose triage cells were left blank', () => {
    const ambulance = caseWith({
      registrationAt: new Date('2026-09-01T21:30:00Z'),
      triageAt: new Date('2026-09-01T20:50:00Z'),
    })
    const rows = adaaReadMeRows({ cases: [ambulance, OVERNIGHT], range: RANGE, generatedAt: new Date('2026-09-09T12:00:00Z') })
    const row = rows.find((r) => r.cells[0]?.startsWith('Rows whose triage cells were left blank'))
    expect(row?.cells[1]).toBe('1')
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
