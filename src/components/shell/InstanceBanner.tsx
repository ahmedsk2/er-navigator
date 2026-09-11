import { instanceBannerText, instanceLabel } from '@/src/lib/instance'

/**
 * The "this is not the real thing" banner (Phase 12 item 1, readiness audit D6).
 *
 * A server component with no props, mounted once at the very top of `<body>` in
 * `app/layout.tsx`, so it is on every page that has a root layout: `/login`, the whole `(app)`
 * group, `/cases/*`, `/report`, `not-found`, `forbidden` and `error`. Returns null when
 * `INSTANCE_LABEL` is unset, which is production: nothing renders and nothing shifts.
 *
 * Deliberately plain:
 *  - not a heading and not a landmark, so `getByRole('heading', …)` counts and the report's <h1>
 *    are untouched;
 *  - no button, no `hidden`, no client component, so it cannot be dismissed;
 *  - in normal flow, not sticky, so it does not fight the Phase 11 sticky case strip, the tab bar
 *    or the FAB, all of which the e2e suite measures by geometry.
 *
 * `print-color-adjust: exact` is load-bearing, not decoration. The CSS default is `economy`, so a
 * browser drops the amber ground and keeps the white text: white on white paper, a printed demo
 * handover sheet indistinguishable from a real one — the exact accident the banner exists to
 * prevent. `app/globals.css` has no global rule, so the opt-in is per element, as it already is
 * on AdaaBullets, ArrivalTable, BarList and StaySplit.
 *
 * The colour pair is `bg-band-h4-ink` + `text-white`, the pair `BAND_PILL.h4` uses: `band-h4`
 * itself is 3.63:1 on white and `src/components/__tests__/bands.test.ts` asserts that it fails AA
 * for text; the ink variant is 5.69:1.
 *
 * Its height is `var(--instance-banner)`, which `app/layout.tsx` sets from
 * `INSTANCE_BANNER_HEIGHT` on the same condition that renders this element (Phase 12 review
 * round, finding 4). Taking the height from the variable rather than declaring one beside it is
 * the point: the desktop rail subtracts that variable from its own height, and the two cannot
 * drift apart. Visually it is what the old `py-1.5` produced, to a third of a pixel.
 */
export function InstanceBanner() {
  const label = instanceLabel()
  if (!label) return null
  return (
    <div
      data-instance-banner={label}
      className="flex h-[var(--instance-banner)] items-center justify-center bg-band-h4-ink px-4 text-center text-caption font-semibold text-white [print-color-adjust:exact]"
    >
      {instanceBannerText(label)}
    </div>
  )
}
