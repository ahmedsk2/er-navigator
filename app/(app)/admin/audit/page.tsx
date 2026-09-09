import type { Metadata } from 'next'
import Link from 'next/link'
import { fmtStamp } from '@/src/lib/cases/local-time'
import { loadAuditPage, parseFilters } from '@/src/lib/admin/audit-view'

export const metadata: Metadata = { title: 'Audit log · Admin · ER Navigator' }
export const dynamic = 'force-dynamic'

/**
 * `/admin/audit` — the append-only record, filtered and paginated. A plain GET form, so a filtered
 * view is a URL an administrator can keep, and no JavaScript is needed to read the log.
 *
 * `before`/`after` are shown as the keys that changed, not as raw JSON: "status: OPEN →
 * RESOLVED" is what someone reading at 03:10 needs. Nothing on this page can write.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const filters = parseFilters(params)
  const page = await loadAuditPage(filters)

  const query = (next: number): string => {
    const q = new URLSearchParams()
    if (filters.action) q.set('action', filters.action)
    if (filters.entity) q.set('entity', filters.entity)
    if (filters.actorId) q.set('actor', filters.actorId)
    if (filters.from) q.set('from', filters.from)
    if (filters.to) q.set('to', filters.to)
    q.set('page', String(next))
    return `/admin/audit?${q.toString()}`
  }

  const FIELD =
    'min-h-11 w-full rounded-field border border-line bg-panel px-3 text-input text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft'

  return (
    <div>
      <form method="get" className="mb-2.5 grid gap-x-3 rounded-card border border-line bg-panel p-4 sm:grid-cols-5">
        <label className="mb-3.5 block">
          <span className="mb-1 block text-label font-medium text-muted">Action</span>
          <select name="action" defaultValue={filters.action ?? ''} className={FIELD}>
            <option value="">Any action</option>
            {page.actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="mb-3.5 block">
          <span className="mb-1 block text-label font-medium text-muted">Entity</span>
          <select name="entity" defaultValue={filters.entity ?? ''} className={FIELD}>
            <option value="">Any entity</option>
            {page.entities.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <label className="mb-3.5 block">
          <span className="mb-1 block text-label font-medium text-muted">Actor</span>
          <select name="actor" defaultValue={filters.actorId ?? ''} className={FIELD}>
            <option value="">Anyone</option>
            {page.actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="mb-3.5 block">
          <span className="mb-1 block text-label font-medium text-muted">From</span>
          <input type="date" name="from" defaultValue={filters.from ?? ''} className={FIELD} />
        </label>
        <label className="mb-3.5 block">
          <span className="mb-1 block text-label font-medium text-muted">To</span>
          <input type="date" name="to" defaultValue={filters.to ?? ''} className={FIELD} />
        </label>
        <div className="flex gap-2 sm:col-span-5">
          <button
            type="submit"
            className="min-h-11 rounded-button bg-accent px-4 text-body font-semibold text-white"
          >
            Apply
          </button>
          <Link
            href="/admin/audit"
            className="inline-flex min-h-11 items-center rounded-button border border-line bg-panel px-4 text-body font-semibold text-ink"
          >
            Clear
          </Link>
        </div>
      </form>

      <p className="mb-2.5 text-body text-ink-2" data-audit-total>
        {page.total} row{page.total === 1 ? '' : 's'} · page {page.page} of {page.pageCount}
      </p>

      <div className="overflow-x-auto rounded-card border border-line bg-panel">
        <table className="w-full border-collapse text-body">
          <caption className="sr-only">Audit rows, newest first</caption>
          <thead>
            <tr className="border-b border-line text-left text-label text-muted">
              <th scope="col" className="p-3 font-medium">
                When
              </th>
              <th scope="col" className="p-3 font-medium">
                Action
              </th>
              <th scope="col" className="p-3 font-medium">
                Entity
              </th>
              <th scope="col" className="p-3 font-medium">
                Actor
              </th>
              <th scope="col" className="p-3 font-medium">
                What changed
              </th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => (
              <tr key={row.id} data-audit-row={row.action} className="border-b border-line-soft last:border-b-0 align-top">
                <td className="num p-3 whitespace-nowrap text-ink-2">{fmtStamp(row.at)}</td>
                <td className="p-3 font-semibold">{row.action}</td>
                <td className="p-3 text-ink-2">
                  {row.entity}
                  {row.entityId ? <span className="num block text-caption text-muted">{row.entityId}</span> : null}
                </td>
                <td className="p-3 text-ink-2">{row.actor ?? 'System'}</td>
                <td className="p-3">
                  {row.diff.length === 0 ? (
                    <span className="text-muted">–</span>
                  ) : (
                    <ul className="grid gap-0.5">
                      {row.diff.slice(0, 8).map((d) => (
                        <li key={d.key} className="text-caption">
                          <span className="font-semibold">{d.key || 'value'}</span>:{' '}
                          <span className="text-muted">{d.before ?? '—'}</span> → {d.after ?? '—'}
                        </li>
                      ))}
                      {row.diff.length > 8 ? (
                        <li className="text-caption text-muted">and {row.diff.length - 8} more</li>
                      ) : null}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex gap-2">
        {page.page > 1 ? (
          <Link
            href={query(page.page - 1)}
            className="inline-flex min-h-11 items-center rounded-button border border-line bg-panel px-4 text-body font-semibold text-accent-ink"
          >
            ‹ Newer
          </Link>
        ) : null}
        {page.page < page.pageCount ? (
          <Link
            href={query(page.page + 1)}
            className="inline-flex min-h-11 items-center rounded-button border border-line bg-panel px-4 text-body font-semibold text-accent-ink"
          >
            Older ›
          </Link>
        ) : null}
      </div>
    </div>
  )
}
