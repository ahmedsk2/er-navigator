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
import { InstallPrompt } from '@/src/components/shell/InstallPrompt'
import { BoardRowItem } from './BoardRowItem'
import { HandoverSheet } from './HandoverSheet'

const FILTER_LABEL: Record<BoardFilter, string> = { open: 'Open', resolved: 'Resolved', all: 'All' }

/** `/`, `/?f=all`, `/?f=resolved&q=8515` — the canonical URL for a filter and a query. */
function boardHref(filter: BoardFilter, query: string): string {
  const params = new URLSearchParams()
  if (filter !== 'open') params.set('f', filter)
  if (query) params.set('q', query)
  const search = params.toString()
  return search ? `/?${search}` : '/'
}

export function Board({ initial, initialQuery, printedBy }: { initial: BoardPayload; initialQuery: string; printedBy: string }) {
  const [payload, setPayload] = useState(initial)
  const [query, setQuery] = useState(initialQuery)
  const [now, setNow] = useState(() => new Date(initial.now))
  const filter = initial.filter
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // One beat for both jobs. A failed poll (the ward's wifi drops) leaves the last good list on
  // screen and still moves the clocks, which is what a nurse needs more than an error banner.
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date())
      void fetch(`/api/board?f=${filter}`, { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((next: BoardPayload | null) => {
          if (next && alive.current && next.filter === filter) setPayload(next)
        })
        .catch(() => undefined)
    }, BOARD_POLL_MS)
    return () => clearInterval(timer)
  }, [filter])

  // Keep the address bar honest without a navigation: `q` never changes what the server loads.
  useEffect(() => {
    const href = boardHref(filter, query)
    if (window.location.pathname + window.location.search !== href) {
      window.history.replaceState(null, '', href)
    }
  }, [filter, query])

  const visible = useMemo(
    () => sortByElapsed(searchRows(payload.rows, query), now),
    [payload.rows, query, now],
  )
  const counts = useMemo(() => countsOf(payload.openRegistrations, now), [payload.openRegistrations, now])

  const emptyMessage = query
    ? `No case matching ${query}.`
    : filter === 'open'
      ? 'No open cases. Tap New case when a patient passes the threshold.'
      : 'Nothing here yet.'

  return (
    <div>
      <div className="px-4 pt-4 pb-2.5">
        <h2 className="text-title">ER board</h2>
        <p className="num mt-0.5 text-[14px] text-muted">
          {counts.open} open · {counts.past6} past 6h · {counts.past12} past 12h
        </p>
      </div>

      <div className="no-print px-4 pb-2.5">
        <label htmlFor="board-search" className="sr-only">
          Search MRN
        </label>
        <input
          id="board-search"
          type="search"
          inputMode="numeric"
          autoComplete="off"
          placeholder="Search MRN"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="num mb-2.5 w-full min-h-11 rounded-field border border-line bg-panel px-3 py-2.5 text-input text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
        <div className="flex gap-2" role="group" aria-label="Filter">
          {BOARD_FILTERS.map((option) => (
            <Link
              key={option}
              href={boardHref(option, query)}
              aria-current={option === filter ? 'true' : undefined}
              className={`inline-flex min-h-11 items-center rounded-chip border px-3 text-[14px] ${
                option === filter ? 'border-accent bg-accent font-semibold text-white' : 'border-line bg-panel text-ink'
              }`}
            >
              {FILTER_LABEL[option]}
            </Link>
          ))}
        </div>
      </div>

      {/* Below the filters, above the rows: seen on arrival, never in the way of the list, and
          gone for good once dismissed or installed (Phase 7). */}
      <InstallPrompt />

      <HandoverSheet rows={visible} now={now} printedBy={printedBy} />

      {visible.length === 0 ? (
        <p className="no-print border-y border-line bg-panel p-7 text-center text-body text-muted">{emptyMessage}</p>
      ) : (
        <ul className="no-print">
          {visible.map((row) => (
            <BoardRowItem key={row.id} row={row} now={now} />
          ))}
        </ul>
      )}
    </div>
  )
}
