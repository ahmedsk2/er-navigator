import { randomBytes } from 'node:crypto'
import type { Role, User } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runAlertCycle } from '@/src/lib/alerts/cycle'
import { acknowledgeAlert, loadAlerts, loadUnacknowledgedAlert } from '@/src/lib/alerts/service'
import { isUniqueViolation, prismaAlertStore, requireSystemUserId } from '@/src/lib/alerts/store'
import {
  addListItem,
  loadReferenceLists,
  moveListItem,
  renameListItem,
  setListItemActive,
} from '@/src/lib/admin/lists'
import { dismissOther, loadOtherReviews, promoteOther } from '@/src/lib/admin/other'
import {
  createUser,
  loadUsers,
  resetUserPassword,
  setUserActive,
  setUserEmail,
  setUserRole,
} from '@/src/lib/admin/users'
import type { AuditContext } from '@/src/lib/audit'
import { ForbiddenError, createSession, type AuthUser } from '@/src/lib/auth/session'
import { SYSTEM_USERNAME } from '@/src/lib/auth/system-user'
import { loadReference } from '@/src/lib/cases/reference'
import { createCase } from '@/src/lib/cases/service'
import type { CaseDraft, ReferenceData } from '@/src/lib/cases/types'
import { prisma } from '@/src/lib/db'

/**
 * The Phase 6 slice against a real Postgres, with the OWNER role (the app role cannot delete the
 * rows a test leaves behind): the system user, promotion end to end, deactivation ending
 * sessions, the worker's transaction and its idempotency, acknowledgement, and the audit rows
 * every one of them writes.
 */
const users: string[] = []
const cases: string[] = []
const reasons: string[] = []
const departments: string[] = []
const areas: string[] = []
let reference: ReferenceData

async function makeUser(role: Role): Promise<User> {
  const user = await prisma.user.create({
    data: {
      username: `p6test_${randomBytes(6).toString('hex')}`,
      passwordHash: 'not-a-real-hash',
      displayName: `Phase 6 ${role}`,
      role,
    },
  })
  users.push(user.id)
  return user
}

function actorOf(user: User): AuthUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active,
    lastShift: user.lastShift,
  }
}

const ctxFor = (id: string): AuditContext => ({ actorId: id, ip: '10.0.0.6', userAgent: 'vitest' })

const HOUR = 36e5

function stage(code: string) {
  const found = reference.stages.find((s) => s.code === code)
  if (!found) throw new Error(`the seed has no "${code}" stage`)
  return found
}

function otherReasonOf(code: string): string {
  const found = stage(code).reasons.find((r) => r.isOther)
  if (!found) throw new Error(`the seed has no "Other" reason under "${code}"`)
  return found.id
}

function draft(overrides: Partial<CaseDraft> = {}): CaseDraft {
  return {
    mrn: '661557',
    registrationAt: new Date(Date.now() - 6 * HOUR).toISOString(),
    shift: 'MORNING',
    ctas: null,
    areaId: null,
    stages: [],
    reasons: [],
    primaryReasonId: null,
    consults: [],
    investigations: [],
    roomType: null,
    triageAt: null,
    roomAt: null,
    physicianAt: null,
    decisionAt: null,
    departedAt: null,
    admOrderAt: null,
    bedRequestedAt: null,
    bedAssignedAt: null,
    handoverAt: null,
    transferRequestedAt: null,
    transferAcceptedAt: null,
    transportArrivedAt: null,
    referralTrackingNo: '',
    transferFacility: '',
    medAdminInformedAt: null,
    painkillerPrescribed: null,
    pethidinePrescribed: null,
    pethidineDoseMg: null,
    painkillerAt: null,
    sickleCellTreatment: null,
    instructionsGiven: null,
    familyEngagement: null,
    caseMgmtReferral: null,
    caseMgmtCriteria: null,
    caseMgmtAction: null,
    caseMgmtCalledAt: null,
    caseMgmtRepliedAt: null,
    disposition: null,
    wardId: null,
    isolation: false,
    resolutionNote: '',
    version: 1,
    ...overrides,
  }
}

async function openCase(actor: AuthUser, overrides: Partial<CaseDraft> = {}): Promise<string> {
  const result = await createCase(actor, draft(overrides), ctxFor(actor.id))
  if (!result.ok) throw new Error(`expected the case to open, got ${JSON.stringify(result)}`)
  cases.push(result.id)
  return result.id
}

/** A case registered `hoursAgo` hours ago with the given stage's Other text, and its review. */
async function caseWithOtherText(actor: AuthUser, stageCode: string, text: string): Promise<string> {
  return openCase(actor, {
    mrn: '661558',
    reasons: [{ reasonId: otherReasonOf(stageCode), otherText: text }],
    primaryReasonId: otherReasonOf(stageCode),
  })
}

const quietLogger = { info: () => undefined, warn: () => undefined, error: () => undefined }

beforeAll(async () => {
  reference = await loadReference()
})

