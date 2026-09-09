import { randomBytes } from 'node:crypto'
import type { Role, User } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuditContext } from '@/src/lib/audit'
import { ForbiddenError, type AuthUser } from '@/src/lib/auth/session'
import { loadReference } from '@/src/lib/cases/reference'
import {
  addCaseUpdate,
  createCase,
  reopenCase,
  resolveCase,
  saveCase,
  voidCase,
} from '@/src/lib/cases/service'
import type { CaseDraft, ReferenceData } from '@/src/lib/cases/types'
import { prisma } from '@/src/lib/db'

/**
 * The Phase 2 vertical slice against a real Postgres, with the OWNER role: creating,
 * editing, the 409 on a stale version, the append-only update, resolve/reopen/void, the "Other"
 * review queue and the audit trail. Cleaning up needs DELETE on Case, CaseUpdate and AuditLog,
 * which the app role deliberately does not have — the same reason tests/db/auth.test.ts runs as
 * the owner.
 */
const users: string[] = []
const cases: string[] = []
/** Reference rows this file creates so it can retire them without touching the seed. */
const extraReasons: string[] = []
const extraDepartments: string[] = []
let reference: ReferenceData

async function makeUser(role: Role): Promise<User> {
  const user = await prisma.user.create({
    data: {
      username: `p2test_${randomBytes(6).toString('hex')}`,
      passwordHash: 'not-a-real-hash',
      displayName: `Phase 2 ${role}`,
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

const ctxFor = (id: string): AuditContext => ({ actorId: id, ip: '10.0.0.2', userAgent: 'vitest' })

function stage(code: string) {
  const found = reference.stages.find((s) => s.code === code)
  if (!found) throw new Error(`the seed has no "${code}" stage`)
  return found
}

function reasonNamed(code: string, name: string): string {
  const found = stage(code).reasons.find((r) => r.name === name)
  if (!found) throw new Error(`the seed has no "${name}" reason under "${code}"`)
  return found.id
}

function otherReasonOf(code: string): string {
  const found = stage(code).reasons.find((r) => r.isOther)
  if (!found) throw new Error(`the seed has no "Other" reason under "${code}"`)
  return found.id
}

/**
 * A reason and a department this file owns, sorted last so no other suite's ordering assertion
 * moves, and retired here rather than in the seed so the database files can keep running in
 * parallel.
 */
async function makeReason(stageId: string): Promise<string> {
  const row = await prisma.reason.create({
    data: { stageId, name: `p7 retired reason ${randomBytes(4).toString('hex')}`, sortOrder: 900, active: true },
  })
  extraReasons.push(row.id)
  return row.id
}

async function makeDepartment(): Promise<string> {
  const row = await prisma.department.create({
    data: { name: `p7 retired team ${randomBytes(4).toString('hex')}`, sortOrder: 900, active: true },
  })
  extraDepartments.push(row.id)
  return row.id
}

const HOUR = 36e5

function draft(overrides: Partial<CaseDraft> = {}): CaseDraft {
  return {
    mrn: '851557',
    registrationAt: new Date(Date.now() - 6 * HOUR).toISOString(),
    shift: 'MORNING',
    stages: [],
    reasons: [{ reasonId: reasonNamed('reg', 'Registration desk/system delay'), otherText: null }],
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
    disposition: null,
    wardId: null,
    isolation: false,
    resolutionNote: '',
    version: 1,
    ...overrides,
  }
}

/** Create a case for a test and remember it for the cleanup. */
async function openCase(actor: AuthUser, overrides: Partial<CaseDraft> = {}): Promise<string> {
  const result = await createCase(actor, draft(overrides), ctxFor(actor.id))
  if (!result.ok) throw new Error(`expected the case to open, got ${JSON.stringify(result)}`)
  cases.push(result.id)
  return result.id
}

beforeAll(async () => {
  reference = await loadReference()
})

afterAll(async () => {
  if (cases.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: cases } } })
    await prisma.otherReview.deleteMany({ where: { caseId: { in: cases } } })
    const updates = await prisma.caseUpdate.findMany({ where: { caseId: { in: cases } }, select: { id: true } })
    await prisma.auditLog.deleteMany({ where: { entityId: { in: updates.map((u) => u.id) } } })
    await prisma.caseUpdate.deleteMany({ where: { caseId: { in: cases } } })
    await prisma.caseReason.deleteMany({ where: { caseId: { in: cases } } })
    await prisma.caseConsult.deleteMany({ where: { caseId: { in: cases } } })
    await prisma.caseInvestigation.deleteMany({ where: { caseId: { in: cases } } })
    await prisma.case.deleteMany({ where: { id: { in: cases } } })
  }
  if (extraReasons.length > 0) await prisma.reason.deleteMany({ where: { id: { in: extraReasons } } })
  if (extraDepartments.length > 0) await prisma.department.deleteMany({ where: { id: { in: extraDepartments } } })
  if (users.length > 0) {
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: users } }, { entityId: { in: users } }] } })
    await prisma.user.deleteMany({ where: { id: { in: users } } })
  }
  await prisma.$disconnect()
})

