/**
 * Seed taxonomy — Appendix A of the locked plan, verbatim. Do not rename any string.
 * The database is the runtime source of truth (Admin edits it); this file only seeds it
 * and drives the unit tests. Every stage also gets exactly one "Other" reason (isOther=true).
 */
export const OTHER = 'Other'

export type StageSeed = {
  code: string
  name: string
  reasons: ReadonlyArray<{ name: string; requiresDepartment?: boolean; requiresReferralNo?: boolean }>
}

export const STAGES: ReadonlyArray<StageSeed> = [
  {
    code: 'reg',
    name: 'Registration',
    reasons: [{ name: 'Registration desk/system delay' }, { name: 'Missing/incorrect patient information' }],
  },
  {
    code: 'triage',
    name: 'Triage',
    reasons: [{ name: 'Waiting for triage nurse availability' }, { name: 'Re-triage required' }],
  },
  {
    code: 'resus',
    name: 'Resus room',
    reasons: [{ name: 'No resus bay available' }, { name: 'Equipment/monitor not available' }],
  },
  {
    code: 'exam',
    name: 'Exam room',
    reasons: [{ name: 'No exam room available' }, { name: 'Waiting for isolation/negative pressure room' }],
  },
  {
    code: 'inv',
    name: 'Investigations',
    reasons: [
      { name: 'Lab: delay in sample collection' },
      { name: 'Lab: delay in transport/pickup to lab' },
      { name: 'Lab: delay in lab receiving specimen' },
      { name: 'Lab: delay in processing' },
      { name: 'Lab: delay in results release to ED' },
      { name: 'Imaging: acquisition delay (CT)' },
      { name: 'Imaging: acquisition delay (US)' },
      { name: 'Imaging: acquisition delay (X-ray/KUB)' },
      { name: 'Imaging: report delay' },
      { name: 'Waiting for transport to imaging' },
    ],
  },
  {
    code: 'ref',
    name: 'Referral / consulted team',
    reasons: [
      { name: 'Awaiting consulted team response/callback', requiresDepartment: true },
      { name: 'Consulted team seen patient, awaiting plan', requiresDepartment: true },
      { name: 'Referral sent, awaiting acceptance', requiresDepartment: true },
      { name: 'Disagreement between teams on ownership', requiresDepartment: true },
    ],
  },
  {
    code: 'dispo',
    name: 'Disposition decision',
    reasons: [{ name: 'Plan made, awaiting written admission order' }, { name: 'Awaiting senior/attending sign-off' }],
  },
  {
    code: 'adm',
    name: 'Admission process',
    reasons: [
      { name: 'No bed available on accepting ward' },
      { name: 'Bed available, awaiting transport/porter' },
      { name: 'Bed available, awaiting nursing handover' },
      { name: 'Referred out: no bed in accepting department', requiresReferralNo: true },
      { name: 'Referred out: care not available on-site', requiresReferralNo: true },
      { name: 'Waiting for RCC / transfer acceptance', requiresReferralNo: true },
    ],
  },
  {
    code: 'dc',
    name: 'Discharge process',
    reasons: [
      { name: 'Awaiting discharge paperwork/prescription' },
      { name: 'Awaiting pharmacy' },
      { name: 'Awaiting patient transport home' },
      { name: 'Patient signing DAMA' },
      { name: 'Social/family factor delaying discharge' },
    ],
  },
  {
    code: 'admin',
    name: 'Administrative / coordination',
    reasons: [
      { name: 'Bed coordinator office delay' },
      { name: 'Fax/communication breakdown between units' },
      { name: 'System/network downtime' },
    ],
  },
]

export const DEPARTMENTS: ReadonlyArray<string> = [
  'MROD',
  'Internal Medicine',
  'General Surgery',
  'ICU',
  'CCU',
  'Orthopedics',
  'Urology',
  'Neurology / Neurosurgery',
  'OB/GYN',
  'Psychiatry',
  'Radiology',
  'Respiratory Therapy',
  'ENT',
  'Ophthalmology',
  'Pediatrics',
  'Other',
]

