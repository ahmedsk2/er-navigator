/**
 * The case mutations, without the Next request plumbing (the same split Phase 1 used for
 * `attemptLogin`): each function takes the actor, the input and an audit context, and does
 * permission check -> zod -> one transaction -> audit row. `app/cases/actions.ts` is the thin
 * server-action wrapper that supplies the session and revalidates; `tests/db/cases.test.ts`
 * drives these directly against a real Postgres.
 *
 * Locked plan section 4:
 *  - every case mutation carries `version`; `UPDATE ... WHERE id = ? AND version = ?` and zero
 *    affected rows means 409 with the last editor's name and time. Never a merge.
 *  - `CaseUpdate` and `AuditLog` are append-only and there is no delete path for a `Case`.
 *  - out-of-order timestamps warn, they never block a save.
 */
import type { Prisma } from '@prisma/client'
import type { z } from 'zod'
import { audit, type AuditContext } from '@/src/lib/audit'
import { assertCan, type AuthUser } from '@/src/lib/auth/session'
import { prisma } from '@/src/lib/db'
import { DISPOSITION_LABELS } from '@/src/lib/domain/taxonomy'
import {
  buildCaseSchemas,
  phiWarnings,
  updateActionSchema,
  updateTextSchema,
  voidSchema,
  type CaseDraft as ValidatedDraft,
} from '@/src/lib/domain/validation'
import { conflictInfoFrom } from './conflict'
import { diffRows } from './diff'
import { caseSchemas, loadReference, loadReferenceForCase, reasonMetaOf, stageOfReason } from './reference'
import { caseSnapshot } from './snapshot'
import type {
  ActionFailure,
  AddUpdateResult,
  CaseUpdateView,
  CreateCaseResult,
  ReferenceData,
  ReopenCaseResult,
  ResolveCaseResult,
  ReviewCaseResult,
  SaveCaseResult,
  ValidationIssue,
  VoidCaseResult,
} from './types'

type ValidatedResolve = z.output<ReturnType<typeof buildCaseSchemas>['resolve']>

/** Everything the snapshot and the editor need, in one read. */
const WITH_CHILDREN = { reasons: true, consults: true, investigations: true } as const
type CaseWithChildren = Prisma.CaseGetPayload<{ include: typeof WITH_CHILDREN }>

// --- small helpers --------------------------------------------------------------------------

function issuesOf(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }))
}

function fail(issues: ValidationIssue[]): ActionFailure {
  return { ok: false, error: 'validation', issues }
}

function blankToNull(v: string | null | undefined): string | null {
  const t = v?.trim()
  return t ? t : null
}

/** Who last changed this case, and when: the newest `AuditLog` row for it, actor name joined. */
async function conflictFailure(caseId: string): Promise<ActionFailure> {
  const [row, current] = await Promise.all([
    prisma.auditLog.findFirst({
      where: { entity: 'Case', entityId: caseId },
      orderBy: { at: 'desc' },
      select: { at: true, actor: { select: { displayName: true } } },
    }),
    prisma.case.findUnique({ where: { id: caseId }, select: { updatedAt: true } }),
  ])
  const info = conflictInfoFrom(row, current?.updatedAt ?? new Date())
  return { ok: false, error: 'conflict', changedBy: info.changedBy, changedAt: info.changedAt.toISOString() }
}

const MISSING = fail([{ path: '', message: 'This case no longer exists.' }])
const VOIDED = fail([{ path: '', message: 'This case is voided and cannot be changed.' }])

function updateView(row: {
  id: string
  createdAt: Date
  text: string
  action: CaseUpdateView['action']
  author: { displayName: string }
}): CaseUpdateView {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    text: row.text,
    author: row.author.displayName,
    action: row.action,
  }
}

/** The `select` every function here uses to build a `CaseUpdateView`. */
const UPDATE_VIEW_SELECT = {
  id: true,
  createdAt: true,
  text: true,
  action: true,
  author: { select: { displayName: true } },
} as const

