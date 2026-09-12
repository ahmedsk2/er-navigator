'use client'

/**
 * "Patient journey" — the one block of times on the case sheet, in the order a patient moves
 * through the ED (Phase 13; Ahmed, 12 September 2026, decisions B, E, F and G).
 *
 * It replaces three things the sheet used to have in three places: the "Add journey times
 * (optional)" toggle with its five milestones, the "Admission times" section, and the transfer
 * chain inside "Referral out". Which steps it shows is `visibleJourneyFields`, and which of them
 * an outcome cannot be resolved without is `requiredJourneyFields`, both in
 * `src/lib/domain/journey.ts` — the same module the server's refusal reads, so the tag on a row
 * and the refusal on the button can never say different things.
 *
 * Progressive disclosure, in the order a nurse meets it:
 *
 *   - a step with a time is one line, "Triage · 12/09 10:42", with an Edit control that reopens
 *     it for the rest of the session;
 *   - the first empty step is the highlighted one, so the thumb lands on what the case is
 *     waiting for;
 *   - a step this outcome cannot have is not drawn at all, and a step it needs carries a small
 *     "needed to resolve" tag until it is filled;
 *   - and nothing hidden is ever dropped: a hidden step that holds a time is listed on one line
 *     at the foot of the block, because the case still says so even when the screen does not.
 */
import { useState } from 'react'
import { Button, Section, TimeRow } from '@/src/components/ui'
import { Clock } from '@/src/components/icons'
import { fmtStamp } from '@/src/lib/cases/local-time'
import {
  hiddenRecordedJourneySteps,
  JOURNEY_LABELS,
  requiredJourneyFields,
  visibleJourneyFields,
  type Disposition,
  type JourneyField,
} from '@/src/lib/domain/journey'

export type JourneyValues = Partial<Record<JourneyField, string | null>>

export function CaseJourney({
  id,
  values,
  onChange,
  disabled = false,
  disposition,
  stageCodes,
  requiresReferralNo,
}: {
  /** The section id the "Times" chip of the jump strip lands on. */
  id: string
  values: JourneyValues
  onChange: (patch: JourneyValues) => void
  disabled?: boolean
  disposition: Disposition | null
  stageCodes: Iterable<string>
  requiresReferralNo: boolean
}) {
  /**
   * The filled steps a nurse has reopened with Edit. Editor state only, and per session: a
   * reload shows the collapsed line again, which is what a nurse reading the case wants.
   */
  const [reopened, setReopened] = useState<ReadonlyArray<JourneyField>>([])

  const context = { disposition, stageCodes, requiresReferralNo }
  const visible = visibleJourneyFields(context)
  const required = new Set(requiredJourneyFields(disposition))
  const alsoRecorded = hiddenRecordedJourneySteps({ ...context, values })
  /** The one step the case is waiting for: the first visible one with no time. */
  const next = visible.find((field) => !values[field])

  return (
    <Section id={id} title="Patient journey" icon={<Clock size={18} />}>
      <p className="mb-2.5 text-caption text-muted">
        Tap Now as each step happens, or type the time. Steps this case cannot have are not shown.
      </p>
      {visible.map((field, index) => {
        const label = JOURNEY_LABELS[field]
        const value = values[field] ?? null
        const step = index + 1
        if (value && !reopened.includes(field)) {
          return (
            <div
              key={field}
              data-journey-step={field}
              className="mb-3 flex min-h-11 items-center gap-2 border-b border-line-soft sm:mb-2"
            >
              <span className="num w-4 shrink-0 text-caption text-muted" aria-hidden>
                {step}
              </span>
              <p className="min-w-0 flex-1 text-body text-ink-2">
                {label} <span className="num text-muted">· {fmtStamp(value)}</span>
              </p>
              {/* Always drawn, disabled with the rest of the sheet: a control that vanishes for
                  the second a save takes moves every row under it. */}
              <Button
                aria-label={`Edit — ${label}`}
                className="shrink-0 px-2.5 text-caption font-semibold"
                disabled={disabled}
                onClick={() => setReopened((open) => [...open, field])}
              >
                Edit
              </Button>
            </div>
          )
        }
        const isNext = field === next
        return (
          <div
            key={field}
            data-journey-step={field}
            data-next-step={isNext ? '' : undefined}
            className={isNext ? '-mx-2 mb-1 rounded-card bg-accent-soft px-2 pt-1.5' : undefined}
          >
            {required.has(field) && !value ? (
              <span
                data-needed
                className="mb-1 inline-block rounded-chip border border-band-h4 px-1.5 py-px text-caption text-band-h4-ink"
              >
                needed to resolve
              </span>
            ) : null}
            <TimeRow
              step={step}
              label={label}
              value={value}
              onChange={(nextValue) => onChange({ [field]: nextValue })}
              disabled={disabled}
            />
          </div>
        )
      })}
      {alsoRecorded.length > 0 ? (
        <p
          data-also-recorded
          className="mt-1.5 border-t border-dashed border-line pt-2 text-caption text-muted"
        >
          Also recorded:{' '}
          {alsoRecorded.map(([field, label]) => `${label} · ${fmtStamp(values[field]!)}`).join(', ')}
        </p>
      ) : null}
    </Section>
  )
}
