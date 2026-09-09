/**
 * The prototype's floating "+ New case" button (`.fab`): ink background, white text, the float
 * shadow, sitting above the tab bar on the right of the column.
 *
 * The layout renders it only for a role that may open a case, so a VIEWER never sees it; and it
 * lives in the `(app)` route group, so it is absent on `/cases/*` without a path check.
 */
import Link from 'next/link'

export function NewCaseFab() {
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md justify-end px-4 pb-[68px]">
      <Link
        href="/cases/new"
        className="pointer-events-auto inline-flex min-h-11 items-center rounded-chip bg-ink px-[18px] text-[15px] font-bold text-white shadow-float"
      >
        + New case
      </Link>
    </div>
  )
}
