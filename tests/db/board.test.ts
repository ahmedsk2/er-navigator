import { randomBytes } from 'node:crypto'
import type { Role, User } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuditContext } from '@/src/lib/audit'
import type { AuthUser } from '@/src/lib/auth/session'
import { loadBoard, loadBoardRows } from '@/src/lib/board/load'
import { countsOf } from '@/src/lib/board/rows'
import { loadReference } from '@/src/lib/cases/reference'
import { addCaseUpdate, createCase, resolveCase, voidCase } from '@/src/lib/cases/service'
import type { CaseDraft, ReferenceData } from '@/src/lib/cases/types'
import { prisma } from '@/src/lib/db'

/**
 * What `GET /api/board` reads, against a real Postgres and through the same service functions a
 * nurse drives. The 401 and the HTTP shape live in the browser suite (tests/e2e/board.spec.ts) —
 * the only place a route handler has a real cookie jar; this file covers the part that matters:
 * the query never returns a voided case, it honours `f`, and it carries what a row draws.
 *
 * Owner role, like the other database tests: the clean-up needs DELETE on Case and CaseUpdate,
 * which the app role deliberately does not have.
 */
const HOUR = 36e5
const users: string[] = []
const cases: string[] = []
let reference: ReferenceData
/** Every MRN this file writes shares a prefix, so an assertion can ignore every other suite's rows. */
const MRN_PREFIX = '96'
let nextMrn = 0

async function makeUser(role: Role): Promise<AuthUser> {
  const user: User = await prisma.user.create({
    data: {
      username: `p3test_${randomBytes(6).toString('hex')}`,
      passwordHash: 'not-a-real-hash',
      displayName: `Phase 3 ${role}`,
      role,
    },
  })
  users.push(user.id)
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active,
    lastShift: user.lastShift,
  }
}

const ctxFor = (id: string): AuditContext => ({ actorId: id, ip: '10.0.0.3', userAgent: 'vitest' })

function reasonNamed(code: string, name: string): string {
  const stage = reference.stages.find((s) => s.code === code)
  if (!stage) throw new Error(`the seed has no "${code}" stage`)
  const reason = stage.reasons.find((r) => r.name === name)
  if (!reason) throw new Error(`the seed has no "${name}" reason under "${code}"`)
  return reason.id
}

function nextTestMrn(): string {
  nextMrn += 1
  return `${MRN_PREFIX}${String(nextMrn).padStart(4, '0')}`
}

function draft(over: Partial<CaseDraft> = {}): CaseDraft {
  return {
    mrn: nextTestMrn(),
    registrationAt: new Date(Date.now() - 6 * HOUR).toISOString(),
    shift: 'MORNING',
    ctas: null,
    areaId: null,
    diagnosis: '',
    payer: null,
    stages: [],
    reasons: [{ reasonId: reasonNamed('adm', 'No bed available on accepting ward'), otherText: null }],
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
    ...over,
  }
}

/** Open a case and keep the exact draft, so a later resolve can send it back unchanged. */
/**
 * Every registration instant this file has opened a case at. `openRegistrations` is a list of
 * timestamps with no ids on it, so this is how a whole-database counts strip is narrowed to the
 * rows this file wrote — `Date.now()` is millisecond-precise, so no other suite can collide.
 */
const myRegistrations = new Set<string>()

async function openCase(actor: AuthUser, over: Partial<CaseDraft> = {}): Promise<{ id: string; input: CaseDraft }> {
  const input = draft(over)
  const result = await createCase(actor, input, ctxFor(actor.id))
  if (!result.ok) throw new Error(`expected the case to open, got ${JSON.stringify(result)}`)
  cases.push(result.id)
  myRegistrations.add(new Date(input.registrationAt).toISOString())
  return { id: result.id, input }
}

/** Only this file's rows: another suite may be writing to the same database. */
const mine = <T extends { mrn: string }>(rows: ReadonlyArray<T>): T[] =>
  rows.filter((row) => row.mrn.startsWith(MRN_PREFIX))

const myOpen = (registrations: ReadonlyArray<string>): string[] =>
  registrations.filter((iso) => myRegistrations.has(iso)).sort()

const mrnsOf = async (filter: 'open' | 'resolved' | 'all'): Promise<string[]> =>
  mine(await loadBoardRows(filter)).map((row) => row.mrn)

beforeAll(async () => {
  reference = await loadReference()
})

afterAll(async () => {
  if (cases.length > 0) {
    const updates = await prisma.caseUpdate.findMany({ where: { caseId: { in: cases } }, select: { id: true } })
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...cases, ...updates.map((u) => u.id)] } } })
    await prisma.otherReview.deleteMany({ where: { caseId: { in: cases } } })
    await prisma.caseUpdate.deleteMany({ where: { caseId: { in: cases } } })
    await prisma.caseReason.deleteMany({ where: { caseId: { in: cases } } })
    await prisma.caseConsult.deleteMany({ where: { caseId: { in: cases } } })
    await prisma.caseInvestigation.deleteMany({ where: { caseId: { in: cases } } })
    await prisma.case.deleteMany({ where: { id: { in: cases } } })
  }
  if (users.length > 0) {
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: users } }, { entityId: { in: users } }] } })
    await prisma.user.deleteMany({ where: { id: { in: users } } })
  }
  await prisma.$disconnect()
})