/**
 * Reference ids the zod factory does not police: a stale editor could post a department or ward
 * that an Admin has since deactivated, and a raw foreign-key violation would surface as a 500.
 *
 * On an existing case `reference` is the case-aware one (`loadReferenceForCase`), so a row this
 * case already carries passes even after it is deactivated; a retired row it does NOT carry is
 * absent from that reference and is still refused. `createCase` passes the strict active-only
 * list, so a new case can never be opened on a retired row.
 *
 * The ED area is policed by the same reference, but one layer up: `caseSchemas(reference)` hands
 * its area ids to `buildCaseSchemas`, so an unknown `areaId` is a zod issue on the `areaId` path
 * rather than a check here (src/lib/domain/validation.ts).
 */
function checkReferenceIds(d: ValidatedDraft, reference: ReferenceData): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const departments = new Set(reference.departments.map((x) => x.id))
  for (const [i, c] of d.consults.entries()) {
    if (!departments.has(c.departmentId)) {
      issues.push({ path: `consults.${i}.departmentId`, message: 'That team is no longer on the list.' })
    }
  }
  const wardId = blankToNull(d.wardId)
  if (wardId && !reference.wards.some((w) => w.id === wardId)) {
    issues.push({ path: 'wardId', message: 'That ward is no longer on the list.' })
  }
  return issues
}

/** The Case columns a draft owns. Status, version, opener and resolvedAt are set by the caller. */
function caseScalarData(d: ValidatedDraft) {
  return {
    mrn: d.mrn,
    registrationAt: d.registrationAt,
    shift: d.shift ?? null,
    ctas: d.ctas ?? null,
    areaId: blankToNull(d.areaId),
    primaryReasonId: d.primaryReasonId ?? null,
    roomType: d.roomType ?? null,
    triageAt: d.triageAt ?? null,
    roomAt: d.roomAt ?? null,
    physicianAt: d.physicianAt ?? null,
    decisionAt: d.decisionAt ?? null,
    departedAt: d.departedAt ?? null,
    admOrderAt: d.admOrderAt ?? null,
    bedRequestedAt: d.bedRequestedAt ?? null,
    bedAssignedAt: d.bedAssignedAt ?? null,
    handoverAt: d.handoverAt ?? null,
    transferRequestedAt: d.transferRequestedAt ?? null,
    transferAcceptedAt: d.transferAcceptedAt ?? null,
    transportArrivedAt: d.transportArrivedAt ?? null,
    referralTrackingNo: blankToNull(d.referralTrackingNo),
    transferFacility: blankToNull(d.transferFacility),
    medAdminInformedAt: d.medAdminInformedAt ?? null,
    // Phase 8b (docs/specs/phase8b-decisions.md). Nullish-coalesced like every other optional
    // column, so leaving a chip row untouched clears the stored value rather than keeping a
    // stale one — the same behaviour CTAS and the ED area have.
    painkillerPrescribed: d.painkillerPrescribed ?? null,
    pethidinePrescribed: d.pethidinePrescribed ?? null,
    pethidineDoseMg: d.pethidineDoseMg ?? null,
    painkillerAt: d.painkillerAt ?? null,
    sickleCellTreatment: d.sickleCellTreatment ?? null,
    instructionsGiven: d.instructionsGiven ?? null,
    familyEngagement: d.familyEngagement ?? null,
    caseMgmtReferral: d.caseMgmtReferral ?? null,
    caseMgmtCriteria: d.caseMgmtCriteria ?? null,
    caseMgmtAction: d.caseMgmtAction ?? null,
    caseMgmtCalledAt: d.caseMgmtCalledAt ?? null,
    caseMgmtRepliedAt: d.caseMgmtRepliedAt ?? null,
    disposition: d.disposition ?? null,
    wardId: blankToNull(d.wardId),
    isolation: d.isolation,
    resolutionNote: blankToNull(d.resolutionNote),
  }
}