describe('createCase', () => {
  it('writes the case, its children and one case.create audit row, and remembers the shift', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const departmentId = reference.departments[0]!.id
    const id = await openCase(nurse, {
      shift: 'NIGHT',
      reasons: [{ reasonId: reasonNamed('ref', 'Referral sent, awaiting acceptance'), otherText: null }],
      consults: [{ departmentId, consultedAt: new Date().toISOString(), seenAt: null, repliedAt: null }],
      investigations: [
        { type: 'LAB', orderedAt: null, collectedAt: null, receivedAt: null, doneAt: null, resultedAt: null },
      ],
    })

    const row = await prisma.case.findUniqueOrThrow({
      where: { id },
      include: { reasons: true, consults: true, investigations: true },
    })
    expect(row.status).toBe('OPEN')
    expect(row.version).toBe(1)
    expect(row.openedById).toBe(nurse.id)
    expect(row.mrn).toBe('851557')
    expect(row.reasons).toHaveLength(1)
    expect(row.consults).toHaveLength(1)
    expect(row.investigations).toHaveLength(1)

    const audits = await prisma.auditLog.findMany({ where: { entity: 'Case', entityId: id } })
    expect(audits).toHaveLength(1)
    expect(audits[0]!.action).toBe('case.create')
    expect(audits[0]!.before).toBeNull()
    expect(audits[0]!.after).toMatchObject({ mrn: '851557', status: 'OPEN', version: 1 })

    // The next case this nurse opens defaults to the shift they just used (plan section 5.3).
    expect((await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })).lastShift).toBe('NIGHT')
  })

  it('refuses a non-numeric MRN and a case with no reason, and writes nothing', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    // Scoped to this nurse: vitest runs the database files in parallel, so a global count moves
    // under this assertion whenever another suite opens a case at the same moment.
    const mine = { openedById: nurse.id }
    const before = await prisma.case.count({ where: mine })

    const badMrn = await createCase(nurse, draft({ mrn: 'A1234' }), ctxFor(nurse.id))
    expect(badMrn).toMatchObject({ ok: false, error: 'validation' })

    const noReason = await createCase(nurse, draft({ reasons: [] }), ctxFor(nurse.id))
    expect(noReason).toMatchObject({ ok: false, error: 'validation' })

    expect(await prisma.case.count({ where: mine })).toBe(before)
  })

  it('requires the primary reason once more than one is selected', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const result = await createCase(
      nurse,
      draft({
        reasons: [
          { reasonId: reasonNamed('reg', 'Registration desk/system delay'), otherText: null },
          { reasonId: reasonNamed('triage', 'Re-triage required'), otherText: null },
        ],
        primaryReasonId: null,
      }),
      ctxFor(nurse.id),
    )
    expect(result).toMatchObject({ ok: false, error: 'validation' })
    if (result.ok || result.error !== 'validation') throw new Error('unreachable')
    expect(result.issues.some((i) => i.path === 'primaryReasonId')).toBe(true)
  })

  it('a VIEWER is refused and the refusal is audited', async () => {
    const viewer = actorOf(await makeUser('VIEWER'))
    await expect(createCase(viewer, draft(), ctxFor(viewer.id))).rejects.toBeInstanceOf(ForbiddenError)
    const rows = await prisma.auditLog.findMany({ where: { actorId: viewer.id, action: 'auth.forbidden' } })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.entityId).toBe('case.create')
  })
})

