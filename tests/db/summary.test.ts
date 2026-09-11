import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { AuditContext } from '@/src/lib/audit'
import type { AuthUser } from '@/src/lib/auth/session'
import { blankDraft, loadCaseForEditor } from '@/src/lib/cases/load'
import { loadReference, loadReferenceForCase } from '@/src/lib/cases/reference'
import { createCase, resolveCase, saveCase } from '@/src/lib/cases/service'
import { summaryOf } from '@/src/lib/cases/summary'
import type { CaseDraft } from '@/src/lib/cases/types'
import { prisma } from '@/src/lib/db'

/**
 * The one path of the case summary that only a real database can walk (Phase 10 review): a
 * navigator clears "Left ED at" on a resolved case and saves. The draft's departure time is
 * nullable and `saveCase` refuses only a voided case, so the row is left RESOLVED with no
 * departure and its resolvedAt intact. `summary.test.ts` builds that loaded case by hand; this
 * proves the row really gets there, and that `loadCaseForEditor` hands resolvedAt over — without
 * it the summary reads "still in the ED" under a clock that never stops.
 *
 * Owner role, like the other database files: the clean-up needs DELETE on Case and CaseUpdate,
 * which the app role deliberately does not have. The MRN is this file's own (`97…`), a prefix no
 * other suite writes or counts.
 */
const HOUR = 36e5
const MRN = '971557'
const cases: string[] = []
let actor: AuthUser

const ctx = (): AuditContext => ({ actorId: actor.id, ip: '10.0.0.7', userAgent: 'vitest' })

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      username: `p10sum_${randomBytes(6).toString('hex')}`,
      passwordHash: 'not-a-real-hash',
      displayName: 'Phase 10 NAVIGATOR',
      role: 'NAVIGATOR',
    },
  })
  actor = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active,
    lastShift: user.lastShift,
    mustChangePassword: user.mustChangePassword,
  }
})

afterAll(async () => {
  const updates = await prisma.caseUpdate.findMany({ where: { caseId: { in: cases } }, select: { id: true } })
  await prisma.auditLog.deleteMany({
    where: { OR: [{ entityId: { in: [...cases, ...updates.map((u) => u.id)] } }, { actorId: actor.id }] },
  })
  await prisma.caseUpdate.deleteMany({ where: { caseId: { in: cases } } })
  await prisma.caseReason.deleteMany({ where: { caseId: { in: cases } } })
  await prisma.case.deleteMany({ where: { id: { in: cases } } })
  await prisma.user.deleteMany({ where: { id: actor.id } })
  await prisma.$disconnect()
})

it('ends the stay of a resolved case whose departure time was cleared at its resolution', async () => {
  const now = new Date()
  const reference = await loadReference()
  const reasonId = reference.stages
    .find((s) => s.code === 'reg')
    ?.reasons.find((r) => r.name === 'Registration desk/system delay')?.id
  if (!reasonId) throw new Error('the seed has no "Registration desk/system delay" reason')
  // blankDraft registers the patient six hours before `now`; they left two hours before it.
  const departed = new Date(now.getTime() - 2 * HOUR).toISOString()
  const draft = (over: Partial<CaseDraft>): CaseDraft => ({
    ...blankDraft({ now, shift: 'MORNING' }),
    mrn: MRN,
    reasons: [{ reasonId, otherText: null }],
    ...over,
  })

  const created = await createCase(actor, draft({}), ctx())
  if (!created.ok) throw new Error(`expected the case to open, got ${JSON.stringify(created)}`)
  cases.push(created.id)
  expect(
    await resolveCase(actor, created.id, draft({ disposition: 'DISCHARGED_HOME', departedAt: departed, version: 1 }), ctx()),
  ).toMatchObject({ ok: true, version: 2 })
  expect(
    await saveCase(actor, created.id, draft({ disposition: 'DISCHARGED_HOME', departedAt: null, version: 2 }), ctx()),
  ).toMatchObject({ ok: true, version: 3 })

  // The state itself: still RESOLVED, no departure, the resolution time kept.
  const row = await prisma.case.findUniqueOrThrow({ where: { id: created.id } })
  expect(row.status).toBe('RESOLVED')
  expect(row.departedAt).toBeNull()
  expect(row.resolvedAt?.toISOString()).toBe(departed)

  const loaded = await loadCaseForEditor(created.id, await loadReferenceForCase(created.id))
  if (!loaded) throw new Error('the case did not load')
  expect(loaded.draft.departedAt).toBeNull()
  expect(loaded.resolvedAt).toBe(departed)

  const summary = summaryOf(loaded, reference, now)
  expect(summary.leftAt).toBe(departed)
  expect(summary.elapsedHours).toBe(4)
  // A day later it has not moved: the stay ended when the case was resolved.
  expect(summaryOf(loaded, reference, new Date(now.getTime() + 24 * HOUR)).elapsedHours).toBe(4)
})
