'use client'

/**
 * The prototype's `HBar`: one horizontal bar per row, longest first, the count at the bar end.
 *
 * `dataviz` rules kept: one series, so one colour and no legend (the section heading names what
 * is plotted); one scale; the value is direct-labelled at the tip and there is therefore no
 * x-axis to repeat it; hairline chrome only, no gridlines, no chart junk; the bar is capped at
 * 18 px so the band's leftover is air; every piece of text wears a text token, never the series
 * colour.
 *
 * The bar is a shortcut, not the only way in: the server renders the same rows as real links
 * beside this chart (`BarLinks`), so keyboard users, screen readers and a browser with
 * JavaScript off all reach the same drill-downs.
 */
import { useRouter } from 'next/navigation'
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CHART, CHART_CATEGORY_TICK, TOOLTIP_LABEL_STYLE, TOOLTIP_STYLE } from './theme'

export type HBarRow = { name: string; value: number; href: string }

/** Which token the section's bars wear. The prototype's four choices, by name. */
export type HBarColor = 'accent' | 'ink' | 'plum' | 'muted' | 'ok'

/** Long reason names would run past the axis; the full name is on the tooltip and the link list. */
const MAX_TICK = 22
const tick = (value: string): string => (value.length > MAX_TICK ? `${value.slice(0, MAX_TICK - 1)}…` : value)

export function HBar({ rows, color, unit }: { rows: HBarRow[]; color: HBarColor; unit: string }) {
  const router = useRouter()
  const height = Math.max(120, rows.length * 30)

  return (
    <div style={{ height }} data-chart="hbar">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 36, top: 4, bottom: 4 }} accessibilityLayer>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={150}
            interval={0}
            tick={CHART_CATEGORY_TICK}
            tickLine={false}
            axisLine={false}
            tickFormatter={tick}
          />
          <Tooltip
            cursor={{ fill: CHART.accentSoft, fillOpacity: 0.5 }}
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={{ color: CHART.ink }}
            formatter={(value) => [`${String(value)} ${unit}`, '']}
            separator=""
          />
          <Bar
            dataKey="value"
            name={unit}
            fill={CHART[color]}
            maxBarSize={18}
            radius={[0, 4, 4, 0]}
            cursor="pointer"
            isAnimationActive={false}
            onClick={(_entry, index) => {
              const row = rows[index]
              if (row) router.push(row.href)
            }}
          >
            <LabelList dataKey="value" position="right" fill={CHART.muted} fontSize={11} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
