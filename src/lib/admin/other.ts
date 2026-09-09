/**
 * Admin → the "Other" review queue. Anything a nurse typed into an Other box is queued here; an
 * administrator either promotes it to a real reason under its stage or dismisses it.
 *
 * Promotion is the interesting one, and it is one transaction (Phase 6 spec):
 *   - find or create an active Reason under that stage with the chosen name (default: the text),
 *     so promoting the same wording twice reuses the reason rather than making a second one;
 *   - re-tag the originating case: drop its Other CaseReason rows for that stage (which is what
 *     clears `otherText` — the text lives on that row), add the new reason, and move
 *     `primaryReasonId` across if the Other one was primary;
 *   - close the review as PROMOTED with the reviewer and the reason;
 *   - bump the case's `version`, because its reasons changed underneath anyone editing it — a
 *     stale save must get the usual 409 rather than silently re-adding the Other text.
 *
 * Dismissal closes the review and leaves the case exactly as it is: the nurse's wording stays.
 */
import { z } from 'zod'
import { audit, type AuditContext } from '@/src/lib/audit'
import { assertCan, type AuthUser } from '@/src/lib/auth/session'
import { prisma } from '@/src/lib/db'
import { nextSortOrder } from './reorder'
import { planPromotion, promotedName } from './promote'
import { fail, type AdminFailure } from './types'

