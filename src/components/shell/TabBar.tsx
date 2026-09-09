'use client'

/**
 * The prototype's bottom tab bar (`ERNavigatorTracker`, `.tabbar`), as real routes. Admin is a
 * placeholder until Phase 6.
 *
 * Two tabs are role-dependent: Export (`export.xlsx`, so not a NAVIGATOR) and Admin (ADMIN only).
 * Hiding a tab is not a permission — both pages check the action again on the server, and write
 * the `auth.forbidden` audit row when they refuse — but a tab that always answers "not allowed"
 * is a worse tab bar than one with three entries.
 *
 * Hidden in print, and absent from `/cases/*` and `/report` because neither is inside this route
 * group — the prototype hides the bar in the editor view for the same reason: one screen, one job.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const BOARD_TABS = [
  { href: '/', label: 'Board' },
  { href: '/dashboard', label: 'Dashboard' },
] as const

const EXPORT_TAB = { href: '/export', label: 'Export' } as const
const ADMIN_TAB = { href: '/admin', label: 'Admin' } as const

export function TabBar({ showExport, showAdmin }: { showExport: boolean; showAdmin: boolean }) {
  const pathname = usePathname()
  const tabs = [...BOARD_TABS, ...(showExport ? [EXPORT_TAB] : []), ...(showAdmin ? [ADMIN_TAB] : [])]

  return (
    <nav
      aria-label="Sections"
      className="no-print fixed inset-x-0 bottom-0 z-10 border-t border-line bg-panel"
    >
      <ul className="mx-auto flex max-w-md">
        {tabs.map((tab) => {
          const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href)
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-14 items-center justify-center px-2 text-label font-semibold ${
                  active ? 'text-accent-ink' : 'text-muted'
                }`}
              >
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
