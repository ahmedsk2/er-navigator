import type { Metadata } from 'next'
import Link from 'next/link'
import { isForbiddenError, requireAction, type AuthUser } from '@/src/lib/auth/session'
import { CaseEditor } from '@/src/components/cases/CaseEditor'
import { blankDraft } from '@/src/lib/cases/load'
import { loadReference } from '@/src/lib/cases/reference'

export const metadata: Metadata = { title: 'New case · ER Navigator' }
export const dynamic = 'force-dynamic'

/**
 * `/cases/new` — NAVIGATOR, SUPERVISOR, ADMIN. A VIEWER is refused here, not only on the action:
 * `requireAction` writes the `auth.forbidden` audit row and throws, and this page turns that into
 * the refusal screen instead of a stack trace.
 */
export default async function NewCasePage() {
  const user = await userWhoMayCreate()
  if (!user) return <Forbidden />

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

/** null means "refused, and the audit row is already written"; anything else is a real fault. */
async function userWhoMayCreate(): Promise<AuthUser | null> {
  try {
    return await requireAction('case.create')
  } catch (error) {
    if (isForbiddenError(error)) return null
    throw error
  }
}

function Forbidden() {
  return (
    <div className="mx-auto max-w-[720px] p-4">
      <h1 className="text-title">Not allowed</h1>
      <p className="mt-3 text-body text-ink-2">
        Your role can read the board and the dashboard, but not open a case. Ask a navigator or a charge nurse to
        open it.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-11 items-center rounded-button border border-line bg-panel px-4 text-body font-semibold text-accent-ink"
      >
        ‹ Back
      </Link>
    </div>
  )
}
