import { randomBytes } from 'node:crypto'
import type { Role, User } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuditContext } from '@/src/lib/audit'
import type { AuthUser } from '@/src/lib/auth/session'
import { loadBoardRowsByIds } from '@/src/lib/board/load'
import { loadReference } from '@/src/lib/cases/reference'
import { createCase, resolveCase, voidCase } from '@/src/lib/cases/service'
import type { CaseDraft, ReferenceData } from '@/src/lib/cases/types'
import { resolveDrill } from '@/src/lib/dashboard/drill'
import { loadCasesForStats } from '@/src/lib/dashboard/load'
import { prisma } from '@/src/lib/db'
import { dashboard } from '@/src/lib/domain/aggregates'

/**
 * What `/dashboard` reads, against a real Postgres and through the same service functions a nurse
 * drives. The mapper's unit test writes rows by hand; this proves the `select` actually produces
 * them — the stage join behind `stageNames`, the "Other" free text on `CaseReason`, the consult
 * departments and the investigation chain — and that a voided case never reaches the aggregates.
 *
 * Owner role, like the other database tests: the clean-up needs DELETE on Case, which the app
 * role deliberately does not have.
 */
const HOUR = 36e5
const users: string[] = []
const cases: string[] = []
let reference: ReferenceData
/** Every MRN this file writes shares a prefix, so it can ignore every other suite's rows. */
const MRN_PREFIX = '94'
let nextMrn = 0

