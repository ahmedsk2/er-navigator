/**
 * Shared validation — locked plan section 4, one zod schema per rule, used by the server actions
 * and the client forms alike (single source of truth for rules like "MRN digits only").
 *
 * The reason-dependent rules (a consult is required when a selected reason requires a
 * department; a referral number is required on resolve when a selected reason requires it) need
 * reason metadata that lives in the database, so the case schema is built by a factory that
 * receives that metadata: `buildCaseSchemas(meta)`.
 *
 * Rules that must NOT block a save (out-of-order times, possible identifiers in free text)
 * are not here; they are warnings (warnings.ts, phiWarnings below).
 */
import { z } from 'zod'

/**
 * Turn zod 4's JIT compiler off, process-wide (Phase 7).
 *
 * Zod probes for it with `Function("")` inside a try/catch the first time a schema is used. The
 * probe is harmless — it catches its own failure — but under the Phase 7 CSP, which has no
 * `'unsafe-eval'`, the browser refuses it and logs a `kEvalViolation` to Chrome's Issues panel,
 * which is what cost the case editor its Lighthouse best-practices point. This module is the one
 * zod-touching file that reaches the browser bundle (the case editor imports it), so the setting
 * belongs here. Interpreted validation is slower per parse and completely invisible at the size
 * of one case form.
 */
z.config({ jitless: true })

export const MRN_RE = /^\d+$/
export const mrnSchema = z.string().trim().regex(MRN_RE, 'Enter the MRN as digits only.')

/** Free text: trimmed, capped, never blocking. Identifier risk is reported by phiWarnings(). */
export const freeText = (max: number) => z.string().trim().max(max)
export const updateTextSchema = freeText(1000).min(1, 'Type what changed.')
export const noteSchema = freeText(1000)
export const otherTextSchema = freeText(300)

/** A 10-digit run is the shape of a Saudi national ID, an Iqama and a mobile number. Warn only. */
export const TEN_DIGIT_RUN = /(?<!\d)\d{10}(?!\d)/
export function phiWarnings(label: string, text: string | null | undefined): string[] {
  if (!text) return []
  return TEN_DIGIT_RUN.test(text) ? [`${label} contains a 10-digit number. Only the MRN may identify a patient.`] : []
}

const isoOrDate = z.union([z.date(), z.string().datetime({ offset: true })]).transform((v) => (v instanceof Date ? v : new Date(v)))
export const timeSchema = isoOrDate.nullable().optional()

export const shiftSchema = z.enum(['MORNING', 'EVENING', 'NIGHT'])
export const roomTypeSchema = z.enum(['RESUS', 'EXAM'])
export const dispositionSchema = z.enum(['ADMITTED', 'DISCHARGED_HOME', 'DISCHARGED_DAMA', 'TRANSFERRED', 'LEFT_WITHOUT_BEING_SEEN', 'OTHER'])
export const investigationTypeSchema = z.enum(['LAB', 'CT', 'US', 'XR'])

export const caseReasonInput = z.object({ reasonId: z.string().min(1), otherText: otherTextSchema.nullable().optional() })
export const consultInput = z.object({
  departmentId: z.string().min(1),
  consultedAt: timeSchema,
  seenAt: timeSchema,
  repliedAt: timeSchema,
})
export const investigationInput = z.object({
  type: investigationTypeSchema,
  orderedAt: timeSchema,
  collectedAt: timeSchema,
  receivedAt: timeSchema,
  doneAt: timeSchema,
  /** Imaging only; a LAB row simply never sends it (Phase 8). Optional, like every other time. */
  preliminaryAt: timeSchema,
  resultedAt: timeSchema,
})

/**
 * CTAS is 1 to 5 and optional (Phase 8). The bound lives here rather than in a database CHECK,
 * so widening the scale one day is an Admin decision and not a migration.
 */
export const CTAS_MIN = 1
export const CTAS_MAX = 5
export const ctasSchema = z
  .number()
  .int('CTAS is a whole number from 1 to 5.')
  .min(CTAS_MIN, 'CTAS is a whole number from 1 to 5.')
  .max(CTAS_MAX, 'CTAS is a whole number from 1 to 5.')

/** What the factory needs to know about each reason id the client may send. */
export type ReasonMeta = { requiresDepartment: boolean; requiresReferralNo: boolean; isOther: boolean }

/**
 * `areaIds` is the set of `EdArea` ids this request may use. It comes from the request's own
 * reference data, which is why it is a parameter and not a constant: `loadReference()` is the
 * active list, so a new case can only be opened on an active area, while
 * `loadReferenceForCase(id)` adds the one deactivated area that case already carries, so editing
 * such a case still saves (the Phase 7 retired-row pattern). The default is empty, so a caller
 * that forgets to pass it refuses every area rather than accepting any.
 */
