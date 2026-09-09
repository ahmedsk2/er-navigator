'use client'

/**
 * "Turnaround" (Phase 8): one horizontal bar per investigation type, split into the six
 * order-to-result time bands.
 *
 * This is the one chart in the app with an ordered categorical scale rather than a single series,
 * so it is the one chart with a legend — `BandLegend` in `parts.tsx`, server-rendered beside it,
 * because Recharts 3 draws its own legend in the order it registered the series, which put
 * "≤30 min" last and made an ordered scale read as an unordered one. The segments wear the app's
 * own severity ramp (`CHART_RAMP`: ok, accent, 4 h, 6 h, 12 h, 24 h) so "slow" is the same colour
 * here as an overdue case is on the board. `dataviz` rules otherwise as elsewhere: one scale,
 * hairline chrome, no gridlines, counts direct-labelled through the tooltip rather than by an axis.
 *
 * The segments are clickable, but the drill-downs do not depend on that: the section renders
 * every type-and-band pair as a real link beside the chart (`BarLinks`), which is what a keyboard,
 * a screen reader and a printed page use.
 */
import { useRouter } from 'next/navigation'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CHART, CHART_CATEGORY_TICK, CHART_RAMP, TOOLTIP_LABEL_STYLE, TOOLTIP_STYLE } from './theme'

/** One row: the bar's name, and one `{ value, href }` per band, in the bands' own order. */
export type StackRow = { name: string; cells: ReadonlyArray<{ value: number; href: string }> }

const ROW_HEIGHT = 34

export function StackedBar({ bands, rows, unit }: { bands: ReadonlyArray<string>; rows: StackRow[]; unit: string }) {
  const router = useRouter()

  // Recharts wants one flat record per bar, with a key per series.
  const data = rows.map((row) => {
    const point: Record<string, string | number> = { name: row.name }
    bands.forEach((band, i) => {
      point[band] = row.cells[i]?.value ?? 0
    })
    return point
  })

  return (
    <div style={{ height: Math.max(72, rows.length * ROW_HEIGHT + 12) }} data-chart="stacked">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 12, top: 4, bottom: 0 }} accessibilityLayer>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={72}
            interval={0}
            tick={CHART_CATEGORY_TICK}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: CHART.accentSoft, fillOpacity: 0.5 }}
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={{ color: CHART.ink }}
            formatter={(value, name) => [`${String(value)} ${unit}`, String(name)]}
          />
          {bands.map((band, i) => (
            <Bar
              key={band}
              dataKey={band}
              stackId="turnaround"
              name={band}
              fill={CHART_RAMP[i % CHART_RAMP.length]}
              maxBarSize={18}
              cursor="pointer"
              isAnimationActive={false}
              onClick={(_entry, index) => {
                const href = rows[index]?.cells[i]?.href
                if (href) router.push(href)
              }}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
