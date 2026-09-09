# Phase 8b: the collection decisions

Ahmed's answers (9 September, evening) to the eight decisions in `docs/specs/phase8-brief.md`
Section 5: A no; B yes; C yes; D yes; E yes for Deceased and Referred to UCC, no LAMA; F yes;
G yes; H yes. This spec builds them. Rules for every slice as in `docs/specs/phase8-reports.md`
(hard rules, MRN only, no new dependency, tests first, `typecheck`/`lint`/`test`/Playwright green,
no edits to `docs/CHANGELOG.md`, `docs/PLAN.md`, `docs/RUNBOOK.md`; commit format `[ERN-P8.{n}]`).

Sequence: the lead's KPI additions and Slice G (schema, rules, editor, loader) in parallel; Slice H
(dashboard, report, exports) on top of both.

## Data model (Slice G)

```prisma
enum Disposition { ADMITTED DISCHARGED_HOME DISCHARGED_DAMA TRANSFERRED LEFT_WITHOUT_BEING_SEEN OTHER DECEASED REFERRED_UCC }
enum InvestigationType { LAB CT US XR MRI }
enum Answer { YES NO NOT_SURE }
enum CaseManagementReferral { CASE_MANAGER COMPLEX_CARE }
enum CaseManagementCriteria { MEETS NOT_MEETING }
enum CaseManagementAction { ENROLLED FOR_ENROLLMENT }
enum UpdateAction { LEADERSHIP_ESCALATION BED_MANAGEMENT FAX_RCC PRO_SOCIAL_WORK FORCED_SAFETY_ADMISSION DAMA_MANAGEMENT }

model Case {
  // F: pain management (Adaa KPI 8). Answers here are YES or NO; NOT_SURE is refused by zod.
  painkillerPrescribed Answer?
  pethidinePrescribed  Answer?
  pethidineDoseMg      Int?        // 50, 100 or 150, only when pethidinePrescribed is YES
  painkillerAt         DateTime?   // time of painkiller administration
  sickleCellTreatment  Answer?     // "was the treatment identified for the sickle-cell condition?"
  // D: discharge communication. YES, NO or NOT_SURE.
  instructionsGiven    Answer?
  familyEngagement     Answer?
  // B: case management
  caseMgmtReferral     CaseManagementReferral?
  caseMgmtCriteria     CaseManagementCriteria?
  caseMgmtAction       CaseManagementAction?
  caseMgmtCalledAt     DateTime?
  caseMgmtRepliedAt    DateTime?
  // H: supervisor review
  reviewedAt           DateTime?
  reviewedById         String?
  reviewedBy           User? @relation("CaseReviewedBy", fields: [reviewedById], references: [id], onDelete: Restrict)
}
model CaseUpdate { action UpdateAction? }   // C: set at creation only; the table stays append-only
model User { reviewedCases Case[] @relation("CaseReviewedBy") }
```

Migration `20260910120000_collection_decisions`, generated with `prisma migrate diff --from-schema
<copy> --to-schema prisma/schema.prisma --script`, read by eye, proven on an empty database and
on a database migrated from the previous chain. Enum values are added with `ALTER TYPE ... ADD
VALUE`; nothing in the same migration uses the new values.

Taxonomy (`src/lib/domain/taxonomy.ts`): `DISPOSITION_LABELS` gains `DECEASED: 'Deceased'` and
`REFERRED_UCC: 'Referred to UCC'` (Ahmed's decision E; Appendix A's list is extended, not
renamed, and the plan records it); `INVESTIGATION_LABELS.MRI = 'MRI'` and `INVESTIGATION_STEPS.MRI`
= the CT steps (ordered, scan done, preliminary report, reported); `UPDATE_ACTION_LABELS` in the
weekly deck's words: `LEADERSHIP_ESCALATION: 'Leadership escalation'`, `BED_MANAGEMENT: 'Case /
bed management'`, `FAX_RCC: 'External transfer / fax / RCC'`, `PRO_SOCIAL_WORK: 'PRO / social
work'`, `FORCED_SAFETY_ADMISSION: 'Forced / safety admission'`, `DAMA_MANAGEMENT: 'DAMA
management'`; `ANSWER_LABELS` (Yes / No / Not sure); `CASE_MANAGEMENT_LABELS` (Case manager /
Complex-care coordinator; Meets criteria / Not meeting criteria; Enrolled / For enrollment);
`PETHIDINE_DOSES = [50, 100, 150]`.

