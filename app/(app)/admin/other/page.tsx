import type { Metadata } from 'next'
import { OtherQueuePanel } from '@/src/components/admin/OtherQueuePanel'
import { loadOtherReviews } from '@/src/lib/admin/other'

export const metadata: Metadata = { title: 'Other queue · Admin · ER Navigator' }
export const dynamic = 'force-dynamic'

/**
 * `/admin/other` — the prototype's "Other reasons awaiting review" list (its `Dashboard`
 * function renders `otherQueue` as stage · MRN over the text, each row opening the case), with
 * the two decisions the plan adds: Promote, which creates or reuses a reason under that stage
 * and re-tags the case, and Dismiss, which leaves the wording alone.
 *
 * `?show=all` also lists what has already been reviewed, so an administrator can see what a
 * promotion did without opening the audit log.
 */
export default async function AdminOtherPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[] }>
}) {
  const params = await searchParams
  const raw = Array.isArray(params.show) ? params.show[0] : params.show
  const showAll = raw === 'all'
  const reviews = await loadOtherReviews(showAll ? 'ALL' : 'PENDING')
  return <OtherQueuePanel reviews={reviews} showAll={showAll} />
}
