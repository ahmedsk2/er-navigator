/**
 * The dashboard's server-rendered furniture: the section wrapper, the three tiles, the tables and
 * the link list that sits beside every chart.
 *
 * Server components with no state at all — the page must render, and every drill-down must work,
 * with JavaScript off; only the two Recharts charts are clients. That is also why a "tap a row
 * to drill" table row is a real `<a>` stretched over the row rather than an onClick handler.
 */
import Link from 'next/link'
import type { ReactNode } from 'react'
import { CHART_RAMP } from '@/src/components/dashboard/charts/theme'
import { sharePercent } from '@/src/lib/dashboard/panels'
import { MIN_N, band, fmtHours } from '@/src/lib/domain/time'
import { BAND_TEXT } from '@/src/components/bands'

/**
 * One dashboard section. A card since Phase 9, where it was a full-bleed strip between two
 * hairlines: twenty-odd of those read as one continuous page, and the reader's question is "which
 * section am I in", which a card answers and a hairline does not.
 *
 * The structure is untouched and deliberately so — `tests/e2e/dashboard.spec.ts` reads the section
 * titles in order off `.dash h3` and finds each table with `xpath=../table`, so the `<h3>` stays
 * the section's first child and the children stay its siblings. `icon` goes inside the heading and
 * is `aria-hidden`, which leaves the heading's accessible name exactly the title.
 */
export function DashSection({
  title,
  icon,
  children,
}: {
  title: string
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mx-4 mb-2.5 rounded-card border border-line bg-panel p-4 shadow-card lg:mx-0">
      <h3 className="mb-2.5 flex items-center gap-2 text-section">
        {icon ? <span className="text-accent">{icon}</span> : null}
        {title}
      </h3>
      {children}
    </section>
  )
}

/** The prototype's empty-state paragraph: one muted line telling the nurse what to enter. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="m-0 text-label text-muted">{children}</p>
}

/** The prototype's footnote under a table or a chart. */
export function Footnote({ children }: { children: ReactNode }) {
  return <p className="mt-2 mb-0 text-caption text-muted">{children}</p>
}

/** The small caption that labels a block inside a section, as the weekly chart's panels do. */
export function PanelLabel({ children }: { children: ReactNode }) {
  return <p className="mt-3 mb-1 text-caption text-muted">{children}</p>
}

/**
 * One headline figure.
 *
 * Phase 8 added two optional parts: `note`, the "+3 vs previous 30 days" line under the label,
 * and `href`, which the longest-stay tile uses to reach the case. The value keeps its
 * `data-tile` hook whether or not it is wrapped in a link, so a test reads the number the same
 * way on every tile.
 */
export function Tile({
  label,
  value,
  tone = 'ink',
  note,
  href,
  icon,
}: {
  label: string
  value: string
  tone?: 'ink' | 'danger'
  note?: string | null
  href?: string
  icon?: ReactNode
}) {
  const number = (
    <span
      className={`num text-[24px] leading-tight font-bold ${tone === 'danger' ? 'text-danger' : 'text-ink'}`}
      data-tile={label}
    >
      {value}
    </span>
  )
  return (
    <div className="min-w-0 flex-1 rounded-card border border-line bg-panel px-3 py-2.5 shadow-card">
      {/* Phase 9: a tinted square before the figure. It names the tile a second time, in a
          channel the eye reaches before it reads — and it is `aria-hidden`, so the tile still
          announces exactly its number and its label. */}
      {icon ? (
        <span
          data-tile-icon={label}
          className="mb-1 inline-grid h-7 w-7 place-items-center rounded-[8px] bg-accent-soft text-accent-ink"
        >
          {icon}
        </span>
      ) : null}
      <div>
        {href ? (
          <Link
            href={href}
            className="inline-flex min-h-11 items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
          >
            {number}
          </Link>
        ) : (
          number
        )}
      </div>
      <div className="mt-0.5 text-caption text-muted">{label}</div>
      {note ? (
        <div className="num mt-0.5 text-caption text-muted" data-tile-note={label}>
          {note}
        </div>
      ) : null}
    </div>
  )
}

/**
 * A compliance share as a hairline bar — the working-targets section's only chart.
 *
 * Server-rendered, because it is one div: the drill-down beside it is the interactive part, and a
 * client chart for a single proportion would be chart junk. `share` is null below MIN_N, and then
 * the track is drawn empty rather than at zero, because "we do not know" is not "none".
 */
