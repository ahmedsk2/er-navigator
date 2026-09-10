'use client'

/**
 * The case summary on screen (Phase 10, Ahmed's third request of 10 September): the weekly deck's
 * ranked-table row and its time sequence, for one patient, with a Copy button.
 *
 * It exists because the question a charge nurse is asked on the phone — "what is happening with
 * 851557?" — currently means reading a whole editor aloud. This is that answer in one panel, and
 * `summaryText` is the same answer as a block of text to paste into the handover message.
 *
 * Two entry points, one panel. The case page renders `CaseSummarySheet`, which already has the
 * summary from the server; the board's row button fetches it and renders `CaseSummaryDialog`
 * directly. Splitting them is what keeps the board from shipping a second copy of this markup.
 *
 * A bottom sheet on the phone and a centred dialog on a laptop, which is the same shape decision
 * the rest of the app makes: a thumb reaches the bottom of a 390 px screen and not its middle.
 *
 * It is "as of page load", exactly like the Timeline section beside it: the clock on it does not
 * tick, and the panel says so.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from '@/src/components/icons'
import { Button } from '@/src/components/ui'
import { fmtStamp } from '@/src/lib/cases/local-time'
import { BAND_LABELS, summaryText, type CaseSummary } from '@/src/lib/cases/summary'
import { fmtHours } from '@/src/lib/domain/time'

const STATUS_TEXT: Record<CaseSummary['status'], string> = {
  OPEN: 'Open',
  RESOLVED: 'Resolved',
  VOIDED: 'Voided',
}

/** One label / value pair. A row with nothing to say is not rendered at all. */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <tr className="border-b border-line-soft last:border-b-0">
      <th scope="row" className="w-[132px] py-1.5 pr-3 text-left align-top text-label font-medium text-muted">
        {label}
      </th>
      <td className="py-1.5 text-left align-top text-body text-ink">{value}</td>
    </tr>
  )
}

