import { describe, expect, it } from 'vitest'
import { FIXTURE, NOW } from '@/src/lib/domain/__tests__/aggregates.fixture'
import { dashboard } from '@/src/lib/domain/aggregates'
import {
  DEFAULT_RANGE,
  DRILL_SECTIONS,
  dashboardHref,
  drillKey,
  gridKey,
  investigationLabel,
  parseDrill,
  parseRange,
  resolveDrill,
} from '@/src/lib/dashboard/drill'

/**
 * The URL half of the dashboard. Resolution runs against the hand-computed fixture in
 * `src/lib/domain/__tests__/aggregates.fixture.ts`, so a drill-down's case list is checked
 * against the same numbers the aggregate tests check.
 */
const data = dashboard(FIXTURE, '30', NOW)

describe('parseRange', () => {
  it.each(['7', '30', '90', 'all'])('accepts %s', (r) => {
    expect(parseRange(r)).toBe(r)
  })

  it.each([undefined, null, '', '14', 'ALL', 'all-time', '30 ', 'drop table'])(
    'falls back to 30 days for %s',
    (r) => {
      expect(parseRange(r)).toBe(DEFAULT_RANGE)
    },
  )

  it('takes the first value when Next hands it a repeated parameter', () => {
    expect(parseRange(['7', '90'])).toBe('7')
    expect(parseRange(['nonsense', '7'])).toBe(DEFAULT_RANGE)
  })
})

describe('parseDrill', () => {
  it('splits section from name', () => {
    expect(parseDrill('threshold:6')).toEqual({ section: 'threshold', name: '6' })
    expect(parseDrill('dept:ICU')).toEqual({ section: 'dept', name: 'ICU' })
  })

  it('splits on the first colon only, because reason names contain colons', () => {
    expect(parseDrill('primary:Lab: delay in processing')).toEqual({
      section: 'primary',
      name: 'Lab: delay in processing',
    })
  })

  it.each([
    undefined,
    null,
    '',
    'threshold',
    ':6',
    'threshold:',
    'nonsense:6',
    'Threshold:6',
    'primaryreason:x',
    '../../etc/passwd',
  ])('returns null for %s', (value) => {
    expect(parseDrill(value)).toBeNull()
  })

  it('round-trips a key built by drillKey', () => {
    expect(parseDrill(drillKey('shift', 'MORNING'))).toEqual({ section: 'shift', name: 'MORNING' })
    expect(parseDrill(drillKey('threshold', 24))).toEqual({ section: 'threshold', name: '24' })
  })
})

describe('dashboardHref', () => {
  it('leaves the default range implicit', () => {
    expect(dashboardHref('30')).toBe('/dashboard')
    expect(dashboardHref('7')).toBe('/dashboard?r=7')
    expect(dashboardHref('all')).toBe('/dashboard?r=all')
  })

  it('encodes the drill key', () => {
    expect(dashboardHref('30', 'primary:Lab: delay in processing')).toBe(
      '/dashboard?drill=primary%3ALab%3A+delay+in+processing',
    )
    expect(dashboardHref('7', 'threshold:6')).toBe('/dashboard?r=7&drill=threshold%3A6')
  })
})

describe('resolveDrill', () => {
  it('resolves a threshold row to every case past it, open or resolved', () => {
    // Fixture, 30 days, NOW: C4 (25h), C3 (13h), C6 (10h LOS), C5 (8h), C8 (7h), C2 (7h), C7 (6h).
    const drill = resolveDrill(data, { section: 'threshold', name: '6' })
    expect(drill?.label).toBe('Cases over 6h')
    expect(drill?.ids.sort()).toEqual(['C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'])
  })

  it('resolves a primary reason, a stage and a department to their rows', () => {
    expect(resolveDrill(data, { section: 'primary', name: 'No bed available on accepting ward' })).toEqual({
      key: { section: 'primary', name: 'No bed available on accepting ward' },
      label: 'No bed available on accepting ward',
      ids: ['C1', 'C5'],
    })
    expect(resolveDrill(data, { section: 'stage', name: 'Triage' })?.ids).toEqual(['C11', 'C12'])
    expect(resolveDrill(data, { section: 'dept', name: 'MROD' })?.ids).toEqual(['C1', 'C5'])
  })

  it('labels a shift and a disposition the way the prototype does', () => {
    expect(resolveDrill(data, { section: 'shift', name: 'NIGHT' })?.label).toBe('Night shift')
    expect(resolveDrill(data, { section: 'dispo', name: 'DISCHARGED_DAMA' })?.label).toBe('Discharged DAMA')
  })

  it('resolves an investigation by its type and labels it by its name', () => {
    const drill = resolveDrill(data, { section: 'investigation', name: 'CT' })
    expect(drill?.label).toBe('CT')
    expect(drill?.ids).toEqual(['C6'])
    expect(investigationLabel('XR')).toBe('X-ray / KUB')
  })

  it('resolves a week by its Sunday and a weekday by its name', () => {
    const week = data.weeks[0]!
    expect(resolveDrill(data, { section: 'week', name: week.weekStart })?.ids).toEqual(week.ids)
    expect(resolveDrill(data, { section: 'weekday', name: 'Tue' })?.ids.length).toBeGreaterThan(0)
  })

  it('resolves a consulted team to the cases behind its median', () => {
    expect(resolveDrill(data, { section: 'consult', name: 'ICU' })?.ids).toEqual(['C2'])
  })

  it('returns null for a row that is not in this range, so the page falls back', () => {
    expect(resolveDrill(data, { section: 'threshold', name: '5' })).toBeNull()
    expect(resolveDrill(data, { section: 'dept', name: 'Psychiatry' })).toBeNull()
    expect(resolveDrill(data, { section: 'primary', name: 'No resus bay available' })).toBeNull()
    expect(resolveDrill(data, { section: 'week', name: '1999-01-03' })).toBeNull()
    expect(resolveDrill(data, { section: 'investigation', name: 'MRI' })).toBeNull()
  })

  it('never resolves a voided case into a drill-down', () => {
    const every = [
      ...data.thresholds.flatMap((r) => r.allIds),
      ...data.byPrimary.flatMap((r) => r.ids),
      ...data.byStage.flatMap((r) => r.ids),
    ]
    expect(every).not.toContain('C10')
  })
})

