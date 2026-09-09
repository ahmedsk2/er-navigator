import { describe, expect, it } from 'vitest'
import { diffRows } from '../diff'

type Row = { key: string; note?: string }
const keyOf = (r: Row) => r.key

describe('diffRows', () => {
  it('adds everything when nothing existed', () => {
    const d = diffRows([], [{ key: 'a' }, { key: 'b' }], keyOf)
    expect(d.added.map(keyOf)).toEqual(['a', 'b'])
    expect(d.kept).toEqual([])
    expect(d.removed).toEqual([])
  })

  it('removes everything when the next list is empty', () => {
    const d = diffRows(['a', 'b'], [], keyOf)
    expect(d.removed).toEqual(['a', 'b'])
    expect(d.added).toEqual([])
    expect(d.kept).toEqual([])
  })

  it('keeps the rows whose key survived, adds the new ones and removes the rest', () => {
    const d = diffRows(['a', 'b', 'c'], [{ key: 'b', note: 'edited' }, { key: 'd' }], keyOf)
    expect(d.removed).toEqual(['a', 'c'])
    expect(d.kept).toEqual([{ key: 'b', note: 'edited' }])
    expect(d.added).toEqual([{ key: 'd' }])
  })

  it('keeps every row and removes nothing when the keys are unchanged', () => {
    const d = diffRows(['a', 'b'], [{ key: 'a' }, { key: 'b' }], keyOf)
    expect(d.kept.map(keyOf)).toEqual(['a', 'b'])
    expect(d.added).toEqual([])
    expect(d.removed).toEqual([])
  })

  it('preserves the order of the next list, not the order of the existing keys', () => {
    const d = diffRows(['a', 'b'], [{ key: 'b' }, { key: 'a' }], keyOf)
    expect(d.kept.map(keyOf)).toEqual(['b', 'a'])
  })

  it('ignores a repeated key so one row is never written twice', () => {
    const d = diffRows(['a'], [{ key: 'a', note: 'first' }, { key: 'a', note: 'second' }, { key: 'b' }], keyOf)
    expect(d.kept).toEqual([{ key: 'a', note: 'first' }])
    expect(d.added).toEqual([{ key: 'b' }])
    expect(d.removed).toEqual([])
  })

  it('reports removals in the order the existing keys were given', () => {
    const d = diffRows(['z', 'y', 'x'], [{ key: 'y' }], keyOf)
    expect(d.removed).toEqual(['z', 'x'])
  })
})
