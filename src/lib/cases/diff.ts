/**
 * Child-row diff for `saveCase`. The editor posts the full set of reasons, consults and
 * investigations it wants a case to have; the server turns that into the smallest set of writes:
 * delete what disappeared, update what stayed, insert what is new. Replacing the rows wholesale
 * (delete-all then insert-all) would work too, but it churns primary keys and would make the
 * audit `before`/`after` diff unreadable.
 *
 * Pure and key-agnostic: the caller supplies the natural key of each child table
 * (`reasonId`, `departmentId`, `type`).
 */
export type RowDiff<K, T> = {
  /** Keys that existed and are not in the next list, in the order they were given. */
  removed: K[]
  /** Next-list items whose key already existed: update them in place. */
  kept: T[]
  /** Next-list items whose key is new: insert them. */
  added: T[]
}

/**
 * A repeated key in `next` is taken once (the first occurrence wins), so a caller that skipped
 * validation cannot make the transaction write the same row twice.
 */
export function diffRows<T, K>(
  existingKeys: Iterable<K>,
  next: readonly T[],
  keyOf: (item: T) => K,
): RowDiff<K, T> {
  const existing = new Set(existingKeys)
  const seen = new Set<K>()
  const kept: T[] = []
  const added: T[] = []

  for (const item of next) {
    const key = keyOf(item)
    if (seen.has(key)) continue
    seen.add(key)
    if (existing.has(key)) kept.push(item)
    else added.push(item)
  }

  const removed = [...existing].filter((key) => !seen.has(key))
  return { removed, kept, added }
}
