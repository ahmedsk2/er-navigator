import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTER,
  caseFilterQuery,
  describeFilter,
  filterChips,
  isEmptyFilter,
  matchesFilter,
  parseCaseFilter,
  withoutFilterValue,
  type CaseFilter,
  type FilterableCase,
} from '../case-filter'

/**
 * The filter is the one piece of Phase 10 that three pages share, so it is tested as maths: a
 * query string in, a predicate out, and the same answer whichever page asked. Everything here is
 * pure — no database, no reference load — because that is the whole point of the module.
 */

const filter = (over: Partial<CaseFilter> = {}): CaseFilter => ({ ...EMPTY_FILTER, ...over })

const kase = (over: Partial<FilterableCase> = {}): FilterableCase => ({
  stageCodes: [],
  reasonNames: [],
  departmentNames: [],
  areaCode: null,
  ctas: null,
  payer: null,
  disposition: null,
  ...over,
})

/** The two reference lists `describeFilter` needs: a code is not a name a nurse would recognise. */
const REFERENCE = {
  stages: [
    { code: 'adm', name: 'Admission process' },
    { code: 'inv', name: 'Investigations' },
  ],
  areas: [
    { code: 'RESUS', name: 'Resuscitation area' },
    { code: 'RAZ', name: 'Rapid assessment zone' },
  ],
}

describe('parseCaseFilter', () => {
  it('reads nothing out of an empty query, and says so', () => {
    const parsed = parseCaseFilter(new URLSearchParams(''))
    expect(parsed).toEqual(EMPTY_FILTER)
    expect(isEmptyFilter(parsed)).toBe(true)
    expect(caseFilterQuery(parsed)).toBe('')
  })

  it('reads every dimension, repeated per value, plus the two modes', () => {
    const parsed = parseCaseFilter(
      new URLSearchParams(
        'stage=adm&stage=inv&reason=Lab%3A+delay+in+processing&dept=ICU&area=RESUS&ctas=2&ctas=3&payer=INSURED&dispo=ADMITTED&not=1&lone=1',
      ),
    )
    expect(parsed).toEqual({
      stage: ['adm', 'inv'],
      reason: ['Lab: delay in processing'],
      dept: ['ICU'],
      area: ['RESUS'],
      ctas: [2, 3],
      payer: ['INSURED'],
      dispo: ['ADMITTED'],
      not: true,
      lone: true,
    })
  })

  it('accepts Next’s own searchParams record, arrays and single strings alike', () => {
    expect(parseCaseFilter({ stage: ['adm', 'inv'], payer: 'SELF_PAY', not: '1' })).toEqual(
      filter({ stage: ['adm', 'inv'], payer: ['SELF_PAY'], not: true }),
    )
  })

  it('round-trips: parse(query(f)) is f', () => {
    const f = filter({
      stage: ['adm'],
      reason: ['Lab: delay in processing', 'Imaging: report delay'],
      dept: ['Internal Medicine'],
      area: ['RAZ'],
      ctas: [1, 5],
      payer: ['GOVERNMENT', 'SELF_PAY'],
      dispo: ['DISCHARGED_HOME'],
      not: true,
      lone: true,
    })
    expect(parseCaseFilter(new URLSearchParams(caseFilterQuery(f)))).toEqual(f)
  })

  it('emits the keys in the documented order, and the flags last', () => {
    expect(
      caseFilterQuery(
        filter({
          stage: ['adm'],
          reason: ['R'],
          dept: ['D'],
          area: ['RAZ'],
          ctas: [3],
          payer: ['INSURED'],
          dispo: ['ADMITTED'],
          not: true,
          lone: true,
        }),
      ),
    ).toBe('stage=adm&reason=R&dept=D&area=RAZ&ctas=3&payer=INSURED&dispo=ADMITTED&not=1&lone=1')
  })

  it('ignores what it cannot use rather than refusing the page', () => {
    const parsed = parseCaseFilter(
      new URLSearchParams('ctas=0&ctas=6&ctas=three&payer=CASH&dispo=SOMETHING&stage=&not=yes&lone=0&unknown=x'),
    )
    expect(parsed).toEqual(EMPTY_FILTER)
    expect(isEmptyFilter(parsed)).toBe(true)
  })

  it('drops duplicates so one chip is one value', () => {
    expect(parseCaseFilter(new URLSearchParams('stage=adm&stage=adm&ctas=3&ctas=3')).stage).toEqual(['adm'])
    expect(parseCaseFilter(new URLSearchParams('ctas=3&ctas=3')).ctas).toEqual([3])
  })

  /**
   * `not` and `lone` are modifiers on a selection, never a selection of their own: on their own
   * they would read as "exclude every case", which is a blank board nobody asked for.
   */
  it('treats the two modes alone as no filter at all', () => {
    const parsed = parseCaseFilter(new URLSearchParams('not=1&lone=1'))
    expect(isEmptyFilter(parsed)).toBe(true)
    expect(caseFilterQuery(parsed)).toBe('')
    expect(matchesFilter(kase(), parsed)).toBe(true)
  })
})

