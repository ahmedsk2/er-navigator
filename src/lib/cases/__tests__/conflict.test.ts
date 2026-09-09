import { describe, expect, it } from 'vitest'
import { conflictInfoFrom, conflictMessage, UNKNOWN_EDITOR } from '../conflict'

const AT = new Date('2026-09-09T12:34:00.000Z')
const FALLBACK = new Date('2026-09-09T09:00:00.000Z')

describe('conflictInfoFrom', () => {
  it('takes the display name and time from the latest audit row', () => {
    expect(conflictInfoFrom({ at: AT, actor: { displayName: 'Sara Al-Otaibi' } }, FALLBACK)).toEqual({
      changedBy: 'Sara Al-Otaibi',
      changedAt: AT,
    })
  })

  it('falls back to the case timestamp when the case has no audit row yet', () => {
    expect(conflictInfoFrom(null, FALLBACK)).toEqual({ changedBy: UNKNOWN_EDITOR, changedAt: FALLBACK })
  })

  it('keeps the audit time but names nobody when the row has no actor', () => {
    expect(conflictInfoFrom({ at: AT, actor: null }, FALLBACK)).toEqual({
      changedBy: UNKNOWN_EDITOR,
      changedAt: AT,
    })
  })

  it('treats a blank display name as no name at all', () => {
    expect(conflictInfoFrom({ at: AT, actor: { displayName: '   ' } }, FALLBACK).changedBy).toBe(UNKNOWN_EDITOR)
  })

  it('builds the message the plan specifies, never offering to merge', () => {
    const message = conflictMessage('Sara Al-Otaibi', '09/09 15:34')
    expect(message).toBe('This case was changed by Sara Al-Otaibi at 09/09 15:34. Reload to continue.')
    expect(message).not.toMatch(/merge/i)
  })
})