export const WARDS: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'FMW', name: 'Female Medical Ward' },
  { code: 'MMW', name: 'Male Medical Ward' },
  { code: 'FSW', name: 'Female Surgical Ward' },
  { code: 'MSW', name: 'Male Surgical Ward' },
  { code: 'ICU', name: 'ICU' },
  { code: 'CCU', name: 'CCU' },
  { code: 'SDU', name: 'Step Down Unit' },
  { code: 'OBW', name: 'OB Ward' },
]

/**
 * The ED areas a patient is assigned to (Phase 8).
 *
 * NOT in Appendix A. This list comes from the navigators' own August collection sheet and the
 * monthly ER Journey deck (docs/specs/phase8-brief.md §5), which split every figure by area. Like
 * the wards it only seeds an empty table: from there Admin → Reference lists owns it, and the
 * hard rule about not renaming the taxonomy is about Appendix A, not about this.
 */
export const ED_AREAS: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'RESUS', name: 'Resuscitation area' },
  { code: 'ACUTE', name: 'Acute area' },
  { code: 'RAZ', name: 'Rapid assessment zone' },
  { code: 'POOL', name: 'Pooling area' },
  { code: 'ISO', name: 'Isolation' },
  { code: 'NEGP', name: 'Negative pressure room' },
]

/** The triage acuity levels the ED decks and the Adaa form report every KPI per. */
export const CTAS_LEVELS = [1, 2, 3, 4, 5] as const
export type CtasLevel = (typeof CTAS_LEVELS)[number]

/** Display labels for enums. The enum values themselves live in prisma/schema.prisma. */
export const DISPOSITION_LABELS = {
  ADMITTED: 'Admitted',
  DISCHARGED_HOME: 'Discharged home',
  DISCHARGED_DAMA: 'Discharged DAMA',
  TRANSFERRED: 'Transferred to another facility',
  LEFT_WITHOUT_BEING_SEEN: 'Left without being seen',
  OTHER: 'Other',
} as const

export const SHIFT_LABELS = { MORNING: 'Morning', EVENING: 'Evening', NIGHT: 'Night' } as const

export const INVESTIGATION_LABELS = { LAB: 'Lab', CT: 'CT', US: 'Ultrasound', XR: 'X-ray / KUB' } as const

export const INVESTIGATION_STEPS = {
  LAB: [
    ['orderedAt', 'Ordered'],
    ['collectedAt', 'Sample collected'],
    ['receivedAt', 'Received by lab'],
    ['resultedAt', 'Resulted'],
  ],
  CT: [
    ['orderedAt', 'Ordered'],
    ['doneAt', 'Scan done'],
    ['resultedAt', 'Reported'],
  ],
  US: [
    ['orderedAt', 'Ordered'],
    ['doneAt', 'Scan done'],
    ['resultedAt', 'Reported'],
  ],
  XR: [
    ['orderedAt', 'Ordered'],
    ['doneAt', 'Done'],
    ['resultedAt', 'Reported'],
  ],
} as const

export const CONSULT_STEPS = [
  ['consultedAt', 'Consulted at'],
  ['seenAt', 'Seen patient at'],
  ['repliedAt', 'Replied / plan given at'],
] as const

export const ADMISSION_STEPS = [
  ['admOrderAt', 'Admission order written'],
  ['bedRequestedAt', 'Bed requested (fax sent)'],
  ['bedAssignedAt', 'Bed assigned'],
  ['handoverAt', 'Nursing handover done'],
] as const

export const TRANSFER_STEPS = [
  ['transferRequestedAt', 'Transfer requested'],
  ['transferAcceptedAt', 'Accepted by facility'],
  ['transportArrivedAt', 'RCC / transport arrived'],
] as const

export const MILESTONES = [
  ['triageAt', 'Triage'],
  ['roomAt', 'Resus / exam room'],
  ['physicianAt', 'First physician contact'],
  ['decisionAt', 'Disposition decided'],
  ['departedAt', 'Left ED'],
] as const

export const THRESHOLDS_H = [4, 6, 12, 24] as const