afterAll(async () => {
  if (cases.length > 0) {
    // alert.fire / alert.acknowledge rows are keyed by the alert id, not the case id.
    const alerts = await prisma.alert.findMany({ where: { caseId: { in: cases } }, select: { id: true } })
    await prisma.auditLog.deleteMany({ where: { entityId: { in: alerts.map((a) => a.id) } } })
    await prisma.alert.deleteMany({ where: { caseId: { in: cases } } })
    await prisma.auditLog.deleteMany({ where: { entityId: { in: cases } } })
    const reviews = await prisma.otherReview.findMany({ where: { caseId: { in: cases } }, select: { id: true } })
    await prisma.auditLog.deleteMany({ where: { entityId: { in: reviews.map((r) => r.id) } } })
    await prisma.otherReview.deleteMany({ where: { caseId: { in: cases } } })
    const updates = await prisma.caseUpdate.findMany({ where: { caseId: { in: cases } }, select: { id: true } })
    await prisma.auditLog.deleteMany({ where: { entityId: { in: updates.map((u) => u.id) } } })
    await prisma.caseUpdate.deleteMany({ where: { caseId: { in: cases } } })
    await prisma.caseReason.deleteMany({ where: { caseId: { in: cases } } })
    await prisma.caseConsult.deleteMany({ where: { caseId: { in: cases } } })
    await prisma.caseInvestigation.deleteMany({ where: { caseId: { in: cases } } })
    await prisma.case.deleteMany({ where: { id: { in: cases } } })
  }
  if (reasons.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: reasons } } })
    await prisma.reason.deleteMany({ where: { id: { in: reasons } } })
  }
  if (departments.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: departments } } })
    await prisma.department.deleteMany({ where: { id: { in: departments } } })
  }
  if (areas.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: areas } } })
    await prisma.edArea.deleteMany({ where: { id: { in: areas } } })
  }
  if (users.length > 0) {
    await prisma.session.deleteMany({ where: { userId: { in: users } } })
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: users } }, { entityId: { in: users } }] } })
    await prisma.user.deleteMany({ where: { id: { in: users } } })
  }
  await prisma.$disconnect()
})

// --- the system account --------------------------------------------------------------------------

describe('the system user', () => {
  it('exists after seeding, is inactive, and has no usable password', async () => {
    const row = await prisma.user.findUnique({ where: { username: SYSTEM_USERNAME } })
    expect(row, 'prisma/seed.ts must create the system user').not.toBeNull()
    expect(row!.active).toBe(false)
    expect(row!.displayName).toBe('System')
    expect(row!.passwordHash).not.toBe('')
    // The seed hashes 48 random bytes, so nobody holds the plaintext.
    expect(row!.passwordHash.startsWith('$2')).toBe(true)
  })

  it('is resolvable by the worker and refuses every admin change', async () => {
    const systemId = await requireSystemUserId(SYSTEM_USERNAME)
    expect(systemId).toMatch(/^[a-z0-9]+$/)

    const admin = actorOf(await makeUser('ADMIN'))
    expect(await setUserActive(admin, systemId, true, ctxFor(admin.id))).toMatchObject({
      ok: false,
      error: 'system',
    })
    expect(await setUserRole(admin, systemId, 'ADMIN', ctxFor(admin.id))).toMatchObject({
      ok: false,
      error: 'system',
    })
    expect(await resetUserPassword(admin, systemId, ctxFor(admin.id))).toMatchObject({
      ok: false,
      error: 'system',
    })
    expect((await loadUsers()).find((u) => u.username === SYSTEM_USERNAME)?.isSystem).toBe(true)
  })
})

// --- users -----------------------------------------------------------------------------------------