Policy (`src/lib/authz/policy.ts`): new action `case.review`, SUPERVISORS (SUPERVISOR, ADMIN).
The matrix test gains the cell. Audit action `case.review` (entity `Case`, `after: { reviewedAt,
reviewedById }`).

## Rules and services (Slice G)

- `validation.ts`: the draft gains the fields above with their enums; `pethidineDoseMg` in
  {50, 100, 150} and only with `pethidinePrescribed === 'YES'`; `painkillerAt` only with
  `painkillerPrescribed === 'YES'`; the case-management times ordered called <= replied
  (warning, not error, in `warnings.ts`); `painkillerAt` before registration is a warning.
  `updateTextSchema` is joined by `updateActionSchema` (optional enum). Resolve carries
  `instructionsGiven` and `familyEngagement`.
- `service.ts`: `createCase`, `saveCase`, `resolveCase` write the new scalars through
  `caseScalarData`; the snapshot and the diff carry them; `addCaseUpdate(caseId, text, action?)`
  stores the action; a new `reviewCase(actor, caseId, ctx)` requires `case.review`, sets
  `reviewedAt = now` and `reviewedById = actor.id` (idempotent: a second mark refreshes the time),
  writes the audit row, and is NOT version-checked (it changes no case content). `saveCase` and
  `resolveCase` clear `reviewedAt`/`reviewedById` when they change anything (a reviewed entry
  that is edited afterwards is no longer reviewed); `addCaseUpdate`, `reopenCase` and `voidCase`
  leave it alone. `app/cases/actions.ts` gets `reviewCase` (guarded by `requireUser` + the service's
  `assertCan`, like the others).
- Loader (`stats-mapper.ts`, `aggregates.ts`): `CaseForStats` gains every field the KPI contract
  below names, including `updateActions` (the distinct `UpdateAction` values on the case's
  updates, from a grouped select or the updates relation) and `reviewedByName`.

## Editor (Slice G)

- Investigations: an MRI row like CT (ordered, scan done, preliminary report, reported).
- Updates: an optional "Action taken" single-select chip row above the text box with the six
  deck labels; the update list shows the label as a small chip before the text.
- New section "Pain management (Adaa KPI 8)" after "Investigation times": Painkiller prescribed
  (Yes / No chips), and when Yes: Pethidine (No / 50 mg / 100 mg / 150 mg) and "Painkiller given
  at" time; Sickle-cell treatment identified (Yes / No). Nothing is required.
- New section "Case management" after "Admission times": Referred to (None / Case manager /
  Complex-care coordinator), and when set: Criteria (Meets / Not meeting), Action (Enrolled / For
  enrollment), "Called at" and "Replied at" times.
- Resolve block: after the disposition, "Instructions given by doctor" and "Family engaged" as
  Yes / No / Not sure chip rows; the disposition select gains Deceased and Referred to UCC (a
  ward is required only for ADMITTED, as today).