export function buildCaseSchemas(
  meta: ReadonlyMap<string, ReasonMeta>,
  now: () => Date = () => new Date(),
  areaIds: ReadonlySet<string> = new Set(),
) {
  const base = z.object({
    mrn: mrnSchema,
    registrationAt: isoOrDate,
    shift: shiftSchema.nullable().optional(),
    ctas: ctasSchema.nullable().optional(),
    areaId: z.string().nullable().optional(),
    reasons: z.array(caseReasonInput).min(1, 'Select at least one delay reason.'),
    primaryReasonId: z.string().nullable().optional(),
    consults: z.array(consultInput).default([]),
    investigations: z.array(investigationInput).default([]),
    roomType: roomTypeSchema.nullable().optional(),
    triageAt: timeSchema,
    roomAt: timeSchema,
    physicianAt: timeSchema,
    decisionAt: timeSchema,
    departedAt: timeSchema,
    admOrderAt: timeSchema,
    bedRequestedAt: timeSchema,
    bedAssignedAt: timeSchema,
    handoverAt: timeSchema,
    transferRequestedAt: timeSchema,
    transferAcceptedAt: timeSchema,
    transportArrivedAt: timeSchema,
    referralTrackingNo: freeText(64).nullable().optional(),
    transferFacility: freeText(120).nullable().optional(),
    medAdminInformedAt: timeSchema,
    disposition: dispositionSchema.nullable().optional(),
    wardId: z.string().nullable().optional(),
    isolation: z.boolean().default(false),
    resolutionNote: noteSchema.nullable().optional(),
    version: z.number().int().positive(),
  })

  /**
   * The cross-field rules, extracted so that "Mark resolved" enforces exactly what "Save changes"
   * enforces (Phase 7, C5). The resolve schema used to be built from the unrefined `base`, so one
   * tap past a refused save wrote a bare "Other" reason with no text, a requiresDepartment reason
   * with no consult, or a future registration time — data the app's own rules forbid, into the
   * dataset the dashboard and the "Other" review queue read.
   */
  type CrossFieldDraft = z.output<typeof base>
  const crossFieldRules = (c: CrossFieldDraft, ctx: z.RefinementCtx<CrossFieldDraft>): void => {
    // registrationAt <= now
    if (c.registrationAt.getTime() > now().getTime() + 60_000) {
      ctx.addIssue({ code: 'custom', path: ['registrationAt'], message: 'Registration time cannot be in the future.' })
    }
    // The ED area must be one this request knows: active, or retired but already on this case.
    const areaId = c.areaId?.trim()
    if (areaId && !areaIds.has(areaId)) {
      ctx.addIssue({ code: 'custom', path: ['areaId'], message: 'That ED area is no longer on the list.' })
    }
    // unknown reason ids are rejected before the rules that depend on them
    const ids = c.reasons.map((r) => r.reasonId)
    const unknown = ids.filter((id) => !meta.has(id))
    if (unknown.length) {
      ctx.addIssue({ code: 'custom', path: ['reasons'], message: 'Unknown delay reason.' })
      return
    }
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['reasons'], message: 'A reason is selected twice.' })
    }
    // more than one reason: primary required and must be one of them
    if (ids.length > 1) {
      if (!c.primaryReasonId) {
        ctx.addIssue({ code: 'custom', path: ['primaryReasonId'], message: 'Choose the primary reason.' })
      } else if (!ids.includes(c.primaryReasonId)) {
        ctx.addIssue({ code: 'custom', path: ['primaryReasonId'], message: 'The primary reason must be one of the selected reasons.' })
      }
    }
    if (ids.length === 1 && c.primaryReasonId && c.primaryReasonId !== ids[0]) {
      ctx.addIssue({ code: 'custom', path: ['primaryReasonId'], message: 'The primary reason must be one of the selected reasons.' })
    }
    // an "Other" reason needs its text; a non-Other reason must not carry text
    for (const [i, r] of c.reasons.entries()) {
      const m = meta.get(r.reasonId)!
      if (m.isOther && !r.otherText?.trim()) {
        ctx.addIssue({ code: 'custom', path: ['reasons', i, 'otherText'], message: 'Describe the other reason.' })
      }
    }
    // a reason that requires a department needs at least one consult row
    if (ids.some((id) => meta.get(id)!.requiresDepartment) && c.consults.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['consults'], message: 'Add the consulted team for this reason.' })
    }
    const deptIds = c.consults.map((x) => x.departmentId)
    if (new Set(deptIds).size !== deptIds.length) {
      ctx.addIssue({ code: 'custom', path: ['consults'], message: 'A team is listed twice.' })
    }
    const invTypes = c.investigations.map((x) => x.type)
    if (new Set(invTypes).size !== invTypes.length) {
      ctx.addIssue({ code: 'custom', path: ['investigations'], message: 'An investigation type is listed twice.' })
    }
  }

  const withRules = base.superRefine(crossFieldRules)

  /**
   * Resolve is the draft's rules PLUS: disposition required; ADMITTED needs a ward; referral
   * number when required.
   */
  const resolve = base
    .extend({ disposition: dispositionSchema, departedAt: isoOrDate })
    .superRefine(crossFieldRules)
    .superRefine((c, ctx) => {
      if (c.disposition === 'ADMITTED' && !c.wardId) {
        ctx.addIssue({ code: 'custom', path: ['wardId'], message: 'Choose the ward.' })
      }
      const needsRef = c.disposition === 'TRANSFERRED' || c.reasons.some((r) => meta.get(r.reasonId)?.requiresReferralNo)
      if (needsRef && !c.referralTrackingNo?.trim()) {
        ctx.addIssue({ code: 'custom', path: ['referralTrackingNo'], message: 'Enter the referral tracking number.' })
      }
    })

  return { draft: withRules, resolve }
}

export type CaseDraftInput = z.input<ReturnType<typeof buildCaseSchemas>['draft']>
export type CaseDraft = z.output<ReturnType<typeof buildCaseSchemas>['draft']>

/** Void: a reason is mandatory (locked plan section 2, "soft delete with reason"). */
export const voidSchema = z.object({ version: z.number().int().positive(), voidReason: freeText(300).min(3, 'Say why this case is voided.') })

/** Registration-time quick adjustments in the new-case form (locked plan section 4). */
export const REGISTRATION_QUICK_HOURS = [4, 6, 8, 12] as const
export const REGISTRATION_DEFAULT_HOURS_AGO = 6
export const REGISTRATION_NUDGE_MINUTES = 30

/** Optimistic-locking conflict payload, so the UI can show who changed the case and when. */
export type ConflictInfo = { changedBy: string; changedAt: Date }
