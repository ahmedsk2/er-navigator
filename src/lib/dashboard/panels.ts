/**
 * What the Phase 8 dashboard sections put on screen: the seven headline tiles with their deltas,
 * the Adaa KPI rows with their benchmark colours, and the three formatters those need.
 *
 * It exists because nothing on the dashboard is allowed to compute — every figure comes out of
 * `src/lib/domain/kpi.ts` through `dashboard().kpi`, and the components only lay it out. Turning
 * 0.3 into "30%", 26.5 into "26h 30m" and a pair of headlines into "+3 vs previous 30 d" is
 * formatting, not arithmetic on the data, so it lives here where it can be unit-tested rather
 * than inside a component where it cannot.
 *
 * The four benchmark bands wear the tokens the Phase 8 spec names — world class = the ok band,
 * acceptable = accent, needs improvement = the 4 h band, unacceptable = the 6 h band — in their
 * INK variants where the token itself is too light to pass 4.5:1 as text (design/tokens.md, and
 * `parts.tsx`'s own `BAND_TEXT` does the same).
 */
import { RANGE_LABELS } from '@/src/lib/dashboard/drill'
import type { DashboardKpi, HeadlineFigures, Range } from '@/src/lib/domain/aggregates'
import { ADAA_BENCHMARKS, benchmark, type AdaaKpi, type AdaaSummaryRow, type Benchmark } from '@/src/lib/domain/kpi'
import { MIN_N, fmtHours } from '@/src/lib/domain/time'

export const BELOW_MIN_N = `n<${MIN_N}`

/** A share as whole percent, or "n<3" where the module refused to divide. */
export function fmtShare(share: number | null): string {
  return share == null ? BELOW_MIN_N : `${Math.round(share * 100)}%`
}

/** The same share as a bar width in percent. 0 when there is no share to draw. */
export function sharePercent(share: number | null): number {
  return share == null ? 0 : Math.round(share * 100)
}

/** Whole minutes, the unit the Adaa form states KPI 1 to 3 in. A dash for nothing measured. */
export function fmtMinutes(minutes: number | null): string {
  return minutes == null ? '–' : `${Math.round(minutes)} min`
}

/** A signed duration for a delta line: "+1h 20m", "-0h 45m", "+0h 00m" for no change. */
export function fmtSignedHours(hours: number): string {
  return `${hours < 0 ? '-' : '+'}${fmtHours(Math.abs(hours))}`
}

const SIGNED = (n: number): string => `${n < 0 ? '-' : '+'}${Math.abs(n)}`

export type HeadlineTile = {
  key: string
  label: string
  value: string
  /** "+3 vs previous 30 d", or null when there is no previous period or nothing to compare. */
  delta: string | null
  /** The longest stay is a case, so its tile is a link to it. */
  href?: string
  tone?: 'ink' | 'danger'
}

/**
 * The tile row that replaces the Phase 4 three.
 *
 * Every delta is against `previousRange`'s headline, which `dashboard()` measured to the instant
 * that period ended. 'All time' has no period before it, so `previous` is null and no tile
 * carries a delta line.
 */
export function headlineTiles(kpi: DashboardKpi, range: Range): HeadlineTile[] {
  const h = kpi.headline
  const p = kpi.previous?.headline ?? null
  const versus = `vs previous ${RANGE_LABELS[range].toLowerCase()}`

  const count = (now: number, before: (f: HeadlineFigures) => number): string | null =>
    p == null ? null : `${SIGNED(now - before(p))} ${versus}`
  const hours = (now: number | null, before: (f: HeadlineFigures) => number | null): string | null => {
    const was = p == null ? null : before(p)
    return now == null || was == null ? null : `${fmtSignedHours(now - was)} ${versus}`
  }
  const points = (now: number | null, before: (f: HeadlineFigures) => number | null): string | null => {
    const was = p == null ? null : before(p)
    return now == null || was == null ? null : `${SIGNED(Math.round((now - was) * 100))} pts ${versus}`
  }

  return [
    { key: 'cases', label: 'Cases', value: String(h.cases), delta: count(h.cases, (f) => f.cases) },
    { key: 'episodes', label: 'Episodes', value: String(h.episodes), delta: count(h.episodes, (f) => f.episodes) },
    {
      key: 'median',
      label: 'Median stay',
      value: h.med == null ? BELOW_MIN_N : fmtHours(h.med),
      delta: hours(h.med, (f) => f.med),
    },
    {
      key: 'mean',
      label: 'Mean stay',
      value: h.mean == null ? BELOW_MIN_N : fmtHours(h.mean),
      delta: hours(h.mean, (f) => f.mean),
    },
    {
      key: 'range',
      label: 'Range',
      // Min and max are facts, not medians: they are shown whenever there is a single stay.
      value: h.min == null || h.max == null ? '–' : `${fmtHours(h.min)} – ${fmtHours(h.max)}`,
      delta: null,
    },
    {
      key: 'atLeast10',
      label: '10 h or more',
      value: fmtShare(h.atLeast10Share),
      delta: points(h.atLeast10Share, (f) => f.atLeast10Share),
      tone: 'danger',
    },
    {
      key: 'longest',
      label: 'Longest stay',
      value: h.longest ? fmtHours(h.longest.hours) : '–',
      delta: hours(h.longest?.hours ?? null, (f) => f.longest?.hours ?? null),
      href: h.longest ? `/cases/${h.longest.id}` : undefined,
    },
  ]
}