describe('saveCase', () => {
  it('bumps the version, diffs the child rows and audits before and after', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const first = reasonNamed('reg', 'Registration desk/system delay')
    const second = reasonNamed('triage', 'Re-triage required')
    const id = await openCase(nurse)

    const saved = await saveCase(
      nurse,
      id,
      draft({
        mrn: '900001',
        reasons: [
          { reasonId: second, otherText: null },
          { reasonId: reasonNamed('triage', 'Waiting for triage nurse availability'), otherText: null },
        ],
        primaryReasonId: second,
        version: 1,
      }),
      ctxFor(nurse.id),
    )
    expect(saved).toMatchObject({ ok: true, version: 2 })

    const row = await prisma.case.findUniqueOrThrow({ where: { id }, include: { reasons: true } })
    expect(row.mrn).toBe('900001')
    expect(row.version).toBe(2)
    expect(row.reasons.map((r) => r.reasonId).sort()).toEqual([second, reasonNamed('triage', 'Waiting for triage nurse availability')].sort())
    expect(row.reasons.map((r) => r.reasonId)).not.toContain(first)

    const audits = await prisma.auditLog.findMany({ where: { entity: 'Case', entityId: id }, orderBy: { at: 'asc' } })
    expect(audits.map((a) => a.action)).toEqual(['case.create', 'case.update'])
    expect(audits[1]!.before).toMatchObject({ mrn: '851557', version: 1 })
    expect(audits[1]!.after).toMatchObject({ mrn: '900001', version: 2 })
  })

  it('answers 409 with the last editor for a stale version, and changes nothing', async () => {
    const first = actorOf(await makeUser('NAVIGATOR'))
    const second = actorOf(await makeUser('SUPERVISOR'))
    const id = await openCase(first)

    const winner = await saveCase(second, id, draft({ mrn: '111111', version: 1 }), ctxFor(second.id))
    expect(winner).toMatchObject({ ok: true, version: 2 })

    const loser = await saveCase(first, id, draft({ mrn: '222222', version: 1 }), ctxFor(first.id))
    expect(loser).toMatchObject({ ok: false, error: 'conflict', changedBy: second.displayName })
    if (loser.ok || loser.error !== 'conflict') throw new Error('unreachable')
    expect(new Date(loser.changedAt).getTime()).toBeLessThanOrEqual(Date.now())

    const row = await prisma.case.findUniqueOrThrow({ where: { id } })
    expect(row.mrn).toBe('111111')
    expect(row.version).toBe(2)
    // The refused save left no audit row behind.
    expect(await prisma.auditLog.count({ where: { entity: 'Case', entityId: id } })).toBe(2)
  })

  it('queues an Other review when Other is chosen, and deletes it when it is deselected', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const other = otherReasonOf('inv')
    const id = await openCase(nurse, { reasons: [{ reasonId: other, otherText: 'Porter never came' }] })

    const queued = await prisma.otherReview.findMany({ where: { caseId: id } })
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ status: 'PENDING', stageId: stage('inv').id, text: 'Porter never came' })

    // Editing the text updates the pending row rather than queuing a second one.
    const edited = await saveCase(
      nurse,
      id,
      draft({ reasons: [{ reasonId: other, otherText: 'Porter never arrived' }], version: 1 }),
      ctxFor(nurse.id),
    )
    expect(edited.ok).toBe(true)
    const afterEdit = await prisma.otherReview.findMany({ where: { caseId: id } })
    expect(afterEdit).toHaveLength(1)
    expect(afterEdit[0]!.text).toBe('Porter never arrived')

    // Deselecting the Other reason removes its text row and its pending review.
    const deselected = await saveCase(
      nurse,
      id,
      draft({ reasons: [{ reasonId: reasonNamed('reg', 'Registration desk/system delay'), otherText: null }], version: 2 }),
      ctxFor(nurse.id),
    )
    expect(deselected.ok).toBe(true)
    expect(await prisma.otherReview.count({ where: { caseId: id } })).toBe(0)
    expect(await prisma.caseReason.count({ where: { caseId: id, reasonId: other } })).toBe(0)
  })

  it('refuses to save a voided case', async () => {
    const supervisor = actorOf(await makeUser('SUPERVISOR'))
    const id = await openCase(supervisor)
    expect(await voidCase(supervisor, id, { version: 1, voidReason: 'opened twice' }, ctxFor(supervisor.id))).toMatchObject({ ok: true })

    const attempt = await saveCase(supervisor, id, draft({ mrn: '333333', version: 2 }), ctxFor(supervisor.id))
    expect(attempt).toMatchObject({ ok: false, error: 'conflict' })
    expect((await prisma.case.findUniqueOrThrow({ where: { id } })).mrn).toBe('851557')
  })
})

