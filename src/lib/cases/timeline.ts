/**
 * The per-case time sequence, as the case page and the handover sheet render it.
 *
 * The sequence itself is `timeline()` in `src/lib/domain/kpi.ts` — every recorded instant on the
 * case in time order, with the hours since the previous one, which is the weekly deck's per-case
 * slide generated. This module does two things and no arithmetic:
 *
 *   - it names the subset of `KpiCase` that `timeline()` actually reads, so a caller that has the
 *     milestones but not the counters (the board's row select) can produce a timeline without
 *     inventing a CTAS or an update count it does not have;
 *   - it turns the steps into plain JSON, because the board's payload crosses `fetch` and the
 *     case page's crosses the RSC boundary, and both carry every instant as an ISO-8601 string
 *     exactly as `src/lib/cases/types.ts` and `src/lib/board/types.ts` already do.
 */
import { timeline, type KpiCase } from '@/src/lib/domain/kpi'

/** One step, on the wire. `fromPrevious` is hours since the step before it; null on the first. */
export type TimelineStepView = { key: string; label: string; at: string; fromPrevious: number | null }

/**
 * What `timeline()` never reads. Filled with inert values so the rest of `KpiCase` — the parts a
 * caller may genuinely not have loaded — does not have to be faked at every call site. If
 * `timeline()` ever grows to read one of these, this object stops compiling as a safe default and
 * the type below stops hiding it.
 */
const NOT_READ = {
  id: '',
  mrn: '',
  disposition: null,
  wardCode: null,
  ctas: null,
  areaName: null,
  stageNames: [] as ReadonlyArray<string>,
  updatesCount: 0,
  lastUpdateAt: null,
  // Phase 8b: the timeline reads painkillerAt and the two case-management times; not these.
  painkillerPrescribed: null,
  pethidinePrescribed: null,
  pethidineDoseMg: null,
  sickleCellTreatment: null,
  instructionsGiven: null,
  familyEngagement: null,
  caseMgmtReferral: null,
  caseMgmtCriteria: null,
  caseMgmtAction: null,
  reviewedAt: null,
  reviewedByName: null,
  updateActions: [] as ReadonlyArray<KpiCase['updateActions'][number]>,
  untaggedUpdatesCount: 0,
  // Phase 10: neither the payer nor the stage codes are a step on the timeline.
  payer: null,
  stageCodes: [] as ReadonlyArray<string>,
} satisfies Partial<KpiCase>

/** Exactly the fields the time sequence is built from. */
export type TimelineSource = Omit<KpiCase, keyof typeof NOT_READ>

export function timelineOf(source: TimelineSource): TimelineStepView[] {
  return timeline({ ...NOT_READ, ...source }).map((step) => ({
    key: step.key,
    label: step.label,
    at: step.at.toISOString(),
    fromPrevious: step.fromPrevious,
  }))
}