export type OtherReviewRow = {
  id: string
  caseId: string
  mrn: string
  stageId: string
  stageName: string
  text: string
  /** The case's registration time, which is the date the wording is "from". */
  registrationAt: string
  status: 'PENDING' | 'PROMOTED' | 'DISMISSED'
  reviewedBy: string | null
  reviewedAt: string | null
  promotedReason: string | null
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

export async function loadOtherReviews(status: 'PENDING' | 'ALL' = 'PENDING'): Promise<OtherReviewRow[]> {
  const rows = await prisma.otherReview.findMany({
    where: status === 'PENDING' ? { status: 'PENDING' } : undefined,
    orderBy: [{ status: 'asc' }, { id: 'desc' }],
    take: 300,
    select: {
      id: true,
      caseId: true,
      stageId: true,
      text: true,
      status: true,
      reviewedAt: true,
      reviewedBy: { select: { displayName: true } },
      promotedReason: { select: { name: true } },
      stage: { select: { name: true } },
      case: { select: { mrn: true, registrationAt: true } },
    },
  })
  return rows.map((row) => ({
    id: row.id,
    caseId: row.caseId,
    mrn: row.case.mrn,
    stageId: row.stageId,
    stageName: row.stage.name,
    text: row.text,
    registrationAt: row.case.registrationAt.toISOString(),
    status: row.status,
    reviewedBy: row.reviewedBy?.displayName ?? null,
    reviewedAt: iso(row.reviewedAt),
    promotedReason: row.promotedReason?.name ?? null,
  }))
}

const promoteSchema = z.object({
  reviewId: z.string().min(1),
  name: z.string().trim().max(120).nullable().optional(),
})

/**
 * A refusal discovered inside the transaction. Returning the failure would commit whatever the
 * transaction had already written (a freshly created reason, say); throwing rolls it back.
 */
class Refusal extends Error {
  readonly failure: AdminFailure
  constructor(failure: AdminFailure) {
    super(failure.message)
    this.name = 'Refusal'
    this.failure = failure
  }
}

export type PromoteResult =
  | { ok: true; reasonId: string; reasonName: string; reused: boolean; caseId: string; primaryMoved: boolean }
  | AdminFailure

export async function promoteOther(
  actor: AuthUser,
  input: unknown,
  ctx: AuditContext,
): Promise<PromoteResult> {
  await assertCan(actor, 'admin.other.review', ctx)
  const parsed = promoteSchema.safeParse(input)
  if (!parsed.success) return fail('validation', 'Check the name and try again.')

  const review = await prisma.otherReview.findUnique({
    where: { id: parsed.data.reviewId },
    select: { id: true, caseId: true, stageId: true, text: true, status: true },
  })
  if (!review) return fail('missing', 'That queued description no longer exists.')
  if (review.status !== 'PENDING') return fail('missing', 'That description has already been reviewed.')

  const name = promotedName(parsed.data.name, review.text)
  if (name.length < 2) return fail('validation', 'Give the new reason a name of at least two characters.')
  if (name.toLowerCase() === 'other') {
    return fail('validation', 'Every stage already has an "Other" entry. Give the new reason its own name.')
  }

  const now = new Date()

  try {
    return await promoteInTransaction(actor, review, name, now, ctx)
  } catch (error) {
    if (error instanceof Refusal) return error.failure
    throw error
  }
}

type PendingReview = { id: string; caseId: string; stageId: string; text: string }

async function promoteInTransaction(
  actor: AuthUser,
  review: PendingReview,
  name: string,
  now: Date,
  ctx: AuditContext,
): Promise<PromoteResult> {
  return prisma.$transaction(async (tx): Promise<PromoteResult> => {
    // 1. The reason: reuse the stage's existing one with this name, or make it.
    const existing = await tx.reason.findFirst({
      where: { stageId: review.stageId, name },
      select: { id: true, active: true, isOther: true },
    })
    let reasonId: string
    let reused = false
    if (existing) {
      if (existing.isOther) {
        throw new Refusal(
          fail('validation', 'That is the stage’s own "Other" entry. Give the new reason its own name.'),
        )
      }
      reasonId = existing.id
      reused = true
      if (!existing.active) await tx.reason.update({ where: { id: existing.id }, data: { active: true } })
    } else {
      const siblings = await tx.reason.findMany({
        where: { stageId: review.stageId },
        select: { id: true, name: true, sortOrder: true },
      })
      const created = await tx.reason.create({
        data: { stageId: review.stageId, name, sortOrder: nextSortOrder(siblings), isOther: false },
        select: { id: true },
      })
      reasonId = created.id
    }

    // 2. The case: swap the Other tag for the real one.
    const target = await tx.case.findUnique({
      where: { id: review.caseId },
      select: { id: true, primaryReasonId: true, version: true, reasons: { select: { reasonId: true } } },
    })
    if (!target) {
      throw new Refusal(fail('missing', 'The case this description came from no longer exists.'))
    }

    const otherReasonIds = (
      await tx.reason.findMany({
        where: { stageId: review.stageId, isOther: true },
        select: { id: true },
      })
    ).map((r) => r.id)

    const plan = planPromotion({
      caseReasonIds: target.reasons.map((r) => r.reasonId),
      otherReasonIdsForStage: otherReasonIds,
      primaryReasonId: target.primaryReasonId,
      newReasonId: reasonId,
    })

    if (plan.addReasonId) {
      await tx.caseReason.create({ data: { caseId: target.id, reasonId: plan.addReasonId } })
    }
    if (plan.removeReasonIds.length > 0) {
      await tx.caseReason.deleteMany({
        where: { caseId: target.id, reasonId: { in: plan.removeReasonIds } },
      })
    }
    await tx.case.update({
      where: { id: target.id },
      data: { primaryReasonId: plan.primaryReasonId, version: { increment: 1 } },
    })

    // 3. The review itself.
    await tx.otherReview.update({
      where: { id: review.id },
      data: {
        status: 'PROMOTED',
        promotedReasonId: reasonId,
        reviewedById: actor.id,
        reviewedAt: now,
      },
    })

    await audit(
      {
        action: 'other.promote',
        entity: 'OtherReview',
        entityId: review.id,
        before: {
          caseId: review.caseId,
          stageId: review.stageId,
          text: review.text,
          status: 'PENDING',
          casePrimaryReasonId: target.primaryReasonId,
        },
        after: {
          status: 'PROMOTED',
          reasonId,
          reasonName: name,
          reasonReused: reused,
          caseId: review.caseId,
          casePrimaryReasonId: plan.primaryReasonId,
          removedReasonIds: plan.removeReasonIds,
        },
      },
      ctx,
      tx,
    )

    return {
      ok: true,
      reasonId,
      reasonName: name,
      reused,
      caseId: review.caseId,
      primaryMoved: plan.primaryMoved,
    }
  })
}

export type DismissResult = { ok: true } | AdminFailure

export async function dismissOther(
  actor: AuthUser,
  reviewId: string,
  ctx: AuditContext,
): Promise<DismissResult> {
  await assertCan(actor, 'admin.other.review', ctx)
  const review = await prisma.otherReview.findUnique({
    where: { id: reviewId },
    select: { id: true, caseId: true, stageId: true, text: true, status: true },
  })
  if (!review) return fail('missing', 'That queued description no longer exists.')
  if (review.status !== 'PENDING') return fail('missing', 'That description has already been reviewed.')

  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.otherReview.update({
      where: { id: reviewId },
      data: { status: 'DISMISSED', reviewedById: actor.id, reviewedAt: now },
    })
    await audit(
      {
        action: 'other.dismiss',
        entity: 'OtherReview',
        entityId: reviewId,
        before: { caseId: review.caseId, text: review.text, status: 'PENDING' },
        after: { status: 'DISMISSED', reviewedAt: now.toISOString() },
      },
      ctx,
      tx,
    )
  })
  return { ok: true }
}
