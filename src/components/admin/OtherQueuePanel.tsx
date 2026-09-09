'use client'

/**
 * Admin → the "Other" review queue. The prototype's row — "{stage} · {MRN}" over the wording,
 * linking to the case — plus the name box a promotion needs (prefilled with the wording, which is
 * the default the spec asks for) and the two buttons.
 */
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { dismissOther as dismissOtherAction, promoteOther as promoteOtherAction } from '@/app/(app)/admin/actions'
import { Button, Input } from '@/src/components/ui'
import type { OtherReviewRow } from '@/src/lib/admin/other'
import { fmtStamp } from '@/src/lib/cases/local-time'

export function OtherQueuePanel({ reviews, showAll }: { reviews: OtherReviewRow[]; showAll: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})

  async function run(work: () => Promise<string | null>): Promise<void> {
    setBusy(true)
    setMessage(null)
    try {
      const problem = await work()
      // Only a problem overwrites the message: a success message the work itself set (the
      // promotion summary) must survive, and the field was already cleared above.
      if (problem) setMessage(problem)
      else router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const onPromote = (row: OtherReviewRow): Promise<void> =>
    run(async () => {
      const result = await promoteOtherAction({ reviewId: row.id, name: names[row.id] ?? row.text })
      if (!result.ok) return result.message
      setMessage(
        `${result.reused ? 'Reused' : 'Created'} "${result.reasonName}" and re-tagged MRN ${row.mrn}` +
          `${result.primaryMoved ? ', which is now its primary reason.' : '.'}`,
      )
      return null
    })

  const onDismiss = (row: OtherReviewRow): Promise<void> =>
    run(async () => {
      const result = await dismissOtherAction(row.id)
      return result.ok ? null : result.message
    })

  const pending = reviews.filter((r) => r.status === 'PENDING')

  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <p className="text-body text-ink-2" data-other-count>
          {pending.length} description{pending.length === 1 ? '' : 's'} awaiting review
        </p>
        <Link
          href={showAll ? '/admin/other' : '/admin/other?show=all'}
          className="inline-flex min-h-11 items-center text-body font-semibold text-accent-ink"
        >
          {showAll ? 'Show only what is waiting' : 'Show what has been reviewed too'}
        </Link>
      </div>

      {message ? (
        <p role="status" className="mb-2.5 rounded-card border border-line bg-panel p-3 text-body text-ink-2">
          {message}
        </p>
      ) : null}

      {reviews.length === 0 ? (
        <p className="rounded-card border border-line bg-panel p-4 text-body text-muted">
          Nothing queued. Anything typed into an &quot;Other&quot; box shows up here so it can be
          promoted to a real category.
        </p>
      ) : (
        <ul className="grid gap-2.5">
          {reviews.map((row) => (
            <li
              key={row.id}
              data-other-review={row.text}
              className="rounded-card border border-line bg-panel p-4"
            >
              <p className="text-label text-muted">
                {row.stageName} ·{' '}
                <Link href={`/cases/${row.caseId}`} className="num font-semibold text-accent-ink">
                  {row.mrn}
                </Link>{' '}
                · <span className="num">{fmtStamp(row.registrationAt)}</span>
              </p>
              <p className="mt-1 text-body">{row.text}</p>

              {row.status === 'PENDING' ? (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div className="min-w-[280px] flex-1">
                    <label className="mb-1 block text-label font-medium text-muted" htmlFor={`name-${row.id}`}>
                      Name for the new reason
                    </label>
                    <Input
                      id={`name-${row.id}`}
                      value={names[row.id] ?? row.text}
                      disabled={busy}
                      onChange={(e) => setNames((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    />
                  </div>
                  <Button tone="main" disabled={busy} onClick={() => void onPromote(row)}>
                    Promote
                  </Button>
                  <Button disabled={busy} onClick={() => void onDismiss(row)}>
                    Dismiss
                  </Button>
                </div>
              ) : (
                <p className="mt-2 text-caption text-muted">
                  {row.status === 'PROMOTED'
                    ? `Promoted to "${row.promotedReason ?? 'a reason'}"`
                    : 'Dismissed'}
                  {row.reviewedBy ? ` by ${row.reviewedBy}` : ''}
                  {row.reviewedAt ? ` on ${fmtStamp(row.reviewedAt)}` : ''}.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2.5 text-caption text-muted">
        Promoting creates the reason under its stage — or reuses the one that is already there
        with that name — and re-tags the case it came from, moving the primary reason across if
        the &quot;Other&quot; one was primary. Dismissing leaves the case exactly as it is.
      </p>
    </div>
  )
}
