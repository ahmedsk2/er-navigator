/**
 * The case's time sequence: every recorded instant in order, with the gap from the one before it.
 *
 * This is the weekly deck's per-case slide, generated — "arrival, each order and result, each
 * referral and review, each decision and fax, with the interval between steps" (the Phase 8
 * brief, section 1). It is read-only by construction: a server component with no state, no
 * controls and no props but the steps, sitting after the Updates section of the editor. Every
 * time on it is edited in the section it belongs to, and appears here because it was.
 *
 * Nothing is computed here. `timeline()` in `src/lib/domain/kpi.ts` ordered the steps and
 * measured the intervals; `fmtStamp` and `fmtHours` only render them, in Asia/Riyadh, on both
 * sides of hydration.
 */
import { Section } from '@/src/components/ui'
import { fmtStamp } from '@/src/lib/cases/local-time'
import type { TimelineStepView } from '@/src/lib/cases/timeline'
import { fmtHours } from '@/src/lib/domain/time'

export function CaseTimeline({ steps }: { steps: ReadonlyArray<TimelineStepView> }) {
  // A case always has its registration, so the list is never empty; a case with nothing else
  // recorded is a one-line timeline, which is itself worth seeing on a delayed patient.
  if (steps.length === 0) return null

  return (
    <Section title="Timeline">
      <ol className="m-0 list-none p-0" data-timeline>
        {steps.map((step) => (
          <li
            key={step.key}
            className="flex items-baseline gap-2 border-b border-line-soft py-1.5 last:border-b-0"
            data-timeline-step={step.key}
          >
            <span className="num w-[86px] shrink-0 text-caption text-muted">{fmtStamp(step.at)}</span>
            <span className="min-w-0 flex-1 text-body text-ink">{step.label}</span>
            {step.fromPrevious == null ? null : (
              <span className="num shrink-0 text-caption text-muted">+{fmtHours(step.fromPrevious)}</span>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-2 mb-0 text-caption text-muted">
        Every time recorded on this case, in order, with the gap from the step before it. Asia/Riyadh.
      </p>
    </Section>
  )
}
