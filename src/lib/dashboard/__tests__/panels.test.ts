import { describe, expect, it } from 'vitest'
import {
  BELOW_MIN_N,
  BENCHMARK_TEXT,
  adaaRows,
  fmtMinutes,
  fmtShare,
  fmtSignedHours,
  headlineTiles,
  sharePercent,
} from '@/src/lib/dashboard/panels'
import { FIXTURE, NOW } from '@/src/lib/domain/__tests__/aggregates.fixture'
import { dashboard } from '@/src/lib/domain/aggregates'
import type { AdaaSummaryRow } from '@/src/lib/domain/kpi'

/**
 * The formatting layer between `dashboard().kpi` and the sections. Nothing here counts anything;
 * what it must never do is invent a number where the module refused to give one, so every case
 * below either formats a real figure or renders "n<3".
 */
describe('formatters', () => {
  it('a share is whole percent, and null is the n<3 the whole app shows', () => {
    expect(fmtShare(0.3)).toBe('30%')
    expect(fmtShare(0)).toBe('0%')
    expect(fmtShare(1)).toBe('100%')
    expect(fmtShare(2 / 3)).toBe('67%')
    expect(fmtShare(null)).toBe('n<3')
    expect(BELOW_MIN_N).toBe('n<3')
  })

  it('a bar width is the same percent, and nothing at all when there is no share', () => {
    expect(sharePercent(0.5)).toBe(50)
    expect(sharePercent(null)).toBe(0)
  })

  it('minutes are whole, with a dash for nothing measured', () => {
    expect(fmtMinutes(150)).toBe('150 min')
    expect(fmtMinutes(29.6)).toBe('30 min')
    expect(fmtMinutes(null)).toBe('–')
  })

  it('a signed duration carries its sign and the carry rule', () => {
    expect(fmtSignedHours(1.5)).toBe('+1h 30m')
    expect(fmtSignedHours(-1.5)).toBe('-1h 30m')
    expect(fmtSignedHours(0)).toBe('+0h 00m')
    // splitHours' carry: 6.9944 h is 6 h 59.67 min, which rounds to 7h 00m, never "6h 60m".
    expect(fmtSignedHours(-6.9944)).toBe('-7h 00m')
  })
})

describe('headlineTiles', () => {
  const thirty = dashboard(FIXTURE, '30', NOW).kpi
  const tiles = headlineTiles(thirty, '30')
  const tile = (key: string) => tiles.find((t) => t.key === key)!

  it('is the seven tiles the spec lists, in order', () => {
    expect(tiles.map((t) => t.key)).toEqual(['cases', 'episodes', 'median', 'mean', 'range', 'atLeast10', 'longest'])
    expect(tiles.map((t) => t.label)).toEqual([
      'Cases',
      'Episodes',
      'Median stay',
      'Mean stay',
      'Range',
      '10 h or more',
      'Longest stay',
    ])
  })

  it('formats the ten in-range cases: median 7 h, mean 8h 30m, 2 h to 25 h, 30 % past 10 h', () => {
    expect(tile('cases').value).toBe('10')
    expect(tile('episodes').value).toBe('10')
    expect(tile('median').value).toBe('7h 00m')
    expect(tile('mean').value).toBe('8h 30m')
    expect(tile('range').value).toBe('2h 00m – 25h 00m')
    expect(tile('atLeast10').value).toBe('30%')
    expect(tile('longest').value).toBe('25h 00m')
  })

  it('links the longest stay to its case and nothing else', () => {
    expect(tile('longest').href).toMatch(/^\/cases\/C4$/)
    expect(tiles.filter((t) => t.href)).toHaveLength(1)
  })

  it('compares against the previous window, which for these thirty days is C9 alone', () => {
    // C9 is one case with a 9 h stay: ten cases now against one then, 25 h against 9 h.
    expect(tile('cases').delta).toBe('+9 vs previous 30 days')
    expect(tile('episodes').delta).toBe('+9 vs previous 30 days')
    expect(tile('longest').delta).toBe('+16h 00m vs previous 30 days')
    // One case cannot have a median, a mean or a share, so those three deltas are withheld.
    expect(tile('median').delta).toBeNull()
    expect(tile('mean').delta).toBeNull()
    expect(tile('atLeast10').delta).toBeNull()
    // The range is a pair of facts, not a figure to trend.
    expect(tile('range').delta).toBeNull()
  })

  it('offers no delta at all on all time, which has no period before it', () => {
    const all = headlineTiles(dashboard(FIXTURE, 'all', NOW).kpi, 'all')
    expect(all.every((t) => t.delta === null)).toBe(true)
  })

  it('shows a median as n<3 rather than a number when the window is too small', () => {
    const seven = headlineTiles(dashboard(FIXTURE.slice(0, 2), '7', NOW).kpi, '7')
    expect(seven.find((t) => t.key === 'median')!.value).toBe('n<3')
    expect(seven.find((t) => t.key === 'atLeast10')!.value).toBe('n<3')
    // A minimum and a maximum are still facts at n = 2.
    expect(seven.find((t) => t.key === 'range')!.value).toBe('3h 00m – 7h 00m')
  })
})

