import type { Metadata } from 'next'
import { Wordmark } from '@/src/components/brand/Mark'
import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Sign in · ER Navigator' }

/**
 * The four band tints of the illustration on the desktop hero. They are literals, not tokens,
 * because they exist for this one picture: the board's own `band-ok`, `h4`, `h6` and `h12` are
 * chosen to hold their own on a white row and go muddy on the teal ground (the green sits within
 * a step of the accent's luminance and read by hue alone), so each is lightened here. Nothing
 * else in the app may use them, and `tests/unit/colour-literals.test.ts` makes sure nothing does.
 *
 * The bars are decorative: they carry no figure and the whole SVG is `aria-hidden`. What the
 * picture says in words is the purpose line above it.
 */
const BAND_BARS = [
  { label: 'under 4 h', fill: '#4fa87c', width: 116 },
  { label: '4 h and over', fill: '#e0a23a', width: 170 },
  { label: '6 h and over', fill: '#e0645a', width: 225 },
  { label: '12 h and over', fill: '#b56aa6', width: 274 },
] as const

/**
 * The ECG trace across the hero: two ordinary beats and a third, drawn once. Its peaks run from
 * y 20 to 72 in a 390-wide box, so the viewBox below is cropped to the band they use (and the
 * stroke's width either side) rather than drawing 26 units of empty teal.
 */
const ECG =
  '0,50 60,50 78,50 88,20 98,72 108,50 150,50 170,50 180,34 190,64 200,50 260,50 275,50 284,26 294,68 302,50 390,50'

// The gate (proxy.ts) sends a refused request here with ?next=<path>; the action validates it.
// `?expired=1` comes from `requireUser()` when the cookie outlived its session — the gate clears
// the cookie on the way in, and this page says what happened rather than showing a bare form.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string }>
}) {
  const { next, expired } = await searchParams

  // Phase 9, direction A: on the phone a teal hero with a white sheet rising over it; on desktop
  // (lg) the same hero becomes the left 46% and the sheet becomes the ground under a form card.
  // One tree, two shapes — the fields, labels, names and messages below are untouched.
  return (
    <main className="flex min-h-dvh flex-col lg:grid lg:grid-cols-[46%_54%]">
      <section
        data-login-hero
        className="bg-hero relative flex min-h-[300px] flex-col overflow-hidden px-6 pt-14 pb-14 text-white lg:min-h-dvh lg:px-12 lg:py-11"
      >
        <Wordmark as="h1" tone="onTeal" size="md" className="relative" />

        <div className="relative mt-10 lg:mt-0 lg:flex lg:flex-1 lg:flex-col lg:justify-center">
          <p className="max-w-[300px] text-[26px] leading-[1.15] font-bold lg:max-w-[380px] lg:text-[36px] lg:leading-[1.12]">
            Every long stay, seen in time.
          </p>
          <p className="mt-3 hidden max-w-[380px] text-body text-white/85 lg:block">
            The ED navigators&rsquo; board for patients whose stay is running long: who is waiting, on
            what, and for how long.
          </p>
          <svg
            viewBox="0 0 380 130"
            className="mt-9 hidden w-full max-w-[380px] lg:block"
            aria-hidden="true"
            focusable="false"
          >
            {BAND_BARS.map((bar, i) => (
              <g key={bar.label} transform={`translate(0 ${i * 32})`}>
                <text x="0" y="13" fill="currentColor" fillOpacity="0.8" fontSize="13">
                  {bar.label}
                </text>
                <rect x="96" y="2" width={bar.width} height="12" rx="6" fill={bar.fill} />
              </g>
            ))}
          </svg>
        </div>

        {/* Phase 11, finding 7: the trace used to be laid over the hero at a fixed 150 px from the
            top, which is where the headline's second line lands on a phone — "seen in time." sat
            on it — and it was not drawn on a laptop at all. It is in the flow now, under the
            headline block at both widths and edge to edge across the hero, so nothing is ever
            written over it; the headline block starts 16 px higher on a phone to make room. */}
        <svg
          viewBox="0 18 390 56"
          className="pointer-events-none -mx-6 mt-4 block h-auto w-[calc(100%+3rem)] max-w-none opacity-[0.28] lg:-mx-12 lg:mt-8 lg:w-[calc(100%+6rem)]"
          aria-hidden="true"
          focusable="false"
        >
          <polyline points={ECG} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        <p className="relative mt-2 text-[14px] text-white/85 lg:mt-3 lg:text-caption lg:text-white/75">
          Qatif Central Hospital · Emergency Department
        </p>
      </section>

      <div className="relative z-10 -mt-7 flex-1 rounded-t-[var(--radius-sheet)] bg-panel px-6 pt-7 pb-10 shadow-sheet lg:mt-0 lg:grid lg:place-items-center lg:rounded-none lg:bg-bg lg:p-10 lg:shadow-none">
        <div data-login-card className="w-full lg:max-w-[400px] lg:rounded-card lg:border lg:border-line lg:bg-panel lg:p-8 lg:shadow-card">
          <p className="text-title">Sign in</p>
          {expired ? (
            <p
              role="status"
              data-session-ended
              className="mt-4 rounded-field border border-line bg-bg px-3 py-2 text-body text-ink-2"
            >
              Your session has ended. Sign in again.
            </p>
          ) : null}
          <LoginForm next={typeof next === 'string' ? next : '/'} />
          <p className="mt-8 text-caption text-muted">
            Hospital accounts only. Ask the ER Navigator lead for access.
          </p>
        </div>
      </div>
    </main>
  )
}
