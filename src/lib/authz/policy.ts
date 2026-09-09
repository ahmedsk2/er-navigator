/**
 * Role policy — the permission matrix from the locked plan, section 2, verbatim. Every server
 * action and route handler asks `can(role, action)`; the UI only hides what a role cannot do.
 * A VIEWER hitting a mutation gets 403 and an `auth.forbidden` audit row (see src/lib/audit.ts).
 */
import type { Role } from '@prisma/client'

export const ACTIONS = [
  'case.view',
  'case.create',
  'case.edit',
  'case.update.add',
  'case.resolve',
  'case.reopen',
  'case.review',
  'alert.acknowledge',
  'case.void',
  'dashboard.view',
  'export.xlsx',
  'report.print',
  'admin.users',
  'admin.lists',
  'admin.other.review',
  'admin.audit.view',
] as const

export type Action = (typeof ACTIONS)[number]

const ALL: ReadonlyArray<Role> = ['NAVIGATOR', 'SUPERVISOR', 'ADMIN', 'VIEWER']
const EDITORS: ReadonlyArray<Role> = ['NAVIGATOR', 'SUPERVISOR', 'ADMIN']
const SUPERVISORS: ReadonlyArray<Role> = ['SUPERVISOR', 'ADMIN']
const EXPORTERS: ReadonlyArray<Role> = ['SUPERVISOR', 'ADMIN', 'VIEWER']
const ADMINS: ReadonlyArray<Role> = ['ADMIN']

const MATRIX: Record<Action, ReadonlyArray<Role>> = {
  'case.view': ALL,
  'case.create': EDITORS,
  'case.edit': EDITORS,
  'case.update.add': EDITORS,
  'case.resolve': EDITORS,
  'case.reopen': EDITORS,
  // Phase 8b, decision H: a supervisor signs a case off as reviewed. It changes no case
  // content, which is why it is not in EDITORS: a navigator cannot mark their own work checked.
  'case.review': SUPERVISORS,
  'alert.acknowledge': SUPERVISORS,
  'case.void': SUPERVISORS,
  'dashboard.view': ALL,
  'export.xlsx': EXPORTERS,
  'report.print': EXPORTERS,
  'admin.users': ADMINS,
  'admin.lists': ADMINS,
  'admin.other.review': ADMINS,
  'admin.audit.view': ADMINS,
}

export function can(role: Role, action: Action): boolean {
  return MATRIX[action].includes(role)
}

/** Every (action, role) pair, for the role-matrix test and the admin "who can do what" table. */
export function matrix(): Array<{ action: Action; role: Role; allowed: boolean }> {
  return ACTIONS.flatMap((action) => ALL.map((role) => ({ action, role, allowed: can(role, action) })))
}