describe('adaaRows', () => {
  const blank: AdaaSummaryRow = {
    ctas: 'overall',
    total: 0,
    ids: [],
    kpi1TotalMin: null,
    kpi1N: 0,
    kpi1Med: null,
    kpi2TotalMin: null,
    kpi2N: 0,
    kpi2Med: null,
    kpi3TotalMin: null,
    kpi3N: 0,
    kpi3Med: null,
    treated: [0, 0, 0, 0, 0, 0, 0],
    treatedN: 0,
    withinFourShare: null,
    damaShare: null,
    resolvedN: 0,
    nonUrgentShare: null,
    withCtasN: 0,
    deceasedShare: null,
    deceasedN: 0,
    uccN: 0,
    kpi8TotalMin: null,
    kpi8N: 0,
    kpi8Med: null,
    painkiller: [0, 0, 0, 0],
    pethidine: [0, 0, 0],
    painkillerYesN: 0,
    pethidineYesN: 0,
    sickleCellYesN: 0,
  }

  it('is the eight rows in the spec order: 1, 2, 3, 5, 6, 7, 8, then 4', () => {
    expect(adaaRows(blank).map((r) => r.kpi)).toEqual(['kpi1', 'kpi2', 'kpi3', 'kpi5', 'kpi6', 'kpi7', 'kpi8', 'kpi4'])
    expect(adaaRows(blank).map((r) => r.name)).toEqual([
      'KPI 1 · Door to doctor, median',
      'KPI 2 · Doctor to decision, median',
      'KPI 3 · Decision to disposition, median',
      'KPI 5 · Door to disposition within 4 h',
      'KPI 6 · Discharged DAMA',
      'KPI 7 · Mortality (deceased among tracked cases)',
      'KPI 8 · Door to painkiller, median',
      'KPI 4 · CTAS 4 or 5',
    ])
  })

  it('counts KPI 7 over every tracked case and KPI 8 over the ones with a painkiller time', () => {
    const rows = adaaRows({ ...blank, total: 20, deceasedN: 1, deceasedShare: 0.05, kpi8N: 4, kpi8Med: 45 })
    const byKpi = Object.fromEntries(rows.map((r) => [r.kpi, r]))
    // The denominator is `total`, open cases included, which is the form's own (kpi.ts).
    expect(byKpi.kpi7).toMatchObject({ n: 20, value: '5%', band: null })
    expect(byKpi.kpi8).toMatchObject({ n: 4, value: '45 min', band: 'world' })
  })

  it('grades KPI 8 on the minutes benchmark and never grades KPI 7', () => {
    const band = (kpi8Med: number) => adaaRows({ ...blank, kpi8N: 5, kpi8Med }).find((r) => r.kpi === 'kpi8')!.band
    expect([band(59), band(60), band(181), band(301)]).toEqual(['world', 'acceptable', 'improve', 'unacceptable'])
    // A mortality rate of 100 % is still ungraded: the form gives KPI 7 no benchmark.
    expect(adaaRows({ ...blank, total: 4, deceasedN: 4, deceasedShare: 1 }).find((r) => r.kpi === 'kpi7')!.band).toBeNull()
  })

  it('grades each value against the Adaa definitions and picks the token band', () => {
    const rows = adaaRows({
      ...blank,
      kpi1N: 8,
      kpi1Med: 9, // under 10 min: world class
      kpi2N: 8,
      kpi2Med: 75, // 60 to 90 min: needs improvement
      kpi3N: 8,
      kpi3Med: 200, // over 130 min: unacceptable
      treatedN: 8,
      withinFourShare: 0.8, // 0.75 to 0.95: acceptable
      resolvedN: 8,
      damaShare: 0.1,
      withCtasN: 8,
      nonUrgentShare: 0.2, // under 0.33: world class
    })
    expect(rows.map((r) => [r.value, r.band])).toEqual([
      ['9 min', 'world'],
      ['75 min', 'improve'],
      ['200 min', 'unacceptable'],
      ['80%', 'acceptable'],
      ['10%', null], // KPI 6 has no benchmark in the form
      ['n<3', null], // KPI 7: nothing to divide, and no benchmark either way
      ['n<3', null], // KPI 8: no painkiller recorded on this row
      ['20%', 'world'],
    ])
    expect(BENCHMARK_TEXT.world).toBe('text-band-ok')
    expect(BENCHMARK_TEXT.acceptable).toBe('text-accent-ink')
    expect(BENCHMARK_TEXT.improve).toBe('text-band-h4-ink')
    expect(BENCHMARK_TEXT.unacceptable).toBe('text-band-h6')
  })

  it('shows n<3 with no benchmark colour where nothing could be measured', () => {
    expect(adaaRows(blank).every((r) => r.value === 'n<3' && r.band === null)).toBe(true)
  })
})