/**
 * Phase 7, C4/C10. An Admin deactivating a reference row a case already carries used to freeze
 * that case: the stored id survived in the draft, the active-only chips offered nothing to
 * deselect it with, and both Save and Resolve refused it. The case-aware reference accepts the
 * rows this case already has — and nothing more.
 */
describe('a reference row retired while a case carries it', () => {
  let nurse: AuthUser
  let retiredReasonId: string
  let retiredDepartmentId: string
  /** The case that carries both rows, and one that never did. */
  let carrier: string
  let bystander: string

  const carrierDraft = (version: number): CaseDraft =>
    draft({
      reasons: [{ reasonId: retiredReasonId, otherText: null }],
      consults: [{ departmentId: retiredDepartmentId, consultedAt: null, seenAt: null, repliedAt: null }],
      version,
    })

  beforeAll(async () => {
    nurse = actorOf(await makeUser('NAVIGATOR'))
    retiredReasonId = await makeReason(stage('reg').id)
    retiredDepartmentId = await makeDepartment()
    carrier = await openCase(nurse, {
      reasons: [{ reasonId: retiredReasonId, otherText: null }],
      consults: [{ departmentId: retiredDepartmentId, consultedAt: null, seenAt: null, repliedAt: null }],
    })
    bystander = await openCase(nurse)
    // What Admin → Reference lists does, and calls safe.
    await prisma.reason.update({ where: { id: retiredReasonId }, data: { active: false } })
    await prisma.department.update({ where: { id: retiredDepartmentId }, data: { active: false } })
  })

  it('saves the unchanged draft', async () => {
    const saved = await saveCase(nurse, carrier, carrierDraft(1), ctxFor(nurse.id))
    expect(saved).toMatchObject({ ok: true, version: 2 })
    const row = await prisma.case.findUniqueOrThrow({ where: { id: carrier }, include: { reasons: true, consults: true } })
    expect(row.reasons.map((r) => r.reasonId)).toEqual([retiredReasonId])
    expect(row.consults.map((c) => c.departmentId)).toEqual([retiredDepartmentId])
  })

  it('saves once the nurse has deselected both retired chips', async () => {
    const cleared = await saveCase(
      nurse,
      carrier,
      draft({
        reasons: [{ reasonId: reasonNamed('reg', 'Registration desk/system delay'), otherText: null }],
        consults: [],
        version: 2,
      }),
      ctxFor(nurse.id),
    )
    expect(cleared).toMatchObject({ ok: true, version: 3 })
    const row = await prisma.case.findUniqueOrThrow({ where: { id: carrier }, include: { reasons: true, consults: true } })
    expect(row.reasons.map((r) => r.reasonId)).not.toContain(retiredReasonId)
    expect(row.consults).toHaveLength(0)
  })

  it('refuses the retired reason on a case that does not already carry it', async () => {
    const added = await saveCase(
      nurse,
      bystander,
      draft({ reasons: [{ reasonId: retiredReasonId, otherText: null }], version: 1 }),
      ctxFor(nurse.id),
    )
    expect(added).toMatchObject({ ok: false, error: 'validation' })
    if (added.ok || added.error !== 'validation') throw new Error('unreachable')
    expect(added.issues.some((i) => i.message === 'Unknown delay reason.')).toBe(true)
    expect((await prisma.case.findUniqueOrThrow({ where: { id: bystander } })).version).toBe(1)
  })

  it('refuses the retired department on a case that does not already carry it', async () => {
    const added = await saveCase(
      nurse,
      bystander,
      draft({
        consults: [{ departmentId: retiredDepartmentId, consultedAt: null, seenAt: null, repliedAt: null }],
        version: 1,
      }),
      ctxFor(nurse.id),
    )
    expect(added).toMatchObject({ ok: false, error: 'validation' })
    if (added.ok || added.error !== 'validation') throw new Error('unreachable')
    expect(added.issues.some((i) => i.message === 'That team is no longer on the list.')).toBe(true)
  })

  it('keeps createCase strict: a new case cannot be opened on a retired reason', async () => {
    const result = await createCase(
      nurse,
      draft({ reasons: [{ reasonId: retiredReasonId, otherText: null }] }),
      ctxFor(nurse.id),
    )
    expect(result).toMatchObject({ ok: false, error: 'validation' })
  })
})

