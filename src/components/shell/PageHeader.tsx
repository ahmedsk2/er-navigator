import type { ReactNode } from 'react'

/**
 * The title block every page in the signed-in shell opens with (Phase 9). Until now each page
 * repeated the same `px-4 pt-4 pb-2.5` wrapper around its own `<h2 class="text-title">`, and on a
 * laptop they all sat in a 448 px column; the rail took that column away, so the padding and the
 * desktop rule for it belong in one place.
 *
 * Nothing about the heading changes: the page still passes its exact title, it is still an `<h2>`
 * at `text-title`, and whatever the page had under it — the board's counters and freshness line,
 * the dashboard's `[data-subtitle]` — is passed straight through as `subtitle`. `children` is the
 * right-hand slot, which on a phone wraps under the title and on a laptop sits on the baseline
 * beside it.
 */
export function PageHeader({
  title,
  subtitle,
  headingId,
  children,
}: {
  title: string
  subtitle?: ReactNode
  /**
   * Makes the title a place the keyboard can be sent back to (`tabIndex={-1}`: focusable from a
   * script, never a Tab stop). The board uses it when the row a summary was opened from has gone.
   */
  headingId?: string
  children?: ReactNode
}) {
  return (
    <div className="px-4 pt-4 pb-2.5 lg:flex lg:items-end lg:justify-between lg:gap-6 lg:px-0 lg:pt-6">
      <div className="min-w-0">
        <h2
          id={headingId}
          tabIndex={headingId ? -1 : undefined}
          className="text-title focus:outline-none"
        >
          {title}
        </h2>
        {subtitle}
      </div>
      {children ? <div className="mt-2 flex flex-wrap items-center gap-2 lg:mt-0">{children}</div> : null}
    </div>
  )
}
