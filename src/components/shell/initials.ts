/**
 * A display name reduced to the two letters that fit in a 36 px circle (Phase 9): the header's
 * menu trigger and the foot of the desktop rail.
 *
 * The first letter of each of the first two words, upper-cased — not the last word, because
 * "Amal Al Qahtani" is one person's given name followed by a family name in two parts, and "AQ"
 * would be a different reading of it than the ED makes. Leading punctuation is skipped so
 * "al-Hassan" gives "A" and "S." gives "S". Arabic has no case, and `toUpperCase` leaves it as
 * written, which is what the ward expects to see.
 *
 * Always decorative: the trigger keeps `aria-label="Menu"` and the rail's block is not
 * interactive, so these letters are `aria-hidden` wherever they are drawn.
 */
export function initialsOf(displayName: string): string {
  return displayName
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 1))
    .join('')
    .toUpperCase()
}
