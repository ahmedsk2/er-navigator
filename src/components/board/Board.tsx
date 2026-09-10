'use client'

/**
 * The board — the prototype's `Board`, on real data.
 *
 * Two things move on their own: the list is re-fetched from `GET /api/board` every 30 s, and
 * `now` ticks on the same beat so the clocks keep running between fetches. Everything else is
 * derived: sort, search and the counts strip are the pure functions in `src/lib/board/rows.ts`,
 * so the server's first paint and every client re-render agree by construction.
 *
 * The filter is a real navigation (three links, `?f=`), because it changes which rows the server
 * must load. The MRN search is client-side over the rows already in hand and only rewrites the
 * URL, so typing never costs a round trip but a refresh still keeps what you typed.
 */
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BOARD_POLL_MS,
  countsOf,
  searchRows,
  sortByElapsed,
} from '@/src/lib/board/rows'
import { BOARD_FILTERS, type BoardFilter, type BoardPayload } from '@/src/lib/board/types'
import { fmtClock } from '@/src/lib/cases/local-time'
import {
  caseFilterQuery,
  isEmptyFilter,
  type CaseFilter,
  type FilterOptions,
} from '@/src/lib/domain/case-filter'
import { Search } from '@/src/components/icons'
import { FilterBar } from '@/src/components/filter/FilterBar'
import { InstallPrompt } from '@/src/components/shell/InstallPrompt'
import { PageHeader } from '@/src/components/shell/PageHeader'
import { Input } from '@/src/components/ui'
import { BoardRowItem, ROW_COLUMNS } from './BoardRowItem'
import { HandoverSheet, narrowingLine } from './HandoverSheet'
import { RowSummaryHost } from './RowSummaryButton'

const FILTER_LABEL: Record<BoardFilter, string> = { open: 'Open', resolved: 'Resolved', all: 'All' }

/**
 * The laptop's column headings (Phase 9). Decorative: every cell under them repeats its own
 * meaning in words — "reg 09/09 03:32", "No update for 3h 10m" — and a screen reader that read
 * five headings before every row would say more than the row does. `aria-hidden`, therefore, and
 * `hidden lg:grid`, because the phone's row is three stacked lines and has nothing to head.
 */
const COLUMN_LABELS = ['MRN', 'Registered', 'Waiting on', 'Last update', 'Elapsed'] as const

/**
 * The search box's id: its label's `htmlFor`, and where the row summary sends the keyboard when
 * the row it was opened from has left the board by the time it is closed.
 */
const SEARCH_ID = 'board-search'

/**
 * `/?f=` and `/?q=`, exactly as they were: `f` is omitted when it is the default Open board and
 * `q` when nothing is typed. The Phase 10 case filter's keys are APPENDED after those two and
 * emit nothing at all when the filter is empty, so `/`, `/?f=all` and `/?q=3100002` are the same
 * strings this phase found them.
 */
function boardQuery(filter: BoardFilter, query: string): string {
  const params = new URLSearchParams()
  if (filter !== 'open') params.set('f', filter)
  if (query) params.set('q', query)
  return params.toString()
}

function boardHref(filter: BoardFilter, query: string, caseFilter: CaseFilter): string {
  const search = [boardQuery(filter, query), caseFilterQuery(caseFilter)].filter(Boolean).join('&')
  return search ? `/?${search}` : '/'
}