describe('admin users', () => {
  it('creates a user with a one-time password and one user.create audit row', async () => {
    const admin = actorOf(await makeUser('ADMIN'))
    const username = `p6new_${randomBytes(4).toString('hex')}`
    const result = await createUser(
      admin,
      { username, displayName: 'New Nurse', role: 'NAVIGATOR' },
      ctxFor(admin.id),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    users.push(result.id)
    expect(result.temporaryPassword).toHaveLength(16)

    const row = await prisma.user.findUniqueOrThrow({ where: { id: result.id } })
    expect(row.role).toBe('NAVIGATOR')
    expect(row.active).toBe(true)
    // The plaintext is never stored anywhere.
    expect(row.passwordHash).not.toContain(result.temporaryPassword)

    const audits = await prisma.auditLog.findMany({ where: { entity: 'User', entityId: result.id } })
    expect(audits).toHaveLength(1)
    expect(audits[0]!.action).toBe('user.create')
    expect(audits[0]!.after).toMatchObject({ username, role: 'NAVIGATOR', active: true })
    expect(JSON.stringify(audits[0]!.after)).not.toContain(result.temporaryPassword)
  })

  it('refuses a duplicate username and a malformed one', async () => {
    const admin = actorOf(await makeUser('ADMIN'))
    expect(
      await createUser(admin, { username: admin.username, displayName: 'Clash', role: 'VIEWER' }, ctxFor(admin.id)),
    ).toMatchObject({ ok: false, error: 'duplicate' })
    expect(
      await createUser(admin, { username: 'no', displayName: 'Too short', role: 'VIEWER' }, ctxFor(admin.id)),
    ).toMatchObject({ ok: false, error: 'validation' })
  })

  it('deactivating a user deletes their sessions and audits the change', async () => {
    const admin = actorOf(await makeUser('ADMIN'))
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    await createSession({ userId: nurse.id, ip: '10.0.0.9', userAgent: 'phone' })
    await createSession({ userId: nurse.id, ip: '10.0.0.10', userAgent: 'desk' })
    expect(await prisma.session.count({ where: { userId: nurse.id } })).toBe(2)

    const result = await setUserActive(admin, nurse.id, false, ctxFor(admin.id))
    expect(result).toMatchObject({ ok: true, sessionsDeleted: 2 })
    expect(await prisma.session.count({ where: { userId: nurse.id } })).toBe(0)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })).active).toBe(false)

    const audits = await prisma.auditLog.findMany({ where: { entity: 'User', entityId: nurse.id } })
    expect(audits).toHaveLength(1)
    expect(audits[0]!.action).toBe('user.update')
    expect(audits[0]!.before).toMatchObject({ active: true })
    expect(audits[0]!.after).toMatchObject({ active: false })

    // Reactivating is allowed and does not resurrect the sessions.
    expect(await setUserActive(admin, nurse.id, true, ctxFor(admin.id))).toMatchObject({ ok: true })
    expect(await prisma.session.count({ where: { userId: nurse.id } })).toBe(0)
  })

  it('resetting a password deletes the sessions and writes user.password', async () => {
    const admin = actorOf(await makeUser('ADMIN'))
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const before = await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })
    await createSession({ userId: nurse.id, ip: '10.0.0.11', userAgent: 'phone' })

    const result = await resetUserPassword(admin, nurse.id, ctxFor(admin.id))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.sessionsDeleted).toBe(1)
    expect(await prisma.session.count({ where: { userId: nurse.id } })).toBe(0)

    const after = await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })
    expect(after.passwordHash).not.toBe(before.passwordHash)
    expect(after.failedLogins).toBe(0)
    expect(after.lockedUntil).toBeNull()

    const audits = await prisma.auditLog.findMany({ where: { entity: 'User', entityId: nurse.id } })
    expect(audits.map((a) => a.action)).toEqual(['user.password'])
    expect(JSON.stringify(audits[0]!.after)).not.toContain(result.temporaryPassword)
  })

  it('refuses self-deactivation and self-demotion, and leaves no audit row behind', async () => {
    const admin = actorOf(await makeUser('ADMIN'))
    expect(await setUserActive(admin, admin.id, false, ctxFor(admin.id))).toMatchObject({
      ok: false,
      error: 'self',
    })
    expect(await setUserRole(admin, admin.id, 'NAVIGATOR', ctxFor(admin.id))).toMatchObject({
      ok: false,
      error: 'self',
    })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe('ADMIN')
    expect(await prisma.auditLog.count({ where: { entity: 'User', entityId: admin.id } })).toBe(0)
  })

  it('changes another user’s role and audits before and after', async () => {
    const admin = actorOf(await makeUser('ADMIN'))
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    expect(await setUserRole(admin, nurse.id, 'SUPERVISOR', ctxFor(admin.id))).toMatchObject({ ok: true })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })).role).toBe('SUPERVISOR')
    const audits = await prisma.auditLog.findMany({ where: { entity: 'User', entityId: nurse.id } })
    expect(audits[0]!.before).toMatchObject({ role: 'NAVIGATOR' })
    expect(audits[0]!.after).toMatchObject({ role: 'SUPERVISOR' })
  })

  it('creates a user with a work email and audits it, and refuses one already in use', async () => {
    const admin = actorOf(await makeUser('ADMIN'))
    const username = `p7new_${randomBytes(4).toString('hex')}`
    const address = `${username}@hospital.example`

    const result = await createUser(
      admin,
      { username, displayName: 'New Supervisor', role: 'SUPERVISOR', email: ` ${address.toUpperCase()} ` },
      ctxFor(admin.id),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    users.push(result.id)

    // Trimmed and lower-cased on the way in, so one mailbox cannot become two rows.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: result.id } })).email).toBe(address)
    const audits = await prisma.auditLog.findMany({ where: { entity: 'User', entityId: result.id } })
    expect(audits[0]!.after).toMatchObject({ email: address })

    expect(
      await createUser(
        admin,
        { username: `${username}b`, displayName: 'Same Mailbox', role: 'ADMIN', email: address },
        ctxFor(admin.id),
      ),
    ).toMatchObject({ ok: false, error: 'duplicate' })

    // Created without one: the column is NULL, not an empty string, so the unique index is free.
    const plain = await createUser(
      admin,
      { username: `${username}c`, displayName: 'No Mailbox', role: 'NAVIGATOR' },
      ctxFor(admin.id),
    )
    expect(plain.ok).toBe(true)
    if (!plain.ok) throw new Error('unreachable')
    users.push(plain.id)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: plain.id } })).email).toBeNull()
  })

  it('sets, changes and clears the work email, auditing user.update with both values', async () => {
    const admin = actorOf(await makeUser('ADMIN'))
    const nurse = actorOf(await makeUser('SUPERVISOR'))
    const first = `p7a_${randomBytes(4).toString('hex')}@hospital.example`
    const second = `p7b_${randomBytes(4).toString('hex')}@hospital.example`

    expect(await setUserEmail(admin, nurse.id, first, ctxFor(admin.id))).toMatchObject({ ok: true })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })).email).toBe(first)

    expect(await setUserEmail(admin, nurse.id, second, ctxFor(admin.id))).toMatchObject({ ok: true })
    // Blank clears it back to NULL rather than to an empty string.
    expect(await setUserEmail(admin, nurse.id, '  ', ctxFor(admin.id))).toMatchObject({ ok: true })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })).email).toBeNull()

    const audits = await prisma.auditLog.findMany({
      where: { entity: 'User', entityId: nurse.id },
      orderBy: { at: 'asc' },
    })
    expect(audits.map((a) => a.action)).toEqual(['user.update', 'user.update', 'user.update'])
    expect(audits[0]!.before).toMatchObject({ email: null })
    expect(audits[0]!.after).toMatchObject({ email: first })
    expect(audits[1]!.before).toMatchObject({ email: first })
    expect(audits[1]!.after).toMatchObject({ email: second })
    expect(audits[2]!.before).toMatchObject({ email: second })
    expect(audits[2]!.after).toMatchObject({ email: null })

    // Sessions are untouched: an address is contact data, not a credential.
    await createSession({ userId: nurse.id, ip: '10.0.0.12', userAgent: 'phone' })
    expect(await setUserEmail(admin, nurse.id, first, ctxFor(admin.id))).toMatchObject({
      ok: true,
      sessionsDeleted: 0,
    })
    expect(await prisma.session.count({ where: { userId: nurse.id } })).toBe(1)
  })

  it('refuses a malformed address, one already in use, and any change to the system account', async () => {
    const admin = actorOf(await makeUser('ADMIN'))
    const nurse = actorOf(await makeUser('SUPERVISOR'))
    const taken = `p7c_${randomBytes(4).toString('hex')}@hospital.example`
    expect(await setUserEmail(admin, nurse.id, taken, ctxFor(admin.id))).toMatchObject({ ok: true })

    const other = actorOf(await makeUser('ADMIN'))
    expect(await setUserEmail(admin, other.id, taken, ctxFor(admin.id))).toMatchObject({
      ok: false,
      error: 'duplicate',
    })
    expect(await setUserEmail(admin, other.id, 'not-an-address', ctxFor(admin.id))).toMatchObject({
      ok: false,
      error: 'validation',
    })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).email).toBeNull()

    const systemId = await requireSystemUserId(SYSTEM_USERNAME)
    expect(await setUserEmail(admin, systemId, 'system@hospital.example', ctxFor(admin.id))).toMatchObject({
      ok: false,
      error: 'system',
    })

    // loadUsers carries the address, which is what the Users screen renders.
    expect((await loadUsers()).find((u) => u.id === nurse.id)?.email).toBe(taken)
  })

  it('refuses a supervisor, with an auth.forbidden audit row', async () => {
    const supervisor = actorOf(await makeUser('SUPERVISOR'))
    await expect(
      createUser(supervisor, { username: 'nope', displayName: 'Nope', role: 'VIEWER' }, ctxFor(supervisor.id)),
    ).rejects.toBeInstanceOf(ForbiddenError)
    const refusals = await prisma.auditLog.findMany({
      where: { actorId: supervisor.id, action: 'auth.forbidden' },
    })
    expect(refusals).toHaveLength(1)
    expect(refusals[0]!.entityId).toBe('admin.users')
  })
})