describe('addCaseUpdate', () => {
  it('appends a row without a version check and audits it against the update, not the case', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const id = await openCase(nurse)

    const one = await addCaseUpdate(nurse, id, 'Bed coordinator called', ctxFor(nurse.id))
    const two = await addCaseUpdate(nurse, id, 'Ward says one hour', ctxFor(nurse.id))
    expect(one).toMatchObject({ ok: true })
    expect(two).toMatchObject({ ok: true })
    if (!one.ok || !two.ok) throw new Error('unreachable')
    expect(one.update.author).toBe(nurse.displayName)
    expect(one.warnings).toEqual([])

    const rows = await prisma.caseUpdate.findMany({ where: { caseId: id }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => r.text)).toEqual(['Bed coordinator called', 'Ward says one hour'])
    // The case's own version is untouched, so an append can never lose a race.
    expect((await prisma.case.findUniqueOrThrow({ where: { id } })).version).toBe(1)
    expect(await prisma.auditLog.count({ where: { entity: 'CaseUpdate', entityId: one.update.id } })).toBe(1)
  })

  it('keeps a row that looks like an identifier, and says so', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const id = await openCase(nurse)
    const result = await addCaseUpdate(nurse, id, 'Family gave 1098765432 as the number', ctxFor(nurse.id))
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error('unreachable')
    expect(result.warnings).toHaveLength(1)
    expect(await prisma.caseUpdate.count({ where: { caseId: id } })).toBe(1)
  })

  it('refuses empty text', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const id = await openCase(nurse)
    expect(await addCaseUpdate(nurse, id, '   ', ctxFor(nurse.id))).toMatchObject({ ok: false, error: 'validation' })
    expect(await prisma.caseUpdate.count({ where: { caseId: id } })).toBe(0)
  })
})