describe('loadBoardRows', () => {
  it('never returns a voided case, on any filter', async () => {
    const supervisor = await makeUser('SUPERVISOR')
    const kept = await openCase(supervisor)
    const gone = await openCase(supervisor)
    expect(
      await voidCase(supervisor, gone.id, { version: 1, voidReason: 'opened twice' }, ctxFor(supervisor.id)),
    ).toMatchObject({ ok: true })

    for (const filter of ['open', 'resolved', 'all'] as const) {
      expect(await mrnsOf(filter)).not.toContain(gone.input.mrn)
    }
    expect(await mrnsOf('open')).toContain(kept.input.mrn)
  })

  it('respects f: open, resolved and all each return their own set', async () => {
    const nurse = await makeUser('NAVIGATOR')
    const stillHere = await openCase(nurse)
    const finished = await openCase(nurse)
    expect(
      await resolveCase(
        nurse,
        finished.id,
        { ...finished.input, disposition: 'DISCHARGED_HOME', departedAt: new Date().toISOString() },
        ctxFor(nurse.id),
      ),
    ).toMatchObject({ ok: true })

    const open = await mrnsOf('open')
    const done = await mrnsOf('resolved')
    const all = await mrnsOf('all')

    expect(open).toContain(stillHere.input.mrn)
    expect(open).not.toContain(finished.input.mrn)
    expect(done).toContain(finished.input.mrn)
    expect(done).not.toContain(stillHere.input.mrn)
    expect(all).toEqual(expect.arrayContaining([stillHere.input.mrn, finished.input.mrn]))
  })

  it('carries the fields a row draws: reason, teams, ward, disposition and the newest update', async () => {
    const nurse = await makeUser('NAVIGATOR')
    const reasonId = reasonNamed('ref', 'Referral sent, awaiting acceptance')
    const medicine = reference.departments.find((d) => d.name === 'Internal Medicine')!
    const icu = reference.departments.find((d) => d.name === 'ICU')!
    const ward = reference.wards.find((w) => w.code === 'ICU')!

    const opened = await openCase(nurse, {
      registrationAt: new Date(Date.now() - 9 * HOUR).toISOString(),
      reasons: [{ reasonId, otherText: null }],
      primaryReasonId: reasonId,
      consults: [
        { departmentId: medicine.id, consultedAt: null, seenAt: null, repliedAt: null },
        { departmentId: icu.id, consultedAt: null, seenAt: null, repliedAt: null },
      ],
    })

    expect(await addCaseUpdate(nurse, opened.id, 'bed coordinator paged', ctxFor(nurse.id))).toMatchObject({ ok: true })
    const second = await addCaseUpdate(nurse, opened.id, 'ward says one hour', ctxFor(nurse.id))
    if (!second.ok) throw new Error('expected the second update to be written')

    const row = mine(await loadBoardRows('open')).find((r) => r.mrn === opened.input.mrn)!
    expect(row.primaryReason).toBe('Referral sent, awaiting acceptance')
    expect(row.departments).toEqual(['Internal Medicine', 'ICU'])
    expect(row.lastUpdateAt).toBe(second.update.createdAt)
    expect(row.status).toBe('OPEN')
    expect(row.ward).toBeNull()
    expect(row.disposition).toBeNull()

    expect(
      await resolveCase(
        nurse,
        opened.id,
        {
          ...opened.input,
          disposition: 'ADMITTED',
          wardId: ward.id,
          departedAt: new Date(Date.now() - 1 * HOUR).toISOString(),
        },
        ctxFor(nurse.id),
      ),
    ).toMatchObject({ ok: true })

    const done = mine(await loadBoardRows('resolved')).find((r) => r.mrn === opened.input.mrn)!
    expect(done.status).toBe('RESOLVED')
    expect(done.disposition).toBe('ADMITTED')
    expect(done.ward).toBe('ICU')
    expect(done.departedAt).not.toBeNull()
    expect(done.resolvedAt).not.toBeNull()
  })

  it('leaves a case with no reason and no updates as nulls rather than failing', async () => {
    const nurse = await makeUser('NAVIGATOR')
    const opened = await openCase(nurse)
    const row = mine(await loadBoardRows('open')).find((r) => r.mrn === opened.input.mrn)!
    expect(row.primaryReason).toBeNull()
    expect(row.departments).toEqual([])
    expect(row.lastUpdateAt).toBeNull()
    expect(row.createdAt).not.toBeNull()
  })
})

describe('loadBoard', () => {
  it('counts the same open cases on the Resolved tab as on the Open tab', async () => {
    const nurse = await makeUser('NAVIGATOR')
    await openCase(nurse, { registrationAt: new Date(Date.now() - 13 * HOUR).toISOString() })
    const now = new Date()

    const onOpen = await loadBoard('open', now)
    const onResolved = await loadBoard('resolved', now)

    expect(onOpen.filter).toBe('open')
    expect(onResolved.filter).toBe('resolved')
    // Narrowed to this file's own registrations: the suite shares one database, and another spec
    // file opening or resolving a case between the two loads would move a whole-database count
    // without saying anything about whether the counts strip is scoped to the open cases.
    expect(myOpen(onResolved.openRegistrations)).toEqual(myOpen(onOpen.openRegistrations))
    expect(countsOf(myOpen(onResolved.openRegistrations), now)).toEqual(
      countsOf(myOpen(onOpen.openRegistrations), now),
    )
    expect(countsOf(myOpen(onOpen.openRegistrations), now).past12).toBeGreaterThanOrEqual(1)
    expect(onOpen.now).toBe(now.toISOString())
    expect(onOpen.rows.every((row) => row.status === 'OPEN')).toBe(true)
    expect(onResolved.rows.every((row) => row.status === 'RESOLVED')).toBe(true)
  })
})
