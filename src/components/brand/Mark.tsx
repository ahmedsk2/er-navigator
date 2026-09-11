/**
 * The mark and the wordmark.
 *
 * Phase 11 (11 September): the mark is the logo Ahmed chose from Envato Elements, "Medical Cross
 * Logo — Healthcare & Hospital Health" by 3ab2ou: a medical cross drawn as parallel paths that
 * turn back on themselves, which is as close as a cross gets to "finding the way through the
 * department". The template is pink-red; here it is `--color-accent-deep`, the app's own teal — a
 * red cross is also a protected emblem, and the app has always been teal. Only the cross is used;
 * the template's placeholder name and slogan are not, the wordmark sets "ER Navigator" as text.
 *
 * The cross is three filled outlines on a 48-unit grid (`mark-paths.json`, read by
 * `scripts/generate-icons.mjs` too, so the header and the home-screen icon cannot drift apart),
 * taken point for point from the template's vector file. Its bars are as thin as the gaps between
 * them, a twelfth of the cross, so below about 42 px the bars are grown by a stroke of their own
 * colour: a hairline is the first thing antialiasing takes. The template's files are not in the
 * repository — its licence covers the mark in this app, not handing the template on.
 *
 * Three tones cover every surface it sits on: `onTeal` (a white badge with a teal cross, for the
 * teal hero and header and the navy rail), `onWhite` (a teal badge with a white cross, for the
 * login sheet and the cards), and `teal` (the bare cross in the accent, for small inline uses).
 * The mark is always decorative; the wordmark carries the name as text.
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

const CROSS: Record<MarkTone, string> = {
  onTeal: 'fill-accent-deep stroke-accent-deep',
  onWhite: 'fill-white stroke-white',
  teal: 'fill-accent stroke-accent',
}

/**
 * How much the cross's bars are grown, in the cross's own 48-unit grid (the stroke is drawn inside
 * its scaled group, as the icon script draws it), for a mark `size` px wide. A little at 42 px and
 * up, more below; never so much that the gaps between the parallel paths close.
 */
export function markGrow(size: number): number {
  if (size < 32) return 1
  if (size < 42) return 0.7
  return 0.4
}

export function Mark({ size = 36, tone = 'onTeal', className = '' }: { size?: number; tone?: MarkTone; className?: string }) {
  const badge = BADGE[tone]
  const unit = PATHS.viewBox
  // On a badge the cross sits inside a margin; bare, it fills the box.
  const glyph = badge ? PATHS.tile.glyph : 1
  const inset = (unit * (1 - glyph)) / 2
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox={`0 0 ${unit} ${unit}`}
      className={`inline-block shrink-0 ${className}`}
      data-mark={tone}
    >
      {badge ? <rect width={unit} height={unit} rx={unit * PATHS.tile.radius} className={badge} /> : null}
      <g
        transform={`translate(${inset} ${inset}) scale(${glyph})`}
        strokeWidth={markGrow(size)}
        strokeLinejoin="miter"
        className={CROSS[tone]}
      >
        {PATHS.cross.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  )
}

const SIZES = {
  sm: { mark: 28, text: 'text-[15px]' },
  md: { mark: 36, text: 'text-[20px]' },
  lg: { mark: 44, text: 'text-[24px]' },
} as const

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
  const text = <span className={`${s.text} font-bold tracking-tight ${colour}`}>ER Navigator</span>
  const Tag = as
  return (
    <Tag className={`m-0 inline-flex items-center gap-2.5 ${className}`}>
      <Mark size={s.mark} tone={tone} />
      {text}
    </Tag>
  )
}
