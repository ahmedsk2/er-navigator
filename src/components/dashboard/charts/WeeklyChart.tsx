'use client'

/**
 * "By week: cases and median stay" — the prototype's weekly chart, as two panels instead of one.
 *
 * The prototype drew a single `ComposedChart` with two y-axes: case counts on the left, median
 * hours on the right. A dual-axis chart is the `dataviz` skill's first anti-pattern and the Phase
 * 4 spec repeats the rule in its own words ("one scale per chart"), because the alignment of two
 * scales is arbitrary and invents a correlation that is not in the data. Putting both series on
 * ONE shared scale is no better here: this app exists to track stays measured in tens of hours,
 * so the median always dwarfs the case count and the bars collapse onto the baseline (measured on
 * the seeded fixture before this was split).
 *
 * So: small multiples, the skill's prescribed fix. Two `ComposedChart`s over the same weeks, one
 * scale each, the prototype's colours and marks unchanged — bars in accent-soft with an accent
 * stroke, the median line in danger. Each panel is direct-labelled rather than sharing a legend,
 * which is the rule for a single-series chart, and only the lower panel repeats the week labels.
 *
 * The bars are clickable; the section also renders every week as a real link beside the panels,
 * so the drill-down does not depend on JavaScript, on a mouse, or on hitting a 4 px dot.
 */
import { useRouter } from 'next/navigation'
import { Bar, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtHours } from '@/src/lib/domain/time'
import { CHART, CHART_TICK, TOOLTIP_LABEL_STYLE, TOOLTIP_STYLE } from './theme'

export type WeekPoint = { name: string; cases: number; med: number | null; href: string }

const PANEL_HEIGHT = 108

function PanelLabel({ children }: { children: string }) {
  return <p className="mb-0.5 text-caption text-muted">{children}</p>
}

export function WeeklyChart({ weeks }: { weeks: WeekPoint[] }) {
  const router = useRouter()
  const go = (index: number) => {
    const week = weeks[index]
    if (week) router.push(week.href)
  }

  return (
    <div data-chart="weekly">
      <PanelLabel>Cases flagged</PanelLabel>
      <div style={{ height: PANEL_HEIGHT }} data-chart-panel="cases">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={weeks} margin={{ left: 0, right: 8, top: 6, bottom: 0 }} accessibilityLayer>
            <XAxis dataKey="name" tick={false} height={4} axisLine={{ stroke: CHART.line }} />
            <YAxis tick={CHART_TICK} width={28} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: CHART.accentSoft, fillOpacity: 0.5 }}
              contentStyle={TOOLTIP_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={{ color: CHART.ink }}
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
              onClick={(_entry, index) => go(index)}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <PanelLabel>Median stay</PanelLabel>
      <div style={{ height: PANEL_HEIGHT }} data-chart-panel="median">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={weeks} margin={{ left: 0, right: 8, top: 6, bottom: 0 }} accessibilityLayer>
            <XAxis dataKey="name" tick={CHART_TICK} tickLine={false} axisLine={{ stroke: CHART.line }} />
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
              formatter={(value) => [fmtHours(typeof value === 'number' ? value : null), '']}
              separator=""
            />
            <Line
              type="monotone"
              dataKey="med"
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