describe('matchesFilter', () => {
  it('keeps everything when nothing is selected', () => {
    expect(matchesFilter(kase({ ctas: 3 }), EMPTY_FILTER)).toBe(true)
  })

  it('is OR within a dimension', () => {
    const f = filter({ stage: ['adm', 'inv'] })
    expect(matchesFilter(kase({ stageCodes: ['adm'] }), f)).toBe(true)
    expect(matchesFilter(kase({ stageCodes: ['inv', 'dc'] }), f)).toBe(true)
    expect(matchesFilter(kase({ stageCodes: ['dc'] }), f)).toBe(false)
    expect(matchesFilter(kase({ stageCodes: [] }), f)).toBe(false)
  })

  it('is AND across dimensions', () => {
    const f = filter({ stage: ['adm'], payer: ['INSURED'] })
    expect(matchesFilter(kase({ stageCodes: ['adm'], payer: 'INSURED' }), f)).toBe(true)
    expect(matchesFilter(kase({ stageCodes: ['adm'], payer: 'GOVERNMENT' }), f)).toBe(false)
    expect(matchesFilter(kase({ stageCodes: ['inv'], payer: 'INSURED' }), f)).toBe(false)
  })

  it('matches each single-valued dimension, and never matches a case that recorded nothing', () => {
    expect(matchesFilter(kase({ areaCode: 'RESUS' }), filter({ area: ['RESUS'] }))).toBe(true)
    expect(matchesFilter(kase({ areaCode: null }), filter({ area: ['RESUS'] }))).toBe(false)
    expect(matchesFilter(kase({ ctas: 2 }), filter({ ctas: [2, 3] }))).toBe(true)
    expect(matchesFilter(kase({ ctas: 4 }), filter({ ctas: [2, 3] }))).toBe(false)
    expect(matchesFilter(kase({ ctas: null }), filter({ ctas: [2] }))).toBe(false)
    expect(matchesFilter(kase({ payer: 'SELF_PAY' }), filter({ payer: ['SELF_PAY'] }))).toBe(true)
    expect(matchesFilter(kase({ payer: null }), filter({ payer: ['SELF_PAY'] }))).toBe(false)
    expect(matchesFilter(kase({ disposition: 'ADMITTED' }), filter({ dispo: ['ADMITTED'] }))).toBe(true)
    expect(matchesFilter(kase({ disposition: null }), filter({ dispo: ['ADMITTED'] }))).toBe(false)
  })

  it('matches the reasons and the consulted teams by name', () => {
    const f = filter({ reason: ['Lab: delay in processing'], dept: ['ICU'] })
    expect(
      matchesFilter(kase({ reasonNames: ['Lab: delay in processing'], departmentNames: ['ICU', 'MROD'] }), f),
    ).toBe(true)
    expect(matchesFilter(kase({ reasonNames: ['Lab: delay in processing'], departmentNames: ['MROD'] }), f)).toBe(
      false,
    )
  })

  it('negates the whole match with not, so the two halves partition the cases', () => {
    const cases = [
      kase({ stageCodes: ['adm'], payer: 'INSURED' }),
      kase({ stageCodes: ['adm'], payer: 'GOVERNMENT' }),
      kase({ stageCodes: ['inv'], payer: 'INSURED' }),
      kase({}),
    ]
    const keep = filter({ stage: ['adm'], payer: ['INSURED'] })
    const drop = filter({ stage: ['adm'], payer: ['INSURED'], not: true })
    expect(cases.map((c) => matchesFilter(c, keep))).toEqual([true, false, false, false])
    expect(cases.map((c) => matchesFilter(c, drop))).toEqual([false, true, true, true])
  })

  describe('lone: the case’s own set equals the selection', () => {
    it('holds a multi-valued dimension to exactly the selected values', () => {
      const f = filter({ stage: ['adm', 'inv'], lone: true })
      expect(matchesFilter(kase({ stageCodes: ['adm', 'inv'] }), f)).toBe(true)
      // Order is not part of a set.
      expect(matchesFilter(kase({ stageCodes: ['inv', 'adm'] }), f)).toBe(true)
      // Fewer than the selection, and more than it, are both out.
      expect(matchesFilter(kase({ stageCodes: ['adm'] }), f)).toBe(false)
      expect(matchesFilter(kase({ stageCodes: ['adm', 'inv', 'dc'] }), f)).toBe(false)
    })

    it('applies to reasons and teams too', () => {
      const f = filter({ reason: ['A'], dept: ['ICU'], lone: true })
      expect(matchesFilter(kase({ reasonNames: ['A'], departmentNames: ['ICU'] }), f)).toBe(true)
      expect(matchesFilter(kase({ reasonNames: ['A', 'B'], departmentNames: ['ICU'] }), f)).toBe(false)
      expect(matchesFilter(kase({ reasonNames: ['A'], departmentNames: ['ICU', 'MROD'] }), f)).toBe(false)
    })

    it('leaves the single-valued dimensions exactly as they were', () => {
      const among = filter({ ctas: [3], area: ['RESUS'], payer: ['INSURED'], dispo: ['ADMITTED'] })
      const lone = { ...among, lone: true }
      const c = kase({ ctas: 3, areaCode: 'RESUS', payer: 'INSURED', disposition: 'ADMITTED' })
      expect(matchesFilter(c, among)).toBe(matchesFilter(c, lone))
      expect(matchesFilter(c, lone)).toBe(true)
    })

    it('leaves an unselected dimension out of the AND, however many values the case has', () => {
      const f = filter({ stage: ['adm'], lone: true })
      expect(matchesFilter(kase({ stageCodes: ['adm'], departmentNames: ['ICU', 'MROD'] }), f)).toBe(true)
    })

    it('combines with not: everything that is not exactly this set', () => {
      const f = filter({ stage: ['adm'], lone: true, not: true })
      expect(matchesFilter(kase({ stageCodes: ['adm'] }), f)).toBe(false)
      expect(matchesFilter(kase({ stageCodes: ['adm', 'inv'] }), f)).toBe(true)
    })
  })
})

