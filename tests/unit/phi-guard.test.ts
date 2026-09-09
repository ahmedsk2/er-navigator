import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Plan §3 hard rule: no column may ever hold a patient name, national ID, or date of birth.
 * This test reads prisma/schema.prisma and fails if any field of any model that can touch a
 * patient matches the pattern below. It is deliberately dumb so it cannot be argued with.
 *
 * `User` is the one model left out on purpose: `User.displayName` and, since Phase 7,
 * `User.email` are contact details for a member of hospital staff who signs in to this app —
 * they identify the nurse, never the patient, and the rule they are subject to is the audit
 * trail, not the PHI ban. The reference lists (Stage, Reason, Department, Ward and, from Phase 8,
 * EdArea) carry a `name` that is the name of a stage, a reason, a team, a ward or an area of the
 * department, so for those five models `name` alone is allowed and every other pattern still
 * applies. The patient is identified by the MRN on Case and by nothing else, which is what these
 * assertions check (widened from the Case model alone after the final review, 2026-09-09).
 */
const STAFF_MODELS = new Set(['User'])
const REFERENCE_MODELS = new Set(['Stage', 'Reason', 'Department', 'Ward', 'EdArea'])
const PATTERN = /name|national|iqama|civil|passport|dob|birth|phone|mobile/i

function modelsIn(schema: string): Map<string, string[]> {
  const models = new Map<string, string[]>()
  for (const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)\n\}/gm)) {
    const fields = match[2]!
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//') && !l.startsWith('@@'))
      .map((l) => l.split(/\s+/)[0]!)
    models.set(match[1]!, fields)
  }
  return models
}

describe('PHI guard on the schema', () => {
  const schema = readFileSync(path.resolve(__dirname, '../../prisma/schema.prisma'), 'utf8')
  const models = modelsIn(schema)

  it('finds the models (a schema rewrite must not make this test vacuous)', () => {
    expect(models.has('Case')).toBe(true)
    expect(models.has('CaseUpdate')).toBe(true)
    expect(models.has('AuditLog')).toBe(true)
    expect(models.size).toBeGreaterThanOrEqual(14)
  })

  it('the Case model has no field that could hold a name, national ID or date of birth', () => {
    const offenders = models.get('Case')!.filter((f) => PATTERN.test(f))
    expect(offenders).toEqual([])
  })

  it('no other patient-facing model has one either', () => {
    const offenders: string[] = []
    for (const [model, fields] of models) {
      if (STAFF_MODELS.has(model)) continue
      for (const field of fields) {
        if (REFERENCE_MODELS.has(model) && field === 'name') continue
        if (PATTERN.test(field)) offenders.push(`${model}.${field}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('identifies the patient by the MRN and nothing else', () => {
    expect(models.get('Case')).toContain('mrn')
  })
})
