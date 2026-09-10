import { HoldingScreen, NotAllowedBody } from '@/src/components/holding'

/**
 * The HTTP 403 for every route that is not inside the signed-in shell (Phase 7).
 * `requireAction()` calls Next's `forbidden()` after writing the `auth.forbidden` audit row, and
 * Next renders this at status 403: a VIEWER opening /cases/new and a NAVIGATOR opening /report
 * both land here, with no chrome above them, so this one brings the wordmark band.
 *
 * A refusal from inside the shell — /export, /admin — is rendered inside `app/(app)/layout.tsx`
 * by Next, so it has a nearer boundary of its own: `app/(app)/forbidden.tsx`, same words without
 * the band. The words themselves live in `src/components/holding.tsx` so the two cannot drift.
 */
export default function Forbidden() {
  return (
    <HoldingScreen>
      <NotAllowedBody />
    </HoldingScreen>
  )
}
