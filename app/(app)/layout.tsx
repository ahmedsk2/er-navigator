import type { Role } from '@prisma/client'
import { NewCaseFab } from '@/src/components/shell/NewCaseFab'
import { OverflowMenu } from '@/src/components/shell/OverflowMenu'
import { TabBar } from '@/src/components/shell/TabBar'
import { requireUser } from '@/src/lib/auth/session'
import { can } from '@/src/lib/authz/policy'

// No all-caps labels (design/tokens.md), so the enum is rendered in sentence case.
const ROLE_LABEL: Record<Role, string> = {
  NAVIGATOR: 'Navigator',
  SUPERVISOR: 'Supervisor',
  ADMIN: 'Admin',
  VIEWER: 'Viewer',
}

/**
 * The signed-in shell: a slim app bar with the overflow menu, the page, the floating "+ New case"
 * button and the bottom tab bar (the prototype's `ERNavigatorTracker`).
 *
 * Everything inside this route group needs a signed-in user. The gate in proxy.ts only sees the
 * cookie; this is where the session is actually resolved, and a stale or forged cookie is turned
 * into a redirect to /login.
 *
 * `/cases/*` deliberately sits outside this group — the editor is a full-screen task with its own
 * "‹ Back", exactly as the prototype hides the bar and the FAB in its editor view.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()

  // `print:max-w-none`: the centred phone column becomes a paper-width sheet on the printer.
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col print:max-w-none">
      <header className="no-print flex items-center justify-between gap-3 border-b border-line bg-panel px-4 py-2">
        <h1 className="text-section tracking-tight">ER Navigator</h1>
        <OverflowMenu displayName={user.displayName} roleLabel={ROLE_LABEL[user.role]} />
      </header>

      <main className="flex-1 pb-28">{children}</main>

      {can(user.role, 'case.create') ? <NewCaseFab /> : null}
      <TabBar showExport={can(user.role, 'export.xlsx')} showAdmin={user.role === 'ADMIN'} />
    </div>
  )
}
