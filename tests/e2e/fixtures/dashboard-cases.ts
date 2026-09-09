import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { E2E_USERS } from './seed-users'

/**
 * A dashboard worth reading: thirteen cases spread over the last twenty-nine days, so the range
 * chips actually change the answer, the weekly chart has more than one week, and enough consults,
 * investigations and resolutions exist for a median to clear `MIN_N` instead of rendering "n<3".
 * The last of them carries Ahmed's Phase 8b collection decisions, so the Adaa pain block, the
 * discharge-communication shares and the review mark all have something real to draw.
 *
 * Written straight to the database (owner role) for the same reason the board fixture is: a case
 * that registered twenty-nine days ago and left the department twenty-six hours later is not
 * something a test should type into an editor.
 *
 * The MRNs are seven digits starting `32000`, which nothing else in the suite uses — the board
 * fixture is `310000`, the case flow generates six digits — so a dashboard assertion can name
 * exactly these rows even though the other spec files are opening their own cases against the
 * same database at the same time. Assertions match the list, never the prefix: `3200010` does not
 * start with `320000`, and a six-digit MRN elsewhere could contain `32000` by chance. They belong
 * to the e2e navigator, so `seedE2EUsers()` clears the previous run's copies before this seeds a
 * fresh set.
 */

const HOUR = 36e5

type Seed = {
  mrn: string
  /** Hours before "now" that the patient registered. */
  registeredHoursAgo: number
  /** Hours of total ED stay; present only on a resolved case. */
  losHours?: number
  shift: 'MORNING' | 'EVENING' | 'NIGHT'
  reason: { stage: string; name: string }
  /** Free text typed into the stage's "Other" box, which the Other review queue lists. */
  other?: { stage: string; text: string }
  /** Departments consulted, with hours after registration for consulted / seen / replied. */
  consults?: ReadonlyArray<{ name: string; consulted: number; seen?: number; replied?: number }>
  investigation?: {
    type: 'LAB' | 'CT' | 'US' | 'XR' | 'MRI'
    ordered: number
    mid: number
    done: number
    /** Imaging only (Phase 8): the verbal read, hours after registration. */
    preliminary?: number
  }
  /** Admission chain, in hours after registration. */
  admission?: { order: number; requested: number; assigned: number }
  disposition?:
    | 'ADMITTED'
    | 'DISCHARGED_HOME'
    | 'DISCHARGED_DAMA'
    | 'LEFT_WITHOUT_BEING_SEEN'
    | 'DECEASED'
    | 'REFERRED_UCC'
  ward?: string
  // --- Phase 8 -------------------------------------------------------------------------------
  /** Triage acuity, so the Adaa panel, "By CTAS" and KPI 4 have something to report. */
  ctas?: 1 | 2 | 3 | 4 | 5
  /** An ED area code from prisma/seed.ts (RESUS, ACUTE, RAZ, POOL, ISO, NEGP). */
  area?: string
  /** The journey milestones the Adaa KPIs are measured between, hours after registration. */
  triage?: number
  physician?: number
  decision?: number
  /** Medical admin informed / transfer requested, hours after registration: two action kinds. */
  escalated?: number
  transferRequested?: number
  /**
   * Update texts, hours after registration, newest last. Drives "Actions documented"; an update
   * with an `action` is one of the weekly deck's six categories (Phase 8b, decision C).
   */
  updates?: ReadonlyArray<{ at: number; text: string; action?: UpdateAction }>
  // --- Phase 8b: Ahmed's collection decisions --------------------------------------------------
  /** The Adaa pain block (decision F): the painkiller's hours after registration, and the dose. */
  pain?: { given?: number; pethidine?: 50 | 100 | 150; sickleCell?: boolean }
  /** Case management (decision B), with the call and reply hours after registration. */
  caseMgmt?: {
    referral: 'CASE_MANAGER' | 'COMPLEX_CARE'
    criteria: 'MEETS' | 'NOT_MEETING'
    action: 'ENROLLED' | 'FOR_ENROLLMENT'
    called: number
    replied: number
  }
  /** The two discharge-communication answers (decision D). */
  instructionsGiven?: Answer
  familyEngagement?: Answer
  /** Marked reviewed by the e2e supervisor (decision H), hours after registration. */
  reviewed?: number
}

