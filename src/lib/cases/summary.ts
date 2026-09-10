/**
 * The per-case summary: one screen, and one block of text, in the shape of the weekly deck's
 * ranked-table row plus its time sequence (Phase 10, Ahmed's request 3).
 *
 * Pure, like `timeline.ts` beside it: `summaryOf` reads the case the editor already loaded and
 * the reference list that page already has, and returns plain JSON — every instant an ISO-8601
 * string, because this crosses the RSC boundary on the case page and `fetch` from the board.
 * `summaryText` renders that JSON as the lines a navigator pastes into a handover message.
 *
 * Two rules it exists to keep:
 *
 *   - MRN only. No name, no national ID, no date of birth — the hard rule — and, beyond that,
 *     NO FREE TEXT A NAVIGATOR TYPED: not an update's text, not the resolution note. The summary
 *     is built to be shared, and free text is where a name gets typed by accident. The working
 *     diagnosis and an "Other" reason box are the two exceptions, and they are here because they
 *     are the clinical line the summary is about; both are identifier-warned in the editor.
 *   - Nothing is computed twice. The elapsed clock is `elapsedHours` (the board's and the
 *     editor's), the time sequence is `timeline()`'s (already on the loaded case), and the
 *     documented actions follow `actionsDocumented` in `kpi.ts` exactly: a kind counts when a
 *     navigator tagged an update with it OR when the case carries the timestamp that records it.
 */
import { ACTION_KINDS, type ActionKind } from '@/src/lib/domain/kpi'
import { DISPOSITION_LABELS, PAYER_LABELS } from '@/src/lib/domain/taxonomy'
import { band, elapsedHours, fmtHours, type Band } from '@/src/lib/domain/time'
import { fmtStamp } from './local-time'
import type { LoadedCase } from './load'
import type { TimelineStepView } from './timeline'
import type { CaseDraft, ReferenceData } from './types'

/**
 * reasonId -> the stage that owns it. `reference.ts` has this map already, but importing it here
 * would pull `@/src/lib/db` — and therefore Prisma — into the browser bundle, and `summaryText`
 * runs in the Copy handler of a client component. Six lines is the price of a module the client
 * can import.
 */
function stageOwners(reference: ReferenceData): Map<string, { id: string; name: string }> {
  const owner = new Map<string, { id: string; name: string }>()
  for (const stage of reference.stages) {
    for (const reason of stage.reasons) owner.set(reason.id, { id: stage.id, name: stage.name })
  }
  return owner
}

/** The six deck categories. `ACTION_KINDS` also carries "UNTAGGED", which is not a category. */
const SUMMARY_ACTION_KINDS = ACTION_KINDS.filter(([kind]) => kind !== 'UNTAGGED')

/**
 * The band in words. The colours are a screen affordance; a pasted summary has none, so the
 * threshold the row crossed has to be sayable. The numbers are `band()`'s own (4, 6, 12, 24).
 */
export const BAND_LABELS: Record<Band, string> = {
  none: 'not recorded',
  ok: 'under 4 h',
  h4: '4 h or more',
  h6: '6 h or more',
  h12: '12 h or more',
  h24: '24 h or more',
}

export type SummaryReason = {
  name: string
  stageName: string
  /** The one reason the navigator marked as the reason the patient is still here. */
  primary: boolean
  /** What was typed into this reason's "Other" box, or null. */
  otherText: string | null
}

/**
 * One deck category. `count` is the evidence behind it: the tagged updates, plus one for the
 * timestamp that records it where there is one (the escalation, the bed request, the transfer
 * request). A kind is documented exactly when `count > 0`, which is `actionsDocumented`'s rule.
 */
export type SummaryAction = { kind: ActionKind; name: string; count: number }

export type SummaryOutcome = {
  dispositionLabel: string | null
  wardCode: string | null
  isolation: boolean
  reviewedByName: string | null
  reviewedAt: string | null
}