// --- the Adaa panel ---------------------------------------------------------------------------

/** The four benchmark bands, in the text tokens `app/globals.css` defines. */
export const BENCHMARK_TEXT: Record<Benchmark, string> = {
  world: 'text-band-ok',
  acceptable: 'text-accent-ink',
  improve: 'text-band-h4-ink',
  unacceptable: 'text-band-h6',
}

export const BENCHMARK_LABELS: Record<Benchmark, string> = {
  world: 'world class',
  acceptable: 'acceptable',
  improve: 'needs improvement',
  unacceptable: 'unacceptable',
}

export type AdaaRow = {
  kpi: AdaaKpi
  name: string
  /** The unit of analysis behind the figure: cases with the KPI measurable, resolved cases, … */
  n: number
  value: string
  /** null where the KPI has no benchmark (KPI 6) or nothing was measured. */
  band: Benchmark | null
}

const ADAA_NAMES: Record<AdaaKpi, string> = {
  kpi1: 'KPI 1 · Door to doctor, median',
  kpi2: 'KPI 2 · Doctor to decision, median',
  kpi3: 'KPI 3 · Decision to disposition, median',
  kpi4: 'KPI 4 · CTAS 4 or 5',
  kpi5: 'KPI 5 · Door to disposition within 4 h',
  kpi7: 'KPI 7 · Mortality (deceased among tracked cases)',
  kpi8: 'KPI 8 · Door to painkiller, median',
  kpi6: 'KPI 6 · Discharged DAMA',
}

/** `benchmark()` only where the KPI has one and there is a value to grade. */
function bandOf(kpi: AdaaKpi, value: number | null): Benchmark | null {
  if (value == null || ADAA_BENCHMARKS[kpi] == null) return null
  return benchmark(kpi, value)
}

/**
 * The panel's six rows, in the order the Phase 8 spec lists them: the three interval KPIs, the
 * within-four-hours share, DAMA, then the non-urgent share.
 *
 * A median is already null below MIN_N (`kpi.ts` guards it), and a share is too; both render as
 * "n<3" and carry no benchmark colour, because a benchmark on two cases is not a benchmark.
 */
export function adaaRows(overall: AdaaSummaryRow): AdaaRow[] {
  const minutes = (kpi: AdaaKpi, med: number | null, n: number): AdaaRow => ({
    kpi,
    name: ADAA_NAMES[kpi],
    n,
    value: med == null ? BELOW_MIN_N : fmtMinutes(med),
    band: bandOf(kpi, med),
  })
  const share = (kpi: AdaaKpi, value: number | null, n: number): AdaaRow => ({
    kpi,
    name: ADAA_NAMES[kpi],
    n,
    value: fmtShare(value),
    band: bandOf(kpi, value),
  })
  return [
    minutes('kpi1', overall.kpi1Med, overall.kpi1N),
    minutes('kpi2', overall.kpi2Med, overall.kpi2N),
    minutes('kpi3', overall.kpi3Med, overall.kpi3N),
    share('kpi5', overall.withinFourShare, overall.treatedN),
    share('kpi6', overall.damaShare, overall.resolvedN),
    share('kpi4', overall.nonUrgentShare, overall.withCtasN),
  ]
}
