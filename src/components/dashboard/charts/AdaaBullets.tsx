/**
 * The Adaa KPIs against their benchmark tiers (Phase 11, item 1): one bullet chart per KPI with a
 * benchmark, at the top of the Adaa panel. The table under it stays, for paper and for a screen
 * reader, and reads in the same order.
 *
 * Plain HTML rather than Recharts, because a bullet chart is four rectangles and a tick, and as
 * HTML it is server-rendered, prints, and needs no JavaScript — like every table on the page. The
 * geometry — four tiers to scale, best on the left, the marker at the value — is `adaaBullets()`
 * in `src/lib/dashboard/panels.ts`, which is unit-tested; this file only lays it out.
 *
 * `dataviz`: the tiers are context, so they are quiet — neutral segments cut apart by a 2 px gap,
 * with only the tier the value is in shaded, in a light tint of the colour its name wears in the
 * text beside it. The marker is the one loud mark, ink with a surface ring. The tier colours are
 * never the only channel: the value's tier is written out beside it, as in the table.
 */
import type { Benchmark } from '@/src/lib/domain/kpi'
import { BENCHMARK_LABELS, BENCHMARK_TEXT, type AdaaBullet } from '@/src/lib/dashboard/panels'

/** The shade of the tier the value is in: a tint of the token its label is written in. */
const TIER_FILL: Record<Benchmark, string> = {
  world: 'bg-band-ok/50',
  acceptable: 'bg-accent/50',
  improve: 'bg-band-h4/55',
  unacceptable: 'bg-band-h6/50',
}

export function AdaaBullets({ bullets, wide = false }: { bullets: AdaaBullet[]; wide?: boolean }) {
  return (
    // Backgrounds are not printed unless asked for, and these tints are the chart. Across a wide
    // section on a laptop the six charts run two to a row, so no value is a page-width from its KPI.
    <div data-chart="bullets" className={`mb-3 [print-color-adjust:exact] ${wide ? 'lg:col-span-2' : ''}`}>
      <ul className={`m-0 list-none p-0 ${wide ? 'lg:grid lg:grid-cols-2 lg:gap-x-6' : ''}`}>
        {bullets.map((b) => (
          <li key={b.kpi} data-bullet={b.kpi} className="py-1.5">
            <div className="flex items-baseline justify-between gap-3 text-label">
              <span className="min-w-0 font-semibold text-ink">{b.name}</span>
              <span className={`num shrink-0 text-right ${b.band ? BENCHMARK_TEXT[b.band] : 'text-muted'}`}>
                {b.value}
                {b.band ? <span className="ml-1 text-caption text-muted">{BENCHMARK_LABELS[b.band]}</span> : null}
              </span>
            </div>
            <div aria-hidden data-track className="relative mt-1 h-4">
              {b.tiers.map((t, i) => (
                <span
                  key={t.tier}
                  data-tier={t.tier}
                  data-current={t.tier === b.band ? '' : undefined}
                  className={`absolute top-1 h-2 ${i === 0 ? 'rounded-l-chip' : ''} ${
                    i === b.tiers.length - 1 ? 'rounded-r-chip' : ''
                  } ${t.tier === b.band ? TIER_FILL[t.tier] : 'bg-line-soft'}`}
                  // Placed rather than flexed, so a tier edge sits exactly where the marker's scale
                  // puts it; the 1 px taken off each side is the 2 px surface gap between tiers.
                  style={{ left: `calc(${t.from * 100}% + 1px)`, width: `max(0px, calc(${(t.to - t.from) * 100}% - 2px))` }}
                />
              ))}
              {b.marker == null ? null : (
                <span
                  data-marker
                  className="absolute top-0 h-4 w-1 -translate-x-1/2 rounded-chip bg-ink ring-2 ring-panel"
                  style={{ left: `${b.marker * 100}%` }}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-1 mb-0 text-caption text-muted">
        Each track is the KPI&apos;s four Adaa tiers to scale, world class on the left to unacceptable on the right,
        with the value&apos;s tier shaded. KPI 5, where more is better, runs from 100% down, so its good end is on the
        left too. Under 3 cases: the track and no marker.
      </p>
    </div>
  )
}
