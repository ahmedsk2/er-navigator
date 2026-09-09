import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/src/lib/db'

export const metadata: Metadata = { title: 'Admin · ER Navigator' }
export const dynamic = 'force-dynamic'

/**
 * `/admin` — the landing card for the five sections, with the two counts that mean somebody has
 * something to do: descriptions waiting to be promoted, and alerts nobody has acknowledged.
 * The ADMIN gate is the layout's; this page only reads.
 */
export default async function AdminIndexPage() {
  const [pendingReviews, unacknowledgedAlerts, activeUsers] = await Promise.all([
    prisma.otherReview.count({ where: { status: 'PENDING' } }),
    prisma.alert.count({ where: { acknowledgedAt: null } }),
    prisma.user.count({ where: { active: true } }),
  ])

  const cards = [
    {
      href: '/admin/users',
      title: 'Users',
      detail: `${activeUsers} active`,
      body: 'Create an account, change a role, reset a password, deactivate someone who has left.',
    },
    {
      href: '/admin/lists',
      title: 'Reference lists',
      detail: 'Departments, wards, reasons',
      body: 'Add, rename, reorder or retire an entry. Renaming keeps every case that already uses it.',
    },
    {
      href: '/admin/other',
      title: 'Other queue',
      detail: `${pendingReviews} waiting`,
      body: 'Promote a description a nurse typed into a real reason, or dismiss it.',
    },
    {
      href: '/admin/alerts',
      title: 'Alerts',
      detail: `${unacknowledgedAlerts} unacknowledged`,
      body: 'Every threshold the worker recorded, when it emailed, and who acknowledged it.',
    },
    {
      href: '/admin/audit',
      title: 'Audit log',
      detail: 'Filtered and paginated',
      body: 'Who changed what, when, from where — append-only, and nothing here can edit it.',
    },
  ]

  return (
    <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <li key={card.href}>
          <Link
            href={card.href}
            className="flex h-full flex-col rounded-card border border-line bg-panel p-4 hover:border-accent"
          >
            <span className="text-section">{card.title}</span>
            <span className="num mt-0.5 text-label font-semibold text-accent-ink">{card.detail}</span>
            <span className="mt-2 text-body text-ink-2">{card.body}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
