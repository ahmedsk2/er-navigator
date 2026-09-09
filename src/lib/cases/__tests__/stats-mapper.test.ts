import { describe, expect, it } from 'vitest'
import { CASE_STATS_SELECT, toCaseForStats, type CaseStatsRow } from '@/src/lib/cases/stats-mapper'
import { consultRows, dashboard, otherQueue } from '@/src/lib/domain/aggregates'

/**
 * The Prisma → `CaseForStats` adapter. The rows here are written by hand in exactly the shape
 * `CASE_STATS_SELECT` produces (the type is derived from the select, so a missing field is a
 * compile error), and the assertions are the two things the aggregates depend on and the
 * database does not give for free: distinct stage names, and the Other free text carried with
 * its stage.
 */
const at = (iso: string) => new Date(iso)

function row(over: Partial<CaseStatsRow> = {}): CaseStatsRow {
  return {
    id: 'c1',
    mrn: '100001',
    status: 'OPEN',
    registrationAt: at('2026-09-08T06:00:00Z'),
    departedAt: null,
    resolvedAt: null,
    shift: 'MORNING',
    disposition: null,
    triageAt: null,
    physicianAt: null,
    decisionAt: null,
    admOrderAt: null,
    bedRequestedAt: null,
    bedAssignedAt: null,
    handoverAt: null,
    transferRequestedAt: null,
    medAdminInformedAt: null,
    ctas: null,
    primaryReason: null,
    ward: null,
    area: null,
    _count: { updates: 0 },
    updates: [],
    reasons: [],
    consults: [],
    investigations: [],
    ...over,
  }
}

const reason = (stage: string, sortOrder: number, otherText: string | null = null) => ({
  otherText,
  reason: { stage: { name: stage, sortOrder } },
})

describe('CASE_STATS_SELECT', () => {
  it('asks for every field CaseForStats needs and nothing else', () => {
    expect(Object.keys(CASE_STATS_SELECT).sort()).toEqual(
      [
        '_count',
        'admOrderAt',
        'area',
        'bedAssignedAt',
        'bedRequestedAt',
        'consults',
        'ctas',
        'decisionAt',
        'departedAt',
        'disposition',
        'handoverAt',
        'id',
        'investigations',
        'medAdminInformedAt',
        'mrn',
        'physicianAt',
        'primaryReason',
        'reasons',
        'registrationAt',
        'resolvedAt',
        'shift',
        'status',
        'transferRequestedAt',
        'triageAt',
        'updates',
        'ward',
      ].sort(),
    )
  })
})