/**
 * What `saveCase` and `resolveCase` add to `caseScalarData`: the review, cleared (Phase 8b,
 * decision H). A supervisor signs off on the case as it stood when they read it; the moment
 * somebody edits it afterwards that signature no longer describes anything, so it goes and the
 * case shows as unreviewed again. `addCaseUpdate`, `reopenCase` and `voidCase` leave it alone —
 * none of them changes what was reviewed (an update is an addition, and a reopen and a void are
 * about the case's standing, not its content).
 */
const CLEARS_REVIEW = { reviewedAt: null, reviewedById: null } as const

/** "Other" text belongs only to an "Other" reason; anything else is dropped. */
function otherTextsByStage(d: ValidatedDraft, reference: ReferenceData): Map<string, string> {
  const meta = reasonMetaOf(reference)
  const owner = stageOfReason(reference)
  const out = new Map<string, string>()
  for (const r of d.reasons) {
    if (!meta.get(r.reasonId)?.isOther) continue
    const text = r.otherText?.trim()
    const stage = owner.get(r.reasonId)
    if (text && stage) out.set(stage.id, text)
  }
  return out
}

function reasonRowData(d: ValidatedDraft, reference: ReferenceData) {
  const meta = reasonMetaOf(reference)
  return d.reasons.map((r) => ({
    reasonId: r.reasonId,
    otherText: meta.get(r.reasonId)?.isOther ? blankToNull(r.otherText) : null,
  }))
}

// --- child rows and the "Other" review queue --------------------------------------------------

/**
 * Replace the three child collections with a diff rather than a delete-all/insert-all, and keep
 * the pending "Other" review queue in step: selecting Other with text queues a review, editing
 * the text updates the pending one, deselecting the reason deletes it (locked plan section 4).
 * A review an Admin has already promoted or dismissed is history and is left alone.
 */
async function applyChildren(
  tx: Prisma.TransactionClient,
  caseId: string,
  d: ValidatedDraft,
  reference: ReferenceData,
  before: CaseWithChildren,
): Promise<void> {
  const reasons = diffRows(
    before.reasons.map((r) => r.reasonId),
    reasonRowData(d, reference),
    (r) => r.reasonId,
  )
  if (reasons.removed.length > 0) {
    await tx.caseReason.deleteMany({ where: { caseId, reasonId: { in: reasons.removed } } })
  }
  for (const r of reasons.kept) {
    await tx.caseReason.update({
      where: { caseId_reasonId: { caseId, reasonId: r.reasonId } },
      data: { otherText: r.otherText },
    })
  }
  if (reasons.added.length > 0) {
    await tx.caseReason.createMany({ data: reasons.added.map((r) => ({ caseId, ...r })) })
  }

  const consults = diffRows(
    before.consults.map((c) => c.departmentId),
    d.consults,
    (c) => c.departmentId,
  )
  if (consults.removed.length > 0) {
    await tx.caseConsult.deleteMany({ where: { caseId, departmentId: { in: consults.removed } } })
  }
  for (const c of consults.kept) {
    await tx.caseConsult.update({
      where: { caseId_departmentId: { caseId, departmentId: c.departmentId } },
      data: { consultedAt: c.consultedAt ?? null, seenAt: c.seenAt ?? null, repliedAt: c.repliedAt ?? null },
    })
  }
  if (consults.added.length > 0) {
    await tx.caseConsult.createMany({
      data: consults.added.map((c) => ({
        caseId,
        departmentId: c.departmentId,
        consultedAt: c.consultedAt ?? null,
        seenAt: c.seenAt ?? null,
        repliedAt: c.repliedAt ?? null,
      })),
    })
  }

  const investigations = diffRows(
    before.investigations.map((i) => i.type),
    d.investigations,
    (i) => i.type,
  )
  if (investigations.removed.length > 0) {
    await tx.caseInvestigation.deleteMany({ where: { caseId, type: { in: investigations.removed } } })
  }
  for (const i of investigations.kept) {
    await tx.caseInvestigation.update({
      where: { caseId_type: { caseId, type: i.type } },
      data: {
        orderedAt: i.orderedAt ?? null,
        collectedAt: i.collectedAt ?? null,
        receivedAt: i.receivedAt ?? null,
        doneAt: i.doneAt ?? null,
        preliminaryAt: i.preliminaryAt ?? null,
        resultedAt: i.resultedAt ?? null,
      },
    })
  }
  if (investigations.added.length > 0) {
    await tx.caseInvestigation.createMany({
      data: investigations.added.map((i) => ({
        caseId,
        type: i.type,
        orderedAt: i.orderedAt ?? null,
        collectedAt: i.collectedAt ?? null,
        receivedAt: i.receivedAt ?? null,
        doneAt: i.doneAt ?? null,
        preliminaryAt: i.preliminaryAt ?? null,
        resultedAt: i.resultedAt ?? null,
      })),
    })
  }

  await syncOtherReviews(tx, caseId, otherTextsByStage(d, reference))
}

