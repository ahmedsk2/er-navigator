import { HoldingCard, NotAllowedBody } from '@/src/components/holding'

/**
 * The HTTP 403 for the routes inside the shell (/export, /admin/*). Next renders a `forbidden()`
 * thrown below a layout *within* that layout, so the header and the tab bar are already on the
 * screen: this boundary is the card alone, where `app/forbidden.tsx` — which serves the routes
 * with no chrome at all — brings the wordmark band with it. Same heading, same copy, one source
 * (`src/components/holding.tsx`); `tests/e2e/export.spec.ts` and `admin.spec.ts` select the
 * heading by name through this file, `cases.spec.ts` through the other.
 */
export default function Forbidden() {
  return (
    <HoldingCard>
      <NotAllowedBody />
    </HoldingCard>
  )
}
