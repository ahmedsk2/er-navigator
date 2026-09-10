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
 * On the board the panel is not the row's to draw (Phase 10 review). The board is a list the 30 s
 * poll rewrites, and a panel drawn inside the row it summarises went with that row: a colleague
 * resolved the case, or edited it out of the filter, and the sheet vanished mid-read with the
 * keyboard dropped on <body>. So `Board` puts its rows inside one `RowSummaryHost`, which draws a
 * single panel outside the list, and a button inside a host hands it the summary and itself.
 * Outside a host — the dashboard's drill-down, a list that never polls — the button draws its own
 * panel, as it always has.
 *
 * `.no-print`, because the handover sheet is a table and a button is not a column.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { CaseSummaryDialog } from '@/src/components/cases/CaseSummarySheet'
import { FileText } from '@/src/components/icons'
import type { CaseSummary } from '@/src/lib/cases/summary'

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'open'; summary: CaseSummary }
  | { kind: 'failed' }

type SummaryHost = {
  /** The case whose summary is open, so that its button, and only its, says `aria-expanded`. */
  openCaseId: string | null
  /** A button is about to ask for a summary: the ticket its answer must bring back to be shown. */
  request: () => number
  /**
   * Open `summary` if `ticket` is still the latest request; `trigger` is the button that asked
   * for it, to be given the keyboard back.
   */
  show: (caseId: string, summary: CaseSummary, trigger: HTMLElement | null, ticket: number) => void
}

const SummaryHostContext = createContext<SummaryHost | null>(null)

/** What the host is showing, keyed afresh for every opening. */
type Shown = { caseId: string; summary: CaseSummary; key: number }

/**
 * The board's one summary panel, drawn after `children` and so outside the list of rows.
 *
 * Closing it gives the keyboard back to the button that opened it while that button is still on
 * the page. When it is not — the poll took its row away while the panel was open — it goes to the
 * element `fallbackFocusId` names instead: the board passes its page title, which is there whatever
 * the rows are, the empty state included, and is not a text field (focusing the search box would
 * raise the phone's keyboard over the list).
 */
export function RowSummaryHost({
  fallbackFocusId,
  children,
}: {
  fallbackFocusId: string
  children: ReactNode
}) {
  const [shown, setShown] = useState<Shown | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  /** Bumped per opening, so each one mounts a fresh panel that takes the focus as it opens. */
  const openings = useRef(0)
  /**
   * Bumped per request and per close. On a slow ward connection a nurse can tap one row, then
   * another before the first answer is back; answers arrive in any order, and only the one she
   * asked for last may open the panel — and none may once she has closed it.
   */
  const requests = useRef(0)

  const request = useCallback(() => {
    requests.current += 1
    return requests.current
  }, [])

  const show = useCallback((caseId: string, summary: CaseSummary, from: HTMLElement | null, ticket: number) => {
    if (ticket !== requests.current) return
    trigger.current = from
    openings.current += 1
    setShown({ caseId, summary, key: openings.current })
  }, [])

  const close = useCallback(() => {
    const from = trigger.current
    trigger.current = null
    requests.current += 1
    setShown(null)
    if (from?.isConnected) from.focus()
    else document.getElementById(fallbackFocusId)?.focus()
  }, [fallbackFocusId])

  const openCaseId = shown?.caseId ?? null
  const host = useMemo<SummaryHost>(() => ({ openCaseId, request, show }), [openCaseId, request, show])

  return (
    <SummaryHostContext value={host}>
      {children}
      {shown ? <CaseSummaryDialog key={shown.key} summary={shown.summary} onClose={close} /> : null}
    </SummaryHostContext>
  )
}

export function RowSummaryButton({ caseId, mrn }: { caseId: string; mrn: string }) {
  const host = useContext(SummaryHostContext)
  const [state, setState] = useState<State>({ kind: 'idle' })
  const trigger = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => {
    setState({ kind: 'idle' })
    trigger.current?.focus()
  }, [])

  const open = useCallback(() => {
    setState({ kind: 'loading' })
    // The element itself, taken now: if the row is gone by the time the answer comes back, the ref
    // has been emptied, and the host still needs something to test for `isConnected`.
    const from = trigger.current
    const ticket = host?.request() ?? 0
    fetch(`/api/cases/${caseId}/summary`, { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        const summary = (await response.json()) as CaseSummary
        if (host) {
          setState({ kind: 'idle' })
          host.show(caseId, summary, from, ticket)
        } else {
          setState({ kind: 'open', summary })
        }
      })
      // A dropped ward wifi, or a case voided since the board last polled. The row keeps working;
      // the button says the summary could not be read rather than opening an empty panel.
      .catch(() => setState({ kind: 'failed' }))
  }, [caseId, host])

  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-summary-for={mrn}
        aria-label={`Summary for ${mrn}`}
        aria-haspopup="dialog"
        aria-expanded={host ? host.openCaseId === caseId : state.kind === 'open'}
        disabled={state.kind === 'loading'}
        onClick={open}
        className="no-print inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-button border border-line bg-panel text-ink-2 disabled:opacity-60"
      >
        <FileText size={18} />
      </button>
      {/* A line of its own under the card (the row's `<li>` wraps), right-aligned so it sits
          under the button it answers. Beside the card it would take its width from the card. */}
      {state.kind === 'failed' ? (
        <span role="status" className="no-print basis-full text-right text-caption text-danger">
          Could not read the summary.
        </span>
      ) : null}
      {state.kind === 'open' ? <CaseSummaryDialog summary={state.summary} onClose={close} /> : null}
    </>
  )
}