async function syncOtherReviews(
  tx: Prisma.TransactionClient,
  caseId: string,
  wanted: Map<string, string>,
): Promise<void> {
  const existing = await tx.otherReview.findMany({ where: { caseId } })

  const stale = existing.filter((r) => r.status === 'PENDING' && !wanted.has(r.stageId))
  if (stale.length > 0) {
    await tx.otherReview.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } })
  }

  for (const [stageId, text] of wanted) {
    const forStage = existing.filter((r) => r.stageId === stageId)
    const pending = forStage.find((r) => r.status === 'PENDING')
    if (pending) {
      if (pending.text !== text) await tx.otherReview.update({ where: { id: pending.id }, data: { text } })
      continue
    }
    // No pending row: queue one, unless an Admin already reviewed this exact wording.
    if (!forStage.some((r) => r.text === text)) {
      await tx.otherReview.create({ data: { caseId, stageId, text, status: 'PENDING' } })
    }
  }
}

// --- 1. create ---------------------------------------------------------------------------------

export async function createCase(
  actor: AuthUser,
  input: unknown,
  ctx: AuditContext,
): Promise<CreateCaseResult> {
  await assertCan(actor, 'case.create', ctx)
  const reference = await loadReference()
  const parsed = caseSchemas(reference).draft.safeParse(input)
  if (!parsed.success) return fail(issuesOf(parsed.error))
  const d = parsed.data

  const referenceIssues = checkReferenceIds(d, reference)
  if (referenceIssues.length > 0) return fail(referenceIssues)

  const otherTexts = otherTextsByStage(d, reference)

  const id = await prisma.$transaction(async (tx) => {
    const created = await tx.case.create({
      data: {
        ...caseScalarData(d),
        openedById: actor.id,
        openedAt: new Date(),
        status: 'OPEN',
        version: 1,
        reasons: { create: reasonRowData(d, reference) },
        consults: {
          create: d.consults.map((c) => ({
            departmentId: c.departmentId,
            consultedAt: c.consultedAt ?? null,
            seenAt: c.seenAt ?? null,
            repliedAt: c.repliedAt ?? null,
          })),
        },
        investigations: {
          create: d.investigations.map((i) => ({
            type: i.type,
            orderedAt: i.orderedAt ?? null,
            collectedAt: i.collectedAt ?? null,
            receivedAt: i.receivedAt ?? null,
            doneAt: i.doneAt ?? null,
            preliminaryAt: i.preliminaryAt ?? null,
            resultedAt: i.resultedAt ?? null,
          })),
        },
        otherReviews: {
          create: [...otherTexts].map(([stageId, text]) => ({ stageId, text, status: 'PENDING' as const })),
        },
      },
      include: WITH_CHILDREN,
    })
    // The next new case starts on the shift this one was opened on (plan section 5.3).
    if (d.shift) await tx.user.update({ where: { id: actor.id }, data: { lastShift: d.shift } })
    await audit(
      { action: 'case.create', entity: 'Case', entityId: created.id, after: caseSnapshot(created) },
      ctx,
      tx,
    )
    return created.id
  })

  return { ok: true, id }
}

// --- 2. save -----------------------------------------------------------------------------------

