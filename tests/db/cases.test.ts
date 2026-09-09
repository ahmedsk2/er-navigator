import { randomBytes } from 'node:crypto'
import type { Role, User } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuditContext } from '@/src/lib/audit'
import { ForbiddenError, type AuthUser } from '@/src/lib/auth/session'
import { loadReference, loadReferenceForCase } from '@/src/lib/cases/reference'
import {
  addCaseUpdate,
  createCase,
  reopenCase,
  resolveCase,
  reviewCase,
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
const extraAreas: string[] = []
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

/** The same, for an ED area (Phase 8): this file's own row, so the seeded six stay untouched. */
async function makeArea(): Promise<string> {
  const suffix = randomBytes(4).toString('hex')
  const row = await prisma.edArea.create({
    data: { code: `P8${suffix.toUpperCase()}`, name: `p8 retired area ${suffix}`, sortOrder: 900, active: true },
  })
  extraAreas.push(row.id)
  return row.id
}

const HOUR = 36e5

function draft(overrides: Partial<CaseDraft> = {}): CaseDraft {
  return {
    mrn: '851557',
    registrationAt: new Date(Date.now() - 6 * HOUR).toISOString(),
    shift: 'MORNING',
    ctas: null,
    areaId: null,
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
  if (extraAreas.length > 0) await prisma.edArea.deleteMany({ where: { id: { in: extraAreas } } })
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
        { type: 'LAB', orderedAt: null, collectedAt: null, receivedAt: null, doneAt: null, preliminaryAt: null, resultedAt: null },
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
 * Phase 8, Slice D: CTAS, the ED area and the imaging preliminary report. Three optional fields
 * that must survive a create, a save and a resolve, and appear in the audit trail like every
 * other column — the reports are built on them, so a field that silently fails to save is worse
 * than one that was never added.
 */
describe('CTAS, the ED area and the preliminary report time', () => {
  const areaNamed = (code: string): string => {
    const found = reference.areas.find((a) => a.code === code)
    if (!found) throw new Error(`the seed has no "${code}" ED area`)
    return found.id
  }

  it('creates a case with all three, and the audit row carries them', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const areaId = areaNamed('RAZ')
    const doneAt = new Date(Date.now() - 3 * HOUR).toISOString()
    const preliminaryAt = new Date(Date.now() - 2.5 * HOUR).toISOString()
    const resultedAt = new Date(Date.now() - 1 * HOUR).toISOString()

    const id = await openCase(nurse, {
      ctas: 3,
      areaId,
      reasons: [{ reasonId: reasonNamed('inv', 'Imaging: report delay'), otherText: null }],
      investigations: [
        { type: 'CT', orderedAt: null, collectedAt: null, receivedAt: null, doneAt, preliminaryAt, resultedAt },
      ],
    })

    const row = await prisma.case.findUniqueOrThrow({ where: { id }, include: { investigations: true } })
    expect(row.ctas).toBe(3)
    expect(row.areaId).toBe(areaId)
    expect(row.investigations[0]!.preliminaryAt?.toISOString()).toBe(preliminaryAt)

    const created = await prisma.auditLog.findFirstOrThrow({ where: { entity: 'Case', entityId: id } })
    expect(created.after).toMatchObject({ ctas: 3, areaId })
    const after = created.after as { investigations: Array<{ preliminaryAt: string | null }> }
    expect(after.investigations[0]!.preliminaryAt).toBe(preliminaryAt)
  })

  it('changes and clears all three on a save, with both values in the audit row', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const first = areaNamed('ACUTE')
    const second = areaNamed('RESUS')
    const preliminaryAt = new Date(Date.now() - 2 * HOUR).toISOString()
    const id = await openCase(nurse, {
      ctas: 4,
      areaId: first,
      investigations: [
        { type: 'US', orderedAt: null, collectedAt: null, receivedAt: null, doneAt: null, preliminaryAt, resultedAt: null },
      ],
    })

    const changed = await saveCase(nurse, id, draft({ ctas: 2, areaId: second, version: 1 }), ctxFor(nurse.id))
    expect(changed).toMatchObject({ ok: true, version: 2 })
    const afterChange = await prisma.case.findUniqueOrThrow({ where: { id }, include: { investigations: true } })
    expect(afterChange.ctas).toBe(2)
    expect(afterChange.areaId).toBe(second)
    // The draft dropped the investigation row, so the diff removed it rather than orphaning it.
    expect(afterChange.investigations).toHaveLength(0)

    const cleared = await saveCase(nurse, id, draft({ ctas: null, areaId: null, version: 2 }), ctxFor(nurse.id))
    expect(cleared).toMatchObject({ ok: true, version: 3 })
    const afterClear = await prisma.case.findUniqueOrThrow({ where: { id } })
    expect(afterClear.ctas).toBeNull()
    expect(afterClear.areaId).toBeNull()

    const audits = await prisma.auditLog.findMany({
      where: { entity: 'Case', entityId: id },
      orderBy: { at: 'asc' },
    })
    expect(audits.map((a) => a.action)).toEqual(['case.create', 'case.update', 'case.update'])
    expect(audits[1]!.before).toMatchObject({ ctas: 4, areaId: first })
    expect(audits[1]!.after).toMatchObject({ ctas: 2, areaId: second })
    expect(audits[2]!.after).toMatchObject({ ctas: null, areaId: null })
  })

  it('keeps all three through a resolve', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const areaId = areaNamed('ISO')
    const preliminaryAt = new Date(Date.now() - 2 * HOUR).toISOString()
    const id = await openCase(nurse)
    const departedAt = new Date().toISOString()

    const resolved = await resolveCase(
      nurse,
      id,
      draft({
        ctas: 1,
        areaId,
        investigations: [
          { type: 'XR', orderedAt: null, collectedAt: null, receivedAt: null, doneAt: null, preliminaryAt, resultedAt: null },
        ],
        disposition: 'DISCHARGED_HOME',
        departedAt,
        version: 1,
      }),
      ctxFor(nurse.id),
    )
    expect(resolved).toMatchObject({ ok: true, version: 2 })

    const row = await prisma.case.findUniqueOrThrow({ where: { id }, include: { investigations: true } })
    expect(row.status).toBe('RESOLVED')
    expect(row.ctas).toBe(1)
    expect(row.areaId).toBe(areaId)
    expect(row.investigations[0]!.preliminaryAt?.toISOString()).toBe(preliminaryAt)

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entity: 'Case', entityId: id, action: 'case.resolve' },
    })
    expect(audit.after).toMatchObject({ status: 'RESOLVED', ctas: 1, areaId })
  })

  it('refuses a CTAS outside 1 to 5 and writes nothing', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const id = await openCase(nurse)
    const refused = await saveCase(nurse, id, draft({ ctas: 6, version: 1 }), ctxFor(nurse.id))
    expect(refused).toMatchObject({ ok: false, error: 'validation' })
    if (refused.ok || refused.error !== 'validation') throw new Error('unreachable')
    expect(refused.issues.some((i) => i.path === 'ctas')).toBe(true)
    expect((await prisma.case.findUniqueOrThrow({ where: { id } })).version).toBe(1)
  })

  it('refuses an ED area that is not on the list', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const result = await createCase(nurse, draft({ areaId: 'no-such-area' }), ctxFor(nurse.id))
    expect(result).toMatchObject({ ok: false, error: 'validation' })
    if (result.ok || result.error !== 'validation') throw new Error('unreachable')
    expect(result.issues.some((i) => i.message === 'That ED area is no longer on the list.')).toBe(true)
  })

  /** The Phase 7 retired-row pattern (`loadReferenceForCase`), now for areas. */
  it('keeps a retired area on the case that carries it, and refuses it anywhere else', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const retiredAreaId = await makeArea()
    const carrier = await openCase(nurse, { areaId: retiredAreaId })
    const bystander = await openCase(nurse)

    // What Admin → Reference lists does.
    await prisma.edArea.update({ where: { id: retiredAreaId }, data: { active: false } })

    // The case-aware reference offers it back, flagged retired, so the editor can show a chip.
    const forCarrier = await loadReferenceForCase(carrier)
    expect(forCarrier.areas.find((a) => a.id === retiredAreaId)).toMatchObject({ retired: true })
    expect((await loadReference()).areas.some((a) => a.id === retiredAreaId)).toBe(false)

    // And the unchanged draft still saves, which is what a deactivation used to break.
    expect(await saveCase(nurse, carrier, draft({ areaId: retiredAreaId, version: 1 }), ctxFor(nurse.id))).toMatchObject({
      ok: true,
      version: 2,
    })
    // Deselecting it saves too, and after that it can never come back.
    expect(await saveCase(nurse, carrier, draft({ areaId: null, version: 2 }), ctxFor(nurse.id))).toMatchObject({
      ok: true,
      version: 3,
    })
    expect((await prisma.case.findUniqueOrThrow({ where: { id: carrier } })).areaId).toBeNull()

    // A case that never carried it is refused, and so is a brand new one.
    const added = await saveCase(nurse, bystander, draft({ areaId: retiredAreaId, version: 1 }), ctxFor(nurse.id))
    expect(added).toMatchObject({ ok: false, error: 'validation' })
    expect(await createCase(nurse, draft({ areaId: retiredAreaId }), ctxFor(nurse.id))).toMatchObject({
      ok: false,
      error: 'validation',
    })
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

  it('answers 409 with the last editor for a stale version on resolve, and resolves nothing', async () => {
    const first = actorOf(await makeUser('NAVIGATOR'))
    const second = actorOf(await makeUser('SUPERVISOR'))
    const id = await openCase(first)

    const winner = await saveCase(second, id, draft({ mrn: '111222', version: 1 }), ctxFor(second.id))
    expect(winner).toMatchObject({ ok: true, version: 2 })

    const loser = await resolveCase(
      first,
      id,
      draft({ disposition: 'DISCHARGED_HOME', departedAt: new Date().toISOString(), version: 1 }),
      ctxFor(first.id),
    )
    expect(loser).toMatchObject({ ok: false, error: 'conflict', changedBy: second.displayName })

    const row = await prisma.case.findUniqueOrThrow({ where: { id } })
    expect(row.status).toBe('OPEN')
    expect(row.version).toBe(2)
    expect(row.resolvedAt).toBeNull()
    // The refused resolve left neither an audit row nor its "Resolved:" update behind.
    expect(await prisma.auditLog.count({ where: { entity: 'Case', entityId: id, action: 'case.resolve' } })).toBe(0)
    expect(await prisma.caseUpdate.count({ where: { caseId: id } })).toBe(0)
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

/**
 * Phase 8b: Ahmed's collection decisions (docs/specs/phase8b-decisions.md). Sixteen more optional
 * columns and one new mutation, against a real Postgres — the enums must round-trip, the audit
 * trail must carry them, and the review must appear and disappear exactly when the spec says.
 */
describe('the collection decisions on a real case', () => {
  const PAIN = {
    painkillerPrescribed: 'YES',
    pethidinePrescribed: 'YES',
    pethidineDoseMg: 100,
    sickleCellTreatment: 'NO',
  } as const

  it('creates a case carrying every new field, and the audit row has them all', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const painkillerAt = new Date(Date.now() - 5 * HOUR).toISOString()
    const caseMgmtCalledAt = new Date(Date.now() - 4 * HOUR).toISOString()
    const caseMgmtRepliedAt = new Date(Date.now() - 3 * HOUR).toISOString()

    const id = await openCase(nurse, {
      ...PAIN,
      painkillerAt,
      instructionsGiven: 'NOT_SURE',
      familyEngagement: 'YES',
      caseMgmtReferral: 'COMPLEX_CARE',
      caseMgmtCriteria: 'MEETS',
      caseMgmtAction: 'FOR_ENROLLMENT',
      caseMgmtCalledAt,
      caseMgmtRepliedAt,
      reasons: [{ reasonId: reasonNamed('inv', 'Imaging: report delay'), otherText: null }],
      // Decision E's other half: an MRI row, which the app could not record before.
      investigations: [
        {
          type: 'MRI',
          orderedAt: null,
          collectedAt: null,
          receivedAt: null,
          doneAt: null,
          preliminaryAt: new Date(Date.now() - 2 * HOUR).toISOString(),
          resultedAt: null,
        },
      ],
    })

    const row = await prisma.case.findUniqueOrThrow({ where: { id }, include: { investigations: true } })
    expect(row.painkillerPrescribed).toBe('YES')
    expect(row.pethidinePrescribed).toBe('YES')
    expect(row.pethidineDoseMg).toBe(100)
    expect(row.painkillerAt?.toISOString()).toBe(painkillerAt)
    expect(row.sickleCellTreatment).toBe('NO')
    expect(row.instructionsGiven).toBe('NOT_SURE')
    expect(row.familyEngagement).toBe('YES')
    expect(row.caseMgmtReferral).toBe('COMPLEX_CARE')
    expect(row.caseMgmtCriteria).toBe('MEETS')
    expect(row.caseMgmtAction).toBe('FOR_ENROLLMENT')
    expect(row.caseMgmtCalledAt?.toISOString()).toBe(caseMgmtCalledAt)
    expect(row.caseMgmtRepliedAt?.toISOString()).toBe(caseMgmtRepliedAt)
    expect(row.investigations[0]!.type).toBe('MRI')

    const created = await prisma.auditLog.findFirstOrThrow({ where: { entity: 'Case', entityId: id } })
    expect(created.after).toMatchObject({
      painkillerPrescribed: 'YES',
      pethidineDoseMg: 100,
      painkillerAt,
      sickleCellTreatment: 'NO',
      instructionsGiven: 'NOT_SURE',
      familyEngagement: 'YES',
      caseMgmtReferral: 'COMPLEX_CARE',
      caseMgmtCriteria: 'MEETS',
      caseMgmtAction: 'FOR_ENROLLMENT',
      caseMgmtCalledAt,
      caseMgmtRepliedAt,
      reviewedAt: null,
      reviewedById: null,
    })
  })

  it('changes and clears them on a save, with both values in the audit row', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const id = await openCase(nurse, { ...PAIN, instructionsGiven: 'NO', caseMgmtReferral: 'CASE_MANAGER' })

    const changed = await saveCase(
      nurse,
      id,
      draft({ painkillerPrescribed: 'NO', instructionsGiven: 'YES', caseMgmtReferral: 'COMPLEX_CARE', version: 1 }),
      ctxFor(nurse.id),
    )
    expect(changed).toMatchObject({ ok: true, version: 2 })

    const cleared = await saveCase(nurse, id, draft({ version: 2 }), ctxFor(nurse.id))
    expect(cleared).toMatchObject({ ok: true, version: 3 })
    const row = await prisma.case.findUniqueOrThrow({ where: { id } })
    expect(row.painkillerPrescribed).toBeNull()
    expect(row.pethidineDoseMg).toBeNull()
    expect(row.instructionsGiven).toBeNull()
    expect(row.caseMgmtReferral).toBeNull()

    const audits = await prisma.auditLog.findMany({ where: { entity: 'Case', entityId: id }, orderBy: { at: 'asc' } })
    expect(audits[1]!.before).toMatchObject({ painkillerPrescribed: 'YES', pethidineDoseMg: 100, instructionsGiven: 'NO' })
    expect(audits[1]!.after).toMatchObject({ painkillerPrescribed: 'NO', instructionsGiven: 'YES', caseMgmtReferral: 'COMPLEX_CARE' })
    expect(audits[2]!.after).toMatchObject({ painkillerPrescribed: null, caseMgmtReferral: null })
  })

  it('keeps them through a resolve, and resolves as Deceased with no ward', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const id = await openCase(nurse)
    const departedAt = new Date().toISOString()

    const resolved = await resolveCase(
      nurse,
      id,
      draft({
        ...PAIN,
        instructionsGiven: 'NO',
        familyEngagement: 'NOT_SURE',
        disposition: 'DECEASED',
        departedAt,
        version: 1,
      }),
      ctxFor(nurse.id),
    )
    expect(resolved).toMatchObject({ ok: true, version: 2 })

    const row = await prisma.case.findUniqueOrThrow({ where: { id } })
    expect(row.status).toBe('RESOLVED')
    expect(row.disposition).toBe('DECEASED')
    expect(row.wardId).toBeNull()
    expect(row.pethidineDoseMg).toBe(100)
    expect(row.familyEngagement).toBe('NOT_SURE')

    const updates = await prisma.caseUpdate.findMany({ where: { caseId: id } })
    expect(updates.map((u) => u.text)).toEqual(['Resolved: Deceased'])

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entity: 'Case', entityId: id, action: 'case.resolve' },
    })
    expect(audit.after).toMatchObject({ disposition: 'DECEASED', instructionsGiven: 'NO', familyEngagement: 'NOT_SURE' })
  })

  it('resolves as Referred to UCC, the other disposition decision E added', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const id = await openCase(nurse)
    const resolved = await resolveCase(
      nurse,
      id,
      draft({ disposition: 'REFERRED_UCC', departedAt: new Date().toISOString(), version: 1 }),
      ctxFor(nurse.id),
    )
    expect(resolved).toMatchObject({ ok: true, version: 2 })
    expect((await prisma.case.findUniqueOrThrow({ where: { id } })).disposition).toBe('REFERRED_UCC')
    const updates = await prisma.caseUpdate.findMany({ where: { caseId: id } })
    expect(updates.map((u) => u.text)).toEqual(['Resolved: Referred to UCC'])
  })

  it('refuses a pethidine dose recorded against no prescription, and writes nothing', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const id = await openCase(nurse)
    const refused = await saveCase(nurse, id, draft({ pethidineDoseMg: 100, version: 1 }), ctxFor(nurse.id))
    expect(refused).toMatchObject({ ok: false, error: 'validation' })
    if (refused.ok || refused.error !== 'validation') throw new Error('unreachable')
    expect(refused.issues.some((i) => i.path === 'pethidineDoseMg')).toBe(true)
    expect((await prisma.case.findUniqueOrThrow({ where: { id } })).version).toBe(1)
  })

  it('refuses a pethidine dose that is not 50, 100 or 150', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const result = await createCase(
      nurse,
      draft({ pethidinePrescribed: 'YES', pethidineDoseMg: 75 }),
      ctxFor(nurse.id),
    )
    expect(result).toMatchObject({ ok: false, error: 'validation' })
    if (result.ok || result.error !== 'validation') throw new Error('unreachable')
    expect(result.issues.some((i) => i.message === 'The pethidine dose is 50, 100 or 150 mg.')).toBe(true)
  })
})