- Review: on a case page a SUPERVISOR or ADMIN sees "Mark reviewed" (or "Reviewed by <name>,
  <time> · Mark again") under the Resolve block; NAVIGATOR and VIEWER see the reviewed line only.
  The board row shows a small "Reviewed" chip on resolved cases that carry one.
- Board/handover: nothing else.

Tests (Slice G): validation (dose rules, answer enums, MRI, update action), warnings (painkiller
and case-management order), `tests/db/cases.test.ts` (create/save/resolve carrying every new
field with audit rows; `reviewCase` by SUPERVISOR ok, by NAVIGATOR forbidden with the audit row,
cleared by a later save and not by an update; `addCaseUpdate` with an action), policy matrix,
e2e in `cases.spec.ts` (pain block, case-management block, an update with an action, review
mark visible to a supervisor and absent for a navigator, MRI row, Deceased disposition).

## The KPI contract additions (lead, `src/lib/domain/kpi.ts`)

```ts
export type Answer = 'YES' | 'NO' | 'NOT_SURE'
export type UpdateActionKind = 'LEADERSHIP_ESCALATION' | 'BED_MANAGEMENT' | 'FAX_RCC' | 'PRO_SOCIAL_WORK' | 'FORCED_SAFETY_ADMISSION' | 'DAMA_MANAGEMENT'
export type KpiInvestigationType = 'LAB' | 'CT' | 'US' | 'XR' | 'MRI'
KpiCase += {
  painkillerPrescribed: Answer | null; pethidinePrescribed: Answer | null; pethidineDoseMg: number | null; painkillerAt: Date | null; sickleCellTreatment: Answer | null
  instructionsGiven: Answer | null; familyEngagement: Answer | null
  caseMgmtReferral: 'CASE_MANAGER' | 'COMPLEX_CARE' | null; caseMgmtCriteria: 'MEETS' | 'NOT_MEETING' | null; caseMgmtAction: 'ENROLLED' | 'FOR_ENROLLMENT' | null; caseMgmtCalledAt: Date | null; caseMgmtRepliedAt: Date | null
  reviewedAt: Date | null; reviewedByName: string | null
  updateActions: ReadonlyArray<UpdateActionKind>   // distinct kinds on the case's updates
}
export function kpi8Minutes(c): number | null           // door to painkiller given, when painkillerPrescribed is YES
export type AdaaKpi += 'kpi7' | 'kpi8'; benchmark('kpi8', minutes): <60 world, <=180 acceptable, <=300 improve, >300 unacceptable; benchmark('kpi7', ...) = null
export const PAINKILLER_BANDS  // '≤30 min', '31–60 min', '1–3 h', '>3 h' (the form's Pain Killer Statistics block; (min, max] with the first closed at 30)
export function painkillerBands(cases): IdRow[]
export function pethidineDoses(cases): IdRow[]           // '50 mg', '100 mg', '150 mg' among pethidinePrescribed YES
AdaaSummaryRow += { kpi8TotalMin: number | null; kpi8N: number; kpi8Med: number | null; painkiller: number[] /* per PAINKILLER_BANDS */; pethidine: number[] /* per dose */; deceasedShare: number | null; deceasedN: number; uccN: number; sickleCellYesN: number }
ACTION_KINDS = the six deck categories; actionsDocumented folds the recorded signals in: LEADERSHIP_ESCALATION also from medAdminInformedAt, BED_MANAGEMENT also from bedRequestedAt, FAX_RCC also from transferRequestedAt; plus a seventh row 'Update without an action tag' (updates beyond the tagged ones); `any` = any of the seven
export function communication(cases): ShareRow[]         // 'Instructions given by doctor', 'Family engaged': n = answered (YES/NO/NOT_SURE), within = YES
Completeness += { resolvedNotReviewed: IdRow }           // RESOLVED with no reviewedAt
timeline(): 'Painkiller given', 'Case management called', 'Case management replied' steps; MRI rows like CT
```

## Dashboard, report, exports (Slice H)

- Adaa panel: rows for KPI 7 (mortality, share of resolved, no benchmark) and KPI 8 (door to
  painkiller, median minutes, benchmark colour), and the painkiller bands table under the
  treated-within bands, with the pethidine doses beside it.
- Actions documented: the seven rows from `actionsDocumented` (labels from the module).
- Documentation: the new "Resolved, not reviewed" row.
- New small section "Discharge communication" after Outcomes: the two `communication()` rows as
  share bars (n<3 guarded).
- Drill sections for anything new (`painkiller`, `communication`, the reviewed row under
  `quality`).
- Report: the same panels.
- Adaa workbook: columns I–N filled (I sickle-cell Yes/No, J painkiller prescribed Yes/No, K
  calendar days later for the painkiller time, L pethidine prescribed Yes/No, M dose 50/100/150,
  N time of administration hh:mm); discharge type `Deceased` and `Referred to UCC`; the KPI
  summary gains the KPI 7 and KPI 8 columns and the form's Pain Killer Statistics block (bands
  and pethidine counts per CTAS, as the form's `Summary Sheet` rows 34–36 lay them out); the Read
  me drops the "blank until recorded" lines that are no longer true and says KPI 7 counts
  Deceased dispositions.
- QCH workbook: `intructions given by doctor`, `Family Engagement`, `Referral to Case Management`
  (`Case manager` / `Complex care co.`), `Complex care Cordinator comment` (`Meeting criteria` /
  `Not meeting criteria`), `Complex care Coordinator Action` (`enrolled` / `for enrollment`),
  `Time of call case manger`, `Time of case manger replay`, `Reviewed By` (the reviewer's display
  name) filled; `Case Manager Name` stays blank (a staff name, decision A's spirit); `Image` type
  `MRI` allowed; `Final Decision` / `ER-MD Decision` map Deceased to `Other` and Referred to UCC
  to `Referral`? No: the August dropdown has no Deceased; write `Deceased` and `Referred to UCC`
  verbatim and say so in the Read me. Read me updated.
- Tests: unit on the new cells, db export test rows carrying the new fields, e2e download
  asserts one new cell; dashboard e2e for the new rows; screenshots `phase8b-*`.
