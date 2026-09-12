import { describe, expect, it } from 'vitest'
import { CASE_STATS_SELECT, toCaseForStats, toFilterableCase, type CaseStatsRow } from '@/src/lib/cases/stats-mapper'
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
    roomAt: null,
    physicianAt: null,
    decisionAt: null,
    admOrderAt: null,
    bedRequestedAt: null,
    bedAssignedAt: null,
    transferRequestedAt: null,
    transferAcceptedAt: null,
    transportArrivedAt: null,
    medAdminInformedAt: null,
    ctas: null,
    payer: null,
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
    primaryReason: null,
    ward: null,
    area: null,
    reviewedBy: null,
    _count: { updates: 0 },
    updates: [],
    reasons: [],
    consults: [],
    investigations: [],
    ...over,
  }
}

/** One `CaseReason` row: the reason's own name (Phase 10) under its stage, with its Other text. */
const reason = (
  stage: string,
  sortOrder: number,
  otherText: string | null = null,
  name = `${stage} reason`,
) => ({
  otherText,
  reason: { name, stage: { code: stage.toLowerCase().replace(/[^a-z]+/g, '-'), name: stage, sortOrder } },
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
        'caseMgmtAction',
        'caseMgmtCalledAt',
        'caseMgmtCriteria',
        'caseMgmtReferral',
        'caseMgmtRepliedAt',
        'consults',
        'ctas',
        'decisionAt',
        'departedAt',
        'disposition',
        'familyEngagement',
        'id',
        'instructionsGiven',
        'investigations',
        'medAdminInformedAt',
        'mrn',
        'painkillerAt',
        'painkillerPrescribed',
        'payer',
        'pethidineDoseMg',
        'pethidinePrescribed',
        'physicianAt',
        'primaryReason',
        'reasons',
        'registrationAt',
        'resolvedAt',
        'reviewedAt',
        'reviewedBy',
        'roomAt',
        'shift',
        'sickleCellTreatment',
        'status',
        'transferAcceptedAt',
        'transferRequestedAt',
        'transportArrivedAt',
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
      stageCodes: ['referral-consulted-team', 'admission-process'],
      // The same taxonomy order, by the reason's own name: what the filter matches on.
      reasonNames: ['Referral / consulted team reason', 'Admission process reason'],
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
      roomAt: null,
      physicianAt: null,
      decisionAt: null,
      admOrderAt: at('2026-09-07T09:00:00Z'),
      bedRequestedAt: at('2026-09-07T09:30:00Z'),
      bedAssignedAt: at('2026-09-07T13:00:00Z'),
        transferRequestedAt: null,
      transferAcceptedAt: null,
      transportArrivedAt: null,
      medAdminInformedAt: null,
      wardCode: null,
      ctas: null,
      areaName: null,
      areaCode: null,
      payer: null,
      updatesCount: 0,
      lastUpdateAt: null,
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
      reviewedByName: null,
      updateActions: [],
      untaggedUpdatesCount: 0,
      otherTexts: [],
    })

    // And the two consults land as two team rows, which is the point of carrying them at all.
    expect(consultRows([mapped]).map((r) => r.name).sort()).toEqual(['General Surgery', 'MROD'])
  })

  it('collapses three reasons in one stage into one stage name', () => {
    const mapped = toCaseForStats({
      ...row(),
      reasons: [
        reason('Investigations', 5, null, 'Lab: delay in processing'),
        reason('Investigations', 5, null, 'Lab: delay in processing'),
        reason('Investigations', 5, null, 'Imaging: report delay'),
      ],
    })
    expect(mapped.stageNames).toEqual(['Investigations'])
    // Three rows, two distinct reasons: the filter counts a name once however often it was typed.
    expect(mapped.reasonNames).toEqual(['Lab: delay in processing', 'Imaging: report delay'])
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
    expect(mapped.reasonNames).toEqual([])
    expect(mapped.areaCode).toBeNull()
    expect(mapped.departmentNames).toEqual([])
  })

  /**
   * Phase 8. `KpiCase` reads the ward by its code and the area by its name, and needs how many
   * updates a case has and when the newest was written. The count comes from `_count`, so it is
   * right whatever subset of the update rows the caller's own select asked for.
   */
  it('maps the ward code, the CTAS, the ED area name and the update count', () => {
    const mapped = toCaseForStats(
      row({
        ctas: 2,
        ward: { code: 'ICU' },
        area: { name: 'Resuscitation area', code: 'RESUS' },
        triageAt: at('2026-09-08T06:10:00Z'),
        physicianAt: at('2026-09-08T06:40:00Z'),
        decisionAt: at('2026-09-08T09:00:00Z'),
        transferRequestedAt: at('2026-09-08T10:00:00Z'),
        medAdminInformedAt: at('2026-09-08T10:30:00Z'),
        _count: { updates: 4 },
        updates: [{ createdAt: at('2026-09-08T11:30:00Z'), action: null, system: false }],
      }),
    )
    expect(mapped.ctas).toBe(2)
    expect(mapped.wardCode).toBe('ICU')
    expect(mapped.areaName).toBe('Resuscitation area')
    // The code beside the name: the filter's URL carries it, so a renamed area keeps its links.
    expect(mapped.areaCode).toBe('RESUS')
    expect(mapped.triageAt).toEqual(at('2026-09-08T06:10:00Z'))
    expect(mapped.physicianAt).toEqual(at('2026-09-08T06:40:00Z'))
    expect(mapped.decisionAt).toEqual(at('2026-09-08T09:00:00Z'))
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
          { createdAt: at('2026-09-08T06:00:00Z'), action: null, system: false },
          { createdAt: at('2026-09-08T09:00:00Z'), action: null, system: false },
          { createdAt: at('2026-09-08T07:00:00Z'), action: null, system: false },
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

  /**
   * Phase 8b (docs/specs/phase8b-decisions.md). Every field the widened KPI contract names, in one
   * row, so a column dropped from the select or forgotten in the mapper is a failed assertion
   * rather than a silently empty panel on the Adaa or discharge-communication sections.
   */
  it('maps the pain block, the discharge answers, case management and the review', () => {
    const mapped = toCaseForStats(
      row({
        painkillerPrescribed: 'YES',
        pethidinePrescribed: 'YES',
        pethidineDoseMg: 100,
        painkillerAt: at('2026-09-08T06:45:00Z'),
        sickleCellTreatment: 'NO',
        instructionsGiven: 'YES',
        familyEngagement: 'NOT_SURE',
        caseMgmtReferral: 'COMPLEX_CARE',
        caseMgmtCriteria: 'MEETS',
        caseMgmtAction: 'FOR_ENROLLMENT',
        caseMgmtCalledAt: at('2026-09-08T07:00:00Z'),
        caseMgmtRepliedAt: at('2026-09-08T08:30:00Z'),
        reviewedAt: at('2026-09-08T13:00:00Z'),
        reviewedBy: { displayName: 'Sami Supervisor' },
      }),
    )
    expect(mapped.painkillerPrescribed).toBe('YES')
    expect(mapped.pethidinePrescribed).toBe('YES')
    expect(mapped.pethidineDoseMg).toBe(100)
    expect(mapped.painkillerAt).toEqual(at('2026-09-08T06:45:00Z'))
    expect(mapped.sickleCellTreatment).toBe('NO')
    expect(mapped.instructionsGiven).toBe('YES')
    expect(mapped.familyEngagement).toBe('NOT_SURE')
    expect(mapped.caseMgmtReferral).toBe('COMPLEX_CARE')
    expect(mapped.caseMgmtCriteria).toBe('MEETS')
    expect(mapped.caseMgmtAction).toBe('FOR_ENROLLMENT')
    expect(mapped.caseMgmtCalledAt).toEqual(at('2026-09-08T07:00:00Z'))
    expect(mapped.caseMgmtRepliedAt).toEqual(at('2026-09-08T08:30:00Z'))
    expect(mapped.reviewedAt).toEqual(at('2026-09-08T13:00:00Z'))
    // The reviewer's NAME, not their id: nothing downstream should have to look a user up.
    expect(mapped.reviewedByName).toBe('Sami Supervisor')
  })

  it('reduces the updates to the DISTINCT action categories, and leaves untagged ones out', () => {
    const mapped = toCaseForStats(
      row({
        _count: { updates: 4 },
        updates: [
          { createdAt: at('2026-09-08T06:00:00Z'), action: 'BED_MANAGEMENT', system: false },
          { createdAt: at('2026-09-08T07:00:00Z'), action: null, system: false },
          { createdAt: at('2026-09-08T08:00:00Z'), action: 'BED_MANAGEMENT', system: false },
          { createdAt: at('2026-09-08T09:00:00Z'), action: 'LEADERSHIP_ESCALATION', system: false },
        ],
      }),
    )
    expect([...mapped.updateActions].sort()).toEqual(['BED_MANAGEMENT', 'LEADERSHIP_ESCALATION'])
    // The untagged ones are COUNTED, not inferred: the deck's seventh row is "an update was
    // written and no action was named", which a set of distinct kinds cannot express.
    expect(mapped.untaggedUpdatesCount).toBe(1)
    // The count is every update, tagged or not; the newest is still found by scanning.
    expect(mapped.updatesCount).toBe(4)
    expect(mapped.lastUpdateAt).toEqual(at('2026-09-08T09:00:00Z'))
    expect(toCaseForStats(row()).updateActions).toEqual([])
    expect(toCaseForStats(row()).untaggedUpdatesCount).toBe(0)
  })

  /**
   * The export's own select overrides `updates` and does not ask for `action` (Slice H adds it).
   * Such a row must map to no kinds AND to no untagged updates — "not asked for" is not the same
   * answer as "asked for and empty", and reporting one update as untagged here would be a figure
   * the query never established.
   */
  it('accepts an update row with no action field at all, and calls it neither tagged nor untagged', () => {
    const mapped = toCaseForStats({
      ...row({ _count: { updates: 1 } }),
      updates: [{ createdAt: at('2026-09-08T06:00:00Z') }],
    })
    expect(mapped.updateActions).toEqual([])
    expect(mapped.untaggedUpdatesCount).toBe(0)
    expect(mapped.updatesCount).toBe(1)
    expect(mapped.lastUpdateAt).toEqual(at('2026-09-08T06:00:00Z'))
  })

  /**
   * Phase 8b review C2: the service appends "Resolved: …", "Reopened" and "Voided: …" itself, and
   * the alerts worker appends the threshold notes; none carries a tag, and none is a navigator
   * documenting an action. Before the `system` flag every resolved case therefore read as "Update
   * without an action tag". A system row still counts as an update and still dates the newest
   * one, but it is neither a kind nor an untagged update.
   */
  it('leaves the app’s own system rows out of the kinds and the untagged count', () => {
    const mapped = toCaseForStats(
      row({
        _count: { updates: 2 },
        updates: [
          { createdAt: at('2026-09-08T09:00:00Z'), action: null, system: true },
          { createdAt: at('2026-09-08T06:00:00Z'), action: 'BED_MANAGEMENT', system: false },
        ],
      }),
    )
    expect(mapped.updateActions).toEqual(['BED_MANAGEMENT'])
    expect(mapped.untaggedUpdatesCount).toBe(0)
    expect(mapped.updatesCount).toBe(2)
    expect(mapped.lastUpdateAt).toEqual(at('2026-09-08T09:00:00Z'))
    // A resolved case whose only row is the resolve note: no action documented at all.
    const resolvedOnly = toCaseForStats(
      row({ _count: { updates: 1 }, updates: [{ createdAt: at('2026-09-08T09:00:00Z'), action: null, system: true }] }),
    )
    expect(resolvedOnly.updateActions).toEqual([])
    expect(resolvedOnly.untaggedUpdatesCount).toBe(0)
  })
})

