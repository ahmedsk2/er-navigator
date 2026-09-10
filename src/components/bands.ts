import type { Band } from '@/src/lib/domain/time'

/**
 * The one Band → class map (Phase 9). Until then the board row, the dashboard and the case
 * editor each carried a copy, and the editor's had drifted on `none`. Every colour here is a
 * token from app/globals.css; `src/components/__tests__/bands.test.ts` reads that file and
 * proves the pill backgrounds hold white text at 4.5:1.
 */

/** The stripe / bar colour of a band. `band-h4` is fine as a surface; it is too light for text. */
export const BAND_BG: Record<Band, string> = {
  none: 'bg-band-none',
  ok: 'bg-band-ok',
  h4: 'bg-band-h4',
  h6: 'bg-band-h6',
  h12: 'bg-band-h12',
  h24: 'bg-band-h24',
}

/** Text in the band's colour on a light ground: the 4 h band uses its ink variant. */
export const BAND_TEXT: Record<Band, string> = {
  none: 'text-muted',
  ok: 'text-band-ok',
  h4: 'text-band-h4-ink',
  h6: 'text-band-h6',
  h12: 'text-band-h12',
  h24: 'text-band-h24',
}

/**
 * The elapsed-time pill (Phase 9): band colour behind white text. The 4 h pill takes the ink
 * variant for the same reason the text does (3.6:1 is not enough for bold 20 px); "no data" is a
 * quiet grey pill with muted text.
 */
export const BAND_PILL: Record<Band, string> = {
  none: 'bg-line-soft text-muted',
  ok: 'bg-band-ok text-white',
  h4: 'bg-band-h4-ink text-white',
  h6: 'bg-band-h6 text-white',
  h12: 'bg-band-h12 text-white',
  h24: 'bg-band-h24 text-white',
}
