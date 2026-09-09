import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CaseEditor } from '@/src/components/cases/CaseEditor'
import { loadUnacknowledgedAlert } from '@/src/lib/alerts/service'
import { requireUser } from '@/src/lib/auth/session'
import { can } from '@/src/lib/authz/policy'
import { loadCaseForEditor } from '@/src/lib/cases/load'
import { loadReference } from '@/src/lib/cases/reference'

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
  const reference = await loadReference()
  const loaded = await loadCaseForEditor(id, reference)
  if (!loaded) notFound()

  const readOnly = !can(user.role, 'case.edit') || loaded.status === 'VOIDED'
  const canVoid = can(user.role, 'case.void') && loaded.status !== 'VOIDED'

  // Phase 6: a supervisor or an admin is offered the Acknowledge control in the header when the
  // worker has recorded a threshold nobody has acknowledged yet. A navigator never sees it, and
  // the action checks `alert.acknowledge` again on the server.
  const mayAcknowledge = can(user.role, 'alert.acknowledge')
  const alert = mayAcknowledge ? await loadUnacknowledgedAlert(loaded.id) : null

  return (
    <CaseEditor
      alert={alert}
      reference={reference}
      initial={loaded.draft}
      caseId={loaded.id}
      initialStatus={loaded.status}
      voidReason={loaded.voidReason}
      navigatorName={loaded.openedByName}
      initialUpdates={loaded.updates}
      readOnly={readOnly}
      canVoid={canVoid}
      nowIso={new Date().toISOString()}
    />
  )
}