describe('resolve and reopen', () => {
  it('needs a ward for an admission, then resolves, appends the update and audits once', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const id = await openCase(nurse)
    const departedAt = new Date().toISOString()

    const noWard = await resolveCase(
      nurse,
      id,
      draft({ disposition: 'ADMITTED', departedAt, version: 1 }),
      ctxFor(nurse.id),
    )
    expect(noWard).toMatchObject({ ok: false, error: 'validation' })
    if (noWard.ok || noWard.error !== 'validation') throw new Error('unreachable')
    expect(noWard.issues.some((i) => i.path === 'wardId')).toBe(true)

    const wardId = reference.wards[0]!.id
    const resolved = await resolveCase(
      nurse,
      id,
      draft({ disposition: 'ADMITTED', wardId, isolation: true, departedAt, version: 1 }),
      ctxFor(nurse.id),
    )
    expect(resolved).toMatchObject({ ok: true, version: 2 })

    const row = await prisma.case.findUniqueOrThrow({ where: { id } })
    expect(row.status).toBe('RESOLVED')
    expect(row.wardId).toBe(wardId)
    expect(row.isolation).toBe(true)
    expect(row.resolvedAt?.toISOString()).toBe(departedAt)
    expect(row.departedAt?.toISOString()).toBe(departedAt)

    const updates = await prisma.caseUpdate.findMany({ where: { caseId: id } })
    expect(updates.map((u) => u.text)).toEqual(['Resolved: Admitted'])

    const audits = await prisma.auditLog.findMany({ where: { entity: 'Case', entityId: id }, orderBy: { at: 'asc' } })
    expect(audits.map((a) => a.action)).toEqual(['case.create', 'case.resolve'])
    expect(audits[1]!.before).toMatchObject({ status: 'OPEN' })
    expect(audits[1]!.after).toMatchObject({ status: 'RESOLVED', disposition: 'ADMITTED' })
  })

  it('needs a referral tracking number when the disposition is a transfer', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const id = await openCase(nurse)
    const result = await resolveCase(
      nurse,
      id,
      draft({ disposition: 'TRANSFERRED', departedAt: new Date().toISOString(), version: 1 }),
      ctxFor(nurse.id),
    )
    expect(result).toMatchObject({ ok: false, error: 'validation' })
    if (result.ok || result.error !== 'validation') throw new Error('unreachable')
    expect(result.issues.some((i) => i.path === 'referralTrackingNo')).toBe(true)
  })

  it('reopens a resolved case, clears resolvedAt, keeps departedAt and appends "Reopened"', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const id = await openCase(nurse)
    const departedAt = new Date().toISOString()
    const resolved = await resolveCase(
      nurse,
      id,
      draft({ disposition: 'DISCHARGED_HOME', departedAt, version: 1 }),
      ctxFor(nurse.id),
    )
    if (!resolved.ok) throw new Error('unreachable')

    const reopened = await reopenCase(nurse, id, resolved.version, ctxFor(nurse.id))
    expect(reopened).toMatchObject({ ok: true, version: 3 })

    const row = await prisma.case.findUniqueOrThrow({ where: { id } })
    expect(row.status).toBe('OPEN')
    expect(row.resolvedAt).toBeNull()
    expect(row.departedAt?.toISOString()).toBe(departedAt)

    const updates = await prisma.caseUpdate.findMany({ where: { caseId: id }, orderBy: { createdAt: 'asc' } })
    expect(updates.map((u) => u.text)).toEqual(['Resolved: Discharged home', 'Reopened'])
    expect(await prisma.auditLog.count({ where: { entity: 'Case', entityId: id, action: 'case.reopen' } })).toBe(1)
  })

  it('answers 409 when the version is stale on reopen', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const id = await openCase(nurse)
    const resolved = await resolveCase(
      nurse,
      id,
      draft({ disposition: 'DISCHARGED_HOME', departedAt: new Date().toISOString(), version: 1 }),
      ctxFor(nurse.id),
    )
    if (!resolved.ok) throw new Error('unreachable')
    expect(await reopenCase(nurse, id, 1, ctxFor(nurse.id))).toMatchObject({ ok: false, error: 'conflict' })
  })
})

describe('voidCase', () => {
  it('is refused for a NAVIGATOR, with an audit row and no change', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const id = await openCase(nurse)

    await expect(voidCase(nurse, id, { version: 1, voidReason: 'wrong MRN' }, ctxFor(nurse.id))).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    expect((await prisma.case.findUniqueOrThrow({ where: { id } })).status).toBe('OPEN')
    const refusals = await prisma.auditLog.findMany({ where: { actorId: nurse.id, action: 'auth.forbidden' } })
    expect(refusals).toHaveLength(1)
    expect(refusals[0]!.entityId).toBe('case.void')
  })

  it('a SUPERVISOR voids with a reason, which appends an update and audits before and after', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const supervisor = actorOf(await makeUser('SUPERVISOR'))
    const id = await openCase(nurse)

    expect(await voidCase(supervisor, id, { version: 1, voidReason: '' }, ctxFor(supervisor.id))).toMatchObject({
      ok: false,
      error: 'validation',
    })

    const voided = await voidCase(supervisor, id, { version: 1, voidReason: 'opened twice by mistake' }, ctxFor(supervisor.id))
    expect(voided).toMatchObject({ ok: true, version: 2 })

    const row = await prisma.case.findUniqueOrThrow({ where: { id } })
    expect(row.status).toBe('VOIDED')
    expect(row.voidReason).toBe('opened twice by mistake')

    const updates = await prisma.caseUpdate.findMany({ where: { caseId: id } })
    expect(updates.map((u) => u.text)).toEqual(['Voided: opened twice by mistake'])

    const audits = await prisma.auditLog.findMany({ where: { entity: 'Case', entityId: id }, orderBy: { at: 'asc' } })
    expect(audits.map((a) => a.action)).toEqual(['case.create', 'case.void'])
    expect(audits[1]!.after).toMatchObject({ status: 'VOIDED' })
  })
})
