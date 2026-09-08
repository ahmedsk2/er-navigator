import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Plan §3 hard rule: no column may ever hold a patient name, national ID, or date of birth.
 * This test reads prisma/schema.prisma, isolates the Case model, and fails if any field
 * name matches /name|national|dob|birth/i. It is deliberately dumb so it cannot be argued with.
 */
describe('PHI guard on the Case model', () => {
  const schema = readFileSync(path.resolve(__dirname, '../../prisma/schema.prisma'), 'utf8')
  const caseModel = schema.match(/model Case \{([\s\S]*?)\n\}/)?.[1]

  it('finds the Case model', () => expect(caseModel).toBeTruthy())

  it('has no field that could hold a name, national ID or date of birth', () => {
    const fields = caseModel!
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//') && !l.startsWith('@@'))
      .map((l) => l.split(/\s+/)[0]!)
    const offenders = fields.filter((f) => /name|national|dob|birth/i.test(f))
    expect(offenders).toEqual([])
  })
})
