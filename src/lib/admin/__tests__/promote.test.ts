import { describe, expect, it } from 'vitest'
import { planPromotion, promotedName } from '../promote'

const OTHER_DC = 'reason-other-dc'
const OTHER_INV = 'reason-other-inv'
const NEW = 'reason-new'
const KEEP = 'reason-awaiting-pharmacy'

describe('planPromotion', () => {
  it('replaces the stage Other tag with the new reason', () => {
    const plan = planPromotion({
      caseReasonIds: [KEEP, OTHER_DC],
      otherReasonIdsForStage: [OTHER_DC],
      primaryReasonId: KEEP,
      newReasonId: NEW,
    })
    expect(plan.removeReasonIds).toEqual([OTHER_DC])
    expect(plan.addReasonId).toBe(NEW)
    expect(plan.primaryReasonId).toBe(KEEP)
    expect(plan.primaryMoved).toBe(false)
  })

  it('moves the primary across when the Other reason was primary', () => {
    const plan = planPromotion({
      caseReasonIds: [OTHER_DC, KEEP],
      otherReasonIdsForStage: [OTHER_DC],
      primaryReasonId: OTHER_DC,
      newReasonId: NEW,
    })
    expect(plan.primaryReasonId).toBe(NEW)
    expect(plan.primaryMoved).toBe(true)
  })

  it('leaves another stage Other tag alone', () => {
    const plan = planPromotion({
      caseReasonIds: [OTHER_DC, OTHER_INV],
      otherReasonIdsForStage: [OTHER_DC],
      primaryReasonId: OTHER_INV,
      newReasonId: NEW,
    })
    expect(plan.removeReasonIds).toEqual([OTHER_DC])
    expect(plan.primaryReasonId).toBe(OTHER_INV)
    expect(plan.primaryMoved).toBe(false)
  })

  it('does not add the reason twice when the case already carries it', () => {
    const plan = planPromotion({
      caseReasonIds: [NEW, OTHER_DC],
      otherReasonIdsForStage: [OTHER_DC],
      primaryReasonId: OTHER_DC,
      newReasonId: NEW,
    })
    expect(plan.addReasonId).toBeNull()
    expect(plan.removeReasonIds).toEqual([OTHER_DC])
    expect(plan.primaryReasonId).toBe(NEW)
  })

  it('is a no-op on the case when the Other tag has already been edited away', () => {
    const plan = planPromotion({
      caseReasonIds: [KEEP],
      otherReasonIdsForStage: [OTHER_DC],
      primaryReasonId: KEEP,
      newReasonId: NEW,
    })
    expect(plan.removeReasonIds).toEqual([])
    expect(plan.addReasonId).toBe(NEW)
    expect(plan.primaryReasonId).toBe(KEEP)
  })
})

describe('promotedName', () => {
  it('defaults to the queued text', () => {
    expect(promotedName(null, '  Porter never came  ')).toBe('Porter never came')
    expect(promotedName('   ', 'Porter never came')).toBe('Porter never came')
  })

  it('prefers what the administrator typed', () => {
    expect(promotedName('  Transport delay ', 'Porter never came')).toBe('Transport delay')
  })
})
