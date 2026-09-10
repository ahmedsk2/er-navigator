import { BoardLink, HoldingScreen } from '@/src/components/holding'

/**
 * HTTP 404 for the whole app: a case id that does not exist, a mistyped link, a bookmark to a
 * screen that moved. Without this file Next serves its own unstyled page with no way back
 * (final review, ui lens). Same shape as `app/forbidden.tsx`: short, and a way to the board.
 *
 * Every `notFound()` in the app is thrown outside the shell (`app/cases/[id]`), and an unmatched
 * URL has no layout by definition, so this one always renders bare and always brings the band.
 */
export default function NotFound() {
  return (
    <HoldingScreen>
      <h1 className="text-title">Not found</h1>
      <p className="mt-3 text-body text-ink-2">
        There is nothing at this address. The case may have been voided, or the link is wrong.
      </p>
      <BoardLink className="mt-6" />
    </HoldingScreen>
  )
}