export function Board({
  initial,
  initialQuery,
  caseFilter,
  filterOptions,
  printedBy,
}: {
  initial: BoardPayload
  initialQuery: string
  caseFilter: CaseFilter
  filterOptions: FilterOptions
  printedBy: string
}) {
  const [payload, setPayload] = useState(initial)
  const [query, setQuery] = useState(initialQuery)
  const [now, setNow] = useState(() => new Date(initial.now))
  /** When the rows on screen were last fetched, and whether the newest poll failed (review C19). */
  const [updatedAt, setUpdatedAt] = useState(() => new Date(initial.now))
  const [pollFailed, setPollFailed] = useState(false)
  const filter = initial.filter
  const alive = useRef(true)
  const filtered = !isEmptyFilter(caseFilter)
  const filterQuery = caseFilterQuery(caseFilter)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // One beat for both jobs. A failed poll (the ward's wifi drops) leaves the last good list on
  // screen and still moves the clocks, which is what a nurse needs more than an error banner —
  // but the freshness line below says so, because a frozen list that looks live is worse than a
  // stale one that admits it (review C19).
  //
  // A 401 is not a dropped packet (review C6). The session behind the cookie is gone — expired,
  // logged out on another device, or the account deactivated by an Admin — and every later poll
  // will get the same answer, so the beat stops and the browser goes to the login form.
  // `?expired=1` is the path the route gate recognises as "clear both cookies".
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date())
      void fetch(`/api/board?${['f=' + filter, filterQuery].filter(Boolean).join('&')}`, { cache: 'no-store' })
        .then(async (response) => {
          if (response.status === 401) {
            clearInterval(timer)
            // A full navigation on purpose, not router.push(): the route gate is what clears the
            // two cookies on `?expired=1`, and a client-side push never reaches it. Everything
            // this tab holds is dead anyway.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.assign('/login?expired=1')
            return
          }
          if (!response.ok) throw new Error(`board api answered ${response.status}`)
          const next = (await response.json()) as BoardPayload
          if (!alive.current || next.filter !== filter) return
          setPayload(next)
          setUpdatedAt(new Date())
          setPollFailed(false)
        })
        .catch(() => {
          if (alive.current) setPollFailed(true)
        })
    }, BOARD_POLL_MS)
    return () => clearInterval(timer)
  }, [filter, filterQuery])

  // Keep the address bar honest without a navigation: `q` never changes what the server loads.
  // The case filter is carried through so typing an MRN does not silently drop it from the URL.
  useEffect(() => {
    const href = boardHref(filter, query, caseFilter)
    if (window.location.pathname + window.location.search !== href) {
      window.history.replaceState(null, '', href)
    }
  }, [filter, query, caseFilter])

  const visible = useMemo(
    () => sortByElapsed(searchRows(payload.rows, query), now),
    [payload.rows, query, now],
  )
  const counts = useMemo(() => countsOf(payload.openRegistrations, now), [payload.openRegistrations, now])

  const emptyMessage = query
    ? `No case matching ${query}.`
    : filtered
      ? 'No case matches this filter. Change it, or clear it to see the whole board.'
      : filter === 'open'
        ? 'No open cases. Tap New case when a patient passes the threshold.'
        : 'Nothing here yet.'

  return (
    <div>
      <PageHeader
        title="ER board"
        subtitle={
          <>
            {/* One element, one sentence — the board spec matches it whole. What Phase 9 adds is
                weight and colour on the three figures inside it, so the two that matter can be
                found without reading the line. */}
            <p className="num mt-0.5 text-[14px] text-muted">
              <span className="font-semibold text-ink">{counts.open} open</span> ·{' '}
              <span className="font-semibold text-band-h6">{counts.past6} past 6h</span> ·{' '}
              <span className="font-semibold text-band-h12">{counts.past12} past 12h</span>
            </p>
            {/* How old the rows are. Riyadh time, 24 h, the same string on the server's first
                paint and on every client tick. A nurse reading a frozen board must be able to see
                that it is frozen; the rows stay on screen either way. */}
            <p
              data-board-freshness={pollFailed ? 'stale' : 'fresh'}
              className="mt-0.5 text-caption text-muted"
            >
              {pollFailed
                ? `Not updating since ${fmtClock(updatedAt)}. Check the connection.`
                : `Updated ${fmtClock(updatedAt)}`}
            </p>
          </>
        }
      />

      {/* The phone stacks the field over the chips; the laptop has room for one line, which is
          also what puts the chips beside the field the mockup shows. */}
      <div className="no-print px-4 pb-2.5 lg:flex lg:items-center lg:gap-3 lg:px-0">
        <label htmlFor={SEARCH_ID} className="sr-only">
          Search MRN
        </label>
        <div className="relative mb-2.5 lg:mb-0 lg:w-[320px] lg:shrink-0">
          <Search
            size={18}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
          />
          <Input
            id={SEARCH_ID}
            type="search"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Search MRN"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="num pl-10"
          />
        </div>
        <div className="flex gap-2" role="group" aria-label="Filter">
          {BOARD_FILTERS.map((option) => (
            <Link
              key={option}
              href={boardHref(option, query, caseFilter)}
              aria-current={option === filter ? 'true' : undefined}
              className={`inline-flex min-h-11 items-center rounded-chip border px-3.5 text-[14px] ${
                option === filter
                  ? 'border-accent bg-accent font-semibold text-white'
                  : 'border-line bg-panel text-ink-2'
              }`}
            >
              {FILTER_LABEL[option]}
            </Link>
          ))}
        </div>
      </div>

      {/* Under the search and the three tabs, above the rows: the filter narrows what those two
          are looking at, and the handover sheet prints whatever is left. */}
      <FilterBar
        basePath="/"
        baseQuery={boardQuery(filter, query)}
        filter={caseFilter}
        options={filterOptions}
        count={filtered ? `${counts.open} of ${payload.totalOpen} open cases` : undefined}
      />

      {/* The sheet prints `visible`, which both the filter and the search box narrow, and the
          chips and the count line that say so on screen do not print: the sheet says it itself. */}
      <HandoverSheet
        rows={visible}
        now={now}
        printedBy={printedBy}
        narrowing={narrowingLine(caseFilter, filterOptions, query)}
      />

      {/* One summary panel for every row, drawn after the list rather than inside a row, so the
          poll can take a row away — or empty the list — while its summary is being read. */}
      <RowSummaryHost fallbackFocusId={SEARCH_ID}>
        {visible.length === 0 ? (
          <p className="no-print mx-4 rounded-card border border-line bg-panel p-7 text-center text-body text-muted shadow-card lg:mx-0">
            {emptyMessage}
          </p>
        ) : (
          <>
            <div
              aria-hidden="true"
              data-board-columns
              className={`no-print hidden px-4 pb-1 text-caption font-semibold text-muted lg:grid lg:gap-x-3 ${ROW_COLUMNS}`}
            >
              {COLUMN_LABELS.map((label, i) => (
                <span
                  key={label}
                  className={i === COLUMN_LABELS.length - 1 ? 'text-right' : undefined}
                >
                  {label}
                </span>
              ))}
            </div>
            <ul className="no-print">
              {visible.map((row) => (
                <BoardRowItem key={row.id} row={row} now={now} />
              ))}
            </ul>
          </>
        )}
      </RowSummaryHost>

      {/* After the rows, not before them (Phase 7). The banner can only appear once the browser
          has hydrated — the server cannot know whether this phone has already dismissed it — and
          anything inserted above the list would push the patient rows down half a second after
          the board paints. On a board a nurse taps at a glance, that is a wrong-patient tap
          waiting to happen; measured, it also cost 0.12 of cumulative layout shift. Here it
          displaces nothing. */}
      <InstallPrompt />
    </div>
  )
}
