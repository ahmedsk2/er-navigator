import { describe, expect, it } from 'vitest'
import { FIXTURE, NOW, h } from '@/src/lib/domain/__tests__/aggregates.fixture'
import { dashboard } from '@/src/lib/domain/aggregates'
import { EMPTY_FILTER } from '@/src/lib/domain/case-filter'
// A case that records nothing, so each phase case below names exactly the times the split reads.
import { caseWith } from '@/src/lib/export/__tests__/phase8.fixture'
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

  /**
   * Phase 10. The filter is appended after `r` and `drill`, and an empty one is not appended at
   * all — which is what keeps every string above exactly what it was before the filter existed.
   */
  it('emits nothing at all for an empty filter, however it is passed', () => {
    expect(dashboardHref('30', null, EMPTY_FILTER)).toBe('/dashboard')
    expect(dashboardHref('7', null, EMPTY_FILTER)).toBe('/dashboard?r=7')
    expect(dashboardHref('7', 'threshold:6', EMPTY_FILTER)).toBe('/dashboard?r=7&drill=threshold%3A6')
    // The two modes alone are not a selection, so they are not a filter and emit nothing.
    expect(dashboardHref('30', null, { ...EMPTY_FILTER, not: true, lone: true })).toBe('/dashboard')
  })

  it('appends the filter after the range and the drill key', () => {
    const filter = { ...EMPTY_FILTER, stage: ['adm', 'inv'], payer: ['INSURED' as const], not: true }
    expect(dashboardHref('30', null, filter)).toBe('/dashboard?stage=adm&stage=inv&payer=INSURED&not=1')
    expect(dashboardHref('7', 'threshold:6', filter)).toBe(
      '/dashboard?r=7&drill=threshold%3A6&stage=adm&stage=inv&payer=INSURED&not=1',
    )
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

  /**
   * Phase 8b. The fixture records no pain block and no discharge answers, so what is proved here
   * is the routing: every band, dose and question resolves to a row (empty, but a row), the two
   * halves of the pain block do not collide, and the three new documentation rows come through
   * `quality` like the six before them.
   */
  it('the pain block splits bands from doses on the pipe', () => {
    expect(resolveDrill(data, { section: 'painkiller', name: gridKey('band', '≤30 min') })).toMatchObject({
      label: 'Door to painkiller ≤30 min',
      ids: [],
    })
    expect(resolveDrill(data, { section: 'painkiller', name: gridKey('band', '>3 h') })?.label).toBe(
      'Door to painkiller >3 h',
    )
    expect(resolveDrill(data, { section: 'painkiller', name: gridKey('dose', '100 mg') })).toMatchObject({
      label: 'Pethidine 100 mg',
      ids: [],
    })
    // A dose is not a band and a band is not a dose, and a name with no half resolves to nothing.
    expect(resolveDrill(data, { section: 'painkiller', name: gridKey('band', '100 mg') })).toBeNull()
    expect(resolveDrill(data, { section: 'painkiller', name: gridKey('dose', '≤30 min') })).toBeNull()
    expect(resolveDrill(data, { section: 'painkiller', name: '≤30 min' })).toBeNull()
  })

  it('the two discharge-communication questions resolve to the cases that answered', () => {
    expect(resolveDrill(data, { section: 'communication', name: 'Instructions given by doctor' })).toMatchObject({
      label: 'Instructions given by doctor: recorded',
      ids: [],
    })
    expect(resolveDrill(data, { section: 'communication', name: 'Family engaged' })?.label).toBe(
      'Family engaged: recorded',
    )
    expect(resolveDrill(data, { section: 'communication', name: 'Something else' })).toBeNull()
  })

  it('the three new documentation rows come through `quality` with the six before them', () => {
    // Every resolved case in the fixture is unreviewed; no case records a painkiller at all.
    expect(resolveDrill(data, { section: 'quality', name: 'Resolved, not yet reviewed' })?.ids).toEqual([
      'C5',
      'C6',
      'C7',
      'C8',
      'C12',
    ])
    expect(resolveDrill(data, { section: 'quality', name: 'Painkiller prescribed, no time given recorded' })?.ids).toEqual([])
    expect(
      resolveDrill(data, { section: 'quality', name: 'Pethidine prescribed, dose missing or not 50 / 100 / 150 mg' })?.ids,
    ).toEqual([])
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

describe('Phase 10 drill-downs', () => {
  it('resolves a phase by its grid key: the measured cases, the longest, or a stage row', () => {
    expect(resolveDrill(data, { section: 'phase', name: gridKey('front', 'median') })).toMatchObject({
      label: 'Front end: cases with the interval measured',
      ids: [],
    })
    expect(resolveDrill(data, { section: 'phase', name: gridKey('after', 'longest') })).toMatchObject({
      label: 'After the decision: the longest phase of the stay',
    })
    expect(resolveDrill(data, { section: 'phase', name: gridKey('decision', 'Investigations') })).toMatchObject({
      label: 'Investigations (decision)',
    })
    expect(resolveDrill(data, { section: 'phase', name: gridKey('decision', 'No such stage') })).toBeNull()
    expect(resolveDrill(data, { section: 'phase', name: gridKey('nowhere', 'median') })).toBeNull()
  })

  it('resolves a payer row, naming the missing one plainly', () => {
    expect(resolveDrill(data, { section: 'payer', name: 'Not recorded' })).toMatchObject({ label: 'Payer not recorded' })
    expect(resolveDrill(data, { section: 'payer', name: 'Government' })).toMatchObject({ label: 'Payer: Government', ids: [] })
  })
})

/**
 * The phase rows' ids. The dashboard fixture records no physician or decision time and no stage
 * code, so every phase resolution above hands back an empty list and would still pass with its
 * id lists swapped. These five cases are the kpi.test.ts phase fixture (a–e) on this file's
 * clock, hand-computed there: front end b 0.5 h, c 0.5, d 1, e 0.25; decision b 6, c 2.5, d 1,
 * e 2.75; after c 7, d 4, e 1.5 (b is still open). So the longest phase is the decision for e and
 * what comes after it for c and d, and the Investigations reason is carried by a and e.
 *
 * At every row asked for below, the three lists a resolution could hand back — the measured
 * cases, the longest-phase cases and the stage row — differ, so each assertion fails if
 * `resolveDrill` answers with the wrong one.
 */
describe('Phase 10 drill-downs, over cases the phase split can measure', () => {
  const phased = dashboard(
    [
      caseWith({ id: 'a', mrn: '3300001', registrationAt: h(8), stageCodes: ['inv'] }),
      caseWith({
        id: 'b',
        mrn: '3300002',
        registrationAt: h(26.5),
        triageAt: h(26.25),
        physicianAt: h(26),
        decisionAt: h(20),
        stageCodes: ['ref', 'adm'],
      }),
      caseWith({
        id: 'c',
        mrn: '3300003',
        status: 'RESOLVED',
        registrationAt: h(13),
        triageAt: h(12.75),
        physicianAt: h(12.5),
        decisionAt: h(10),
        departedAt: h(3),
        resolvedAt: h(3),
        stageCodes: ['adm'],
      }),
      caseWith({
        id: 'd',
        mrn: '3300004',
        status: 'RESOLVED',
        registrationAt: h(30),
        physicianAt: h(29),
        decisionAt: h(28),
        departedAt: h(24),
        resolvedAt: h(24),
        stageCodes: ['dc'],
      }),
      caseWith({
        id: 'e',
        mrn: '3300005',
        status: 'RESOLVED',
        registrationAt: h(20),
        physicianAt: h(19.75),
        decisionAt: h(17),
        departedAt: h(15.5),
        resolvedAt: h(15.5),
        stageCodes: ['inv'],
      }),
    ],
    'all',
    NOW,
  )
  const phase = (name: string) => resolveDrill(phased, { section: 'phase', name })

  it('front|median lists every case whose front end was measured, and no longest-phase list', () => {
    // The front end is the longest phase of no case here, so a swapped list would be empty.
    expect(phase(gridKey('front', 'median'))).toEqual({
      key: { section: 'phase', name: 'front|median' },
      label: 'Front end: cases with the interval measured',
      ids: ['b', 'c', 'd', 'e'],
    })
  })

  it('after|longest lists the cases where leaving took longest, not every case that left', () => {
    // e left too (1.5 h after the decision), but its decision phase was the longer.
    expect(phase(gridKey('after', 'longest'))).toEqual({
      key: { section: 'phase', name: 'after|longest' },
      label: 'After the decision: the longest phase of the stay',
      ids: ['c', 'd'],
    })
  })

  it('a decision-phase stage row lists the cases carrying that stage, measured or not', () => {
    // a has no interval measured at all and is still on the row; b, c and d carry no such reason.
    expect(phase(gridKey('decision', 'Investigations'))).toEqual({
      key: { section: 'phase', name: 'decision|Investigations' },
      label: 'Investigations (decision)',
      ids: ['a', 'e'],
    })
  })
})
