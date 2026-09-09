import { describe, expect, it } from 'vitest'
import { inDisplayOrder, nextSortOrder, planMove } from '../reorder'

const LIST = [
  { id: 'c', name: 'Cardiology', sortOrder: 3 },
  { id: 'a', name: 'Anaesthetics', sortOrder: 1 },
  { id: 'b', name: 'Burns', sortOrder: 2 },
]

describe('inDisplayOrder', () => {
  it('orders by sortOrder, then name', () => {
    expect(inDisplayOrder(LIST).map((i) => i.id)).toEqual(['a', 'b', 'c'])
    const tied = [
      { id: 'z', name: 'Zebra', sortOrder: 1 },
      { id: 'y', name: 'Aardvark', sortOrder: 1 },
    ]
    expect(inDisplayOrder(tied).map((i) => i.id)).toEqual(['y', 'z'])
  })
})

describe('planMove', () => {
  it('swaps with the row above', () => {
    expect(planMove(LIST, 'b', 'up')).toEqual({
      a: { id: 'b', sortOrder: 1 },
      b: { id: 'a', sortOrder: 2 },
    })
  })

  it('swaps with the row below', () => {
    expect(planMove(LIST, 'b', 'down')).toEqual({
      a: { id: 'b', sortOrder: 3 },
      b: { id: 'c', sortOrder: 2 },
    })
  })

  it('refuses to move past either end', () => {
    expect(planMove(LIST, 'a', 'up')).toBeNull()
    expect(planMove(LIST, 'c', 'down')).toBeNull()
    expect(planMove(LIST, 'missing', 'up')).toBeNull()
  })

  it('still moves when two rows were seeded with the same order', () => {
    const tied = [
      { id: 'first', name: 'Aardvark', sortOrder: 5 },
      { id: 'second', name: 'Zebra', sortOrder: 5 },
    ]
    const swap = planMove(tied, 'second', 'up')
    expect(swap).not.toBeNull()
    const applied = tied.map((i) =>
      i.id === swap!.a.id
        ? { ...i, sortOrder: swap!.a.sortOrder }
        : i.id === swap!.b.id
          ? { ...i, sortOrder: swap!.b.sortOrder }
          : i,
    )
    expect(inDisplayOrder(applied).map((i) => i.id)).toEqual(['second', 'first'])
  })
})

describe('nextSortOrder', () => {
  it('puts a new row after everything', () => {
    expect(nextSortOrder(LIST)).toBe(4)
    expect(nextSortOrder([])).toBe(1)
  })
})
