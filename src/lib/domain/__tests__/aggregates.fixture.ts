/**
 * Dashboard fixture with hand-computed answers (see aggregates.test.ts for the arithmetic).
 * NOW is Tuesday 2026-09-08 12:00 UTC = 15:00 in Asia/Riyadh. Hours are relative to NOW.
 * Twelve cases: nine open/resolved inside 30 days, one 40 days old, one voided, one with an
 * out-of-order consult. Every number in the tests is derived from this table by hand.
 */
import type { CaseForStats } from '../aggregates'

export const NOW = new Date('2026-09-08T12:00:00Z')
export const h = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 36e5)

type Seed = Omit<Partial<CaseForStats>, 'id' | 'mrn' | 'status' | 'registrationAt'> & Pick<CaseForStats, 'id' | 'mrn' | 'status' | 'registrationAt'>

const c = (p: Seed): CaseForStats => ({
  shift: null,
  primaryReasonName: null,
  stageNames: [],
  departmentNames: [],
  disposition: null,
  consults: [],
  investigations: [],
  admOrderAt: null,
  bedRequestedAt: null,
  bedAssignedAt: null,
  otherTexts: [],
  departedAt: null,
  resolvedAt: null,
  ...p,
})

export const FIXTURE: CaseForStats[] = [
  // C1: open 3h (ok band), Tue 12:00 Riyadh
  c({ id: 'C1', mrn: '100001', status: 'OPEN', registrationAt: h(3), shift: 'MORNING', primaryReasonName: 'No bed available on accepting ward', stageNames: ['Admission process'], departmentNames: ['MROD'],
    consults: [{ departmentName: 'MROD', consultedAt: h(2), seenAt: h(1), repliedAt: h(0.5) }] }),
  // C2: open 7h (h6), Tue 08:00
  c({ id: 'C2', mrn: '100002', status: 'OPEN', registrationAt: h(7), shift: 'EVENING', primaryReasonName: 'Awaiting consulted team response/callback', stageNames: ['Referral / consulted team'], departmentNames: ['ICU'],
    consults: [{ departmentName: 'ICU', consultedAt: h(5), seenAt: h(3), repliedAt: null }] }),
  // C3: open 13h (h12), Tue 02:00
  c({ id: 'C3', mrn: '100003', status: 'OPEN', registrationAt: h(13), shift: 'NIGHT', primaryReasonName: 'Lab: delay in processing', stageNames: ['Investigations'],
    investigations: [{ type: 'LAB', orderedAt: h(12), collectedAt: h(11), receivedAt: h(10), doneAt: null, resultedAt: h(8) }] }),
  // C4: open 25h (h24), Mon 14:00
  c({ id: 'C4', mrn: '100004', status: 'OPEN', registrationAt: h(25), shift: 'MORNING', primaryReasonName: 'Fax/communication breakdown between units', stageNames: ['Administrative / coordination'] }),
  // C5: resolved, reg 30h ago (Mon 09:00), left 22h ago: LOS 8. Two teams, admission chain.
  c({ id: 'C5', mrn: '100005', status: 'RESOLVED', registrationAt: h(30), departedAt: h(22), resolvedAt: h(22), shift: 'MORNING', primaryReasonName: 'No bed available on accepting ward',
    stageNames: ['Admission process', 'Referral / consulted team'], departmentNames: ['MROD', 'General Surgery'], disposition: 'ADMITTED',
    consults: [
      { departmentName: 'MROD', consultedAt: h(28), seenAt: h(27), repliedAt: h(26.5) },
      { departmentName: 'General Surgery', consultedAt: h(27), seenAt: h(24), repliedAt: h(23) },
    ],
    admOrderAt: h(27), bedRequestedAt: h(26.5), bedAssignedAt: h(23) }),
  // C6: resolved, reg 50h ago (Sun 13:00), left 40h ago: LOS 10. CT.
  c({ id: 'C6', mrn: '100006', status: 'RESOLVED', registrationAt: h(50), departedAt: h(40), resolvedAt: h(40), shift: 'EVENING', primaryReasonName: 'Imaging: acquisition delay (CT)', stageNames: ['Investigations'], disposition: 'DISCHARGED_HOME',
    investigations: [{ type: 'CT', orderedAt: h(48), collectedAt: null, receivedAt: null, doneAt: h(46), resultedAt: h(43) }] }),
  // C7: resolved, reg 74h ago (Sat 13:00), left 68h ago: LOS 6.
  c({ id: 'C7', mrn: '100007', status: 'RESOLVED', registrationAt: h(74), departedAt: h(68), resolvedAt: h(68), shift: 'NIGHT', primaryReasonName: 'Awaiting pharmacy', stageNames: ['Discharge process'], disposition: 'DISCHARGED_HOME' }),
  // C8: resolved, reg 240h ago (Sat 15:00, 10 days), left 233h ago: LOS 7. Other text.
  c({ id: 'C8', mrn: '100008', status: 'RESOLVED', registrationAt: h(240), departedAt: h(233), resolvedAt: h(233), shift: 'MORNING', primaryReasonName: 'Other', stageNames: ['Discharge process'], disposition: 'DISCHARGED_DAMA',
    otherTexts: [{ stageName: 'Discharge process', text: 'Waiting for social worker' }] }),
  // C9: resolved 40 days ago, LOS 9. Outside the 30-day range.
  c({ id: 'C9', mrn: '100009', status: 'RESOLVED', registrationAt: h(960), departedAt: h(951), resolvedAt: h(951), shift: 'EVENING', primaryReasonName: 'No resus bay available', stageNames: ['Resus room'], disposition: 'TRANSFERRED' }),
  // C10: VOIDED, must never count.
  c({ id: 'C10', mrn: '100010', status: 'VOIDED', registrationAt: h(5), shift: 'MORNING', primaryReasonName: 'No bed available on accepting ward', stageNames: ['Admission process'] }),
  // C11: open exactly 4h (h4 boundary), Tue 11:00
  c({ id: 'C11', mrn: '100011', status: 'OPEN', registrationAt: h(4), shift: 'NIGHT', primaryReasonName: 'Waiting for triage nurse availability', stageNames: ['Triage'] }),
  // C12: resolved, reg 20h ago (Mon 19:00), left 18h ago: LOS 2. Out-of-order consult (seen before consulted).
  c({ id: 'C12', mrn: '100012', status: 'RESOLVED', registrationAt: h(20), departedAt: h(18), resolvedAt: h(18), shift: 'MORNING', primaryReasonName: 'Re-triage required', stageNames: ['Triage'], departmentNames: ['Urology'], disposition: 'LEFT_WITHOUT_BEING_SEEN',
    consults: [{ departmentName: 'Urology', consultedAt: h(19), seenAt: h(19.5), repliedAt: null }] }),
]
