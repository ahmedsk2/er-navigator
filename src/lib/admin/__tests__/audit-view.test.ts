import { describe, expect, it } from 'vitest'
import { changedKeys, dateRangeWhere, parseFilters, renderValue } from '../audit-view'

describe('changedKeys', () => {
  it('lists only the keys that actually differ', () => {
    const diff = changedKeys(
      { mrn: '851557', status: 'OPEN', version: 1 },
      { mrn: '851557', status: 'RESOLVED', version: 2 },
    )
    expect(diff).toEqual([
      { key: 'status', before: 'OPEN', after: 'RESOLVED' },
      { key: 'version', before: '1', after: '2' },
    ])
  })

  it('shows a create as after-only', () => {
    expect(changedKeys(null, { username: 'sami', role: 'SUPERVISOR' })).toEqual([
      { key: 'username', before: null, after: 'sami' },
      { key: 'role', before: null, after: 'SUPERVISOR' },
    ])
  })

  it('treats a missing key and a null value as the same thing', () => {
    expect(changedKeys({ a: null }, {})).toEqual([])
  })

  it('is empty when nothing changed', () => {
    expect(changedKeys({ a: 1 }, { a: 1 })).toEqual([])
    expect(changedKeys(null, null)).toEqual([])
  })

  it('compares nested values structurally', () => {
    expect(changedKeys({ reasons: ['a', 'b'] }, { reasons: ['a', 'b'] })).toEqual([])
    const diff = changedKeys({ reasons: ['a'] }, { reasons: ['a', 'b'] })
    expect(diff).toEqual([{ key: 'reasons', before: '["a"]', after: '["a","b"]' }])
  })
})

describe('renderValue', () => {
  it('truncates a long value rather than filling the row', () => {
    const long = 'x'.repeat(500)
    expect(renderValue(long)!.length).toBeLessThan(140)
    expect(renderValue(long)!.endsWith('…')).toBe(true)
  })

  it('renders null and undefined as nothing at all', () => {
    expect(renderValue(null)).toBeNull()
    expect(renderValue(undefined)).toBeNull()
  })
})

describe('parseFilters', () => {
  it('defaults to page one with no filters', () => {
    expect(parseFilters({})).toEqual({ action: null, entity: null, actorId: null, from: null, to: null, page: 1 })
  })

  it('reads the query string, ignoring blanks and a bad page', () => {
    expect(parseFilters({ action: 'user.create', entity: '  ', actor: ['u1'], page: '3' })).toMatchObject({
      action: 'user.create',
      entity: null,
      actorId: 'u1',
      page: 3,
    })
    expect(parseFilters({ page: '0' }).page).toBe(1)
    expect(parseFilters({ page: 'nonsense' }).page).toBe(1)
  })
})

describe('dateRangeWhere', () => {
  it('covers whole calendar days at both ends', () => {
    const range = dateRangeWhere('2026-09-01', '2026-09-02')
    expect(range?.gte?.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(range?.lte?.toISOString()).toBe('2026-09-02T23:59:59.999Z')
  })

  it('is undefined when neither end is given', () => {
    expect(dateRangeWhere(null, null)).toBeUndefined()
  })

  it('drops an unparseable end rather than filtering on NaN', () => {
    expect(dateRangeWhere('not-a-date', null)).toBeUndefined()
    expect(dateRangeWhere('not-a-date', '2026-09-02')?.lte?.toISOString()).toBe('2026-09-02T23:59:59.999Z')
  })
})