export function CaseSummaryDialog({ summary, onClose }: { summary: CaseSummary; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  const pre = useRef<HTMLPreElement>(null)
  /** What the Copy button did, announced once. Cleared when the panel closes. */
  const [copyNote, setCopyNote] = useState<string | null>(null)
  /** True once the clipboard API has refused us and the text is on screen to be selected by hand. */
  const [selectable, setSelectable] = useState(false)

  // Escape and a tap outside, the two ways out of a panel on a phone (the OverflowMenu pattern).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const onPointerDown = (event: MouseEvent | TouchEvent): void => {
      if (!panel.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [onClose])

  // Focus lands in the panel, so a keyboard or a screen reader is inside the dialog rather than
  // still on the row behind it. The caller sends it back to the trigger when the panel closes.
  useEffect(() => {
    panel.current?.focus()
  }, [])

  const text = summaryText(summary)

  const onCopy = useCallback(() => {
    // In the tap handler, not after an await: Safari only grants the clipboard inside the gesture.
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
    if (!clipboard?.writeText) {
      // No clipboard API (an insecure origin, an old browser, a locked-down ward device). Show
      // the text and select it, which is the fallback every native app falls back to as well.
      setSelectable(true)
      setCopyNote('Select and copy.')
      window.setTimeout(() => {
        const node = pre.current
        if (!node) return
        const range = document.createRange()
        range.selectNodeContents(node)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      }, 0)
      return
    }
    clipboard.writeText(text).then(
      () => setCopyNote('Copied.'),
      () => {
        setSelectable(true)
        setCopyNote('Select and copy.')
      },
    )
  }, [text])

  const documented = summary.actions.filter((a) => a.count > 0)

  return (
    <div className="no-print fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Case summary"
        tabIndex={-1}
        data-summary-dialog
        className="max-h-[88vh] w-full max-w-[560px] overflow-y-auto rounded-t-sheet border border-line bg-panel shadow-sheet focus:outline-none sm:rounded-card sm:shadow-float"
      >
        <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-line bg-panel px-4 py-3">
          {/*
            "Case summary", not "Case {mrn}": the case page's own h1 is already "Case {mrn}" and
            two headings of that name on one screen is a selector collision the whole suite would
            have to work around. The MRN sits beside it, and is the first row of the table below.
          */}
          <h2 className="m-0 text-section">Case summary</h2>
          <span className="num ml-auto mr-1 text-label text-muted">MRN {summary.mrn}</span>
          <button
            type="button"
            aria-label="Close summary"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-button text-ink-2"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-4 py-3">
          <table className="w-full border-collapse">
            <tbody>
              <Row label="MRN" value={<span className="num">{summary.mrn}</span>} />
              <Row label="CTAS" value={summary.ctas == null ? null : <span className="num">{summary.ctas}</span>} />
              <Row label="ED area" value={summary.areaName} />
              <Row label="Payer" value={summary.payerLabel} />
              <Row label="Working diagnosis" value={summary.diagnosis} />
              <Row label="Status" value={STATUS_TEXT[summary.status]} />
              <Row label="Registered" value={<span className="num">{fmtStamp(summary.registrationAt)}</span>} />
              <Row
                label="Left ED"
                value={
                  summary.leftAt ? <span className="num">{fmtStamp(summary.leftAt)}</span> : 'still in the ED'
                }
              />
              <Row
                label="Time in the ED"
                value={
                  <>
                    <span className="num">{fmtHours(summary.elapsedHours)}</span>{' '}
                    <span className="text-caption text-muted">({BAND_LABELS[summary.band]})</span>
                  </>
                }
              />
              <Row label="Classification" value={summary.stageNames.join(', ') || 'none recorded'} />
              <Row
                label="Waiting on"
                value={
                  summary.reasons.length === 0 ? (
                    'no reason recorded'
                  ) : (
                    <ul className="m-0 list-none p-0">
                      {summary.reasons.map((reason) => (
                        <li key={`${reason.stageName}/${reason.name}`} className="mb-0.5 last:mb-0">
                          <span className={reason.primary ? 'font-semibold' : ''}>{reason.name}</span>
                          {reason.primary ? <span className="text-caption text-accent-ink"> · primary</span> : null}
                          <span className="text-caption text-muted"> ({reason.stageName})</span>
                          {reason.otherText ? (
                            <span className="block text-caption text-ink-2">{reason.otherText}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )
                }
              />
              <Row label="Teams" value={summary.departments.join(', ') || 'none'} />
              <Row
                label="Documented actions"
                value={
                  documented.length === 0
                    ? 'none'
                    : documented.map((action) => `${action.name} ×${action.count}`).join(', ')
                }
              />
              <Row
                label="Updates"
                value={
                  <>
                    <span className="num">{summary.updates.count}</span>
                    {summary.updates.lastAt ? (
                      <span className="text-caption text-muted">
                        , last <span className="num">{fmtStamp(summary.updates.lastAt)}</span>
                      </span>
                    ) : null}
                  </>
                }
              />
              <Row label="Outcome" value={summary.outcome.dispositionLabel} />
              <Row label="Ward" value={summary.outcome.wardCode} />
              <Row label="Isolation" value={summary.outcome.isolation ? 'Yes' : null} />
              <Row
                label="Reviewed by"
                value={
                  summary.outcome.reviewedByName && summary.outcome.reviewedAt
                    ? `${summary.outcome.reviewedByName}, ${fmtStamp(summary.outcome.reviewedAt)}`
                    : null
                }
              />
            </tbody>
          </table>

          <h3 className="mt-3.5 mb-1 text-label font-medium text-muted">Time sequence</h3>
          <ol className="m-0 list-none p-0" data-summary-timeline>
            {summary.timeline.map((step) => (
              <li key={step.key} className="flex items-baseline gap-2 border-b border-line-soft py-1 last:border-b-0">
                <span className="num w-[86px] shrink-0 text-caption text-muted">{fmtStamp(step.at)}</span>
                <span className="min-w-0 flex-1 text-body text-ink">{step.label}</span>
                {step.fromPrevious == null ? null : (
                  <span className="num shrink-0 text-caption text-muted">+{fmtHours(step.fromPrevious)}</span>
                )}
              </li>
            ))}
          </ol>

          {/*
            The text the Copy button puts on the clipboard, in the DOM either way: hidden while
            the clipboard works, shown and selected when it does not. It is the same string
            `summaryText` builds, so what is pasted is never a re-rendering of the table above.
          */}
          <pre
            ref={pre}
            data-summary-text
            hidden={!selectable}
            className="mt-3 max-h-56 overflow-auto rounded-field border border-line bg-bg p-2 text-caption whitespace-pre-wrap text-ink-2"
          >
            {text}
          </pre>

          <p className="mt-3 mb-0 text-caption text-muted">
            As of {fmtStamp(summary.generatedAt)}, Asia/Riyadh. No update text and no resolution note are
            included.
          </p>
        </div>

        <div className="sticky bottom-0 flex items-center gap-2 border-t border-line bg-panel px-4 py-3">
          <Button tone="main" onClick={onCopy}>
            Copy
          </Button>
          <Button onClick={onClose}>Close</Button>
          <span role="status" className="text-body text-muted">
            {copyNote}
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * The trigger and the panel together, for a caller that already holds the summary: the case page,
 * which computes it on the server and slots this into the editor header.
 */
export function CaseSummarySheet({ summary }: { summary: CaseSummary }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    trigger.current?.focus()
  }, [])

  return (
    <>
      <Button
        ref={trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-summary-trigger
        className="px-3 text-label"
        onClick={() => setOpen(true)}
      >
        Summary
      </Button>
      {open ? <CaseSummaryDialog summary={summary} onClose={close} /> : null}
    </>
  )
}
