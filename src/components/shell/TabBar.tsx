'use client'

/**
 * The prototype's bottom tab bar (`ERNavigatorTracker`, `.tabbar`), as real routes. Dashboard,
 * Export and Admin are placeholders until Phases 4, 5 and 6; the Admin tab exists only for an
 * ADMIN, which the placeholder page enforces again on the server.
 *
 * Hidden in print, and absent from `/cases/*` because the editor is not inside this route group —
 * the prototype hides the bar in the editor view for the same reason: one screen, one job.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/', label: 'Board' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/export', label: 'Export' },
] as const

const ADMIN_TAB = { href: '/admin', label: 'Admin' } as const

export function TabBar({ showAdmin }: { showAdmin: boolean }) {
  const pathname = usePathname()
  const tabs = showAdmin ? [...TABS, ADMIN_TAB] : TABS

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