// --- reference lists ---------------------------------------------------------------------------

describe('admin reference lists', () => {
  it('adds, renames, reorders and deactivates a department, auditing each change as list.update', async () => {
    const admin = actorOf(await makeUser('ADMIN'))
    const name = `P6 Department ${randomBytes(3).toString('hex')}`

    const added = await addListItem(admin, { kind: 'department', name }, ctxFor(admin.id))
    expect(added.ok).toBe(true)
    if (!added.ok) throw new Error('unreachable')
    departments.push(added.id)

    const renamed = `${name} renamed`
    expect(await renameListItem(admin, { kind: 'department', id: added.id, name: renamed }, ctxFor(admin.id))).toMatchObject({ ok: true })
    const afterRename = await prisma.department.findUniqueOrThrow({ where: { id: added.id } })
    // The id survives a rename: every case already tagged with it stays tagged.
    expect(afterRename.name).toBe(renamed)

    const beforeMove = afterRename.sortOrder
    expect(await moveListItem(admin, { kind: 'department', id: added.id, direction: 'up' }, ctxFor(admin.id))).toMatchObject({ ok: true })
    const afterMove = await prisma.department.findUniqueOrThrow({ where: { id: added.id } })
    expect(afterMove.sortOrder).toBeLessThan(beforeMove)

    expect(await setListItemActive(admin, { kind: 'department', id: added.id, active: false }, ctxFor(admin.id))).toMatchObject({ ok: true })
    expect((await prisma.department.findUniqueOrThrow({ where: { id: added.id } })).active).toBe(false)

    const audits = await prisma.auditLog.findMany({
      where: { entity: 'Department', entityId: added.id },
      orderBy: { at: 'asc' },
    })
    expect(audits).toHaveLength(4)
    expect(new Set(audits.map((a) => a.action))).toEqual(new Set(['list.update']))
    expect(audits[1]!.before).toMatchObject({ name })
    expect(audits[1]!.after).toMatchObject({ name: renamed })
  })

  it('refuses a duplicate name and refuses to move past the end', async () => {
    const admin = actorOf(await makeUser('ADMIN'))
    const first = reference.departments[0]!
    expect(await addListItem(admin, { kind: 'department', name: first.name }, ctxFor(admin.id))).toMatchObject({
      ok: false,
      error: 'duplicate',
    })

    const lists = await prisma.department.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })
    expect(await moveListItem(admin, { kind: 'department', id: lists[0]!.id, direction: 'up' }, ctxFor(admin.id))).toMatchObject({
      ok: false,
      error: 'nothing',
    })
  })

  /**
   * Phase 8: `EdArea` joins the same three operations wards have, under the `area` kind, with its
   * own `EdArea` audit entity. A deactivated area is what `loadReferenceForCase` then has to keep
   * visible on a case that already carries it (tests/db/cases.test.ts).
   */
  it('adds, renames, reorders and deactivates an ED area, auditing each change against EdArea', async () => {
    const admin = actorOf(await makeUser('ADMIN'))
    const suffix = randomBytes(3).toString('hex')
    const name = `P8 Area ${suffix}`
    const code = `P8${suffix.toUpperCase()}`

    // The code is mandatory, exactly as it is for a ward.
    expect(await addListItem(admin, { kind: 'area', name }, ctxFor(admin.id))).toMatchObject({
      ok: false,
      error: 'validation',
    })

    const added = await addListItem(admin, { kind: 'area', name, code }, ctxFor(admin.id))
    expect(added.ok).toBe(true)
    if (!added.ok) throw new Error('unreachable')
    areas.push(added.id)
    expect((await prisma.edArea.findUniqueOrThrow({ where: { id: added.id } })).code).toBe(code)

    const renamed = `${name} renamed`
    expect(await renameListItem(admin, { kind: 'area', id: added.id, name: renamed }, ctxFor(admin.id))).toMatchObject({ ok: true })
    const afterRename = await prisma.edArea.findUniqueOrThrow({ where: { id: added.id } })
    // The id and the code survive a rename, so every case already assigned to it stays assigned.
    expect(afterRename.name).toBe(renamed)
    expect(afterRename.code).toBe(code)

    const beforeMove = afterRename.sortOrder
    expect(await moveListItem(admin, { kind: 'area', id: added.id, direction: 'up' }, ctxFor(admin.id))).toMatchObject({ ok: true })
    expect((await prisma.edArea.findUniqueOrThrow({ where: { id: added.id } })).sortOrder).toBeLessThan(beforeMove)

    expect(await setListItemActive(admin, { kind: 'area', id: added.id, active: false }, ctxFor(admin.id))).toMatchObject({ ok: true })
    expect((await prisma.edArea.findUniqueOrThrow({ where: { id: added.id } })).active).toBe(false)
    // Nothing is deleted: the row is still there for the cases that carry it.
    expect(await prisma.edArea.count({ where: { id: added.id } })).toBe(1)

    const audits = await prisma.auditLog.findMany({
      where: { entity: 'EdArea', entityId: added.id },
      orderBy: { at: 'asc' },
    })
    expect(audits).toHaveLength(4)
    expect(new Set(audits.map((a) => a.action))).toEqual(new Set(['list.update']))
    expect(audits[1]!.before).toMatchObject({ name })
    expect(audits[1]!.after).toMatchObject({ name: renamed })
    expect(audits[3]!.after).toMatchObject({ name: renamed, active: false })

    // The seeded areas are on the panel's list, alongside the departments and the wards.
    const lists = await loadReferenceLists()
    expect(lists.areas.some((a) => a.code === 'RESUS' && a.name === 'Resuscitation area')).toBe(true)
    expect(lists.areas.find((a) => a.id === added.id)).toMatchObject({ active: false, code })
  })

  it('refuses a duplicate ED area name and a duplicate code', async () => {
    const admin = actorOf(await makeUser('ADMIN'))
    expect(
      await addListItem(admin, { kind: 'area', name: 'Resuscitation area', code: 'RESUS2' }, ctxFor(admin.id)),
    ).toMatchObject({ ok: false, error: 'duplicate' })
    expect(
      await addListItem(admin, { kind: 'area', name: 'Somewhere else entirely', code: 'RESUS' }, ctxFor(admin.id)),
    ).toMatchObject({ ok: false, error: 'duplicate' })
  })

  it('will not rename or retire a stage’s "Other" entry', async () => {
    const admin = actorOf(await makeUser('ADMIN'))
    const other = otherReasonOf('inv')
    expect(await renameListItem(admin, { kind: 'reason', id: other, name: 'Something else' }, ctxFor(admin.id))).toMatchObject({ ok: false, error: 'validation' })
    expect(await setListItemActive(admin, { kind: 'reason', id: other, active: false }, ctxFor(admin.id))).toMatchObject({ ok: false, error: 'validation' })
  })
})

