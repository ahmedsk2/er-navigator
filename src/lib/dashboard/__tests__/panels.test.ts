import { describe, expect, it } from 'vitest'
import {
  BELOW_MIN_N,
  BENCHMARK_TEXT,
  adaaBullets,
  adaaRows,
  heatLegend,
  heatStep,
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
      'KPI 7 · Mortality',
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
    expect(adaaRows(blank).every((r) => r.raw === null)).toBe(true)
  })

  it('carries the unformatted value beside the formatted one', () => {
    const rows = adaaRows({ ...blank, kpi1N: 8, kpi1Med: 29.6, treatedN: 8, withinFourShare: 0.8 })
    expect(rows.find((r) => r.kpi === 'kpi1')).toMatchObject({ value: '30 min', raw: 29.6 })
    expect(rows.find((r) => r.kpi === 'kpi5')).toMatchObject({ value: '80%', raw: 0.8 })
  })
})

/**
 * Phase 11: the Adaa panel's bullet charts. What is tested is the geometry — the four tiers to
 * scale, left to right best first, and where the marker lands — because that is the part a
 * component cannot be trusted to get right by eye. Positions are fractions of the track.
 */
describe('adaaBullets', () => {
  const blankRow: AdaaSummaryRow = {
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
  const tiers = (b: { tiers: ReadonlyArray<{ tier: string; from: number; to: number }> }) =>
    b.tiers.map((t) => [t.tier, +t.from.toFixed(4), +t.to.toFixed(4)])

  it('is one bullet per KPI with a benchmark, in the table order: 1, 2, 3, 5, 8, 4', () => {
    expect(adaaBullets(blankRow).map((b) => b.kpi)).toEqual(['kpi1', 'kpi2', 'kpi3', 'kpi5', 'kpi8', 'kpi4'])
  })

  it('draws the track and no marker below three cases, with n<3 for the value', () => {
    for (const b of adaaBullets(blankRow)) {
      expect(b.marker, b.kpi).toBeNull()
      expect(b.value, b.kpi).toBe('n<3')
      expect(b.band, b.kpi).toBeNull()
      expect(b.tiers.map((t) => t.tier), b.kpi).toEqual(['world', 'acceptable', 'improve', 'unacceptable'])
    }
  })

  it('draws a minutes KPI to scale, running half as far again past the last boundary', () => {
    // KPI 1: under 10 min, to 20, to 40, then more; nothing measured, so the track ends at 60.
    const kpi1 = adaaBullets(blankRow).find((b) => b.kpi === 'kpi1')!
    expect(tiers(kpi1)).toEqual([
      ['world', 0, 0.1667],
      ['acceptable', 0.1667, 0.3333],
      ['improve', 0.3333, 0.6667],
      ['unacceptable', 0.6667, 1],
    ])
    // A median of 30 min sits halfway along, inside "needs improvement".
    const at30 = adaaBullets({ ...blankRow, kpi1N: 5, kpi1Med: 30 }).find((b) => b.kpi === 'kpi1')!
    expect(at30.marker).toBe(0.5)
    expect(at30.band).toBe('improve')
  })

  it('stretches the track to reach a value past its end, so the marker is where the value is', () => {
    // KPI 3 in the demo: 390 min against boundaries of 30, 90 and 130. The track ends 10 % past
    // the value, at 429 min, and the tiers shrink to keep their scale.
    const kpi3 = adaaBullets({ ...blankRow, kpi3N: 5, kpi3Med: 390 }).find((b) => b.kpi === 'kpi3')!
    expect(tiers(kpi3)).toEqual([
      ['world', 0, +(30 / 429).toFixed(4)],
      ['acceptable', +(30 / 429).toFixed(4), +(90 / 429).toFixed(4)],
      ['improve', +(90 / 429).toFixed(4), +(130 / 429).toFixed(4)],
      ['unacceptable', +(130 / 429).toFixed(4), 1],
    ])
    expect(kpi3.marker).toBeCloseTo(390 / 429, 12)
    expect(kpi3.band).toBe('unacceptable')
  })

  it('reads KPI 5 the same way round: 100 % on the left, the best tier first', () => {
    // Higher is better: over 95 % world class, to 75 % acceptable, to 60 % needs improvement.
    const kpi5 = adaaBullets({ ...blankRow, treatedN: 5, withinFourShare: 0.8 }).find((b) => b.kpi === 'kpi5')!
    expect(tiers(kpi5)).toEqual([
      ['world', 0, 0.05],
      ['acceptable', 0.05, 0.25],
      ['improve', 0.25, 0.4],
      ['unacceptable', 0.4, 1],
    ])
    expect(kpi5.marker).toBeCloseTo(0.2, 12)
    expect(kpi5.band).toBe('acceptable')
    // None seen within four hours is the far right, the worst end, as on every other track.
    expect(adaaBullets({ ...blankRow, treatedN: 5, withinFourShare: 0 }).find((b) => b.kpi === 'kpi5')!.marker).toBe(1)
  })

  it('draws a share KPI that is better low from 0 to 100 %', () => {
    const kpi4 = adaaBullets({ ...blankRow, withCtasN: 5, nonUrgentShare: 0.4 }).find((b) => b.kpi === 'kpi4')!
    expect(tiers(kpi4)).toEqual([
      ['world', 0, 0.33],
      ['acceptable', 0.33, 0.5],
      ['improve', 0.5, 0.75],
      ['unacceptable', 0.75, 1],
    ])
    expect(kpi4.marker).toBe(0.4)
    expect(kpi4.value).toBe('40%')
  })

  it('keeps every tier inside the track and in order, whatever the value', () => {
    for (const med of [0, 5, 59, 60, 181, 450, 3000]) {
      const kpi8 = adaaBullets({ ...blankRow, kpi8N: 4, kpi8Med: med }).find((b) => b.kpi === 'kpi8')!
      expect(kpi8.tiers[0]!.from).toBe(0)
      expect(kpi8.tiers[3]!.to).toBe(1)
      kpi8.tiers.forEach((t, i) => {
        expect(t.to).toBeGreaterThan(t.from)
        if (i > 0) expect(t.from).toBe(kpi8.tiers[i - 1]!.to)
      })
      expect(kpi8.marker!).toBeGreaterThanOrEqual(0)
      expect(kpi8.marker!).toBeLessThan(1)
    }
  })
})

/** Phase 11: the arrivals table's fills, four steps against the fullest cell, and their key. */
describe('heat steps', () => {
  it('leaves an empty cell plain and steps the rest by quarters of the fullest', () => {
    expect(heatStep(0, 5)).toBe(0)
    expect(heatStep(0, 0)).toBe(0)
    expect([1, 2, 3, 4, 5].map((v) => heatStep(v, 5))).toEqual([1, 2, 3, 4, 4])
    expect([1, 3, 4, 6, 7, 9, 10, 12].map((v) => heatStep(v, 12))).toEqual([1, 1, 2, 2, 3, 3, 4, 4])
    // A single case in the fullest cell is the fullest cell.
    expect(heatStep(1, 1)).toBe(4)
    expect([1, 2].map((v) => heatStep(v, 2))).toEqual([2, 4])
  })

  it('keys each step to the counts that reach it, and leaves out the steps no count reaches', () => {
    expect(heatLegend(12)).toEqual([
      { step: 1, label: '1–3' },
      { step: 2, label: '4–6' },
      { step: 3, label: '7–9' },
      { step: 4, label: '10–12' },
    ])
    expect(heatLegend(5)).toEqual([
      { step: 1, label: '1' },
      { step: 2, label: '2' },
      { step: 3, label: '3' },
      { step: 4, label: '4–5' },
    ])
    expect(heatLegend(2)).toEqual([
      { step: 2, label: '1' },
      { step: 4, label: '2' },
    ])
    expect(heatLegend(1)).toEqual([{ step: 4, label: '1' }])
    expect(heatLegend(0)).toEqual([])
    // The key and the cells agree on every count up to the fullest.
    for (const max of [1, 2, 3, 5, 7, 12, 31]) {
      for (let v = 1; v <= max; v += 1) {
        const step = heatStep(v, max)
        const entry = heatLegend(max).find((e) => e.step === step)!
        const [from, to] = entry.label.split('–').map(Number) as [number, number | undefined]
        expect(v, `${v} of ${max}`).toBeGreaterThanOrEqual(from)
        expect(v, `${v} of ${max}`).toBeLessThanOrEqual(to ?? from)
      }
    }
  })
})
