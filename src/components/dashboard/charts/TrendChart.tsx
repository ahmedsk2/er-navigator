'use client'

/**
 * "By week: cases and median stay" and, since Phase 11, "By day": the prototype's weekly chart,
 * as two panels instead of one.
 *
 * The prototype drew a single `ComposedChart` with two y-axes: case counts on the left, median
 * hours on the right. A dual-axis chart is the `dataviz` skill's first anti-pattern and the Phase
 * 4 spec repeats the rule in its own words ("one scale per chart"), because the alignment of two
 * scales is arbitrary and invents a correlation that is not in the data. Putting both series on
 * ONE shared scale is no better here: this app exists to track stays measured in tens of hours,
 * so the median always dwarfs the case count and the bars collapse onto the baseline (measured on
 * the seeded fixture before this was split).
 *
 * So: small multiples, the skill's prescribed fix. Two `ComposedChart`s over the same weeks or
 * days, one scale each, the prototype's colours and marks unchanged — bars in accent-soft with an
 * accent stroke, the median line in danger. Each panel is direct-labelled rather than sharing a
 * legend, which is the rule for a single-series chart, and only the lower panel repeats the labels.
 *
 * The daily chart adds a `reference`: a dashed 6 h line on the median panel, the threshold the
 * board turns a case red at, labelled in the chrome's muted ink. Dashed on purpose — the one line
 * on the page that is a threshold rather than a grid.
 *
 * The bars are clickable; the section also renders every point as a real link beside the panels,
 * so the drill-down does not depend on JavaScript, on a mouse, or on hitting a 4 px dot. Nothing
 * animates, so there is nothing for `prefers-reduced-motion` to stop.
 */
import { useRouter } from 'next/navigation'
import { Bar, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { MIN_N, fmtHours } from '@/src/lib/domain/time'
import { CHART, CHART_TICK, TOOLTIP_LABEL_STYLE, TOOLTIP_STYLE } from './theme'

/**
 * `name` is the axis label and `label` the tooltip's heading ("Tue 08/09" for a day). `med` is
 * already null below MIN_N — `weekPoint()` in src/lib/dashboard/weeks.ts guards a week, `byDay()`
 * guards a day — so the line breaks there and the tooltip says "n<3" instead of a number.
 */
export type TrendPoint = { name: string; label?: string; cases: number; med: number | null; href: string }

const PANEL_HEIGHT = 108

function PanelLabel({ children }: { children: string }) {
  return <p className="mb-0.5 text-caption text-muted">{children}</p>
}

export function TrendChart({
  points,
  kind,
  reference,
}: {
  points: TrendPoint[]
  kind: 'weekly' | 'daily'
  /** A threshold to draw across the median panel, in hours. */
  reference?: { hours: number; label: string }
}) {
  const router = useRouter()
  const go = (index: number) => {
    const point = points[index]
    if (point) router.push(point.href)
  }
  /**
   * A tap on a bar opens that bar's day or week, exactly (`Bar`'s own index). A tap elsewhere in
   * the column — on a short bar's empty space, or on the median panel — falls back to the column
   * Recharts reports under the pointer (`activeTooltipIndex`, a number or its string): thirty-one
   * bars in a phone's 290 px are 7 px each. The bar's click stops there, so one tap never
   * navigates twice.
   */
  const onBar = (_entry: unknown, index: number, event: { stopPropagation: () => void }) => {
    event.stopPropagation()
    go(index)
  }
  const onColumn = (state: { activeTooltipIndex?: unknown } | null | undefined) => {
    const index = Number(state?.activeTooltipIndex)
    if (Number.isInteger(index) && index >= 0) go(index)
  }
  // A month of days is thirty-one labels in 330 px: every fourth or so, always on a whole step,
  // so the labels fall on regular days rather than wherever the library finds room.
  const interval = kind === 'daily' ? Math.max(0, Math.ceil(points.length / 8) - 1) : undefined
  const tooltipLabel = (label: unknown, payload: ReadonlyArray<{ payload?: TrendPoint }>) =>
    payload?.[0]?.payload?.label ?? String(label)
  const unit = kind === 'daily' ? 'day' : 'week'

  return (
    <div data-chart={kind} data-points={points.length}>
      <PanelLabel>Cases flagged</PanelLabel>
      <div style={{ height: PANEL_HEIGHT }} data-chart-panel="cases">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={points}
            margin={{ left: 0, right: 8, top: 6, bottom: 0 }}
            accessibilityLayer
            onClick={onColumn}
            style={{ cursor: 'pointer' }}
          >
            <XAxis dataKey="name" tick={false} height={4} axisLine={{ stroke: CHART.line }} interval={interval} />
            <YAxis tick={CHART_TICK} width={28} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: CHART.accentSoft, fillOpacity: 0.5 }}
              contentStyle={TOOLTIP_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={{ color: CHART.ink }}
              labelFormatter={tooltipLabel}
              formatter={(value) => [`${String(value)} cases`, '']}
              separator=""
            />
            <Bar
              dataKey="cases"
              name="Cases"
              fill={CHART.accentSoft}
              stroke={CHART.accent}
              radius={[3, 3, 0, 0]}
              maxBarSize={24}
              cursor="pointer"
              isAnimationActive={false}
              onClick={onBar}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <PanelLabel>
        {points.some((p) => p.med != null) ? 'Median stay' : `Median stay: no ${unit} has ${MIN_N} cases yet`}
      </PanelLabel>
      <div style={{ height: PANEL_HEIGHT }} data-chart-panel="median">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={points}
            margin={{ left: 0, right: 8, top: 6, bottom: 0 }}
            accessibilityLayer
            onClick={onColumn}
            style={{ cursor: 'pointer' }}
          >
            {/* A band scale, as the bars above have: a line on its own gets a point scale, which
                runs its first and last points out to the edges — off their bars by half a band,
                and the last date label past the edge of the chart. */}
            <XAxis
              dataKey="name"
              scale="band"
              tick={CHART_TICK}
              tickLine={false}
              axisLine={{ stroke: CHART.line }}
              interval={interval}
            />
            <YAxis
              tick={CHART_TICK}
              width={28}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              unit="h"
            />
            <Tooltip
              cursor={{ stroke: CHART.line }}
              contentStyle={TOOLTIP_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={{ color: CHART.ink }}
              labelFormatter={tooltipLabel}
              formatter={(value) => [typeof value === 'number' ? fmtHours(value) : `n<${MIN_N}`, '']}
              separator=""
            />
            {reference ? (
              <ReferenceLine
                y={reference.hours}
                ifOverflow="extendDomain"
                stroke={CHART.muted}
                strokeDasharray="4 3"
                label={{ value: reference.label, position: 'insideTopLeft', fill: CHART.muted, fontSize: 11 }}
              />
            ) : null}
            <Line
              type="monotone"
              dataKey="med"
              connectNulls={false}
              name="Median stay"
              stroke={CHART.danger}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              isAnimationActive={false}
              dot={{ r: 4, fill: CHART.danger, stroke: CHART.panel, strokeWidth: 2 }}
              activeDot={{ r: 5, fill: CHART.danger, stroke: CHART.panel, strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