type Answer = 'YES' | 'NO' | 'NOT_SURE'
type UpdateAction =
  | 'LEADERSHIP_ESCALATION'
  | 'BED_MANAGEMENT'
  | 'FAX_RCC'
  | 'PRO_SOCIAL_WORK'
  | 'FORCED_SAFETY_ADMISSION'
  | 'DAMA_MANAGEMENT'

/** The Other text the queue must show. Distinctive enough that no other fixture can produce it. */
export const DASHBOARD_OTHER_TEXT = 'Family travelling from Dammam to collect the patient'

/** The MRN this fixture gives two cases, so "Repeat visits" has exactly one row of its own. */
export const REPEAT_MRN = '3200011'

/**
 * The one case carrying Ahmed's Phase 8b collection decisions: the pain block, a case-management
 * referral, two tagged updates, both discharge answers, a Deceased disposition and a supervisor's
 * review mark. Every Slice H assertion that names a case names this one.
 */
export const PHASE8B_MRN = '3200013'

export const DASHBOARD_CASES: ReadonlyArray<Seed> = [
  {
    mrn: '3200001',
    registeredHoursAgo: 700,
    losHours: 26,
    shift: 'MORNING',
    reason: { stage: 'adm', name: 'No bed available on accepting ward' },
    consults: [{ name: 'MROD', consulted: 2, seen: 4, replied: 5 }],
    admission: { order: 3, requested: 4, assigned: 20 },
    disposition: 'ADMITTED',
    ward: 'ICU',
    ctas: 2,
    area: 'RESUS',
    triage: 0.25,
    physician: 0.5,
    decision: 2,
    escalated: 5,
    updates: [
      { at: 6, text: 'Bed coordinator paged, no ICU bed yet' },
      { at: 18, text: 'Medical admin on-call aware, chasing the unit' },
    ],
  },
  {
    mrn: '3200002',
    registeredHoursAgo: 600,
    losHours: 14,
    shift: 'EVENING',
    reason: { stage: 'inv', name: 'Imaging: report delay' },
    investigation: { type: 'CT', ordered: 2, mid: 5, done: 9, preliminary: 6 },
    disposition: 'DISCHARGED_HOME',
    ctas: 3,
    area: 'ACUTE',
    triage: 0.2,
    physician: 0.4,
    decision: 12,
  },
  {
    mrn: '3200003',
    registeredHoursAgo: 500,
    losHours: 9,
    shift: 'NIGHT',
    reason: { stage: 'ref', name: 'Awaiting consulted team response/callback' },
    consults: [
      { name: 'MROD', consulted: 1, seen: 3, replied: 4 },
      { name: 'Internal Medicine', consulted: 2, seen: 6 },
    ],
    disposition: 'ADMITTED',
    ward: 'FMW',
    ctas: 3,
    area: 'ACUTE',
    triage: 0.2,
    physician: 1,
    decision: 6,
  },
  {
    mrn: '3200004',
    registeredHoursAgo: 400,
    losHours: 7,
    shift: 'MORNING',
    reason: { stage: 'dc', name: 'Awaiting pharmacy' },
    disposition: 'DISCHARGED_HOME',
    ctas: 4,
    area: 'RAZ',
    triage: 0.1,
    physician: 0.3,
    decision: 4,
  },
  {
    mrn: '3200005',
    registeredHoursAgo: 300,
    losHours: 5,
    shift: 'EVENING',
    reason: { stage: 'triage', name: 'Waiting for triage nurse availability' },
    disposition: 'DISCHARGED_DAMA',
    ctas: 4,
    physician: 0.5,
    decision: 2,
  },
  {
    mrn: '3200006',
    registeredHoursAgo: 200,
    losHours: 3,
    shift: 'NIGHT',
    reason: { stage: 'reg', name: 'Registration desk/system delay' },
    disposition: 'LEFT_WITHOUT_BEING_SEEN',
    ctas: 5,
  },
  {
    mrn: '3200007',
    registeredHoursAgo: 100,
    losHours: 30,
    shift: 'MORNING',
    reason: { stage: 'adm', name: 'No bed available on accepting ward' },
    consults: [{ name: 'MROD', consulted: 2, seen: 5, replied: 7 }],
    admission: { order: 4, requested: 5, assigned: 25 },
    disposition: 'ADMITTED',
    ward: 'MMW',
    ctas: 2,
    area: 'RESUS',
    triage: 0.3,
    physician: 0.6,
    decision: 8,
    updates: [{ at: 12, text: 'Ward says bed after the afternoon discharge round' }],
  },
  // The open half of the board, one per band.
  {
    mrn: '3200008',
    registeredHoursAgo: 26,
    shift: 'EVENING',
    reason: { stage: 'adm', name: 'No bed available on accepting ward' },
    consults: [
      { name: 'MROD', consulted: 3, seen: 8 },
      { name: 'Internal Medicine', consulted: 4 },
    ],
    ctas: 3,
    area: 'ACUTE',
    triage: 0.2,
    physician: 0.5,
    updates: [{ at: 20, text: 'Still waiting on the medical ward' }],
  },
  {
    mrn: '3200009',
    registeredHoursAgo: 13,
    shift: 'NIGHT',
    reason: { stage: 'inv', name: 'Lab: delay in processing' },
    investigation: { type: 'LAB', ordered: 1, mid: 2, done: 6 },
    ctas: 3,
    physician: 0.5,
    decision: 3,
  },
  {
    mrn: '3200010',
    registeredHoursAgo: 7,
    shift: 'MORNING',
    reason: { stage: 'ref', name: 'Referral sent, awaiting acceptance' },
    consults: [{ name: 'ICU', consulted: 2 }],
    ctas: 4,
    area: 'RAZ',
    physician: 1,
    transferRequested: 3,
  },
  {
    mrn: REPEAT_MRN,
    registeredHoursAgo: 5,
    shift: 'EVENING',
    reason: { stage: 'dispo', name: 'Awaiting senior/attending sign-off' },
    ctas: 5,
    area: 'POOL',
    physician: 0.5,
    decision: 1,
  },
  {
    mrn: '3200012',
    registeredHoursAgo: 2,
    shift: 'NIGHT',
    reason: { stage: 'dc', name: 'Awaiting patient transport home' },
    other: { stage: 'dc', text: DASHBOARD_OTHER_TEXT },
  },
  // The same patient back a second time, under six hours so that every existing threshold
  // assertion above is untouched, and the only repeat-visit row on the dashboard.
  {
    mrn: REPEAT_MRN,
    registeredHoursAgo: 3,
    shift: 'NIGHT',
    reason: { stage: 'triage', name: 'Re-triage required' },
  },
  /**
   * Phase 8b's case: everything Ahmed's collection decisions added, on one patient, so every new
   * panel has a row of its own. Registered four hours ago and resolved after two, which keeps it
   * out of every band and threshold the assertions above name — the six-hour drill-down, the
   * 24-hour band and the seven-day window are all unchanged by it.
   */
  {
    mrn: PHASE8B_MRN,
    registeredHoursAgo: 4,
    losHours: 2,
    shift: 'MORNING',
    reason: { stage: 'dc', name: 'Patient signing DAMA' },
    ctas: 3,
    area: 'ACUTE',
    triage: 0.1,
    physician: 0.4,
    decision: 1,
    disposition: 'DECEASED',
    // The Adaa pain block: 45 minutes from the door, so the case lands in the second band.
    pain: { given: 0.75, pethidine: 100, sickleCell: true },
    caseMgmt: { referral: 'COMPLEX_CARE', criteria: 'MEETS', action: 'ENROLLED', called: 0.5, replied: 1.25 },
    instructionsGiven: 'YES',
    familyEngagement: 'NOT_SURE',
    reviewed: 2.5,
    investigation: { type: 'MRI', ordered: 0.5, mid: 1, done: 1.5, preliminary: 1.25 },
    updates: [
      { at: 0.6, text: 'Escalated to the medical admin on call', action: 'LEADERSHIP_ESCALATION' },
      { at: 1.2, text: 'Social work asked to sit with the family', action: 'PRO_SOCIAL_WORK' },
    ],
  },
]

