/**
 * When the delayed patients arrive (Phase 11, item 4): a real `<table>`, the seven weekdays down
 * and the eight three-hour blocks of Asia/Riyadh registration time across, the count in every
 * cell. A heat map that is also a table: the numbers are the content, the fill is the glance.
 *
 * `dataviz`: magnitude, so one hue stepped light to dark — the accent-soft token, then the accent
 * at 35 %, 65 % and full — with ink text on the three light steps and white on the last, which is
 * where each clears 4.5:1. The steps are quarters of the fullest cell (`heatStep()`), and the key
 * under the table says in counts what each step means (`heatLegend()`), so a colour is never
 * read alone. An empty cell is plain, and is not a link: there is nothing behind it to open.
 *
 * Server-rendered, like every table on the page: a cell with cases is a real link to them, and
 * the page still works, and prints, with JavaScript off.
 */
import Link from 'next/link'
import { ARRIVAL_BLOCKS, type ArrivalBlock } from '@/src/lib/domain/aggregates'
import { WEEKDAY_NAMES, blockHours } from '@/src/lib/dashboard/drill'
import { heatLegend, heatStep, type HeatStep } from '@/src/lib/dashboard/panels'

const STEP_FILL: Record<Exclude<HeatStep, 0>, string> = {
  1: 'bg-accent-soft',
  2: 'bg-accent/35',
  3: 'bg-accent/65',
  4: 'bg-accent',
}

/**
 * The count's colour sits on the cell, not the link: the print stylesheet sets every dashboard
 * link to `color: inherit`, and a link that carried its own white printed the fullest cells in ink
 * on teal, about 3:1.
 */
const STEP_TEXT: Record<Exclude<HeatStep, 0>, string> = {
  1: 'text-ink',
  2: 'text-ink',
  3: 'text-ink',
  4: 'text-white',
}

export type ArrivalTableRow = {
  weekday: string
  cells: ReadonlyArray<{ block: ArrivalBlock; value: number; href: string }>
}

export function ArrivalTable({ rows, max }: { rows: ReadonlyArray<ArrivalTableRow>; max: number }) {
  return (
    <>
      <table className="num w-full table-fixed border-collapse text-caption [print-color-adjust:exact]" data-arrivals>
        <caption className="sr-only">
          Cases by weekday and three-hour block of registration, Asia/Riyadh time. Each cell with cases links to them.
        </caption>
        <thead>
          <tr className="text-muted">
            <th scope="col" className="w-9 py-1 text-left font-medium">
              Day
            </th>
            {ARRIVAL_BLOCKS.map((block) => (
              <th key={block} scope="col" className="px-0 py-1 text-center text-[11px] font-medium whitespace-nowrap">
                {block}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.weekday}>
              <th scope="row" className="py-0 text-left font-semibold text-ink">
                {row.weekday}
              </th>
              {row.cells.map((cell) => {
                const step = heatStep(cell.value, max)
                return (
                  <td
                    key={cell.block}
                    className={`p-px ${step === 0 ? '' : STEP_TEXT[step]}`}
                    data-count={cell.value}
                    data-step={step || undefined}
                  >
                    {step === 0 ? (
                      // Plain, and silent to the eye; a screen reader still hears the count.
                      <span className="flex min-h-11 items-center justify-center rounded-[4px] bg-bg">
                        <span className="sr-only">0</span>
                      </span>
                    ) : (
                      <Link
                        href={cell.href}
                        aria-label={`${WEEKDAY_NAMES[row.weekday] ?? row.weekday} ${blockHours(cell.block)}: ${cell.value} ${
                          cell.value === 1 ? 'case' : 'cases'
                        }`}
                        className={`flex min-h-11 items-center justify-center rounded-[4px] font-semibold text-inherit ${STEP_FILL[step]}`}
                      >
                        {cell.value}
                      </Link>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 mb-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted" data-heat-legend>
        <span>Cases in a cell:</span>
        {heatLegend(max).map(({ step, label }) => (
          <span key={step} className="inline-flex items-center gap-1">
            <span aria-hidden className={`inline-block h-3 w-3 rounded-[3px] ${STEP_FILL[step]}`} />
            {label}
          </span>
        ))}
      </p>
    </>
  )
}
