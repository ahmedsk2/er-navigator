'use client'

/**
 * One navigation, two shapes (Phase 9). The prototype's bottom tab bar (`ERNavigatorTracker`,
 * `.tabbar`) is still what a phone gets; from `lg` up the same element becomes the navy left rail
 * of the desktop layout. Same `<nav aria-label="Sections">`, same `<ul>`, same four link names,
 * same `aria-current` — a screen reader and every Playwright selector see one navigation, because
 * that is what it is.
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
import { Wordmark } from '@/src/components/brand/Mark'
import { BarChart3, Download, LayoutList, Plus, Settings } from '@/src/components/icons'
import { initialsOf } from './initials'

type Tab = { href: string; label: string; Icon: typeof LayoutList }

const BOARD_TABS: readonly Tab[] = [
  { href: '/', label: 'Board', Icon: LayoutList },
  { href: '/dashboard', label: 'Dashboard', Icon: BarChart3 },
]

const EXPORT_TAB: Tab = { href: '/export', label: 'Export', Icon: Download }
const ADMIN_TAB: Tab = { href: '/admin', label: 'Admin', Icon: Settings }

export function TabBar({
  showExport,
  showAdmin,
  canCreate = false,
  displayName,
  roleLabel,
}: {
  showExport: boolean
  showAdmin: boolean
  /** Renders the rail's "+ New case" button on a laptop; the phone keeps the floating one. */
  canCreate?: boolean
  displayName?: string
  roleLabel?: string
}) {
  const pathname = usePathname()
  const tabs = [...BOARD_TABS, ...(showExport ? [EXPORT_TAB] : []), ...(showAdmin ? [ADMIN_TAB] : [])]

  return (
    <nav
      aria-label="Sections"
      className="no-print fixed inset-x-0 bottom-0 z-10 border-t border-line bg-panel lg:sticky lg:inset-x-auto lg:top-0 lg:bottom-auto lg:z-auto lg:flex lg:h-dvh lg:w-[232px] lg:flex-col lg:gap-4 lg:border-t-0 lg:border-r lg:border-navy lg:bg-navy lg:p-3.5 lg:text-rail-ink"
    >
      {/* The rail owns the brand on a laptop, where there is a column to put it in, and its
          wordmark is the page's h1 there (the header's h1 is `lg:hidden`, so there is one per
          shape). The wrapper does the hiding: `Wordmark` sets its own `inline-flex`, and two
          display utilities on one element are decided by the order Tailwind emits them. */}
      <div className="hidden px-1.5 pt-2 pb-1 lg:block">
        <Wordmark tone="onTeal" size="sm" as="h1" />
      </div>

      <ul className="mx-auto flex max-w-md lg:mx-0 lg:max-w-none lg:flex-1 lg:flex-col lg:gap-1">
        {tabs.map((tab) => {
          const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href)
          return (
            <li key={tab.href} className="flex-1 lg:flex-none">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 px-2 text-caption font-semibold lg:min-h-11 lg:flex-row lg:justify-start lg:gap-2.5 lg:rounded-button lg:px-3 lg:text-body ${
                  active
                    ? 'text-accent-ink lg:bg-white/10 lg:text-white'
                    : 'text-muted lg:text-rail-ink lg:hover:bg-white/5'
                }`}
              >
                <tab.Icon size={22} className={active ? 'lg:text-rail-active' : undefined} />
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>

      {/*
        The primary action, in the rail on a laptop: the phone's floating button would float over
        the admin tables at 1280, and a sidebar is where a laptop expects "new". Same href, same
        accessible name "+ New case" as the floating one; the two are never displayed together,
        because this one is `hidden` below `lg` and the floating one is `lg:hidden`.
      */}
      {canCreate ? (
        <Link
          href="/cases/new"
          className="hidden min-h-11 items-center justify-center gap-1.5 rounded-button bg-panel px-3 text-body font-bold text-navy shadow-float lg:flex"
        >
          <Plus size={18} />
          <span className="sr-only">+ </span>New case
        </Link>
      ) : null}

      {/*
        Who is signed in, at the foot of the rail — the MedAxis pattern, and the one place on a
        laptop where the name is on screen without opening the menu. Not a control: the account
        page and Log out are behind the header's Menu button, which is the same on both shapes.
      */}
      {displayName ? (
        <div className="hidden items-center gap-2.5 px-1.5 py-2 lg:flex">
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-chip bg-white/15 text-label font-semibold text-white"
          >
            {initialsOf(displayName)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-label font-semibold text-white">{displayName}</span>
            {roleLabel ? <span className="block truncate text-caption text-rail-ink/80">{roleLabel}</span> : null}
          </span>
        </div>
      ) : null}
    </nav>
  )
}