/** Phase 8b, decision C: the weekly deck's action category, written with the update. */
describe('addCaseUpdate with an action', () => {
  it('stores the category, audits it and leaves an untagged update untagged', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const id = await openCase(nurse)

    const tagged = await addCaseUpdate(nurse, id, 'Escalated to the on-call director', ctxFor(nurse.id), 'LEADERSHIP_ESCALATION')
    const plain = await addCaseUpdate(nurse, id, 'Ward says one hour', ctxFor(nurse.id))
    expect(tagged).toMatchObject({ ok: true })
    expect(plain).toMatchObject({ ok: true })
    if (!tagged.ok || !plain.ok) throw new Error('unreachable')
    expect(tagged.update.action).toBe('LEADERSHIP_ESCALATION')
    expect(plain.update.action).toBeNull()

    const rows = await prisma.caseUpdate.findMany({ where: { caseId: id }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => r.action)).toEqual(['LEADERSHIP_ESCALATION', null])

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entity: 'CaseUpdate', entityId: tagged.update.id } })
    expect(entry.after).toMatchObject({ text: 'Escalated to the on-call director', action: 'LEADERSHIP_ESCALATION' })
  })

  it('refuses a category that is not one of the six, and writes no row', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const id = await openCase(nurse)
    const refused = await addCaseUpdate(nurse, id, 'Called the ward', ctxFor(nurse.id), 'ESCALATION')
    expect(refused).toMatchObject({ ok: false, error: 'validation' })
    expect(await prisma.caseUpdate.count({ where: { caseId: id } })).toBe(0)
  })
})