export type CaseSummary = {
  id: string
  mrn: string
  status: LoadedCase['status']
  ctas: number | null
  areaName: string | null
  payerLabel: string | null
  diagnosis: string | null
  registrationAt: string
  /** When the patient left the ED, or null while they are still in it. */
  leftAt: string | null
  elapsedHours: number | null
  band: Band
  /**
   * The stages the case's reasons belong to, distinct, in the order `reasons` lists them — so
   * the primary reason's stage leads. The deck's "classification" column.
   */
  stageNames: string[]
  reasons: SummaryReason[]
  /** The teams consulted, by name. */
  departments: string[]
  actions: SummaryAction[]
  updates: { count: number; lastAt: string | null }
  outcome: SummaryOutcome
  timeline: TimelineStepView[]
  /** The instant the summary was taken: it is a reading of the case, not a live view. */
  generatedAt: string
}

function nameOf<T extends { id: string }>(rows: ReadonlyArray<T>, id: string | null): T | null {
  if (!id) return null
  return rows.find((row) => row.id === id) ?? null
}

/**
 * The tagged-update counts per kind, from the update rows the editor already holds.
 *
 * The app's own resolve, reopen, void and alert notes never carry a category (they are written
 * with `system: true` and no `action`), so counting by `action` alone already excludes them —
 * the same exclusion `toCaseForStats` makes explicitly, reached here by construction.
 */
function taggedCounts(updates: LoadedCase['updates']): Map<string, number> {
  const counts = new Map<string, number>()
  for (const update of updates) {
    if (!update.action) continue
    counts.set(update.action, (counts.get(update.action) ?? 0) + 1)
  }
  return counts
}

/** The timestamp on the case that documents a kind on its own (`actionKindsOf` in kpi.ts). */
function recordedStep(draft: CaseDraft, kind: ActionKind): boolean {
  if (kind === 'LEADERSHIP_ESCALATION') return draft.medAdminInformedAt !== null
  if (kind === 'BED_MANAGEMENT') return draft.bedRequestedAt !== null
  if (kind === 'FAX_RCC') return draft.transferRequestedAt !== null
  return false
}

export function summaryOf(loaded: LoadedCase, reference: ReferenceData, now: Date): CaseSummary {
  const draft = loaded.draft
  const owner = stageOwners(reference)
  const stageOrder = new Map(reference.stages.map((stage, index) => [stage.id, index]))
  const reasonById = new Map(reference.stages.flatMap((s) => s.reasons.map((r) => [r.id, r] as const)))
  const departmentById = new Map(reference.departments.map((d) => [d.id, d.name]))

  // The reasons in stage order, then the primary lifted to the front: the deck's row reads "the
  // reason this patient is still here, and what else is open behind it".
  const reasons: SummaryReason[] = [...draft.reasons]
    .sort((a, b) => {
      const sa = stageOrder.get(owner.get(a.reasonId)?.id ?? '') ?? Number.MAX_SAFE_INTEGER
      const sb = stageOrder.get(owner.get(b.reasonId)?.id ?? '') ?? Number.MAX_SAFE_INTEGER
      return sa - sb
    })
    .map((r) => ({
      name: reasonById.get(r.reasonId)?.name ?? 'Unknown reason',
      stageName: owner.get(r.reasonId)?.name ?? 'Unknown stage',
      primary: r.reasonId === draft.primaryReasonId,
      otherText: r.otherText && r.otherText.trim() !== '' ? r.otherText : null,
    }))
    .sort((a, b) => Number(b.primary) - Number(a.primary))

  const stageNames = [...new Set(reasons.map((r) => r.stageName))]

  // The same clock the board row and the editor header show, so three readings of one case never
  // disagree. `resolvedAt` is not on the loaded case because `resolveCase` always writes a
  // departure time: for a RESOLVED case that IS the end of the clock.
  const clock = {
    status: loaded.status,
    registrationAt: new Date(draft.registrationAt),
    departedAt: draft.departedAt ? new Date(draft.departedAt) : null,
    resolvedAt: null,
  }
  const elapsed = elapsedHours(clock, now)

  const tagged = taggedCounts(loaded.updates)
  const actions: SummaryAction[] = SUMMARY_ACTION_KINDS.map(([kind, name]) => ({
    kind,
    name,
    count: (tagged.get(kind) ?? 0) + (recordedStep(draft, kind) ? 1 : 0),
  }))

  const lastUpdate = loaded.updates.reduce<string | null>(
    (latest, u) => (latest === null || u.createdAt > latest ? u.createdAt : latest),
    null,
  )

  return {
    id: loaded.id,
    mrn: draft.mrn,
    status: loaded.status,
    ctas: draft.ctas,
    areaName: nameOf(reference.areas, draft.areaId)?.name ?? null,
    payerLabel: draft.payer ? PAYER_LABELS[draft.payer] : null,
    diagnosis: draft.diagnosis.trim() === '' ? null : draft.diagnosis,
    registrationAt: draft.registrationAt,
    // Only a case that has left: an open case keeps its old departure time after a reopen, and
    // `endAt` reads that as "still here" everywhere else in the app.
    leftAt: loaded.status === 'RESOLVED' ? draft.departedAt : null,
    elapsedHours: elapsed,
    band: band(elapsed),
    stageNames,
    reasons,
    departments: draft.consults
      .map((c) => departmentById.get(c.departmentId))
      .filter((name): name is string => !!name),
    actions,
    updates: { count: loaded.updates.length, lastAt: lastUpdate },
    outcome: {
      dispositionLabel: draft.disposition ? DISPOSITION_LABELS[draft.disposition] : null,
      wardCode: nameOf(reference.wards, draft.wardId)?.code ?? null,
      isolation: draft.isolation,
      reviewedByName: loaded.review?.byName ?? null,
      reviewedAt: loaded.review?.at ?? null,
    },
    timeline: loaded.timeline,
    generatedAt: now.toISOString(),
  }
}