type Outcome<T> = { kind: 'ok'; value: T } | { kind: 'conflict' } | { kind: 'missing' } | { kind: 'voided' }

export async function saveCase(
  actor: AuthUser,
  caseId: string,
  input: unknown,
  ctx: AuditContext,
): Promise<SaveCaseResult> {
  await assertCan(actor, 'case.edit', ctx)
  const reference = await loadReferenceForCase(caseId)
  const parsed = caseSchemas(reference).draft.safeParse(input)
  if (!parsed.success) return fail(issuesOf(parsed.error))
  const d = parsed.data

  const referenceIssues = checkReferenceIds(d, reference)
  if (referenceIssues.length > 0) return fail(referenceIssues)

  const outcome = await prisma.$transaction(async (tx): Promise<Outcome<number>> => {
    const before = await tx.case.findUnique({ where: { id: caseId }, include: WITH_CHILDREN })
    if (!before) return { kind: 'missing' }

    const touched = await tx.case.updateMany({
      where: { id: caseId, version: d.version, status: { not: 'VOIDED' } },
      data: { ...caseScalarData(d), ...CLEARS_REVIEW, version: { increment: 1 } },
    })
    if (touched.count === 0) return { kind: 'conflict' }

    await applyChildren(tx, caseId, d, reference, before)
    const after = await tx.case.findUniqueOrThrow({ where: { id: caseId }, include: WITH_CHILDREN })
    await audit(
      {
        action: 'case.update',
        entity: 'Case',
        entityId: caseId,
        before: caseSnapshot(before),
        after: caseSnapshot(after),
      },
      ctx,
      tx,
    )
    if (d.shift) await tx.user.update({ where: { id: actor.id }, data: { lastShift: d.shift } })
    return { kind: 'ok', value: after.version }
  })

  if (outcome.kind === 'missing') return MISSING
  if (outcome.kind === 'voided') return VOIDED
  if (outcome.kind === 'conflict') return conflictFailure(caseId)
  return { ok: true, version: outcome.value }
}

// --- 3. add an update --------------------------------------------------------------------------

/**
 * Append-only, so no version check: two nurses adding an update at the same moment both succeed
 * (locked plan section 4). The identifier warning is advisory — the row is kept either way.
 *
 * Phase 8b, decision C: an update may carry one of the weekly deck's six action categories. It is
 * written with the row and there is no path that changes it afterwards, which is what keeps this
 * table append-only; leaving it off is the ordinary case and never refused. A review the case
 * already carries is untouched — an update adds to the record, it does not change what was read.
 */
export async function addCaseUpdate(
  actor: AuthUser,
  caseId: string,
  text: unknown,
  ctx: AuditContext,
  action?: unknown,
): Promise<AddUpdateResult> {
  await assertCan(actor, 'case.update.add', ctx)
  const parsed = updateTextSchema.safeParse(text)
  if (!parsed.success) return fail(issuesOf(parsed.error))
  const parsedAction = updateActionSchema.safeParse(action)
  if (!parsedAction.success) return fail(issuesOf(parsedAction.error))
  const tag = parsedAction.data ?? null

  const outcome = await prisma.$transaction(async (tx): Promise<Outcome<CaseUpdateView>> => {
    const target = await tx.case.findUnique({ where: { id: caseId }, select: { status: true } })
    if (!target) return { kind: 'missing' }
    if (target.status === 'VOIDED') return { kind: 'voided' }

    const row = await tx.caseUpdate.create({
      data: { caseId, authorId: actor.id, text: parsed.data, action: tag },
      select: UPDATE_VIEW_SELECT,
    })
    await audit(
      {
        action: 'case.update.add',
        entity: 'CaseUpdate',
        entityId: row.id,
        after: { caseId, text: parsed.data, action: tag },
      },
      ctx,
      tx,
    )
    return { kind: 'ok', value: updateView(row) }
  })

  if (outcome.kind === 'missing') return MISSING
  if (outcome.kind === 'voided') return VOIDED
  if (outcome.kind === 'conflict') return conflictFailure(caseId)
  return { ok: true, update: outcome.value, warnings: phiWarnings('This update', parsed.data) }
}