/** Phase 8b, decision H: the supervisor review. */
describe('reviewCase', () => {
  it('marks the case reviewed, audits it, and neither checks nor bumps the version', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const supervisor = actorOf(await makeUser('SUPERVISOR'))
    const id = await openCase(nurse)

    const marked = await reviewCase(supervisor, id, ctxFor(supervisor.id))
    expect(marked).toMatchObject({ ok: true, reviewedByName: supervisor.displayName })
    if (!marked.ok) throw new Error('unreachable')

    const row = await prisma.case.findUniqueOrThrow({ where: { id } })
    expect(row.reviewedById).toBe(supervisor.id)
    expect(row.reviewedAt?.toISOString()).toBe(marked.reviewedAt)
    // No case content changed, so the version an open editor holds is still good.
    expect(row.version).toBe(1)

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { entity: 'Case', entityId: id, action: 'case.review' },
    })
    expect(entry.before).toMatchObject({ reviewedAt: null, reviewedById: null })
    expect(entry.after).toMatchObject({ reviewedAt: marked.reviewedAt, reviewedById: supervisor.id })
  })

  it('is idempotent: a second mark moves the time and the name to whoever read it last', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const supervisor = actorOf(await makeUser('SUPERVISOR'))
    const admin = actorOf(await makeUser('ADMIN'))
    const id = await openCase(nurse)

    const first = await reviewCase(supervisor, id, ctxFor(supervisor.id))
    const second = await reviewCase(admin, id, ctxFor(admin.id))
    expect(first).toMatchObject({ ok: true })
    expect(second).toMatchObject({ ok: true, reviewedByName: admin.displayName })
    if (!first.ok || !second.ok) throw new Error('unreachable')

    const row = await prisma.case.findUniqueOrThrow({ where: { id } })
    expect(row.reviewedById).toBe(admin.id)
    expect(new Date(second.reviewedAt).getTime()).toBeGreaterThanOrEqual(new Date(first.reviewedAt).getTime())
    expect(await prisma.auditLog.count({ where: { entity: 'Case', entityId: id, action: 'case.review' } })).toBe(2)
  })

  it('is refused for a NAVIGATOR, with an audit row and no change', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const id = await openCase(nurse)

    await expect(reviewCase(nurse, id, ctxFor(nurse.id))).rejects.toBeInstanceOf(ForbiddenError)
    expect((await prisma.case.findUniqueOrThrow({ where: { id } })).reviewedAt).toBeNull()
    const refusals = await prisma.auditLog.findMany({ where: { actorId: nurse.id, action: 'auth.forbidden' } })
    expect(refusals).toHaveLength(1)
    expect(refusals[0]!.entityId).toBe('case.review')
  })

  it('is cleared by a later save and by a resolve, and left alone by an update', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const supervisor = actorOf(await makeUser('SUPERVISOR'))
    const id = await openCase(nurse)

    expect(await reviewCase(supervisor, id, ctxFor(supervisor.id))).toMatchObject({ ok: true })

    // An update adds to the record; it does not change what was read.
    expect(await addCaseUpdate(nurse, id, 'Bed coordinator called', ctxFor(nurse.id))).toMatchObject({ ok: true })
    expect((await prisma.case.findUniqueOrThrow({ where: { id } })).reviewedById).toBe(supervisor.id)

    // A save does: the entry the supervisor signed off no longer exists.
    expect(await saveCase(nurse, id, draft({ mrn: '900123', version: 1 }), ctxFor(nurse.id))).toMatchObject({ ok: true })
    const afterSave = await prisma.case.findUniqueOrThrow({ where: { id } })
    expect(afterSave.reviewedAt).toBeNull()
    expect(afterSave.reviewedById).toBeNull()

    // And so does a resolve.
    expect(await reviewCase(supervisor, id, ctxFor(supervisor.id))).toMatchObject({ ok: true })
    expect(
      await resolveCase(
        nurse,
        id,
        draft({ mrn: '900123', disposition: 'DISCHARGED_HOME', departedAt: new Date().toISOString(), version: 2 }),
        ctxFor(nurse.id),
      ),
    ).toMatchObject({ ok: true })
    expect((await prisma.case.findUniqueOrThrow({ where: { id } })).reviewedAt).toBeNull()
  })

  it('survives a reopen and a void, which change the case standing and not its content', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const supervisor = actorOf(await makeUser('SUPERVISOR'))
    const id = await openCase(nurse)
    const resolved = await resolveCase(
      nurse,
      id,
      draft({ disposition: 'DISCHARGED_HOME', departedAt: new Date().toISOString(), version: 1 }),
      ctxFor(nurse.id),
    )
    if (!resolved.ok) throw new Error('unreachable')

    expect(await reviewCase(supervisor, id, ctxFor(supervisor.id))).toMatchObject({ ok: true })
    expect(await reopenCase(nurse, id, resolved.version, ctxFor(nurse.id))).toMatchObject({ ok: true })
    expect((await prisma.case.findUniqueOrThrow({ where: { id } })).reviewedById).toBe(supervisor.id)

    const reopened = await prisma.case.findUniqueOrThrow({ where: { id } })
    expect(await voidCase(supervisor, id, { version: reopened.version, voidReason: 'opened twice' }, ctxFor(supervisor.id))).toMatchObject({ ok: true })
    expect((await prisma.case.findUniqueOrThrow({ where: { id } })).reviewedById).toBe(supervisor.id)

    // But a voided case can no longer be marked at all.
    expect(await reviewCase(supervisor, id, ctxFor(supervisor.id))).toMatchObject({ ok: false, error: 'validation' })
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

  it('answers 409 with the last editor for a stale version, and voids nothing', async () => {
    const nurse = actorOf(await makeUser('NAVIGATOR'))
    const supervisor = actorOf(await makeUser('SUPERVISOR'))
    const id = await openCase(nurse)

    const winner = await saveCase(nurse, id, draft({ mrn: '111333', version: 1 }), ctxFor(nurse.id))
    expect(winner).toMatchObject({ ok: true, version: 2 })

    const loser = await voidCase(supervisor, id, { version: 1, voidReason: 'opened twice' }, ctxFor(supervisor.id))
    expect(loser).toMatchObject({ ok: false, error: 'conflict', changedBy: nurse.displayName })

    const row = await prisma.case.findUniqueOrThrow({ where: { id } })
    expect(row.status).toBe('OPEN')
    expect(row.version).toBe(2)
    expect(row.voidReason).toBeNull()
    expect(await prisma.auditLog.count({ where: { entity: 'Case', entityId: id, action: 'case.void' } })).toBe(0)
    expect(await prisma.caseUpdate.count({ where: { caseId: id } })).toBe(0)
  })
})