/**
 * Phase 10 review. The seven fields `matchesFilter` reads, off any row that has their relations:
 * the dashboard's and the workbook's through `toCaseForStats`, and the export count's slim select,
 * which asks for these columns and nothing else. One adapter, so the count on /export cannot read
 * a case differently from the file it counts.
 */
describe('toFilterableCase', () => {
  /** Exactly what the export's count selects. */
  const slim = {
    ctas: 3,
    payer: 'INSURED' as const,
    disposition: 'ADMITTED' as const,
    area: { code: 'RESUS' },
    reasons: [
      { reason: { name: 'No bed available on accepting ward', stage: { code: 'adm' } } },
      { reason: { name: 'Lab: delay in processing', stage: { code: 'inv' } } },
      { reason: { name: 'Imaging: report delay', stage: { code: 'inv' } } },
    ],
    consults: [{ department: { name: 'MROD' } }, { department: { name: 'ICU' } }],
  }

  it('reads each field from its own column: stages by code, reasons by name, the area by code', () => {
    expect(toFilterableCase(slim)).toEqual({
      stageCodes: ['adm', 'inv'],
      reasonNames: ['No bed available on accepting ward', 'Lab: delay in processing', 'Imaging: report delay'],
      departmentNames: ['MROD', 'ICU'],
      areaCode: 'RESUS',
      ctas: 3,
      payer: 'INSURED',
      disposition: 'ADMITTED',
    })
  })

  it('leaves what a case did not record empty, rather than inventing a value', () => {
    expect(
      toFilterableCase({ ...slim, ctas: null, payer: null, disposition: null, area: null, reasons: [], consults: [] }),
    ).toEqual({
      stageCodes: [],
      reasonNames: [],
      departmentNames: [],
      areaCode: null,
      ctas: null,
      payer: null,
      disposition: null,
    })
  })

  it('is what toCaseForStats carries, whatever order the reasons came back in', () => {
    const full = row({
      ctas: 4,
      payer: 'SELF_PAY',
      disposition: 'DISCHARGED_HOME',
      area: { name: 'Rapid assessment zone', code: 'RAZ' },
      reasons: [
        reason('Investigations', 5, null, 'Lab: delay in processing'),
        reason('Registration', 1, null, 'Registration desk/system delay'),
        reason('Investigations', 5, null, 'Imaging: report delay'),
      ],
      consults: [{ department: { name: 'MROD' }, consultedAt: at('2026-09-08T07:00:00Z'), seenAt: null, repliedAt: null }],
    })
    const stats = toCaseForStats(full)
    const own = toFilterableCase(full)
    // The same sets, which is all `matchesFilter` reads; toCaseForStats keeps its stage order.
    expect(new Set(own.stageCodes)).toEqual(new Set(stats.stageCodes))
    expect(new Set(own.reasonNames)).toEqual(new Set(stats.reasonNames))
    expect(stats.stageCodes).toEqual(['registration', 'investigations'])
    expect(stats.reasonNames).toEqual(['Registration desk/system delay', 'Lab: delay in processing', 'Imaging: report delay'])
    expect([own.departmentNames, own.areaCode, own.ctas, own.payer, own.disposition]).toEqual([
      stats.departmentNames,
      stats.areaCode,
      stats.ctas,
      stats.payer,
      stats.disposition,
    ])
  })
})
