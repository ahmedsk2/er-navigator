/**
 * The prototype's `HBar` — one horizontal bar per row, longest first, the count at the bar's tip
 * — as rows of links (Phase 11, item 6).
 *
 * It was a Recharts chart, and a chart's category axis is a fixed width: a reason longer than 22
 * characters was cut ("No bed available on a…"), and the whole of it lived only in a tooltip and
 * a visually hidden list. Here every row is one real link carrying the whole label — on its own
 * line above the bar on a phone, beside it from `sm` — so nothing is cut, the tap target is the
 * row, and the drill-down works with JavaScript off and on paper, like every table on the page.
 *
 * `dataviz` rules kept: one series, so one colour and no legend (the section heading names what is
 * plotted); one scale, the longest bar the full width; the value direct-labelled at the tip; a
 * 12 px bar with a 4 px rounded data end, square at the baseline; every piece of text in a text
 * token, never the series colour.
 */
import Link from 'next/link'

export type HBarRow = { name: string; value: number; href: string }

/** Which token the section's bars wear. The prototype's choices, by name. */
export type HBarColor = 'accent' | 'ink' | 'plum' | 'muted' | 'ok'

const FILL: Record<HBarColor, string> = {
  accent: 'bg-accent',
  ink: 'bg-ink',
  plum: 'bg-band-h12',
  muted: 'bg-muted',
  ok: 'bg-band-ok',
}

/** "1 case", "3 cases"; a unit that is not plain cases ("of 12 cases") is said as given. */
function spoken(value: number, unit: string): string {
  return unit === 'cases' && value === 1 ? '1 case' : `${value} ${unit}`
}

export function BarList({ rows, color, unit }: { rows: ReadonlyArray<HBarRow>; color: HBarColor; unit: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value))
  return (
    // Backgrounds are not printed unless asked for, and on paper these bars are the chart.
    //
    // From `sm` the list is a two-column grid and every row a subgrid of it, so all the bars start
    // on one baseline while the label column is only as wide as the longest label needs, up to
    // 15rem: the weekdays' bars sit beside "Sun", a long reason wraps instead of pushing them away.
    <ul
      data-chart="hbar"
      className="m-0 list-none p-0 [print-color-adjust:exact] sm:grid sm:grid-cols-[fit-content(15rem)_minmax(0,1fr)] sm:gap-x-3"
    >
      {rows.map((row) => (
        <li key={row.name} data-bar={row.name} className="sm:col-span-2 sm:grid sm:grid-cols-subgrid">
          <Link
            href={row.href}
            aria-label={`${row.name}: ${spoken(row.value, unit)}`}
            className="grid min-h-11 grid-cols-1 content-center gap-y-1 rounded-[6px] py-1 hover:bg-bg sm:col-span-2 sm:grid-cols-subgrid sm:items-center"
          >
            <span data-bar-label className="min-w-0 text-label break-words text-ink">
              {row.name}
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              {/* The longest bar leaves 2.75rem for its count; the rest are that width scaled. A bar
                  with a case in it is never thinner than 2 px, so it cannot vanish. */}
              <span
                data-bar-fill
                className={`h-3 shrink-0 rounded-r-[4px] ${FILL[color]}`}
                style={{
                  width:
                    row.value > 0 && max > 0 ? `max(2px, calc((100% - 2.75rem) * ${row.value / max}))` : '0px',
                }}
              />
              <span className="num text-caption text-muted">{row.value}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
