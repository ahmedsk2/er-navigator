'use client'

/**
 * The five admin sections as a row of chips — the same 44 px tap target the prototype's chips
 * use, so the screen works on a phone even though it is meant for a laptop. Phase 9 gave each one
 * the icon that names it and the board's chip colours: soft panel and hairline when it is not the
 * section you are on, the accent filled when it is.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, ClipboardList, History, ListChecks, Users } from '@/src/components/icons'

export const ADMIN_SECTIONS = [
  { href: '/admin/users', label: 'Users', Icon: Users },
  { href: '/admin/lists', label: 'Lists', Icon: ListChecks },
  { href: '/admin/other', label: 'Other queue', Icon: ClipboardList },
  { href: '/admin/alerts', label: 'Alerts', Icon: Bell },
  { href: '/admin/audit', label: 'Audit log', Icon: History },
] as const

export function AdminNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Administration sections" className="mt-3 mb-4 flex flex-wrap gap-1.5">
      {ADMIN_SECTIONS.map((section) => {
        const active = pathname.startsWith(section.href)
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center gap-2 rounded-chip border px-3.5 text-body font-semibold ${
              active ? 'border-accent bg-accent text-white' : 'border-line bg-panel text-ink-2'
            }`}
          >
            <section.Icon size={18} />
            {section.label}
          </Link>
        )
      })}
    </nav>
  )
}
