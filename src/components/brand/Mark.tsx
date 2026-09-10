/**
 * The mark and the wordmark (Phase 9, Ahmed's direction A of 10 September).
 *
 * The mark is a heart with an ECG trace through it, drawn as strokes on a 24 × 24 grid: the
 * heart is what the department does, the trace is the time this app watches. Three tones cover
 * every surface it sits on: `onTeal` (a white tile with a teal trace, for the hero and the
 * header), `onWhite` (a teal tile with a white trace, for the login sheet and the cards), and
 * `teal` (bare strokes in the accent, for small inline uses). The mark is always decorative; the
 * wordmark carries the name as text.
 *
 * `Wordmark as="h1"` is reserved for the two places that own the page's "ER Navigator" heading:
 * the signed-in shell's header and the login hero. Tests select that heading by name and expect
 * exactly one per page, so everywhere else the wordmark is a `<span>`.
 */

export type MarkTone = 'onTeal' | 'onWhite' | 'teal'

const TILE: Record<MarkTone, string> = {
  onTeal: 'bg-panel text-accent',
  onWhite: 'bg-accent text-white',
  teal: 'text-accent',
}

export function Mark({ size = 36, tone = 'onTeal', className = '' }: { size?: number; tone?: MarkTone; className?: string }) {
  const glyph = Math.round(size * 0.6)
  const tile = tone === 'teal' ? '' : `${TILE[tone]} rounded-[28%]`
  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 place-items-center ${tile} ${tone === 'teal' ? TILE.teal : ''} ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={glyph}
        height={glyph}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
      >
        <path d="M12 21s-7-4.5-7-11a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 6.5-7 11-7 11z" />
        <path d="M6 12h3l1.5-3 2 6 1.5-3H18" />
      </svg>
    </span>
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
