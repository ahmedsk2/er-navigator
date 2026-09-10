'use client'

/**
 * The prototype's `ExportPanel` (docs/reference/ERNavigatorTracker.jsx), as a real page: two date
 * inputs over the registration date, a status filter, the live count, the workbook and the report.
 *
 * The prototype counted in the browser because every case was in `localStorage`. Here the count is
 * a route handler, so the page never downloads a month of cases to say how many there are, and the
 * number it shows is the one the server would actually write. The first count is rendered on the
 * server, so the page is already truthful before any JavaScript runs, and the two downloads are
 * plain links for the same reason: a nurse with a flaky ward connection gets the browser's own
 * download, not a fetch that has to survive.
 *
 * Both dates are Asia/Riyadh calendar days — see src/lib/export/range.ts.
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { FilterBar } from '@/src/components/filter/FilterBar'
import { PageHeader } from '@/src/components/shell/PageHeader'
import { Download, Printer } from '@/src/components/icons'
import { BUTTON_MAIN, BUTTON_QUIET, Field, Input, Select } from '@/src/components/ui'
import {
  EXPORT_FORMATS,
  EXPORT_FORMAT_HELP,
  EXPORT_FORMAT_LABELS,
  EXPORT_STATUSES,
  EXPORT_STATUS_LABELS,
  exportRangeQuery,
  reportQuery,
  type ExportFormat,
  type ExportRange,
  type ExportStatus,
} from '@/src/lib/export/range'
import type { ExportCountPayload } from '@/src/lib/export/service'
import { EMPTY_FILTER, type FilterOptions } from '@/src/lib/domain/case-filter'

/**
 * The two download controls are links, not buttons, so they cannot be <Button>; they take the
 * button tones from the same module instead. Until Phase 9 this file carried its own copy of the
 * input and button strings, which is exactly how a primitive drifts.
 */
const LINK_BASE =
  'flex min-h-11 w-full items-center justify-center gap-2 rounded-button px-4 text-body font-semibold'

export function ExportPanel({
  initialRange,
  initialCount,
  filterOptions,
}: {
  initialRange: ExportRange
  initialCount: number
  filterOptions: FilterOptions
}) {
  const initialQuery = exportRangeQuery(initialRange)
  const [range, setRange] = useState<ExportRange>(initialRange)
  /**
   * Counts by query string rather than one "current count": the answer for a range the nurse has
   * already seen is shown immediately while it is re-checked, and the state is only ever written
   * from the fetch's own callback, never synchronously while the effect runs.
   */
  const [counts, setCounts] = useState<Record<string, number>>(() => ({ [initialQuery]: initialCount }))
  const query = exportRangeQuery(range)
  const count = counts[query]

  useEffect(() => {
    if (query === initialQuery) return
    const controller = new AbortController()
    fetch(`/api/export/count?${query}`, { signal: controller.signal, cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<ExportCountPayload>) : null))
      .then((payload) => {
        if (payload) setCounts((previous) => ({ ...previous, [query]: payload.count }))
      })
      .catch(() => {
        // An aborted or failed count leaves the line reading "counting…"; the links still work.
      })
    return () => controller.abort()
  }, [query, initialQuery])

  const empty = count === 0

  return (
    <div>
      <PageHeader title="Export and print" />

      {/*
        The filter is a navigation, not a control in the card: it changes what the count means and
        what both downloads would contain, and the page must be able to be re-opened at exactly
        this request from a link. The dates are the panel's own state, so they ride along as the
        base query — a filter applied after moving the dates keeps the dates.
      */}
      <FilterBar
        basePath="/export"
        baseQuery={exportRangeQuery({ ...range, filter: undefined })}
        filter={range.filter ?? EMPTY_FILTER}
        options={filterOptions}
      />

      <section className="mx-4 mb-2.5 rounded-card border border-line bg-panel p-4 shadow-card lg:mx-0 lg:max-w-[560px]">
        {/*
          Above the range, because it changes what the two buttons below mean: the same cases,
          three different files. The one-line help under it is the whole of the choice — the
          columns themselves are documented on each workbook's own "Read me" sheet.
        */}
        <Field label="Format">
          <Select
            aria-label="Format"
            value={range.format}
            onChange={(e) => setRange((r) => ({ ...r, format: e.target.value as ExportFormat }))}
          >
            {EXPORT_FORMATS.map((format) => (
              <option key={format} value={format}>
                {EXPORT_FORMAT_LABELS[format]}
              </option>
            ))}
          </Select>
        </Field>
        <p className="mt-0 mb-3 text-caption text-muted" data-format-help>
          {EXPORT_FORMAT_HELP[range.format]}
        </p>

        <div className="flex gap-2.5">
          <div className="min-w-0 flex-1">
            <Field label="From (registration date)">
              <Input
                type="date"
                value={range.from}
                max={range.to}
                onChange={(e) => setRange((r) => ({ ...r, from: e.target.value || r.from }))}
              />
            </Field>
          </div>
          <div className="min-w-0 flex-1">
            <Field label="To">
              <Input
                type="date"
                value={range.to}
                min={range.from}
                onChange={(e) => setRange((r) => ({ ...r, to: e.target.value || r.to }))}
              />
            </Field>
          </div>
        </div>

        <Field label="Status">
          {/*
            The wrapping <label> would otherwise take its accessible name from its whole text
            content — which, for a <select>, includes every option — so the name is stated once
            here, identically to the visible label.
          */}
          <Select
            aria-label="Status"
            value={range.status}
            onChange={(e) => setRange((r) => ({ ...r, status: e.target.value as ExportStatus }))}
          >
            {EXPORT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {EXPORT_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </Field>

        <p className="num m-0 mb-3 text-body" data-export-count>
          {count === undefined ? 'counting…' : `${count} case${count === 1 ? '' : 's'} in range`}
        </p>

        {empty ? (
          <span
            aria-disabled="true"
            className={`${LINK_BASE} ${BUTTON_MAIN} mb-2.5 cursor-not-allowed opacity-60`}
            data-download-disabled
          >
            <Download size={18} />
            Download Excel
          </span>
        ) : (
          <a
            href={`/api/export.xlsx?${query}`}
            className={`${LINK_BASE} ${BUTTON_MAIN} mb-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2`}
            data-download
          >
            <Download size={18} />
            Download Excel
          </a>
        )}

        <Link
          href={`/report?${reportQuery(range)}`}
          target="_blank"
          rel="noreferrer"
          className={`${LINK_BASE} ${BUTTON_QUIET} focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
          data-print-report
        >
          <Printer size={18} />
          Print report
        </Link>

        <p className="mt-2.5 mb-0 text-caption text-muted">
          All three formats cover the same cases: the range is the registration date, and voided
          cases are never exported. Print report opens the department report for this range in a
          new tab. A filter above narrows the count, the workbook and the report alike.
        </p>
      </section>
    </div>
  )
}