async function makeUser(role: Role): Promise<AuthUser> {
  const user: User = await prisma.user.create({
    data: {
      username: `p4test_${randomBytes(6).toString('hex')}`,
      passwordHash: 'not-a-real-hash',
      displayName: `Phase 4 ${role}`,
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

const ctxFor = (id: string): AuditContext => ({ actorId: id, ip: '10.0.0.4', userAgent: 'vitest' })

function reasonNamed(code: string, name: string): string {
  const stage = reference.stages.find((s) => s.code === code)
  if (!stage) throw new Error(`the seed has no "${code}" stage`)
  const reason = stage.reasons.find((r) => r.name === name)
  if (!reason) throw new Error(`the seed has no "${name}" reason under "${code}"`)
  return reason.id
}

function otherReasonOf(code: string): string {
  const stage = reference.stages.find((s) => s.code === code)
  const reason = stage?.reasons.find((r) => r.isOther)
  if (!reason) throw new Error(`the seed has no Other reason under "${code}"`)
  return reason.id
}

const departmentNamed = (name: string): string => {
  const found = reference.departments.find((d) => d.name === name)
  if (!found) throw new Error(`the seed has no "${name}" department`)
  return found.id
}

function nextTestMrn(): string {
  nextMrn += 1
  return `${MRN_PREFIX}${String(nextMrn).padStart(4, '0')}`
}

function draft(over: Partial<CaseDraft> = {}): CaseDraft {
  return {
    mrn: nextTestMrn(),
    registrationAt: new Date(Date.now() - 8 * HOUR).toISOString(),
    shift: 'NIGHT',
    ctas: null,
    areaId: null,
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
    disposition: null,
    wardId: null,
    isolation: false,
    resolutionNote: '',
    version: 1,
    ...over,
  }
}

async function openCase(actor: AuthUser, over: Partial<CaseDraft> = {}): Promise<{ id: string; input: CaseDraft }> {
  const input = draft(over)
  const result = await createCase(actor, input, ctxFor(actor.id))
  if (!result.ok) throw new Error(`expected the case to open, got ${JSON.stringify(result)}`)
  cases.push(result.id)
  return { id: result.id, input }
}

/** Only this file's rows: another suite may be writing to the same database. */
const mine = <T extends { mrn: string }>(rows: ReadonlyArray<T>): T[] =>
  rows.filter((row) => row.mrn.startsWith(MRN_PREFIX))

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

describe('loadCasesForStats', () => {
  it('maps a real case, with its stages, teams, tests and Other text, into CaseForStats', async () => {
    const nurse = await makeUser('NAVIGATOR')
    const registrationAt = new Date(Date.now() - 9 * HOUR)
    const at = (hoursAfter: number) => new Date(registrationAt.getTime() + hoursAfter * HOUR).toISOString()
    const admission = reasonNamed('adm', 'No bed available on accepting ward')

    const { id, input } = await openCase(nurse, {
      registrationAt: registrationAt.toISOString(),
      shift: 'EVENING',
      reasons: [
        { reasonId: admission, otherText: null },
        // A second reason under the SAME stage: the case must still count once for that stage.
        { reasonId: reasonNamed('adm', 'Bed available, awaiting transport/porter'), otherText: null },
        { reasonId: reasonNamed('inv', 'Lab: delay in processing'), otherText: null },
        { reasonId: otherReasonOf('dc'), otherText: 'Pharmacy closed for stock take' },
      ],
      primaryReasonId: admission,
      consults: [
        {
          departmentId: departmentNamed('MROD'),
          consultedAt: at(1),
          seenAt: at(2),
          repliedAt: at(3),
        },
      ],
      investigations: [
        {
          type: 'LAB',
          orderedAt: at(0.5),
          collectedAt: at(1),
          receivedAt: at(1.5),
          doneAt: null,
          preliminaryAt: null,
          resultedAt: at(4),
        },
      ],
      admOrderAt: at(3),
      bedRequestedAt: at(3.5),
      bedAssignedAt: at(7),
    })

    const rows = mine(await loadCasesForStats())
    const row = rows.find((c) => c.id === id)
    expect(row, 'the case is in the dashboard read').toBeDefined()
    expect(row!.mrn).toBe(input.mrn)
    expect(row!.status).toBe('OPEN')
    expect(row!.shift).toBe('EVENING')
    expect(row!.primaryReasonName).toBe('No bed available on accepting ward')
    // Two reasons under "Admission process" collapse to one stage name, in taxonomy order.
    expect(row!.stageNames).toEqual(['Investigations', 'Admission process', 'Discharge process'])
    expect(row!.departmentNames).toEqual(['MROD'])
    expect(row!.consults).toHaveLength(1)
    expect(row!.consults[0]!.departmentName).toBe('MROD')
    expect(row!.investigations[0]!.type).toBe('LAB')
    expect(row!.otherTexts).toEqual([
      { stageName: 'Discharge process', text: 'Pharmacy closed for stock take' },
    ])
    expect(row!.admOrderAt).toBeInstanceOf(Date)

    // And the aggregates read it: one consult row, one lab row, one admission chain.
    const data = dashboard(rows, 'all', new Date())
    expect(data.consults.find((r) => r.name === 'MROD')?.ids).toContain(id)
    expect(data.investigations.find((r) => r.type === 'LAB')?.ids).toContain(id)
    expect(data.byStage.find((r) => r.name === 'Admission process')?.ids.filter((x) => x === id)).toEqual([id])
    expect(data.otherQueue.find((q) => q.id === id)?.text).toBe('Pharmacy closed for stock take')
  })

  it('never returns a voided case, so no drill-down can reach one', async () => {
    const supervisor = await makeUser('SUPERVISOR')
    const kept = await openCase(supervisor)
    const gone = await openCase(supervisor)
    expect(
      await voidCase(supervisor, gone.id, { version: 1, voidReason: 'opened twice' }, ctxFor(supervisor.id)),
    ).toMatchObject({ ok: true })

    const rows = mine(await loadCasesForStats())
    expect(rows.map((c) => c.id)).toContain(kept.id)
    expect(rows.map((c) => c.id)).not.toContain(gone.id)
  })

  it('feeds a drill-down whose ids load as board rows', async () => {
    const nurse = await makeUser('NAVIGATOR')
    const open = await openCase(nurse, { registrationAt: new Date(Date.now() - 26 * HOUR).toISOString() })
    const done = await openCase(nurse, { registrationAt: new Date(Date.now() - 30 * HOUR).toISOString() })
    expect(
      await resolveCase(
        nurse,
        done.id,
        {
          ...done.input,
          disposition: 'ADMITTED',
          wardId: reference.wards.find((w) => w.code === 'ICU')!.id,
          departedAt: new Date(Date.now() - 5 * HOUR).toISOString(),
        },
        ctxFor(nurse.id),
      ),
    ).toMatchObject({ ok: true })

    const data = dashboard(await loadCasesForStats(), 'all', new Date())
    const drill = resolveDrill(data, { section: 'threshold', name: '24' })
    expect(drill?.label).toBe('Cases over 24h')
    expect(drill!.ids).toContain(open.id)
    expect(drill!.ids).toContain(done.id)

    const rows = await loadBoardRowsByIds(drill!.ids)
    const shown = mine(rows).map((r) => r.mrn)
    expect(shown).toContain(open.input.mrn)
    expect(shown).toContain(done.input.mrn)
    // The list a drill-down renders carries what a board row draws.
    expect(rows.find((r) => r.id === done.id)).toMatchObject({ status: 'RESOLVED', disposition: 'ADMITTED' })
  })

  it('returns nothing for an empty id list rather than the whole board', async () => {
    expect(await loadBoardRowsByIds([])).toEqual([])
  })
})