const STATUS_TEXT: Record<LoadedCase['status'], string> = {
  OPEN: 'Open',
  RESOLVED: 'Resolved',
  VOIDED: 'Voided',
}

/** One "Label: value" line, dropped entirely when there is nothing to say. */
function line(label: string, value: string | null): string | null {
  return value === null || value === '' ? null : `${label}: ${value}`
}

/**
 * The summary as text, for the Copy button: the deck's shape, one line per row, MRN only, and
 * not one character of free text a navigator typed into an update or a resolution note.
 */
export function summaryText(summary: CaseSummary): string {
  const reasonLine = (r: SummaryReason): string =>
    `  ${r.primary ? '* ' : '- '}${r.name} (${r.stageName})${r.otherText ? ` — ${r.otherText}` : ''}`

  const documented = summary.actions.filter((a) => a.count > 0)
  const review =
    summary.outcome.reviewedByName && summary.outcome.reviewedAt
      ? `${summary.outcome.reviewedByName}, ${fmtStamp(summary.outcome.reviewedAt)}`
      : null

  const rows: Array<string | null> = [
    `Case summary — MRN ${summary.mrn}`,
    line('CTAS', summary.ctas == null ? null : String(summary.ctas)),
    line('ED area', summary.areaName),
    line('Payer', summary.payerLabel),
    line('Working diagnosis', summary.diagnosis),
    line('Status', STATUS_TEXT[summary.status]),
    line('Registered', fmtStamp(summary.registrationAt)),
    line('Left ED', summary.leftAt ? fmtStamp(summary.leftAt) : 'still in the ED'),
    line('Time in the ED', `${fmtHours(summary.elapsedHours)} (${BAND_LABELS[summary.band]})`),
    line('Classification', summary.stageNames.join(', ') || 'none recorded'),
    'Waiting on:',
    ...(summary.reasons.length > 0 ? summary.reasons.map(reasonLine) : ['  - no reason recorded']),
    line('Teams', summary.departments.join(', ') || 'none'),
    line(
      'Documented actions',
      documented.length > 0 ? documented.map((a) => `${a.name} ×${a.count}`).join(', ') : 'none',
    ),
    line(
      'Updates',
      `${summary.updates.count}${summary.updates.lastAt ? `, last ${fmtStamp(summary.updates.lastAt)}` : ''}`,
    ),
    line('Outcome', summary.outcome.dispositionLabel),
    line('Ward', summary.outcome.wardCode),
    summary.outcome.isolation ? 'Isolation: yes' : null,
    line('Reviewed by', review),
    '',
    'Time sequence:',
    ...summary.timeline.map(
      (step) =>
        `  ${fmtStamp(step.at)}  ${step.label}${step.fromPrevious == null ? '' : `  +${fmtHours(step.fromPrevious)}`}`,
    ),
  ]

  return rows.filter((row): row is string => row !== null).join('\n')
}
