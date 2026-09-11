/**
 * How the stay splits (Phase 11, item 2): one 100 % bar in three segments — front end, decision,
 * after the decision — over every case with all three measured, then the same bar for each
 * outcome group with at least MIN_N such cases, so "admitted patients spend most of their stay
 * after the decision" is something the eye sees rather than a sum the reader does.
 *
 * Plain HTML, server-rendered, for the reasons `AdaaBullets` gives. Every figure is
 * `phaseSplitByOutcome()`'s (`src/lib/domain/kpi.ts`, hand-tested); nothing here computes.
 *
 * `dataviz`: the three phases happen in that order, so they are an ordinal scale and wear one hue
 * light to dark (the accent at 55 %, the accent, the deep accent — validated as an ordinal ramp:
 * monotone, 2:1 at the light end), cut apart by a 2 px surface gap. The shares and medians are
 * text under each bar, each behind a swatch of its segment and, for a screen reader, its name.
 */
import { MIN_N, fmtHours } from '@/src/lib/domain/time'
import { fmtShare } from '@/src/lib/dashboard/panels'
import { PHASES, type PhaseKey, type StaySplitRow } from '@/src/lib/domain/kpi'

const PHASE_FILL: Record<PhaseKey, string> = {
  front: 'bg-accent/55',
  decision: 'bg-accent',
  after: 'bg-accent-deep',
}

function Swatch({ phase }: { phase: PhaseKey }) {
  return <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-[2px] ${PHASE_FILL[phase]}`} />
}

export function StaySplit({ rows }: { rows: ReadonlyArray<StaySplitRow> }) {
  const [all, ...groups] = rows
  if (!all) return null
  return (
    <div data-chart="stay-split" className="mb-3 [print-color-adjust:exact]">
      <p className="m-0 text-caption text-muted">
        How the stay splits, over the {all.split.completeN} {all.split.completeN === 1 ? 'case' : 'cases'} with all
        three measured
      </p>
      <ul className="m-0 mt-1 flex list-none flex-wrap gap-x-3 gap-y-1 p-0" data-split-legend>
        {PHASES.map((p) => (
          <li key={p.key} className="flex items-center gap-1 text-caption text-muted">
            <Swatch phase={p.key} />
            {p.name}
          </li>
        ))}
      </ul>
      <SplitBar row={all} />
      {groups
        .filter((g) => g.split.completeN >= MIN_N)
        .map((g) => (
          <SplitBar key={g.key} row={g} />
        ))}
    </div>
  )
}

function SplitBar({ row }: { row: StaySplitRow }) {
  const { phases, completeN } = row.split
  // `phaseSplit` gives the shares together or not at all (null below MIN_N complete cases).
  const drawn = phases.every((p) => p.share != null)
  return (
    <div data-split={row.key} className="mt-2.5">
      <p className="m-0 flex items-baseline justify-between gap-3 text-label">
        <span className="font-semibold text-ink">{row.name}</span>
        <span className="num text-caption text-muted">
          {completeN} {completeN === 1 ? 'case' : 'cases'}
        </span>
      </p>
      <div aria-hidden data-bar className="mt-1 flex h-3.5 gap-[2px] overflow-hidden rounded-[4px]">
        {drawn ? (
          phases.map((p) => (
            <span
              key={p.key}
              data-segment={p.key}
              className={PHASE_FILL[p.key]}
              style={{ flexGrow: p.share ?? 0, flexBasis: 0 }}
            />
          ))
        ) : (
          <span className="flex-1 bg-line-soft" />
        )}
      </div>
      {drawn ? (
        <ul className="num m-0 mt-1 grid list-none grid-cols-3 gap-2 p-0 text-caption text-ink-2">
          {phases.map((p, i) => (
            <li
              key={p.key}
              className={`flex items-center gap-1 ${i === 1 ? 'justify-center' : i === 2 ? 'justify-end' : ''}`}
            >
              <Swatch phase={p.key} />
              <span>
                <span className="sr-only">{p.name}: </span>
                {fmtShare(p.share)} · {fmtHours(p.med)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 mb-0 text-caption text-muted">n&lt;{MIN_N}</p>
      )}
    </div>
  )
}