// --- 4. resolve --------------------------------------------------------------------------------

export async function resolveCase(
  actor: AuthUser,
  caseId: string,
  input: unknown,
  ctx: AuditContext,
): Promise<ResolveCaseResult> {
  await assertCan(actor, 'case.resolve', ctx)
  const reference = await loadReferenceForCase(caseId)
  const parsed = caseSchemas(reference).resolve.safeParse(input)
  if (!parsed.success) return fail(issuesOf(parsed.error))
  const d: ValidatedResolve = parsed.data

  const referenceIssues = checkReferenceIds(d, reference)
  if (referenceIssues.length > 0) return fail(referenceIssues)

  const outcome = await prisma.$transaction(
    async (tx): Promise<Outcome<{ version: number; update: CaseUpdateView }>> => {
      const before = await tx.case.findUnique({ where: { id: caseId }, include: WITH_CHILDREN })
      if (!before) return { kind: 'missing' }

      const touched = await tx.case.updateMany({
        where: { id: caseId, version: d.version, status: { not: 'VOIDED' } },
        data: {
          ...caseScalarData(d),
          ...CLEARS_REVIEW,
          status: 'RESOLVED',
          departedAt: d.departedAt,
          resolvedAt: d.departedAt,
          version: { increment: 1 },
        },
      })
      if (touched.count === 0) return { kind: 'conflict' }

      await applyChildren(tx, caseId, d, reference, before)
      const row = await tx.caseUpdate.create({
        data: { caseId, authorId: actor.id, text: `Resolved: ${DISPOSITION_LABELS[d.disposition]}` },
        select: UPDATE_VIEW_SELECT,
      })
      const after = await tx.case.findUniqueOrThrow({ where: { id: caseId }, include: WITH_CHILDREN })
      await audit(
        {
          action: 'case.resolve',
          entity: 'Case',
          entityId: caseId,
          before: caseSnapshot(before),
          after: caseSnapshot(after),
        },
        ctx,
        tx,
      )
      if (d.shift) await tx.user.update({ where: { id: actor.id }, data: { lastShift: d.shift } })
      return { kind: 'ok', value: { version: after.version, update: updateView(row) } }
    },
  )

  if (outcome.kind === 'missing') return MISSING
  if (outcome.kind === 'voided') return VOIDED
  if (outcome.kind === 'conflict') return conflictFailure(caseId)
  return { ok: true, version: outcome.value.version, update: outcome.value.update }
}

// --- 5. reopen ---------------------------------------------------------------------------------

/** `departedAt` stays as entered; the prototype's reopen clears only `resolvedAt`. */
export async function reopenCase(
  actor: AuthUser,
  caseId: string,
  version: number,
  ctx: AuditContext,
): Promise<ReopenCaseResult> {
  await assertCan(actor, 'case.reopen', ctx)

  const outcome = await prisma.$transaction(
    async (tx): Promise<Outcome<{ version: number; update: CaseUpdateView }>> => {
      const before = await tx.case.findUnique({ where: { id: caseId }, include: WITH_CHILDREN })
      if (!before) return { kind: 'missing' }

      const touched = await tx.case.updateMany({
        where: { id: caseId, version, status: { not: 'VOIDED' } },
        data: { status: 'OPEN', resolvedAt: null, version: { increment: 1 } },
      })
      if (touched.count === 0) return { kind: 'conflict' }

      const row = await tx.caseUpdate.create({
        data: { caseId, authorId: actor.id, text: 'Reopened' },
        select: UPDATE_VIEW_SELECT,
      })
      const after = await tx.case.findUniqueOrThrow({ where: { id: caseId }, include: WITH_CHILDREN })
      await audit(
        {
          action: 'case.reopen',
          entity: 'Case',
          entityId: caseId,
          before: caseSnapshot(before),
          after: caseSnapshot(after),
        },
        ctx,
        tx,
      )
      return { kind: 'ok', value: { version: after.version, update: updateView(row) } }
    },
  )

  if (outcome.kind === 'missing') return MISSING
  if (outcome.kind === 'voided') return VOIDED
  if (outcome.kind === 'conflict') return conflictFailure(caseId)
  return { ok: true, version: outcome.value.version, update: outcome.value.update }
}