describe('toCaseForStats', () => {
  it('maps a resolved case with two consults to the expected shape', () => {
    const mapped = toCaseForStats(
      row({
        id: 'c5',
        mrn: '100005',
        status: 'RESOLVED',
        registrationAt: at('2026-09-07T06:00:00Z'),
        departedAt: at('2026-09-07T14:00:00Z'),
        resolvedAt: at('2026-09-07T14:00:00Z'),
        disposition: 'ADMITTED',
        admOrderAt: at('2026-09-07T09:00:00Z'),
        bedRequestedAt: at('2026-09-07T09:30:00Z'),
        bedAssignedAt: at('2026-09-07T13:00:00Z'),
        primaryReason: { name: 'No bed available on accepting ward' },
        reasons: [reason('Admission process', 8), reason('Referral / consulted team', 6)],
        consults: [
          {
            department: { name: 'MROD' },
            consultedAt: at('2026-09-07T08:00:00Z'),
            seenAt: at('2026-09-07T09:00:00Z'),
            repliedAt: at('2026-09-07T09:30:00Z'),
          },
          {
            department: { name: 'General Surgery' },
            consultedAt: at('2026-09-07T09:00:00Z'),
            seenAt: at('2026-09-07T12:00:00Z'),
            repliedAt: null,
          },
        ],
        investigations: [
          {
            type: 'LAB',
            orderedAt: at('2026-09-07T07:00:00Z'),
            collectedAt: at('2026-09-07T08:00:00Z'),
            receivedAt: at('2026-09-07T08:30:00Z'),
            doneAt: null,
            preliminaryAt: null,
            resultedAt: at('2026-09-07T10:00:00Z'),
          },
        ],
      }),
    )

    expect(mapped).toEqual({
      id: 'c5',
      mrn: '100005',
      status: 'RESOLVED',
      registrationAt: at('2026-09-07T06:00:00Z'),
      departedAt: at('2026-09-07T14:00:00Z'),
      resolvedAt: at('2026-09-07T14:00:00Z'),
      shift: 'MORNING',
      primaryReasonName: 'No bed available on accepting ward',
      // Taxonomy order: Referral (6) before Admission (8), whatever order the rows came back in.
      stageNames: ['Referral / consulted team', 'Admission process'],
      departmentNames: ['MROD', 'General Surgery'],
      disposition: 'ADMITTED',
      consults: [
        {
          departmentName: 'MROD',
          consultedAt: at('2026-09-07T08:00:00Z'),
          seenAt: at('2026-09-07T09:00:00Z'),
          repliedAt: at('2026-09-07T09:30:00Z'),
        },
        {
          departmentName: 'General Surgery',
          consultedAt: at('2026-09-07T09:00:00Z'),
          seenAt: at('2026-09-07T12:00:00Z'),
          repliedAt: null,
        },
      ],
      investigations: [
        {
          type: 'LAB',
          orderedAt: at('2026-09-07T07:00:00Z'),
          collectedAt: at('2026-09-07T08:00:00Z'),
          receivedAt: at('2026-09-07T08:30:00Z'),
          doneAt: null,
          preliminaryAt: null,
          resultedAt: at('2026-09-07T10:00:00Z'),
        },
      ],
      triageAt: null,
      physicianAt: null,
      decisionAt: null,
      admOrderAt: at('2026-09-07T09:00:00Z'),
      bedRequestedAt: at('2026-09-07T09:30:00Z'),
      bedAssignedAt: at('2026-09-07T13:00:00Z'),
      handoverAt: null,
      transferRequestedAt: null,
      medAdminInformedAt: null,
      wardCode: null,
      ctas: null,
      areaName: null,
      updatesCount: 0,
      lastUpdateAt: null,
      otherTexts: [],
    })

    // And the two consults land as two team rows, which is the point of carrying them at all.
    expect(consultRows([mapped]).map((r) => r.name).sort()).toEqual(['General Surgery', 'MROD'])
  })

  it('collapses three reasons in one stage into one stage name', () => {
    const mapped = toCaseForStats({
      ...row(),
      reasons: [reason('Investigations', 5), reason('Investigations', 5), reason('Investigations', 5)],
    })
    expect(mapped.stageNames).toEqual(['Investigations'])
    expect(dashboard([mapped], 'all', at('2026-09-08T12:00:00Z')).byStage).toEqual([
      { name: 'Investigations', value: 1, ids: ['c1'] },
    ])
  })

  it('carries Other free text with the stage it was typed under, and drops blank ones', () => {
    const mapped = toCaseForStats({
      ...row({ mrn: '100008' }),
      reasons: [
        reason('Discharge process', 9, 'Waiting for social worker'),
        reason('Triage', 2, '   '),
        reason('Registration', 1, null),
      ],
    })
    expect(mapped.otherTexts).toEqual([{ stageName: 'Discharge process', text: 'Waiting for social worker' }])
    expect(otherQueue([mapped])).toEqual([
      { id: 'c1', mrn: '100008', stageName: 'Discharge process', text: 'Waiting for social worker' },
    ])
  })

  it('leaves an unset primary reason, shift and disposition null rather than inventing one', () => {
    const mapped = toCaseForStats(row({ shift: null }))
    expect(mapped.primaryReasonName).toBeNull()
    expect(mapped.shift).toBeNull()
    expect(mapped.disposition).toBeNull()
    expect(mapped.stageNames).toEqual([])
    expect(mapped.departmentNames).toEqual([])
  })

  /**
   * Phase 8. `KpiCase` reads the ward by its code and the area by its name, and needs how many
   * updates a case has and when the newest was written. The count comes from `_count`, so it is
   * right even though the dashboard's own select only fetches one update row.
   */
  it('maps the ward code, the CTAS, the ED area name and the update count', () => {
    const mapped = toCaseForStats(
      row({
        ctas: 2,
        ward: { code: 'ICU' },
        area: { name: 'Resuscitation area' },
        triageAt: at('2026-09-08T06:10:00Z'),
        physicianAt: at('2026-09-08T06:40:00Z'),
        decisionAt: at('2026-09-08T09:00:00Z'),
        handoverAt: at('2026-09-08T11:00:00Z'),
        transferRequestedAt: at('2026-09-08T10:00:00Z'),
        medAdminInformedAt: at('2026-09-08T10:30:00Z'),
        _count: { updates: 4 },
        updates: [{ createdAt: at('2026-09-08T11:30:00Z') }],
      }),
    )
    expect(mapped.ctas).toBe(2)
    expect(mapped.wardCode).toBe('ICU')
    expect(mapped.areaName).toBe('Resuscitation area')
    expect(mapped.triageAt).toEqual(at('2026-09-08T06:10:00Z'))
    expect(mapped.physicianAt).toEqual(at('2026-09-08T06:40:00Z'))
    expect(mapped.decisionAt).toEqual(at('2026-09-08T09:00:00Z'))
    expect(mapped.handoverAt).toEqual(at('2026-09-08T11:00:00Z'))
    expect(mapped.transferRequestedAt).toEqual(at('2026-09-08T10:00:00Z'))
    expect(mapped.medAdminInformedAt).toEqual(at('2026-09-08T10:30:00Z'))
    expect(mapped.updatesCount).toBe(4)
    expect(mapped.lastUpdateAt).toEqual(at('2026-09-08T11:30:00Z'))
  })

  it('finds the newest update whatever order the query returned them in', () => {
    // The export widens the same select to every update, oldest first; the dashboard takes the
    // newest one only. Both must produce the same answer.
    const oldestFirst = toCaseForStats(
      row({
        _count: { updates: 3 },
        updates: [
          { createdAt: at('2026-09-08T06:00:00Z') },
          { createdAt: at('2026-09-08T09:00:00Z') },
          { createdAt: at('2026-09-08T07:00:00Z') },
        ],
      }),
    )
    expect(oldestFirst.lastUpdateAt).toEqual(at('2026-09-08T09:00:00Z'))
    expect(toCaseForStats(row()).lastUpdateAt).toBeNull()
  })

  it('keeps a voided case voided, so inRange() can drop it', () => {
    const voided = toCaseForStats(row({ id: 'c10', status: 'VOIDED' }))
    expect(voided.status).toBe('VOIDED')
    expect(dashboard([voided], 'all', at('2026-09-08T12:00:00Z')).inRange).toBe(0)
  })
})
