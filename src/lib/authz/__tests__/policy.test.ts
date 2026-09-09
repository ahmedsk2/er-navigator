import { describe, expect, it } from 'vitest'
import { ACTIONS, can, matrix } from '../policy'

/**
 * Locked plan section 2, transcribed cell by cell. If this table and the policy disagree, the
 * policy is wrong; if the table and the locked plan disagree, this file is wrong. Never "fix"
 * the policy to make a test pass without re-reading the plan.
 *
 *   Action                                     NAVIGATOR SUPERVISOR ADMIN VIEWER
 *   View board and case detail                 yes       yes        yes   yes
 *   Create/edit/add update/resolve/reopen      yes       yes        yes   no
 *   Mark a case reviewed (Phase 8b, dec. H)    no        yes        yes   no
 *   Acknowledge threshold alert                no        yes        yes   no
 *   Void a case                                no        yes        yes   no
 *   Dashboard                                  yes       yes        yes   yes
 *   Export xlsx, print report                  no        yes        yes   yes
 *   Manage users, lists, Other, audit log      no        no         yes   no
 */
const expected: Record<string, [boolean, boolean, boolean, boolean]> = {
  'case.view': [true, true, true, true],
  'case.create': [true, true, true, false],
  'case.edit': [true, true, true, false],
  'case.update.add': [true, true, true, false],
  'case.resolve': [true, true, true, false],
  'case.reopen': [true, true, true, false],
  'case.review': [false, true, true, false],
  'alert.acknowledge': [false, true, true, false],
  'case.void': [false, true, true, false],
  'dashboard.view': [true, true, true, true],
  'export.xlsx': [false, true, true, true],
  'report.print': [false, true, true, true],
  'admin.users': [false, false, true, false],
  'admin.lists': [false, false, true, false],
  'admin.other.review': [false, false, true, false],
  'admin.audit.view': [false, false, true, false],
}
const roles = ['NAVIGATOR', 'SUPERVISOR', 'ADMIN', 'VIEWER'] as const

describe('role matrix (locked plan section 2)', () => {
  it('covers every action exactly once', () => {
    expect(Object.keys(expected).sort()).toEqual([...ACTIONS].sort())
  })

  it.each(ACTIONS.flatMap((a) => roles.map((r, i) => [a, r, expected[a]![i]] as const)))(
    '%s for %s = %s',
    (action, role, allowed) => expect(can(role, action)).toBe(allowed),
  )

  it('matrix() lists all pairs', () => {
    expect(matrix()).toHaveLength(ACTIONS.length * roles.length)
  })

  it('a VIEWER can never mutate anything', () => {
    const mutating = ACTIONS.filter((a) => !['case.view', 'dashboard.view', 'export.xlsx', 'report.print'].includes(a))
    expect(mutating.every((a) => !can('VIEWER', a))).toBe(true)
  })
})
