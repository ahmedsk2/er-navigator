/**
 * The prototype's floating "+ New case" button (`.fab`): ink background, white text, the float
 * shadow, sitting above the tab bar on the right of the column.
 *
 * The layout renders it only for a role that may open a case, so a VIEWER never sees it; and it
 * lives in the `(app)` route group, so it is absent on `/cases/*` without a path check.
 */
import Link from 'next/link'
import { Plus } from '@/src/components/icons'

export function NewCaseFab() {
  // `pb-[76px]` clears the 64 px tab bar (Phase 9 grew it from 56 to make room for the icons).
  // From `lg` the tab bar is the rail and the rail carries its own "+ New case" (TabBar.tsx), so
  // this one is hidden there rather than floating over the admin tables.
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md justify-end px-4 pb-[76px] lg:hidden">
      <Link
        href="/cases/new"
        className="pointer-events-auto inline-flex min-h-11 items-center gap-1.5 rounded-chip bg-ink px-[18px] text-[15px] font-bold text-white shadow-float"
      >
        {/* The icon draws the plus; the literal "+ " stays in the accessible name, which every
            spec in the suite selects this link by. */}
        <Plus size={18} />
        <span className="sr-only">+ </span>New case
      </Link>
    </div>
  )
}
