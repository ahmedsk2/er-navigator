import type { CaseForExport } from '../rows'

/**
 * One case, built field by field, for the two Phase 8 workbooks.
 *
 * Both sheets are wide — twenty columns for the Adaa form, seventy for the QCH log — and the
 * point of the tests over them is that EVERY column is asserted, including the ones that must
 * come out blank. So the base case below records nothing, and each test names exactly the fields
 * its expectation depends on. Instants are given in UTC with the Riyadh clock time in a comment,
 * because Riyadh is UTC+3 and that offset is what the day-boundary tests turn on.
 */
export const BASE_CASE: CaseForExport = {
  id: 'C1',
  mrn: '1000001',
  status: 'OPEN',
  registrationAt: new Date('2026-09-01T05:00:00Z'), // 08:00 Riyadh, 01-Sep
  departedAt: null,
  resolvedAt: null,
  shift: 'MORNING',
  primaryReasonName: null,
  stageNames: [],
  departmentNames: [],
  disposition: null,
  consults: [],
  investigations: [],
  triageAt: null,
  roomAt: null,
  physicianAt: null,
  decisionAt: null,
  admOrderAt: null,
  bedRequestedAt: null,
  bedAssignedAt: null,
  handoverAt: null,
  transferRequestedAt: null,
  transferAcceptedAt: null,
  transportArrivedAt: null,
  medAdminInformedAt: null,
  wardCode: null,
  ctas: null,
  areaName: null,
  payer: null,
  stageCodes: [],
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
  navigatorName: 'Nadia Navigator',
  navigatorUsername: 'nadia',
  primaryReasonLabel: null,
  reasonLabels: [],
  reasonRows: [],
  referralTrackingNo: null,
  transferFacility: null,
  isolation: false,
  resolutionNote: null,
  updates: [],
}

export const caseWith = (over: Partial<CaseForExport>): CaseForExport => ({ ...BASE_CASE, ...over })
