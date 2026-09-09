import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEPARTMENTS, STAGES, WARDS } from '../taxonomy'

/**
 * Hard rule 6, the taxonomy is locked: every stage name, every reason name (in order, with its
 * flags), every department and every ward in `taxonomy.ts` must be exactly what Appendix A of
 * the locked plan says. The appendix is parsed from the reference document itself, so the only
 * way to change a string is to change the locked plan (final review, tests lens: the previous
 * test compared counts and codes, and 38 reason names could be reworded without it noticing).
 */
const PLAN = path.resolve(__dirname, '../../../../docs/reference/ER_Navigator_ClaudeCode_Plan.md')

type AppendixStage = { name: string; reasons: Array<{ name: string; requiresDepartment: boolean; requiresReferralNo: boolean }> }

function appendixA(): { stages: AppendixStage[]; departments: string[]; wards: string[] } {
  const text = readFileSync(PLAN, 'utf8')
  const start = text.indexOf('## Appendix A')
  expect(start, 'Appendix A heading').toBeGreaterThan(0)
  const section = text.slice(start)

  const stages: AppendixStage[] = []
  const stagesBlock = section.slice(section.indexOf('**Stages and reasons**'), section.indexOf('**Departments**'))
  for (const line of stagesBlock.split('\n')) {
    const m = /^- (.+?)(?: \(`requiresDepartment = true` on all\))?: (.+)$/.exec(line.trim())
    if (!m) continue
    const allRequireDepartment = line.includes('`requiresDepartment = true` on all')
    const reasons = m[2]!.split('; ').map((raw) => {
      const requiresReferralNo = raw.includes('(`requiresReferralNo`)')
      const name = raw.replace(' (`requiresReferralNo`)', '').trim()
      return { name, requiresDepartment: allRequireDepartment, requiresReferralNo }
    })
    stages.push({ name: m[1]!.trim(), reasons })
  }

  const list = (label: string): string[] => {
    const m = new RegExp(`\\*\\*${label}\\*\\*: (.+)`).exec(section)
    expect(m, label).toBeTruthy()
    return m![1]!.split('; ').map((s) => s.trim())
  }
  return { stages, departments: list('Departments'), wards: list('Wards') }
}

describe('taxonomy.ts is Appendix A of the locked plan, verbatim', () => {
  const appendix = appendixA()

  it('parses the appendix (a reformatted plan must not make this test vacuous)', () => {
    expect(appendix.stages).toHaveLength(10)
    expect(appendix.stages.reduce((n, s) => n + s.reasons.length, 0)).toBe(38)
    expect(appendix.departments).toHaveLength(16)
    expect(appendix.wards).toHaveLength(8)
  })

  it('has the same stage names in the same order', () => {
    expect(STAGES.map((s) => s.name)).toEqual(appendix.stages.map((s) => s.name))
  })

  it('has the same reason names, in order, with the same flags, under every stage', () => {
    for (const [i, stage] of appendix.stages.entries()) {
      const actual = STAGES[i]!.reasons.map((r) => ({
        name: r.name,
        requiresDepartment: r.requiresDepartment === true,
        requiresReferralNo: r.requiresReferralNo === true,
      }))
      expect(actual, stage.name).toEqual(stage.reasons)
    }
  })

  it('has the same departments and wards, in order', () => {
    expect([...DEPARTMENTS]).toEqual(appendix.departments)
    // The appendix writes a ward as "CODE (Name)", or just "CODE" when that is the whole name
    // (ICU, CCU); taxonomy.ts keeps code and name apart.
    expect(WARDS.map((w) => (w.name === w.code ? w.code : `${w.code} (${w.name})`))).toEqual(appendix.wards)
  })
})
