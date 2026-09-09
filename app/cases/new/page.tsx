import type { Metadata } from 'next'
import { requireAction } from '@/src/lib/auth/session'
import { CaseEditor } from '@/src/components/cases/CaseEditor'
import { blankDraft } from '@/src/lib/cases/load'
import { loadReference } from '@/src/lib/cases/reference'

export const metadata: Metadata = { title: 'New case · ER Navigator' }
export const dynamic = 'force-dynamic'

/**
 * `/cases/new` — NAVIGATOR, SUPERVISOR, ADMIN. A VIEWER is refused here, not only on the action:
 * `requireAction` writes the `auth.forbidden` audit row and then answers 403 with
 * `app/forbidden.tsx` (Phase 7), so the refusal is a status a proxy and a log can see.
 */
export default async function NewCasePage() {
  const user = await requireAction('case.create')

  const reference = await loadReference()
  const now = new Date()
  return (
    <CaseEditor
      reference={reference}
      initial={blankDraft({ now, shift: user.lastShift })}
      caseId={null}
      initialStatus="OPEN"
      voidReason={null}
      navigatorName={user.displayName}
      initialUpdates={[]}
      readOnly={false}
      canVoid={false}
      nowIso={now.toISOString()}
    />
  )
}
