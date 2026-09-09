import { describe, expect, it } from 'vitest'
import { caseSnapshot, type SnapshotSource } from '../snapshot'

const REG = new Date('2026-09-09T05:00:00.000Z')

function source(overrides: Partial<SnapshotSource> = {}): SnapshotSource {
  return {
    id: 'case_1',
    mrn: '851557',
    registrationAt: REG,
    openedAt: new Date('2026-09-09T11:00:00.000Z'),
    openedById: 'user_1',
    shift: 'MORNING',
    status: 'OPEN',
    primaryReasonId: 'reason_a',
    medAdminInformedAt: null,
    ctas: null,
    areaId: null,
    triageAt: null,
    roomAt: null,
    roomType: null,
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
    referralTrackingNo: null,
    transferFacility: null,
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
    reviewedAt: null,
    reviewedById: null,
    disposition: null,
    wardId: null,
    isolation: false,
    resolutionNote: null,
    resolvedAt: null,
    voidReason: null,
    version: 1,
    reasons: [{ reasonId: 'reason_a', otherText: null }],
    consults: [],
    investigations: [],
    ...overrides,
  }
}

describe('caseSnapshot', () => {
  it('serialises dates as ISO strings and keeps every scalar the plan audits', () => {
    const snap = caseSnapshot(source())
    expect(snap.registrationAt).toBe('2026-09-09T05:00:00.000Z')
    expect(snap.mrn).toBe('851557')
    expect(snap.status).toBe('OPEN')
    expect(snap.version).toBe(1)
    expect(snap.departedAt).toBeNull()
  })

  it('produces the same JSON whatever order the source keys were built in', () => {
    const a = caseSnapshot(source())
    const scrambled = Object.fromEntries(
      Object.entries(source() as unknown as Record<string, unknown>).reverse(),
    ) as unknown as SnapshotSource
    const b = caseSnapshot(scrambled)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('sorts the child rows so a reordered relation is not read as a change', () => {
    const a = caseSnapshot(
      source({
        reasons: [
          { reasonId: 'r_b', otherText: null },
          { reasonId: 'r_a', otherText: 'text' },
        ],
        consults: [
          { departmentId: 'd_z', consultedAt: REG, seenAt: null, repliedAt: null },
          { departmentId: 'd_a', consultedAt: null, seenAt: null, repliedAt: null },
        ],
        investigations: [
          { type: 'XR', orderedAt: null, collectedAt: null, receivedAt: null, doneAt: null, preliminaryAt: null, resultedAt: null },
          { type: 'CT', orderedAt: null, collectedAt: null, receivedAt: null, doneAt: null, preliminaryAt: null, resultedAt: null },
        ],
      }),
    )
    const b = caseSnapshot(
      source({
        reasons: [
          { reasonId: 'r_a', otherText: 'text' },
          { reasonId: 'r_b', otherText: null },
        ],
        consults: [
          { departmentId: 'd_a', consultedAt: null, seenAt: null, repliedAt: null },
          { departmentId: 'd_z', consultedAt: REG, seenAt: null, repliedAt: null },
        ],
        investigations: [
          { type: 'CT', orderedAt: null, collectedAt: null, receivedAt: null, doneAt: null, preliminaryAt: null, resultedAt: null },
          { type: 'XR', orderedAt: null, collectedAt: null, receivedAt: null, doneAt: null, preliminaryAt: null, resultedAt: null },
        ],
      }),
    )
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('drops every relation the query may have carried along, so no password hash can leak', () => {
    const withRelations = {
      ...source(),
      openedBy: { id: 'user_1', username: 'nurse', passwordHash: '$2b$12$averysecrethash', displayName: 'Nurse' },
      updates: [{ id: 'u1', text: 'hello', author: { passwordHash: '$2b$12$another' } }],
      ward: { id: 'w1', code: 'ICU' },
    } as unknown as SnapshotSource
    const json = JSON.stringify(caseSnapshot(withRelations))
    expect(json).not.toContain('passwordHash')
    expect(json).not.toContain('$2b$12$')
    expect(json).not.toContain('"openedBy"')
    expect(json).not.toContain('"updates"')
    expect(json).not.toContain('"ward"')
  })

  it('carries the resolution and void fields once they are set', () => {
    const snap = caseSnapshot(
      source({
        status: 'RESOLVED',
        disposition: 'ADMITTED',
        wardId: 'ward_icu',
        isolation: true,
        resolvedAt: new Date('2026-09-09T14:00:00.000Z'),
        departedAt: new Date('2026-09-09T14:00:00.000Z'),
        version: 3,
      }),
    )
    expect(snap).toMatchObject({
      status: 'RESOLVED',
      disposition: 'ADMITTED',
      wardId: 'ward_icu',
      isolation: true,
      resolvedAt: '2026-09-09T14:00:00.000Z',
      version: 3,
    })
  })
})