// --- 6. void -----------------------------------------------------------------------------------

/** The prototype's Delete. There is no delete path: a case is voided with a reason, and stays. */
export async function voidCase(
  actor: AuthUser,
  caseId: string,
  input: unknown,
  ctx: AuditContext,
): Promise<VoidCaseResult> {
  await assertCan(actor, 'case.void', ctx)
  const parsed = voidSchema.safeParse(input)
  if (!parsed.success) return fail(issuesOf(parsed.error))
  const { version, voidReason } = parsed.data

  const outcome = await prisma.$transaction(async (tx): Promise<Outcome<number>> => {
    const before = await tx.case.findUnique({ where: { id: caseId }, include: WITH_CHILDREN })
    if (!before) return { kind: 'missing' }

    const touched = await tx.case.updateMany({
      where: { id: caseId, version, status: { not: 'VOIDED' } },
      data: { status: 'VOIDED', voidReason, version: { increment: 1 } },
    })
    if (touched.count === 0) return { kind: 'conflict' }

    await tx.caseUpdate.create({ data: { caseId, authorId: actor.id, text: `Voided: ${voidReason}` } })
    const after = await tx.case.findUniqueOrThrow({ where: { id: caseId }, include: WITH_CHILDREN })
    await audit(
      {
        action: 'case.void',
        entity: 'Case',
        entityId: caseId,
        before: caseSnapshot(before),
        after: caseSnapshot(after),
      },
      ctx,
      tx,
    )
    return { kind: 'ok', value: after.version }
  })

  if (outcome.kind === 'missing') return MISSING
  if (outcome.kind === 'voided') return VOIDED
  if (outcome.kind === 'conflict') return conflictFailure(caseId)
  return { ok: true, version: outcome.value }
}

// --- 7. mark reviewed ---------------------------------------------------------------------------

/**
 * Phase 8b, decision H: a SUPERVISOR or an ADMIN signs a case off as read.
 *
 * Deliberately NOT version-checked, and it does not bump the version. Marking a case reviewed
 * changes no case content, so there is nothing for two people to disagree about and nothing an
 * open editor's draft could be stale against — a 409 here would only be a puzzle. It is
 * idempotent for the same reason: marking an already-reviewed case again simply moves the time
 * and the name to whoever read it last, which is what a second reading actually is.
 *
 * A voided case is still refused, because a voided case is refused everywhere.
 */
export async function reviewCase(
  actor: AuthUser,
  caseId: string,
  ctx: AuditContext,
): Promise<ReviewCaseResult> {
  await assertCan(actor, 'case.review', ctx)

  const outcome = await prisma.$transaction(async (tx): Promise<Outcome<Date>> => {
    const before = await tx.case.findUnique({
      where: { id: caseId },
      select: { status: true, reviewedAt: true, reviewedById: true },
    })
    if (!before) return { kind: 'missing' }
    if (before.status === 'VOIDED') return { kind: 'voided' }

    const reviewedAt = new Date()
    await tx.case.update({ where: { id: caseId }, data: { reviewedAt, reviewedById: actor.id } })
    await audit(
      {
        action: 'case.review',
        entity: 'Case',
        entityId: caseId,
        before: { reviewedAt: before.reviewedAt?.toISOString() ?? null, reviewedById: before.reviewedById },
        after: { reviewedAt: reviewedAt.toISOString(), reviewedById: actor.id },
      },
      ctx,
      tx,
    )
    return { kind: 'ok', value: reviewedAt }
  })

  if (outcome.kind === 'missing') return MISSING
  if (outcome.kind === 'voided') return VOIDED
  if (outcome.kind === 'conflict') return conflictFailure(caseId)
  return { ok: true, reviewedAt: outcome.value.toISOString(), reviewedByName: actor.displayName }
}
