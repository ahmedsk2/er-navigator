import { describe, expect, it } from 'vitest'
import { MIN_N } from '@/src/lib/domain/time'
import { weekPoint } from '../weeks'

describe('weekPoint applies the n<3 rule to the weekly median', () => {
  it('suppresses the median for a week with fewer than MIN_N cases', () => {
    expect(MIN_N).toBe(3)
    expect(weekPoint({ name: '09-13', cases: 1, med: 41 }, '/dashboard?week=x')).toEqual({
      name: '09-13',
      cases: 1,
      med: null,
      href: '/dashboard?week=x',
    })
    expect(weekPoint({ name: '09-20', cases: 2, med: 7.5 }, '/x').med).toBeNull()
  })

  it('keeps the median at exactly MIN_N and above, and never touches the count', () => {
    expect(weekPoint({ name: '09-06', cases: 3, med: 8.25 }, '/x')).toMatchObject({ cases: 3, med: 8.25 })
    expect(weekPoint({ name: '09-06', cases: 12, med: 6 }, '/x')).toMatchObject({ cases: 12, med: 6 })
  })

  it('passes a null median through unchanged', () => {
    expect(weekPoint({ name: '08-30', cases: 4, med: null }, '/x').med).toBeNull()
  })
})