describe('filterChips and describeFilter', () => {
  it('names a stage and an area by their reference name, not their code', () => {
    const f = filter({ stage: ['adm'], area: ['RESUS'] })
    expect(filterChips(f, REFERENCE).map((c) => c.label)).toEqual([
      'Stage: Admission process',
      'Area: Resuscitation area',
    ])
  })

  it('falls back to the code when the reference no longer has the row', () => {
    expect(filterChips(filter({ stage: ['gone'] }), REFERENCE)[0]?.label).toBe('Stage: gone')
  })

  it('labels every dimension the way the page names it', () => {
    const f = filter({
      stage: ['inv'],
      reason: ['Lab: delay in processing'],
      dept: ['ICU'],
      area: ['RAZ'],
      ctas: [3],
      payer: ['SELF_PAY'],
      dispo: ['DISCHARGED_HOME'],
    })
    expect(filterChips(f, REFERENCE).map((c) => c.label)).toEqual([
      'Stage: Investigations',
      'Reason: Lab: delay in processing',
      'Team: ICU',
      'Area: Rapid assessment zone',
      'CTAS 3',
      'Payer: Self-pay',
      'Outcome: Discharged home',
    ])
  })

  it('describes the whole filter in one sentence, modes included', () => {
    expect(describeFilter(EMPTY_FILTER, REFERENCE)).toBe('')
    expect(describeFilter(filter({ stage: ['adm'] }), REFERENCE)).toBe('Stage: Admission process')
    expect(describeFilter(filter({ stage: ['adm'], payer: ['INSURED'] }), REFERENCE)).toBe(
      'Stage: Admission process · Payer: Insured',
    )
    expect(describeFilter(filter({ stage: ['adm'], not: true }), REFERENCE)).toBe(
      'Excluding Stage: Admission process',
    )
    expect(describeFilter(filter({ stage: ['adm'], lone: true }), REFERENCE)).toBe(
      'Stage: Admission process · the lone finding',
    )
  })

  /**
   * The sentence has to say what the predicate does, and the predicate is OR within a dimension,
   * AND across dimensions, and `not` over the whole conjunction. Joining every chip with " · " said
   * none of that: "Excluding Stage: Admission process · Payer: Insured" read as two exclusions.
   */
  it('joins the values of one dimension with "or", one part per dimension in dimension order', () => {
    expect(describeFilter(filter({ stage: ['adm', 'inv'] }), REFERENCE)).toBe(
      'Stage: Admission process or Investigations',
    )
    expect(
      describeFilter(
        filter({
          stage: ['inv', 'adm'],
          reason: ['Lab: delay in processing', 'Imaging: report delay'],
          dept: ['ICU', 'MROD'],
          area: ['RAZ', 'RESUS'],
          ctas: [3, 4],
          payer: ['GOVERNMENT', 'SELF_PAY'],
          dispo: ['ADMITTED', 'DISCHARGED_HOME'],
        }),
        REFERENCE,
      ),
    ).toBe(
      'Stage: Investigations or Admission process · Reason: Lab: delay in processing or Imaging: report delay · ' +
        'Team: ICU or MROD · Area: Rapid assessment zone or Resuscitation area · CTAS 3 or 4 · ' +
        'Payer: Government or Self-pay · Outcome: Admitted or Discharged home',
    )
  })

  it('joins a multi-valued dimension with "and" under the lone finding, where the case carries every one', () => {
    expect(describeFilter(filter({ stage: ['adm', 'inv'], lone: true }), REFERENCE)).toBe(
      'Stage: Admission process and Investigations · the lone finding',
    )
    // Reasons and teams are sets too; CTAS is one value per case, so its values stay alternatives.
    const sets = filter({ reason: ['A', 'B'], dept: ['ICU', 'MROD'], ctas: [3, 4], lone: true })
    expect(describeFilter(sets, REFERENCE)).toBe('Reason: A and B · Team: ICU and MROD · CTAS 3 or 4 · the lone finding')
  })

  it('excludes the cases that match the whole filter, and says so when it spans dimensions', () => {
    expect(describeFilter(filter({ stage: ['adm'], payer: ['INSURED'], not: true }), REFERENCE)).toBe(
      'Excluding cases with Stage: Admission process and Payer: Insured',
    )
    expect(describeFilter(filter({ stage: ['adm'], area: ['RESUS'], ctas: [2], not: true }), REFERENCE)).toBe(
      'Excluding cases with Stage: Admission process and Area: Resuscitation area and CTAS 2',
    )
    // One dimension is one part, however many values it has, and keeps the short form.
    expect(describeFilter(filter({ stage: ['adm', 'inv'], not: true }), REFERENCE)).toBe(
      'Excluding Stage: Admission process or Investigations',
    )
    const both = filter({ stage: ['adm', 'inv'], payer: ['INSURED'], not: true, lone: true })
    expect(describeFilter(both, REFERENCE)).toBe(
      'Excluding cases with Stage: Admission process and Investigations and Payer: Insured · the lone finding',
    )
  })

  it('leaves the chips one per value, exactly as they were', () => {
    const f = filter({ stage: ['adm', 'inv'], payer: ['INSURED'], not: true })
    expect(filterChips(f, REFERENCE).map((c) => c.label)).toEqual([
      'Stage: Admission process',
      'Stage: Investigations',
      'Payer: Insured',
    ])
  })
})

describe('withoutFilterValue', () => {
  it('removes one value and leaves the rest of the filter alone', () => {
    const f = filter({ stage: ['adm', 'inv'], ctas: [2, 3], not: true })
    expect(withoutFilterValue(f, 'stage', 'adm')).toEqual(filter({ stage: ['inv'], ctas: [2, 3], not: true }))
    expect(withoutFilterValue(f, 'ctas', '3')).toEqual(filter({ stage: ['adm', 'inv'], ctas: [2], not: true }))
  })

  it('clears the two modes with the last value, so an empty filter is really empty', () => {
    const f = filter({ stage: ['adm'], not: true, lone: true })
    expect(withoutFilterValue(f, 'stage', 'adm')).toEqual(EMPTY_FILTER)
  })
})
