import type { Role } from '@prisma/client'
import Link from 'next/link'
import { requireUser } from '@/src/lib/auth/session'
import { logout } from './actions'

// No all-caps labels (design/tokens.md), so the enum is rendered in sentence case.
const ROLE_LABEL: Record<Role, string> = {
  NAVIGATOR: 'Navigator',
  SUPERVISOR: 'Supervisor',
  ADMIN: 'Admin',
  VIEWER: 'Viewer',
}

/**
 * Everything inside this route group needs a signed-in user. The gate in proxy.ts only sees the
 * cookie; this is where the session is actually resolved, and a stale or forged cookie is turned
 * into a redirect to /login. The bottom tab bar arrives with the board in Phase 3.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-panel px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-title tracking-tight">ER Navigator</h1>
          <Link
            href="/account"
            className="block truncate text-label font-medium text-muted underline-offset-4 hover:underline"
          >
            {user.displayName} · {ROLE_LABEL[user.role]}
          </Link>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="min-h-11 rounded-button border border-line px-3 text-body font-semibold text-accent-ink"
          >
            Log out
          </button>
        </form>
      </header>
      <main className="flex-1 px-4 pt-6 pb-16">{children}</main>
    </div>
  )
}