/**
 * Phase 8: one drill-down per new count row. The ids are the same lists
 * `src/lib/domain/__tests__/aggregates.test.ts` hand-computes; what is checked here is that every
 * section name reaches them, that the grid sections split their two coordinates, and that a row
 * which has fallen out of range still resolves to null rather than throwing.
 */
describe('resolveDrill, the Phase 8 sections', () => {
  it('resolves a stay band, a treated-within band and an outcome', () => {
    expect(resolveDrill(data, { section: 'stayband', name: '24+ h' })).toEqual({
      key: { section: 'stayband', name: '24+ h' },
      label: 'Stay 24+ h',
      ids: ['C4'],
    })
    expect(resolveDrill(data, { section: 'treated', name: 'Within 4 h' })).toMatchObject({
      label: 'Door to disposition: Within 4 h',
      ids: ['C12'],
    })
    expect(resolveDrill(data, { section: 'outcome', name: 'Discharged home' })?.ids).toEqual(['C6', 'C7'])
    expect(resolveDrill(data, { section: 'outcome', name: 'Still open' })?.ids).toEqual(['C1', 'C2', 'C3', 'C4', 'C11'])
  })

  it('a target resolves by its key to the cases that MISSED it', () => {
    const drill = resolveDrill(data, { section: 'target', name: 'consult60' })
    expect(drill?.label).toBe('Missed: Consulted team responded within 1 h')
    expect(drill?.ids).toEqual(['C2', 'C5'])
    expect(resolveDrill(data, { section: 'target', name: 'nonsense' })).toBeNull()
  })

  it('the two grid sections split unit or type from band on the pipe', () => {
    expect(gridKey('CT', '2–4 h')).toBe('CT|2–4 h')
    expect(resolveDrill(data, { section: 'turnaround', name: gridKey('CT', '2–4 h') })).toMatchObject({
      label: 'CT order to result 2–4 h',
      ids: ['C6'],
    })
    // No ward code in the fixture, so every admission band is empty — but it still resolves.
    expect(resolveDrill(data, { section: 'unitband', name: gridKey('ICU', '≤30 min') })).toMatchObject({
      label: 'ICU-type unit, admission order to left ED ≤30 min',
      ids: [],
    })
    expect(resolveDrill(data, { section: 'unitband', name: 'ICU' })).toBeNull()
    expect(resolveDrill(data, { section: 'turnaround', name: gridKey('PET', '2–4 h') })).toBeNull()
  })

  it('resolves an action kind, a CTAS level, an area and a completeness row', () => {
    expect(resolveDrill(data, { section: 'action', name: 'Case / bed management' })?.ids).toEqual(['C5'])
    expect(resolveDrill(data, { section: 'action', name: 'No action documented' })?.ids).toHaveLength(9)
    expect(resolveDrill(data, { section: 'ctas', name: '3' })).toMatchObject({ label: 'CTAS 3', ids: ['C1'] })
    expect(resolveDrill(data, { section: 'ctas', name: 'Not recorded' })?.label).toBe('CTAS not recorded')
    expect(resolveDrill(data, { section: 'area', name: 'Acute area' })).toMatchObject({ label: 'Acute area', ids: ['C6'] })
    expect(resolveDrill(data, { section: 'quality', name: 'Times out of order' })?.ids).toEqual(['C12'])
  })

  it('a repeat visit resolves by MRN, and an unknown one falls back', () => {
    // Every fixture MRN is distinct, so there is no repeat row to hit.
    expect(resolveDrill(data, { section: 'repeat', name: '100001' })).toBeNull()
    expect(resolveDrill(data, { section: 'examconsult', name: 'MROD' })).toBeNull() // no physician times
  })

  it('every Phase 8 section is parseable and round-trips through drillKey', () => {
    for (const section of DRILL_SECTIONS) {
      expect(parseDrill(drillKey(section, 'x'))).toEqual({ section, name: 'x' })
    }
  })
})