export function ShareBar({ share, label }: { share: number | null; label: string }) {
  const percent = sharePercent(share)
  return (
    <div
      className="h-1.5 w-full min-w-[48px] overflow-hidden rounded-chip bg-line-soft"
      role="img"
      aria-label={share == null ? `${label}: not enough cases` : `${label}: ${percent} percent`}
      data-share={label}
    >
      <div className="h-full rounded-chip bg-accent" style={{ width: `${percent}%` }} />
    </div>
  )
}

/** A median cell: the number, or the prototype's muted "n<3" when the row has too few values. */
export function Median({ value, n }: { value: number | null; n: number }) {
  if (n < MIN_N) return <span className="text-muted">n&lt;{MIN_N}</span>
  return <>{fmtHours(value)}</>
}

// BAND_TEXT comes from src/components/bands.ts (Phase 9): one map for the board, the dashboard and the editor.

/** "Over 6h" in the colour of the band it opens — the prototype's `bandColor(t)` on the label. */
export function ThresholdLabel({ hours }: { hours: number }) {
  return <span className={BAND_TEXT[band(hours)]}>Over {hours}h</span>
}

/**
 * The turnaround chart's key: one swatch per band, in the bands' own order, fast to slow.
 *
 * Server-rendered rather than drawn by Recharts, for two reasons: the chart library orders its
 * legend by the order it registered the series, which scrambles an ordered scale; and a key that
 * is real HTML prints, and is readable with JavaScript off, exactly like every other row on this
 * page.
 */
export function BandLegend({ bands }: { bands: ReadonlyArray<string> }) {
  return (
    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1" data-band-legend>
      {bands.map((band, i) => (
        <li key={band} className="flex items-center gap-1 text-caption text-muted">
          <span
            aria-hidden
            className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
            style={{ background: CHART_RAMP[i % CHART_RAMP.length] }}
          />
          {band}
        </li>
      ))}
    </ul>
  )
}

export type TableRow = {
  /** Stable key, and the drill-down target. A row with no href is not tappable. */
  key: string
  href?: string
  cells: ReactNode[]
}

/**
 * The prototype's `Table`: first column left and semibold, the rest right-aligned and tabular.
 *
 * A tappable row is one link, not three: the `<a>` in the first cell carries the row's accessible
 * name and stretches over the whole `<tr>` with an `::after` overlay, so the tap target is the row
 * (44 px on a phone) while the accessibility tree still sees one link per row.
 */
export function DataTable({ head, rows }: { head: string[]; rows: TableRow[] }) {
  return (
    <table className="num w-full border-collapse text-label">
      <thead>
        <tr className="text-caption text-muted">
          {head.map((h, i) => (
            <th key={h} scope="col" className={`py-1 font-medium ${i ? 'text-right' : 'text-left'}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="relative border-t border-line">
            {row.cells.map((cell, i) => (
              <td
                key={i}
                className={`py-2 align-middle ${i ? 'text-right font-normal' : 'text-left font-semibold'}`}
              >
                {i === 0 && row.href ? (
                  <Link
                    href={row.href}
                    className="inline-flex min-h-11 items-center text-ink after:absolute after:inset-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                  >
                    {cell}
                  </Link>
                ) : (
                  cell
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * The same rows a bar chart draws, as real links.
 *
 * A Recharts bar is an SVG rectangle: it cannot be focused, it is not in the accessibility tree
 * as a link, and it does nothing without JavaScript. This list is the chart's text equivalent —
 * `dataviz`'s "a table view exists" rule — and the only reason it is visually hidden is that the
 * bars already show it. It stays in the tab order, so the drill-downs are reachable by keyboard.
 */
export function BarLinks({
  caption,
  rows,
  unit,
}: {
  caption: string
  rows: ReadonlyArray<{ name: string; value: number; href: string }>
  unit: string
}) {
  return (
    <ul className="sr-only">
      <li aria-hidden>{caption}</li>
      {rows.map((row) => (
        <li key={row.name}>
          <Link href={row.href}>
            {row.name}: {row.value} {unit}
          </Link>
        </li>
      ))}
    </ul>
  )
}