// --- the Other queue ---------------------------------------------------------------------------

describe('the Other review queue', () => {
  it('promotes a queued description: the reason is created, the case is re-tagged, the review closes', async () => {
    const admin = actorOf(await makeUser('ADMIN'))
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const text = `Porter never came ${randomBytes(3).toString('hex')}`
    const caseId = await caseWithOtherText(nurse, 'inv', text)

    const queued = await prisma.otherReview.findFirstOrThrow({ where: { caseId, status: 'PENDING' } })
    expect(queued.text).toBe(text)

    const result = await promoteOther(admin, { reviewId: queued.id, name: null }, ctxFor(admin.id))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    reasons.push(result.reasonId)
    expect(result.reused).toBe(false)
    expect(result.reasonName).toBe(text)
    expect(result.primaryMoved).toBe(true)

    // The reason now exists under the stage the text was typed under.
    const reason = await prisma.reason.findUniqueOrThrow({ where: { id: result.reasonId } })
    expect(reason.stageId).toBe(stage('inv').id)
    expect(reason.isOther).toBe(false)
    expect(reason.active).toBe(true)

    // The case carries it instead of the Other tag, with no leftover text, and it is primary.
    const tagged = await prisma.case.findUniqueOrThrow({
      where: { id: caseId },
      select: { primaryReasonId: true, version: true, reasons: true },
    })
    expect(tagged.reasons.map((r) => r.reasonId)).toEqual([result.reasonId])
    expect(tagged.reasons[0]!.otherText).toBeNull()
    expect(tagged.primaryReasonId).toBe(result.reasonId)
    expect(tagged.version).toBe(2)

    // The review is closed with who did it and what it became.
    const closed = await prisma.otherReview.findUniqueOrThrow({ where: { id: queued.id } })
    expect(closed.status).toBe('PROMOTED')
    expect(closed.promotedReasonId).toBe(result.reasonId)
    expect(closed.reviewedById).toBe(admin.id)
    expect(closed.reviewedAt).not.toBeNull()

    const audits = await prisma.auditLog.findMany({ where: { entity: 'OtherReview', entityId: queued.id } })
    expect(audits.map((a) => a.action)).toEqual(['other.promote'])
    expect(audits[0]!.after).toMatchObject({ status: 'PROMOTED', reasonName: text, reasonReused: false })
  })

  it('a second promotion of the same wording reuses the reason', async () => {
    const admin = actorOf(await makeUser('ADMIN'))
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const text = `Trolley shortage ${randomBytes(3).toString('hex')}`

    const firstCase = await caseWithOtherText(nurse, 'adm', text)
    const firstReview = await prisma.otherReview.findFirstOrThrow({ where: { caseId: firstCase, status: 'PENDING' } })
    const first = await promoteOther(admin, { reviewId: firstReview.id }, ctxFor(admin.id))
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('unreachable')
    reasons.push(first.reasonId)
    expect(first.reused).toBe(false)

    const secondCase = await caseWithOtherText(nurse, 'adm', text)
    const secondReview = await prisma.otherReview.findFirstOrThrow({ where: { caseId: secondCase, status: 'PENDING' } })
    const second = await promoteOther(admin, { reviewId: secondReview.id }, ctxFor(admin.id))
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error('unreachable')
    expect(second.reused).toBe(true)
    expect(second.reasonId).toBe(first.reasonId)

    expect(
      await prisma.reason.count({ where: { stageId: stage('adm').id, name: text } }),
    ).toBe(1)
  })

  it('dismisses a description and leaves the case untouched', async () => {
    const admin = actorOf(await makeUser('ADMIN'))
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const text = `Handover argument ${randomBytes(3).toString('hex')}`
    const caseId = await caseWithOtherText(nurse, 'dc', text)
    const queued = await prisma.otherReview.findFirstOrThrow({ where: { caseId, status: 'PENDING' } })

    expect(await dismissOther(admin, queued.id, ctxFor(admin.id))).toMatchObject({ ok: true })
    const closed = await prisma.otherReview.findUniqueOrThrow({ where: { id: queued.id } })
    expect(closed.status).toBe('DISMISSED')
    expect(closed.reviewedById).toBe(admin.id)

    const untouched = await prisma.case.findUniqueOrThrow({
      where: { id: caseId },
      select: { version: true, reasons: true },
    })
    expect(untouched.version).toBe(1)
    expect(untouched.reasons[0]!.otherText).toBe(text)

    // A second decision on the same row is refused.
    expect(await dismissOther(admin, queued.id, ctxFor(admin.id))).toMatchObject({ ok: false })
    expect(await promoteOther(admin, { reviewId: queued.id }, ctxFor(admin.id))).toMatchObject({ ok: false })

    const listed = await loadOtherReviews('ALL')
    expect(listed.some((r) => r.id === queued.id && r.status === 'DISMISSED')).toBe(true)
    expect((await loadOtherReviews('PENDING')).some((r) => r.id === queued.id)).toBe(false)
  })
})

