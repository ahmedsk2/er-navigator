import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { SYSTEM_USERNAME } from '../../../src/lib/auth/system-user'
import { E2E_USERS } from './seed-users'

/**
 * The two rows the Phase 6 browser spec cannot make through the UI: a queued "Other" description
 * waiting to be promoted, and a fired threshold alert waiting to be acknowledged. The worker is
 * not running during the suite, so its output is seeded exactly as the worker would write it —
 * Alert row plus the system user's CaseUpdate.
 *
 * Both cases belong to the e2e navigator, so `seedE2EUsers()` clears the previous run's copies
 * before this runs. Their MRNs start `330000`, which no other fixture or spec produces.
 */
const HOUR = 36e5

export const ADMIN_MRN_PREFIX = '330000'
export const PROMOTE_MRN = '3300001'
/** Acknowledged from `/admin/alerts`. */
export const ALERT_MRN = '3300002'
/** Acknowledged from the case editor's header, by a supervisor who never sees /admin. */
export const EDITOR_ALERT_MRN = '3300003'
export const EDITOR_ALERT_THRESHOLD_HOURS = 24

/** A second queued description nothing promotes, so the queue is never empty for a screenshot. */
export const KEPT_MRN = '3300004'
export const KEPT_TEXT = 'Interpreter unavailable to take consent'
export const KEPT_STAGE_CODE = 'dc'

/** The wording the queue must show and the promotion must turn into a reason. */
export const PROMOTE_TEXT = 'Ambulance bay blocked by a delivery lorry'
/** The stage that wording was typed under. */
export const PROMOTE_STAGE_CODE = 'adm'
export const ALERT_THRESHOLD_HOURS = 12

function ownerClient(): PrismaClient {
  const connectionString = process.env.E2E_OWNER_DATABASE_URL ?? process.env.DATABASE_URL
  if (!connectionString) throw new Error('[e2e] E2E_OWNER_DATABASE_URL or DATABASE_URL must be set')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

export async function seedAdminCases(): Promise<void> {
  const prisma = ownerClient()
  try {
    const [navigator, system] = await Promise.all([
      prisma.user.findUnique({ where: { username: E2E_USERS.navigator.username }, select: { id: true } }),
      prisma.user.findUnique({ where: { username: SYSTEM_USERNAME }, select: { id: true } }),
    ])
    if (!navigator) throw new Error('[e2e] seedE2EUsers() must run before seedAdminCases()')
    if (!system) throw new Error('[e2e] the seed must create the system user before seedAdminCases()')

    const stages = await prisma.stage.findMany({
      select: { id: true, code: true, reasons: { select: { id: true, name: true, isOther: true } } },
    })
    const stage = stages.find((s) => s.code === PROMOTE_STAGE_CODE)
    if (!stage) throw new Error(`[e2e] the seed has no "${PROMOTE_STAGE_CODE}" stage`)
    const otherReason = stage.reasons.find((r) => r.isOther)
    const plainReason = stage.reasons.find((r) => !r.isOther)
    if (!otherReason || !plainReason) throw new Error('[e2e] the stage needs an Other reason and a plain one')

    const keptStage = stages.find((s) => s.code === KEPT_STAGE_CODE)
    const keptOther = keptStage?.reasons.find((r) => r.isOther)
    if (!keptStage || !keptOther) throw new Error(`[e2e] the seed has no "${KEPT_STAGE_CODE}" stage`)

    // Anything the previous run promoted under this wording, so "Promote" creates it again.
    await prisma.reason.deleteMany({ where: { stageId: stage.id, name: PROMOTE_TEXT } })

    const now = Date.now()
    const ago = (hours: number): Date => new Date(now - hours * HOUR)

    // 1. A case whose Other text is waiting in the review queue.
    const queued = await prisma.case.create({
      data: {
        mrn: PROMOTE_MRN,
        registrationAt: ago(5),
        openedAt: ago(5),
        createdAt: ago(5),
        openedById: navigator.id,
        shift: 'MORNING',
        status: 'OPEN',
        primaryReasonId: otherReason.id,
        reasons: { create: [{ reasonId: otherReason.id, otherText: PROMOTE_TEXT }] },
      },
      select: { id: true },
    })
    await prisma.otherReview.create({
      data: { caseId: queued.id, stageId: stage.id, text: PROMOTE_TEXT, status: 'PENDING' },
    })

    // 1b. A second queued description, under a different stage, that no test acts on: the queue
    //     screenshot must have a row whatever order the specs run in.
    const kept = await prisma.case.create({
      data: {
        mrn: KEPT_MRN,
        registrationAt: ago(3),
        openedAt: ago(3),
        createdAt: ago(3),
        openedById: navigator.id,
        shift: 'EVENING',
        status: 'OPEN',
        primaryReasonId: keptOther.id,
        reasons: { create: [{ reasonId: keptOther.id, otherText: KEPT_TEXT }] },
      },
      select: { id: true },
    })
    await prisma.otherReview.create({
      data: { caseId: kept.id, stageId: keptStage.id, text: KEPT_TEXT, status: 'PENDING' },
    })

    // 2. A case the worker has already alerted on, unacknowledged, exactly as it would write it.
    const alerted = await prisma.case.create({
      data: {
        mrn: ALERT_MRN,
        registrationAt: ago(13),
        openedAt: ago(13),
        createdAt: ago(13),
        openedById: navigator.id,
        shift: 'NIGHT',
        status: 'OPEN',
        primaryReasonId: plainReason.id,
        reasons: { create: [{ reasonId: plainReason.id }] },
      },
      select: { id: true },
    })
    await prisma.alert.create({
      data: { caseId: alerted.id, thresholdHours: ALERT_THRESHOLD_HOURS, firedAt: ago(1) },
    })
    await prisma.caseUpdate.create({
      data: {
        caseId: alerted.id,
        authorId: system.id,
        createdAt: ago(1),
        text: `Reached ${ALERT_THRESHOLD_HOURS}h threshold`,
      },
    })

    // 3. A second alerted case, for the supervisor who acknowledges from the case editor rather
    //    than from /admin/alerts (which their role cannot open at all).
    const editorAlerted = await prisma.case.create({
      data: {
        mrn: EDITOR_ALERT_MRN,
        registrationAt: ago(26),
        openedAt: ago(26),
        createdAt: ago(26),
        openedById: navigator.id,
        shift: 'NIGHT',
        status: 'OPEN',
        primaryReasonId: plainReason.id,
        reasons: { create: [{ reasonId: plainReason.id }] },
      },
      select: { id: true },
    })
    await prisma.alert.create({
      data: {
        caseId: editorAlerted.id,
        thresholdHours: EDITOR_ALERT_THRESHOLD_HOURS,
        firedAt: ago(2),
      },
    })
    await prisma.caseUpdate.create({
      data: {
        caseId: editorAlerted.id,
        authorId: system.id,
        createdAt: ago(2),
        text: `Reached ${EDITOR_ALERT_THRESHOLD_HOURS}h threshold`,
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}
