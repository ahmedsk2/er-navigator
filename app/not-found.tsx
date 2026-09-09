import Link from 'next/link'

/**
 * HTTP 404 for the whole app: a case id that does not exist, a mistyped link, a bookmark to a
 * screen that moved. Without this file Next serves its own unstyled page with no way back
 * (final review, ui lens). Same shape as `app/forbidden.tsx`: short, and a way to the board.
 */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-md p-4 pt-8">
      <h1 className="text-title">Not found</h1>
      <p className="mt-3 text-body text-ink-2">
        There is nothing at this address. The case may have been voided, or the link is wrong.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-11 items-center rounded-button border border-line bg-panel px-4 text-body font-semibold text-accent-ink"
      >
        ‹ Board
      </Link>
    </main>
  )
}
