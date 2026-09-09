/**
 * Promoting a queued "Other" description to a real reason, decided as a pure plan so the
 * re-tagging rule can be unit tested and then applied in one transaction.
 *
 * The spec: "creates a Reason under that stage or picks an existing active one; re-tags the
 * originating case: replaces its Other `CaseReason` for that stage with the new reason, clears
 * `otherText`, sets `primaryReasonId` to the new reason if the Other one was primary".
 *
 * Removing the Other `CaseReason` row is what clears `otherText` — the text lives on that row.
 */
export type PromotionPlan = {
  /** The case's Other reason rows for this stage, to delete. */
  removeReasonIds: string[]
  /** The new reason, unless the case already carries it. */
  addReasonId: string | null
  /** The primary reason after the promotion. */
  primaryReasonId: string | null
  /** True when the Other reason was the primary one and the new reason takes its place. */
  primaryMoved: boolean
}

export function planPromotion(input: {
  /** Every reasonId currently on the case. */
  caseReasonIds: ReadonlyArray<string>
  /** The "Other" reason ids that belong to the stage under review. */
  otherReasonIdsForStage: ReadonlyArray<string>
  primaryReasonId: string | null
  newReasonId: string
}): PromotionPlan {
  const others = new Set(input.otherReasonIdsForStage)
  const removeReasonIds = input.caseReasonIds.filter((id) => others.has(id))
  const addReasonId = input.caseReasonIds.includes(input.newReasonId) ? null : input.newReasonId
  const primaryMoved = input.primaryReasonId !== null && removeReasonIds.includes(input.primaryReasonId)
  return {
    removeReasonIds,
    addReasonId,
    primaryReasonId: primaryMoved ? input.newReasonId : input.primaryReasonId,
    primaryMoved,
  }
}

/** The name a promotion gives the new reason: what the admin typed, or the queued text. */
export function promotedName(typed: string | null | undefined, queuedText: string): string {
  const trimmed = (typed ?? '').trim()
  return trimmed.length > 0 ? trimmed : queuedText.trim()
}
