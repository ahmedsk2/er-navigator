import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CaseEditor } from '@/src/components/cases/CaseEditor'
import { CaseSummarySheet } from '@/src/components/cases/CaseSummarySheet'
import { CaseTimeline } from '@/src/components/cases/CaseTimeline'
import { loadUnacknowledgedAlert } from '@/src/lib/alerts/service'
import { requireUser } from '@/src/lib/auth/session'
import { can } from '@/src/lib/authz/policy'
import { loadCaseForEditor } from '@/src/lib/cases/load'
import { loadReferenceForCase } from '@/src/lib/cases/reference'
import { summaryOf } from '@/src/lib/cases/summary'

export const metadata: Metadata = { title: 'Case · ER Navigator' }
export const dynamic = 'force-dynamic'

/**
 * `/cases/[id]` — every role may look. A VIEWER, and anyone at all on a voided case, gets exactly
 * the same editor with every control disabled: one screen, one code path, no second read-only
 * rendering to drift out of step.
 */
export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()
  // The case-aware reference: active rows plus anything this case already carries that an Admin
  // has since deactivated, so a retired chip stays visible and removable (Phase 7, C4/C10). It
  // feeds the editor's chips and the validation metadata alike, exactly as the actions do.
  const reference = await loadReferenceForCase(id)
  const loaded = await loadCaseForEditor(id, reference)
  if (!loaded) notFound()

  const readOnly = !can(user.role, 'case.edit') || loaded.status === 'VOIDED'
  const canVoid = can(user.role, 'case.void') && loaded.status !== 'VOIDED'

  // Phase 6: a supervisor or an admin is offered the Acknowledge control in the header when the
  // worker has recorded a threshold nobody has acknowledged yet. A navigator never sees it, and
  // the action checks `alert.acknowledge` again on the server.
  const mayAcknowledge = can(user.role, 'alert.acknowledge')
  const alert = mayAcknowledge ? await loadUnacknowledgedAlert(loaded.id) : null

  // Phase 8b, decision H. Every role sees whether the case has been reviewed; only a SUPERVISOR
  // or an ADMIN is offered the control, and only while the case is not voided — `reviewCase`
  // checks `case.review` and refuses a voided case again on the server.
  const canReview = can(user.role, 'case.review') && loaded.status !== 'VOIDED'

  // Phase 10: the shareable reading of this case, computed here from what the page already
  // loaded — no second query — and taken at page load, exactly as the timeline is.
  const now = new Date()
  const summary = summaryOf(loaded, reference, now)

  return (
    <CaseEditor
      alert={alert}
      reference={reference}
      initial={loaded.draft}
      caseId={loaded.id}
      initialStatus={loaded.status}
      initialResolvedAt={loaded.resolvedAt}
      voidReason={loaded.voidReason}
      navigatorName={loaded.openedByName}
      initialUpdates={loaded.updates}
      // Phase 8: the case's recorded time sequence, read-only, rendered here on the server and
      // slotted into the editor after the updates. The editor never touches it; every time on it
      // is edited in the section that owns it.
      timeline={<CaseTimeline steps={loaded.timeline} />}
      summary={<CaseSummarySheet summary={summary} />}
      review={loaded.review}
      canReview={canReview}
      readOnly={readOnly}
      canVoid={canVoid}
      nowIso={now.toISOString()}
    />
  )
}
