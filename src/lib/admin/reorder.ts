/**
 * Reordering a reference list with up/down buttons and no drag (Phase 6 spec).
 *
 * The list is ordered by `sortOrder` and then by name, so two rows that were seeded with the
 * same order still have a stable position. Moving swaps this row's `sortOrder` with its
 * neighbour's; when the two happen to be equal — which the seed can produce — the neighbour is
 * pushed past it instead, so a move always moves.
 *
 * Pure, so the arithmetic is tested without a database.
 */
export type Orderable = { id: string; name: string; sortOrder: number }

export type Direction = 'up' | 'down'

export type Swap = {
  a: { id: string; sortOrder: number }
  b: { id: string; sortOrder: number }
}

/** The list as the screen shows it: sortOrder first, then name, then id for total stability. */
export function inDisplayOrder<T extends Orderable>(items: ReadonlyArray<T>): T[] {
  return [...items].sort(
    (x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name) || x.id.localeCompare(y.id),
  )
}

/**
 * The two rows to write, or null when the item is already at that end (or is not in the list).
 */
export function planMove<T extends Orderable>(
  items: ReadonlyArray<T>,
  id: string,
  direction: Direction,
): Swap | null {
  const ordered = inDisplayOrder(items)
  const index = ordered.findIndex((i) => i.id === id)
  if (index === -1) return null
  const neighbourIndex = direction === 'up' ? index - 1 : index + 1
  const item = ordered[index]
  const neighbour = ordered[neighbourIndex]
  if (!item || !neighbour) return null

  if (item.sortOrder === neighbour.sortOrder) {
    // Equal orders: give the mover the neighbour's place and push the neighbour one step away.
    const step = direction === 'up' ? -1 : 1
    return {
      a: { id: item.id, sortOrder: item.sortOrder },
      b: { id: neighbour.id, sortOrder: neighbour.sortOrder - step },
    }
  }
  return {
    a: { id: item.id, sortOrder: neighbour.sortOrder },
    b: { id: neighbour.id, sortOrder: item.sortOrder },
  }
}

/** Where a newly added row goes: after everything currently in the list. */
export function nextSortOrder(items: ReadonlyArray<Orderable>): number {
  return items.reduce((max, i) => Math.max(max, i.sortOrder), 0) + 1
}
