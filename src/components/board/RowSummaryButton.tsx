'use client'

/**
 * The summary button on a board row (Phase 10).
 *
 * It sits as a SIBLING of the row's `<a data-mrn>`, never inside it: a button nested in a link is
 * invalid HTML, a tap on it would follow the link on some browsers, and the board's row count is
 * asserted as `a[data-mrn]` in three specs — a second anchor or a nested control would either
 * break the count or make it mean something else.
 *
 * The summary is fetched on the tap rather than shipped with every row: a board of forty rows
 * would otherwise carry forty timelines, forty reason lists and forty consult lists to a phone,
 * for a panel the nurse opens perhaps twice a shift.
 *
 * `.no-print`, because the handover sheet is a table and a button is not a column.
 */
import { useCallback, useRef, useState } from 'react'
import { CaseSummaryDialog } from '@/src/components/cases/CaseSummarySheet'
import { FileText } from '@/src/components/icons'
import type { CaseSummary } from '@/src/lib/cases/summary'

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'open'; summary: CaseSummary }
  | { kind: 'failed' }

export function RowSummaryButton({ caseId, mrn }: { caseId: string; mrn: string }) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const trigger = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => {
    setState({ kind: 'idle' })
    trigger.current?.focus()
  }, [])

  const open = useCallback(() => {
    setState({ kind: 'loading' })
    fetch(`/api/cases/${caseId}/summary`, { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        setState({ kind: 'open', summary: (await response.json()) as CaseSummary })
      })
      // A dropped ward wifi, or a case voided since the board last polled. The row keeps working;
      // the button says the summary could not be read rather than opening an empty panel.
      .catch(() => setState({ kind: 'failed' }))
  }, [caseId])

  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-summary-for={mrn}
        aria-label={`Summary for ${mrn}`}
        aria-haspopup="dialog"
        aria-expanded={state.kind === 'open'}
        disabled={state.kind === 'loading'}
        onClick={open}
        className="no-print inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-button border border-line bg-panel text-ink-2 disabled:opacity-60"
      >
        <FileText size={18} />
      </button>
      {state.kind === 'failed' ? (
        <span role="status" className="no-print text-caption text-danger">
          Could not read the summary.
        </span>
      ) : null}
      {state.kind === 'open' ? <CaseSummaryDialog summary={state.summary} onClose={close} /> : null}
    </>
  )
}