// --- the alerts worker against the real database -------------------------------------------------

describe('the alerts worker', () => {
  it('fires once per threshold, writing the Alert, the system update and the audit row together', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const caseId = await openCase(nurse, {
      mrn: '661570',
      registrationAt: new Date(Date.now() - 7 * HOUR).toISOString(),
      reasons: [{ reasonId: stage('adm').reasons[0]!.id, otherText: null }],
    })
    const systemId = await requireSystemUserId(SYSTEM_USERNAME)
    const store = prismaAlertStore(systemId)
    const now = new Date()

    const first = await store.fire({ caseId, thresholdHours: 6, now })
    expect(first.fired).toBe(true)
    if (!first.fired) throw new Error('unreachable')

    const alert = await prisma.alert.findUniqueOrThrow({ where: { id: first.alertId } })
    expect(alert.thresholdHours).toBe(6)
    expect(alert.emailSentAt).toBeNull()
    // Alerts never write medAdminInformedAt: that stays a human confirmation.
    expect((await prisma.case.findUniqueOrThrow({ where: { id: caseId } })).medAdminInformedAt).toBeNull()

    const update = await prisma.caseUpdate.findFirstOrThrow({
      where: { caseId, authorId: systemId },
      select: { text: true, system: true },
    })
    expect(update.text).toBe('Reached 6h threshold')
    expect(update.system).toBe(true)

    const audits = await prisma.auditLog.findMany({ where: { entity: 'Alert', entityId: first.alertId } })
    expect(audits.map((a) => a.action)).toEqual(['alert.fire'])
    expect(audits[0]!.actorId).toBe(systemId)

    // The unique index makes a second attempt a no-op rather than a second row and update.
    const second = await store.fire({ caseId, thresholdHours: 6, now })
    expect(second).toEqual({ fired: false, reason: 'duplicate' })
    expect(await prisma.alert.count({ where: { caseId, thresholdHours: 6 } })).toBe(1)
    expect(await prisma.caseUpdate.count({ where: { caseId, authorId: systemId } })).toBe(1)
  })

  it('runs a whole cycle over the real store and does not re-fire on the next one', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const caseId = await openCase(nurse, {
      mrn: '661571',
      registrationAt: new Date(Date.now() - 13 * HOUR).toISOString(),
      reasons: [{ reasonId: stage('adm').reasons[0]!.id, otherText: null }],
    })
    const store = prismaAlertStore(await requireSystemUserId(SYSTEM_USERNAME))

    // Only this case, and one fixed recipient, so a suite that shares a database cannot make
    // either count ambiguous. `recipients()` itself is asserted against the real table below.
    const scoped = {
      ...store,
      openCases: async () => (await store.openCases()).filter((c) => c.id === caseId),
      recipients: async () => [
        { username: 'p7alerts', displayName: 'Alerts', email: 'alerts@example.test' },
      ],
    }

    const deps = {
      store: scoped,
      mailer: null, // SMTP_HOST empty: the 6 h and 12 h messages are logged, not sent
      logger: quietLogger,
      appUrl: 'https://example.test',
    }
    const first = await runAlertCycle({ ...deps, now: new Date() })
    // 4, 6 and 12 h all crossed; only the last two email.
    expect(first).toMatchObject({ casesScanned: 1, alertsFired: 3, emailsSent: 0, emailsLogged: 2 })

    const second = await runAlertCycle({ ...deps, now: new Date() })
    expect(second).toMatchObject({ casesScanned: 1, alertsFired: 0 })
    expect(await prisma.alert.count({ where: { caseId } })).toBe(3)
  })

  /**
   * Phase 7: the directory is the user table, not `ALERT_EMAIL_MAP`. The store returns every
   * active SUPERVISOR and ADMIN — including the ones with no address, so the cycle can name them
   * in a warning — and an Admin setting an address on Admin → Users is picked up on the next
   * cycle with no restart.
   */
  it('reads its recipients from the active supervisors and admins that have an email', async () => {
    const admin = actorOf(await makeUser('ADMIN'))
    const supervisor = actorOf(await makeUser('SUPERVISOR'))
    const navigator = actorOf(await makeUser('NAVIGATOR'))
    const leaver = actorOf(await makeUser('SUPERVISOR'))
    const address = `p7r_${randomBytes(4).toString('hex')}@hospital.example`
    const leaverAddress = `p7l_${randomBytes(4).toString('hex')}@hospital.example`
    const navigatorAddress = `p7n_${randomBytes(4).toString('hex')}@hospital.example`

    expect(await setUserEmail(admin, supervisor.id, address, ctxFor(admin.id))).toMatchObject({ ok: true })
    expect(await setUserEmail(admin, navigator.id, navigatorAddress, ctxFor(admin.id))).toMatchObject({ ok: true })
    expect(await setUserEmail(admin, leaver.id, leaverAddress, ctxFor(admin.id))).toMatchObject({ ok: true })

    const store = prismaAlertStore(await requireSystemUserId(SYSTEM_USERNAME))
    const emailsOf = async (): Promise<string[]> =>
      (await store.recipients()).flatMap((r) => (r.email ? [r.email] : []))

    let found = await emailsOf()
    expect(found).toContain(address)
    expect(found).toContain(leaverAddress)
    // A navigator is not on the list whatever their address, and neither is the admin with none.
    expect(found).not.toContain(navigatorAddress)
    expect((await store.recipients()).some((r) => r.username === admin.username && r.email === null)).toBe(true)

    // Deactivated: off the list on the very next cycle, with no restart and no config change.
    expect(await setUserActive(admin, leaver.id, false, ctxFor(admin.id))).toMatchObject({ ok: true })
    found = await emailsOf()
    expect(found).toContain(address)
    expect(found).not.toContain(leaverAddress)

    // Cleared: off the list too, while the account stays active.
    expect(await setUserEmail(admin, supervisor.id, '', ctxFor(admin.id))).toMatchObject({ ok: true })
    expect(await emailsOf()).not.toContain(address)
  })

  it('acknowledging writes alert.acknowledge once and keeps the first name and time', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const supervisor = actorOf(await makeUser('SUPERVISOR'))
    const caseId = await openCase(nurse, {
      mrn: '661572',
      registrationAt: new Date(Date.now() - 5 * HOUR).toISOString(),
      reasons: [{ reasonId: stage('adm').reasons[0]!.id, otherText: null }],
    })
    const store = prismaAlertStore(await requireSystemUserId(SYSTEM_USERNAME))
    const fired = await store.fire({ caseId, thresholdHours: 4, now: new Date() })
    if (!fired.fired) throw new Error('unreachable')

    expect(await loadUnacknowledgedAlert(caseId)).toMatchObject({ id: fired.alertId, thresholdHours: 4 })

    const result = await acknowledgeAlert(supervisor, fired.alertId, ctxFor(supervisor.id))
    expect(result).toMatchObject({ ok: true, alreadyAcknowledged: false })

    const row = await prisma.alert.findUniqueOrThrow({ where: { id: fired.alertId } })
    expect(row.acknowledgedById).toBe(supervisor.id)
    expect(row.acknowledgedAt).not.toBeNull()
    expect(await loadUnacknowledgedAlert(caseId)).toBeNull()

    // A second acknowledgement is a no-op, not a second audit row or a new name.
    const again = await acknowledgeAlert(actorOf(await makeUser('ADMIN')), fired.alertId, ctxFor(supervisor.id))
    expect(again).toMatchObject({ ok: true, alreadyAcknowledged: true })
    const unchanged = await prisma.alert.findUniqueOrThrow({ where: { id: fired.alertId } })
    expect(unchanged.acknowledgedById).toBe(supervisor.id)
    expect(unchanged.acknowledgedAt?.getTime()).toBe(row.acknowledgedAt?.getTime())

    const audits = await prisma.auditLog.findMany({ where: { entity: 'Alert', entityId: fired.alertId } })
    expect(audits.map((a) => a.action).sort()).toEqual(['alert.acknowledge', 'alert.fire'])

    const listed = await loadAlerts()
    expect(listed.find((a) => a.id === fired.alertId)).toMatchObject({
      mrn: '661572',
      thresholdHours: 4,
      acknowledgedBy: supervisor.displayName,
    })
  })

  it('refuses a navigator, with an auth.forbidden audit row', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const caseId = await openCase(nurse, {
      mrn: '661573',
      registrationAt: new Date(Date.now() - 5 * HOUR).toISOString(),
      reasons: [{ reasonId: stage('adm').reasons[0]!.id, otherText: null }],
    })
    const store = prismaAlertStore(await requireSystemUserId(SYSTEM_USERNAME))
    const fired = await store.fire({ caseId, thresholdHours: 4, now: new Date() })
    if (!fired.fired) throw new Error('unreachable')

    await expect(acknowledgeAlert(nurse, fired.alertId, ctxFor(nurse.id))).rejects.toBeInstanceOf(ForbiddenError)
    expect((await prisma.alert.findUniqueOrThrow({ where: { id: fired.alertId } })).acknowledgedAt).toBeNull()
    const refusals = await prisma.auditLog.findMany({ where: { actorId: nurse.id, action: 'auth.forbidden' } })
    expect(refusals.map((r) => r.entityId)).toContain('alert.acknowledge')
  })
})

describe('isUniqueViolation', () => {
  it('recognises Prisma P2002 and nothing else', async () => {
    const caught = await prisma.user
      .create({
        data: {
          username: SYSTEM_USERNAME,
          passwordHash: 'x',
          displayName: 'Clash',
          role: 'NAVIGATOR',
        },
      })
      .catch((e: unknown) => e)
    expect(isUniqueViolation(caught)).toBe(true)
    expect(isUniqueViolation(new Error('boom'))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
  })
})
