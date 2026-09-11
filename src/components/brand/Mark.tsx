/**
 * The mark and the wordmark.
 *
 * Phase 11 (11 September): the mark is Ahmed's own, made with Envato's AI generator from a brief
 * written for this project; `design/brand/er-navigator-logo.envato.svg` is the file as delivered.
 * It says what the app is in one line: a heartbeat trace that rises into a medical cross and runs
 * on into an arrow — the patient's pulse, the department's care, and the navigator moving a long
 * stay forward — on a badge of `--color-accent-deep`, the teal the delivered file already used.
 *
 * The delivered file is an auto-trace: wobbly outlines on a 2048-unit canvas. What is drawn here is
 * the same drawing redrawn as three strokes on a 48-unit badge (`mark-paths.json`, which
 * `scripts/generate-icons.mjs` reads too, so the header and the home-screen icon cannot drift
 * apart). The stroke thickens as the mark gets small, because at 28 px a 2.2-unit line is a
 * pixel and a half and the half-cross beside the spike is the first thing to go.
 *
 * Three tones cover every surface it sits on: `onTeal` (a white badge with a teal trace, for the
 * teal hero and header), `onWhite` (the logo as delivered: a deep teal badge with a white trace,
 * for the login sheet and the cards), and `teal` (the bare trace in the accent, for small inline
 * uses). The mark is always decorative; the wordmark carries the name as text.
 *
 * `Wordmark as="h1"` is reserved for the two places that own the page's "ER Navigator" heading:
 * the signed-in shell's header and the login hero. Tests select that heading by name and expect
 * exactly one per page, so everywhere else the wordmark is a `<span>`.
 */
import PATHS from './mark-paths.json'

export type MarkTone = 'onTeal' | 'onWhite' | 'teal'

const BADGE: Record<MarkTone, string | null> = {
  onTeal: 'fill-panel',
  onWhite: 'fill-accent-deep',
  teal: null,
}

const TRACE: Record<MarkTone, string> = {
  onTeal: 'stroke-accent-deep',
  onWhite: 'stroke-white',
  teal: 'stroke-accent',
}

/** Stroke width on the 48-unit grid for a mark drawn `size` px wide. */
export function markStroke(size: number): number {
  if (size < 32) return 2.8
  if (size < 42) return 2.4
  return 2.2
}

export function Mark({ size = 36, tone = 'onTeal', className = '' }: { size?: number; tone?: MarkTone; className?: string }) {
  const badge = BADGE[tone]
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox={`0 0 ${PATHS.viewBox} ${PATHS.viewBox}`}
      className={`inline-block shrink-0 ${className}`}
      data-mark={tone}
    >
      {badge ? <rect width={PATHS.viewBox} height={PATHS.viewBox} rx={PATHS.radius} className={badge} /> : null}
      <g
        fill="none"
        strokeWidth={markStroke(size)}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={TRACE[tone]}
      >
        <path d={PATHS.ecg} />
        <path d={PATHS.arrow} />
        <path d={PATHS.cross} />
      </g>
    </svg>
  )
}

const SIZES = {
  sm: { mark: 28, text: 'text-[15px]' },
  md: { mark: 36, text: 'text-[20px]' },
  lg: { mark: 44, text: 'text-[24px]' },
} as const

/**
 * The mark and the name side by side, set as the delivered logo sets them: "ER" bold and
 * "Navigator" a step lighter. Two spans and a literal space, so the heading's accessible name is
 * still exactly "ER Navigator".
 */
export function Wordmark({
  tone = 'onTeal',
  size = 'md',
  as = 'span',
  className = '',
}: {
  tone?: MarkTone
  size?: keyof typeof SIZES
  as?: 'h1' | 'span'
  className?: string
}) {
  const s = SIZES[size]
  const colour = tone === 'onTeal' ? 'text-white' : 'text-ink'
  const text = (
    <span className={`${s.text} tracking-tight ${colour}`}>
      <span className="font-bold">ER</span> <span className="font-medium">Navigator</span>
    </span>
  )
  const Tag = as
  return (
    <Tag className={`m-0 inline-flex items-center gap-2.5 ${className}`}>
      <Mark size={s.mark} tone={tone} />
      {text}
    </Tag>
  )
}
