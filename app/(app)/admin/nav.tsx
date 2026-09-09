'use client'

/**
 * The five admin sections as a row of chips — the same 44 px tap target the prototype's chips
 * use, so the screen works on a phone even though it is meant for a laptop.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export const ADMIN_SECTIONS = [
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/lists', label: 'Lists' },
  { href: '/admin/other', label: 'Other queue' },
  { href: '/admin/alerts', label: 'Alerts' },
  { href: '/admin/audit', label: 'Audit log' },
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
            className={`inline-flex min-h-11 items-center rounded-chip border px-3 text-body font-semibold ${
              active ? 'border-accent bg-accent text-white' : 'border-line bg-panel text-ink'
            }`}
          >
            {section.label}
          </Link>
        )
      })}
    </nav>
  )
}