/** Every MRN this fixture writes, once each. An assertion narrows to this list, never to a prefix. */
export const DASHBOARD_MRNS: ReadonlyArray<string> = [...new Set(DASHBOARD_CASES.map((c) => c.mrn))]

/** Elapsed hours the dashboard will compute for each seeded case, for the drill-down assertions. */
export const elapsedOf = (seed: Seed): number => seed.losHours ?? seed.registeredHoursAgo

/** The fixture MRNs the "Over {t}h" drill-down must list, and by omission the ones it must not. */
export function fixtureMrnsOver(hours: number): string[] {
  return [...new Set(DASHBOARD_CASES.filter((c) => elapsedOf(c) >= hours).map((c) => c.mrn))].sort()
}

/** The fixture MRNs whose stay falls in a given half-open band, for the "Stay bands" drill-down. */
export function fixtureMrnsInBand(min: number, max: number | null): string[] {
  return [
    ...new Set(
      DASHBOARD_CASES.filter((c) => elapsedOf(c) >= min && (max == null || elapsedOf(c) < max)).map((c) => c.mrn),
    ),
  ].sort()
}

/** Registered inside the last seven days: what the "7 days" chip must narrow the page down to. */
export const WITHIN_7_DAYS = DASHBOARD_CASES.filter((c) => c.registeredHoursAgo <= 7 * 24)

function ownerClient(): PrismaClient {
  const connectionString = process.env.E2E_OWNER_DATABASE_URL ?? process.env.DATABASE_URL
  if (!connectionString) throw new Error('[e2e] E2E_OWNER_DATABASE_URL or DATABASE_URL must be set')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

export async function seedDashboardCases(): Promise<void> {
  const prisma = ownerClient()
  try {
    const navigator = await prisma.user.findUnique({
      where: { username: E2E_USERS.navigator.username },
      select: { id: true },
    })
    if (!navigator) throw new Error('[e2e] seedE2EUsers() must run before seedDashboardCases()')
    // Decision H's review mark names a real reviewer, and the QCH sheet prints their display name.
    const supervisor = await prisma.user.findUnique({
      where: { username: E2E_USERS.supervisor.username },
      select: { id: true },
    })
    if (!supervisor) throw new Error('[e2e] seedE2EUsers() must run before seedDashboardCases()')

    const [stages, departments, wards, areas] = await Promise.all([
      prisma.stage.findMany({
        select: { code: true, reasons: { select: { id: true, name: true, isOther: true } } },
      }),
      prisma.department.findMany({ select: { id: true, name: true } }),
      prisma.ward.findMany({ select: { id: true, code: true } }),
      prisma.edArea.findMany({ select: { id: true, code: true } }),
    ])
    const reasonId = (stageCode: string, name: string): string => {
      const stage = stages.find((s) => s.code === stageCode)
      const reason = stage?.reasons.find((r) => r.name === name)
      if (!reason) throw new Error(`[e2e] the seed has no "${name}" reason under "${stageCode}"`)
      return reason.id
    }
    const otherReasonId = (stageCode: string): string => {
      const stage = stages.find((s) => s.code === stageCode)
      const reason = stage?.reasons.find((r) => r.isOther)
      if (!reason) throw new Error(`[e2e] the seed has no Other reason under "${stageCode}"`)
      return reason.id
    }
    const departmentId = (name: string): string => {
      const found = departments.find((d) => d.name === name)
      if (!found) throw new Error(`[e2e] the seed has no "${name}" department`)
      return found.id
    }
    const wardId = (code: string): string => {
      const found = wards.find((w) => w.code === code)
      if (!found) throw new Error(`[e2e] the seed has no "${code}" ward`)
      return found.id
    }
    const areaId = (code: string): string => {
      const found = areas.find((a) => a.code === code)
      if (!found) throw new Error(`[e2e] the seed has no "${code}" ED area`)
      return found.id
    }

    const now = Date.now()
    const ago = (hours: number): Date => new Date(now - hours * HOUR)

    for (const seed of DASHBOARD_CASES) {
      const registeredAt = ago(seed.registeredHoursAgo)
      /** A time `hours` after this patient registered. */
      const after = (hours: number): Date => ago(seed.registeredHoursAgo - hours)
      const left = seed.losHours == null ? null : after(seed.losHours)
      const primary = reasonId(seed.reason.stage, seed.reason.name)

      await prisma.case.create({
        data: {
          mrn: seed.mrn,
          registrationAt: registeredAt,
          openedAt: registeredAt,
          createdAt: registeredAt,
          openedById: navigator.id,
          shift: seed.shift,
          status: left ? 'RESOLVED' : 'OPEN',
          primaryReasonId: primary,
          departedAt: left,
          resolvedAt: left,
          disposition: seed.disposition ?? null,
          wardId: seed.ward ? wardId(seed.ward) : null,
          admOrderAt: seed.admission ? after(seed.admission.order) : null,
          bedRequestedAt: seed.admission ? after(seed.admission.requested) : null,
          bedAssignedAt: seed.admission ? after(seed.admission.assigned) : null,
          // Phase 8: the acuity, the area and the journey milestones the Adaa KPIs, the working
          // targets and the per-case timeline are all measured between.
          ctas: seed.ctas ?? null,
          areaId: seed.area ? areaId(seed.area) : null,
          triageAt: seed.triage == null ? null : after(seed.triage),
          physicianAt: seed.physician == null ? null : after(seed.physician),
          decisionAt: seed.decision == null ? null : after(seed.decision),
          medAdminInformedAt: seed.escalated == null ? null : after(seed.escalated),
          transferRequestedAt: seed.transferRequested == null ? null : after(seed.transferRequested),
          // Phase 8b: the pain block, the case-management referral, the two discharge answers and
          // the review mark. A seed that names none of them writes nulls, exactly as today.
          sickleCellTreatment: seed.pain?.sickleCell ? 'YES' : null,
          painkillerPrescribed: seed.pain ? 'YES' : null,
          painkillerAt: seed.pain?.given == null ? null : after(seed.pain.given),
          pethidinePrescribed: seed.pain ? (seed.pain.pethidine == null ? 'NO' : 'YES') : null,
          pethidineDoseMg: seed.pain?.pethidine ?? null,
          caseMgmtReferral: seed.caseMgmt?.referral ?? null,
          caseMgmtCriteria: seed.caseMgmt?.criteria ?? null,
          caseMgmtAction: seed.caseMgmt?.action ?? null,
          caseMgmtCalledAt: seed.caseMgmt == null ? null : after(seed.caseMgmt.called),
          caseMgmtRepliedAt: seed.caseMgmt == null ? null : after(seed.caseMgmt.replied),
          instructionsGiven: seed.instructionsGiven ?? null,
          familyEngagement: seed.familyEngagement ?? null,
          reviewedAt: seed.reviewed == null ? null : after(seed.reviewed),
          reviewedById: seed.reviewed == null ? null : supervisor.id,
          updates: {
            create: (seed.updates ?? []).map((u) => ({
              authorId: navigator.id,
              createdAt: after(u.at),
              text: u.text,
              action: u.action ?? null,
            })),
          },
          reasons: {
            create: [
              { reasonId: primary },
              ...(seed.other
                ? [{ reasonId: otherReasonId(seed.other.stage), otherText: seed.other.text }]
                : []),
            ],
          },
          consults: {
            create: (seed.consults ?? []).map((c) => ({
              departmentId: departmentId(c.name),
              consultedAt: after(c.consulted),
              seenAt: c.seen == null ? null : after(c.seen),
              repliedAt: c.replied == null ? null : after(c.replied),
            })),
          },
          investigations: {
            create: seed.investigation
              ? [
                  {
                    type: seed.investigation.type,
                    orderedAt: after(seed.investigation.ordered),
                    collectedAt:
                      seed.investigation.type === 'LAB' ? after(seed.investigation.mid) : null,
                    receivedAt:
                      seed.investigation.type === 'LAB' ? after(seed.investigation.mid + 0.5) : null,
                    doneAt: seed.investigation.type === 'LAB' ? null : after(seed.investigation.mid),
                    preliminaryAt:
                      seed.investigation.preliminary == null ? null : after(seed.investigation.preliminary),
                    resultedAt: after(seed.investigation.done),
                  },
                ]
              : [],
          },
        },
        select: { id: true },
      })
    }
  } finally {
    await prisma.$disconnect()
  }
}
