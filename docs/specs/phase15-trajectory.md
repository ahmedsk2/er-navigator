# Phase 15: the patient trajectory

Ahmed, 12 September 2026, after the Phase 14 gate. One request, in his words:

> "For patient journey time inputs, some are suitable for discharged patients and some for
> admitted patients only and others for referred patients to other facility like the fax sent at
> and accepted at and RCC transferred the patient at. Same goes for other categories in different
> labels. Hide them and show what is related based on patient trajectory."

Phase 13 already hides what a case cannot have — but only once the **outcome** is chosen, and the
outcome is chosen at the end of the stay. For the ten hours before that, the sheet either shows
every chain or guesses from the delay stages. The trajectory is the nurse saying, early and in one
tap, where this patient is going; from then on the sheet is about that pathway.

The taxonomy NAMES are untouched: no stage, reason, department, ward, ED area, disposition, shift,
payer, investigation type or update action is renamed, added or removed. One additive migration:
one enum and one nullable column on `Case`, read and written by nothing that exists.

This phase also folds in the three Phase 14 follow-ups the close of that phase left with Ahmed
(`docs/PLAN.md`, "Delivered in Phase 14", last bullet), one commit each: items 8, 9 and 10 below.

## Ahmed's request of 12 September 2026, as Fable's design answered it

| # | Decision |
| --- | --- |
| A | A **Patient trajectory** chip row at the top of the Patient journey block, on the new-case form and on an open case alike: Not decided yet (the default, stored NULL), Discharge, Admission, Transfer to another facility. |
| B | While no disposition is chosen, the journey steps follow the trajectory. The Phase 13 stage implications stay only while the trajectory is not decided; once a trajectory is chosen it governs. |
| C | Once a disposition is chosen, the Phase 13 outcome rules govern, exactly as today. |
| D | The other blocks follow it: Referral out, the Ward and Isolation controls at resolve, and the Final disposition list, which is narrowed by trajectory behind a plain "Show all outcomes" control so every outcome stays reachable. |
| E | Changing the trajectory never loses data. A time entered under another pathway stays saved and is named on the Phase 13 "Also recorded" line. |
| F | The delay stages and reasons are NOT filtered by trajectory. |
| G | The trajectory travels with the case: the summary sheet, the handover sheet, the Cases export sheet, the demo seed and the demo kit. |

---

## Rules for every item

The hard rules in `CLAUDE.md`. Tests first: every item below names the assertion it starts from,
and that assertion must fail before the change and pass after. MRN only. Every rule is enforced
server-side and mirrored, never replaced, on the client. `CaseUpdate` and `AuditLog` stay
append-only: this phase adds no `create`, no `update` and no `delete` to either. A stale write is
still a 409. One additive migration, and no existing row is read or written by it.

---

## 1. The column, the enum and the labels

```prisma
/// Phase 15 (docs/specs/phase15-trajectory.md; Ahmed, 12 September 2026, decision A).
/// Where this patient is going, said early and in one tap. NULL is "not decided yet", which is
/// what every case carries until somebody taps a chip, and is not an error state.
enum Trajectory {
  DISCHARGE
  ADMISSION
  TRANSFER
}

model Case {
  trajectory Trajectory?
}
```

Migration `20260912130000_patient_trajectory`: `CREATE TYPE "Trajectory"` and one
`ALTER TABLE "Case" ADD COLUMN "trajectory" "Trajectory"`. No default, no backfill, no read of an
existing row, and no `GRANT`: `ALTER DEFAULT PRIVILEGES` (20260908190100) covers new tables, a new
column on an existing table needs nothing, and a Postgres enum type carries `USAGE` for `PUBLIC`
unless it is revoked, which this schema never does. Generated with
`prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` and read
by eye, because the shadow database `prisma migrate dev` needs does not work in this repository
(`docs/RUNBOOK.md`), exactly as Phase 14's was.

`Trajectory` does not match `tests/unit/phi-guard.test.ts`'s pattern, and could not hold an
identifier if it did: it is a three-valued enum.

### The labels (`src/lib/domain/taxonomy.ts`)

```ts
export const TRAJECTORIES = ['DISCHARGE', 'ADMISSION', 'TRANSFER'] as const
export const TRAJECTORY_LABELS = {
  DISCHARGE: 'Discharge',
  ADMISSION: 'Admission',
  TRANSFER: 'Transfer to another facility',
} as const
/** The chip that stands for NULL. A state, not a value: the case has no trajectory yet. */
export const TRAJECTORY_NOT_DECIDED = 'Not decided yet'
```

An addition to the vocabulary, like Phase 8b's answers and Phase 10's payers; nothing is renamed.
One label map, printed verbatim wherever the trajectory is shown — the chip, the summary sheet,
the handover line and the export cell — so "Transfer to another facility" cannot become two
different strings in two places. **Recorded reading:** the brief says the trajectory prints "as
one word when set"; it prints as its one label, which for the transfer is four words, for the same
reason the Disposition column prints "Transferred to another facility" and not "Transferred".

### Where the value travels

| Module | Change |
| --- | --- |
| `prisma/schema.prisma` | the enum and the column above |
| `src/lib/cases/types.ts` | `CaseDraft.trajectory: Trajectory \| null` |
| `src/lib/cases/load.ts` | `blankDraft` (`null`), `CaseRow`, `draftFromCase` |
| `src/lib/domain/validation.ts` | `trajectorySchema = z.enum([...])`, and `trajectory: trajectorySchema.nullable().optional()` on `base`. Never required, at "Open case" or at "Mark resolved" |
| `src/lib/cases/service.ts` | `caseScalarData` writes `trajectory: d.trajectory ?? null` |
| `src/lib/cases/snapshot.ts` | in `SnapshotSource` and `caseSnapshot`, before `disposition`, so the audit `before`/`after` shows it change |
| `src/lib/cases/stats-mapper.ts` | in `CASE_STATS_SELECT` and in `toCaseForStats` |
| `src/lib/domain/aggregates.ts` | `CaseForStats.trajectory` |
| `src/lib/board/load.ts`, `src/lib/board/types.ts` | `BoardRow.trajectory`, for the handover line |
| `src/lib/cases/summary.ts` | `CaseSummary.trajectoryLabel`, and one line in `summaryText` |
| `src/lib/export/rows.ts` | the `Trajectory` column (item 6) |

Nothing is added to `kpi.ts`: the trajectory is a plan, not an action, and no figure in the deck
or the Adaa form counts one.

**Tests this item starts from:** `src/lib/domain/__tests__/validation.test.ts` (a draft with an
unknown key is stripped, and every enum refuses a value outside its list);
`src/lib/cases/__tests__/snapshot.test.ts` (the snapshot's key list);
`src/lib/cases/__tests__/stats-mapper.test.ts` ("asks for every field CaseForStats needs and
nothing else"); `tests/db/cases.test.ts` (the create/save/resolve round trip).

---

## 2. The chip row

At the **top of the Patient journey block** (`#case-times`), above the steps and under the
block's caption, on `/cases/new` and on `/cases/[id]` alike — it is part of `CaseJourney`, which
both pages already render.

- A chip row with the group label **`Patient trajectory`**, four chips in this order:
  **`Not decided yet`**, **`Discharge`**, **`Admission`**, **`Transfer to another facility`**.
- `Not decided yet` is pressed while the column is NULL. It is a chip and not the absence of one
  because "nobody has decided" is a state a nurse reads off the sheet, and a row with nothing
  pressed cannot be told from a row nobody has looked at.
- Tapping a chip sets that value; tapping `Not decided yet` sets NULL; tapping the pressed chip
  again clears back to NULL, the same tap-again gesture CTAS, ED area, Shift, Payer and the
  Phase 14 escalation already use.
- Disabled with the rest of the sheet for a VIEWER and on a voided case, like every other control.

The four options travel through the existing `Chips` primitive as
`['NOT_DECIDED', 'DISCHARGE', 'ADMISSION', 'TRANSFER']`, with `NOT_DECIDED` mapped to NULL at the
edge of the component. `NOT_DECIDED` is not a database value, is not in `TRAJECTORIES` and never
reaches zod.

**Tests this item starts from:** `tests/e2e/phase13-case-sheet.spec.ts` "a new case opens on the
journey block with the core steps alone" (the block's contents on a blank case).

---

## 3. The visibility function

`src/lib/domain/journey.ts` keeps its shape: one pure module, read by the server rule in
`validation.ts` and by the editor, so the two cannot drift. `JourneyContext` gains one field:

```ts
export type JourneyContext = {
  disposition: Disposition | null
  trajectory: Trajectory | null
  stageCodes: Iterable<string>
  requiresReferralNo: boolean
}
```

Required, not optional: a caller that forgets it would silently get the Phase 13 behaviour, and
there are only three callers.

### The table `visibleJourneyFields` implements

Read top to bottom; the first row that matches wins. Every result is in `JOURNEY_STEPS` flow
order, whatever order the rules added the fields in.

| # | disposition | trajectory | Steps shown |
| --- | --- | --- | --- |
| 1 | set | anything | `OUTCOMES[disposition]` — the Phase 13 table, unchanged |
| 2 | null | `DISCHARGE` | the core six |
| 3 | null | `ADMISSION` | the core six + `admOrderAt`, `bedRequestedAt`, `bedAssignedAt` |
| 4 | null | `TRANSFER` | the core six + `transferRequestedAt`, `transferAcceptedAt`, `transportArrivedAt` |
| 5 | null | null | the core six, + the admission chain when the `adm` stage is selected, + the transfer chain when the `ref` stage is selected or a selected reason is `requiresReferralNo` (Phase 13, unchanged) |

The **core six** are `CORE_JOURNEY_FIELDS`, unchanged since Phase 13: `triageAt`, `roomAt`,
`physicianAt`, `decisionAt`, `departedAt`, `medAdminInformedAt`.

**Recorded deviation from the brief.** Fable's design enumerated the undecided view as "triage,
room, first physician contact, disposition decided (plus Medical admin informed)" and named
`Left ED` under each of the three trajectories instead. `Left ED` stays in the undecided view
here, for three reasons, and the deviation is recorded rather than silently taken:

1. **Two of the eight outcomes have no trajectory.** `LEFT_WITHOUT_BEING_SEEN` and `DECEASED` are
   neither a discharge, an admission nor a transfer. A patient who walked out has left the ED and
   nothing else; under the literal reading their departure could not be recorded until an outcome
   was chosen, and on `/cases/new`, which has no Resolve block at all, it could not be recorded
   by any route.
2. **The principle is "hide what is not related".** Every patient leaves the department, so the
   departure is related to every pathway. Hiding it under "not decided" is an artefact of an
   enumeration, not an application of the rule.
3. The deliverable's own e2e list says "Not decided shows the core steps only", and the core steps
   in this codebase are the six that include `Left ED` (`CORE_JOURNEY_FIELDS`, Phase 13 item 2).

So the Phase 13 contract "always shows `Left ED`, whatever the outcome" is joined by "and whatever
the trajectory", the resolve block's `Recorded in Patient journey, above.` caption stays true, and
`journey.test.ts`'s existing assertion needs no weakening.

`requiredJourneyFields` and `missingJourneyTimes` are **not** touched: what a case must record is
decided by its outcome and by nothing else, so no trajectory can make a time mandatory and no
trajectory can excuse one. `hiddenRecordedJourneySteps` needs no edit either — it is defined as
"recorded and not visible", and it reads `visibleJourneyFields`, so decision E is satisfied by
construction and is asserted rather than implemented.

**Tests this item starts from:** `src/lib/domain/__tests__/journey.test.ts`
(`visibleJourneyFields` takes a context of three fields; the "before a disposition" block).

---

## 4. The Final disposition list

`offeredDispositions`, also in `journey.ts` and also pure:

```ts
export function offeredDispositions(input: {
  trajectory: Trajectory | null
  disposition: Disposition | null
  showAll?: boolean
}): Disposition[]
```

| trajectory | Offered |
| --- | --- |
| `DISCHARGE` | Discharged home, Discharged DAMA, Left without being seen, Other, Deceased, Referred to UCC |
| `ADMISSION` | Admitted, Other, Deceased |
| `TRANSFER` | Transferred to another facility, Other, Deceased |
| null, or `showAll` | all eight |

Always in `DISPOSITION_LABELS` key order, so an outcome is in the same place in the short list as
in the long one. **`DISCHARGED_DAMA` keeps its label, "Discharged DAMA"**; the brief called it
"Discharged against advice", which is what DAMA stands for, and the taxonomy is not renamed.

Two rules that make the narrowing safe:

- **The chosen outcome is always offered.** A case loaded with a disposition outside its
  trajectory's list — a transfer that ended in an admission, a trajectory tapped after the
  outcome — still shows it, so the select can never render a value it has no option for and no
  saved outcome is quietly dropped by a re-render.
- **`Show all outcomes` reveals the rest.** A plain `Button` under the select, visible text
  **`Show all outcomes`**, drawn only when the list is actually narrowed (a trajectory is set and
  the full list is not already shown) and never for a VIEWER. One tap shows all eight for the rest
  of the session and the button goes. Editor state; nothing is stored.

The outcome rules then govern as they always have: the journey block switches to the outcome's
row of the Phase 13 table, `Mark resolved` refuses what that outcome cannot be resolved without,
and the trajectory has no further say.

**Tests this item starts from:** new `journey.test.ts` cases; `tests/e2e/cases.spec.ts` and
`tests/e2e/phase13-case-sheet.spec.ts`, which `selectOption` a disposition on a case with no
trajectory (unchanged: with no trajectory the list is all eight).

---

## 5. The other blocks

| Block | Shown when |
| --- | --- |
| **Referral out** (referral tracking number, receiving facility) | a `requiresReferralNo` reason, **or** `disposition === 'TRANSFERRED'`, **or** `trajectory === 'TRANSFER'` |
| **Ward** and **Isolation / negative pressure room**, in Resolve | `disposition === 'ADMITTED'` **or** `trajectory === 'ADMISSION'` |

Both are plain ORs and not the journey block's "the disposition governs" precedence, because the
brief states them as ORs and because an OR can only ever show a control, never hide a recorded
value: `caseScalarData` writes `wardId`, `referralTrackingNo` and `transferFacility` whether or
not their control is on the screen, so a hide has never dropped one and still does not. It is the
same shape "Referral out" has had since Phase 2, where a `requiresReferralNo` reason shows the
block whatever the outcome turns out to be.

The consequence, stated so it is deliberate: a case whose trajectory says Admission and whose
outcome says Discharged home shows the Ward chips, empty. That is the honest reading — somebody
said the patient was being admitted and then discharged them — and the ward is only ever
*required* for `ADMITTED`, which is unchanged.

**The delay stages and reasons are not filtered** (decision F). "Where is the delay?" is the
question this app exists to answer and every stage can delay any pathway; a discharge held up by
the admission office is exactly the case the navigators opened the WhatsApp group for.

**Tests this item starts from:** `tests/e2e/cases.spec.ts` (the ward chips appear on ADMITTED);
`tests/e2e/phase13-case-sheet.spec.ts` (the referral block on a `requiresReferralNo` reason).

---

## 6. Where the trajectory is shown

### The case summary sheet (`CaseSummarySheet`, `summary.ts`)

One row, `Trajectory`, immediately **before** `Outcome`, drawn only when the case carries one —
the plan and the result read together — and the same line in `summaryText`.

### The handover sheet (`HandoverSheet`)

The trajectory joins the Phase 14 line under the case, `[data-action-row]`, as its **first** part:

```
Trajectory: Admission · Action: Bed manager called twice; ICU holding a bed for 14:00 · Escalated to medical director: Yes
```

A part of the existing line and not an eighth column or a third row: the table's seven headers
are pinned, a ward printer's page is already full, and the question the line answers — "and what
is happening with this one?" — is the same question. A case with only a trajectory now draws the
line; a case with nothing still draws none.

### The Cases export sheet

One column, **`Trajectory`**, immediately **before** `Disposition`, holding
`TRAJECTORY_LABELS[c.trajectory]` or `''`. Before rather than appended, because the plan and the
outcome are compared column against column, and the Cases sheet is this app's own sheet with no
external side matching on its positions. The Adaa and QCH workbooks are **not** widened: both are
external forms with a fixed column list and neither has a column for this.

**Tests this item starts from:** `src/lib/cases/__tests__/summary.test.ts` (`summaryText`'s
lines); `src/components/__tests__/handover.test.ts` (`actionLine`);
`src/lib/export/__tests__/rows.test.ts` (`CASES_HEADER` and the row's length);
`tests/db/export.test.ts` (the Cases sheet's header row).

---

## 7. The demo

`scripts/demo-seed.ts`: every one of the ten seeded cases carries a trajectory consistent with its
story and its outcome — `ADMISSION` for the four heading to a ward and the one that was admitted,
`TRANSFER` for the transferred one, `DISCHARGE` for the rest. A presenter opening any case finds
the chip row answered rather than empty, and the board's demo shows the narrowed disposition list
working on a real case.

`tests/demo/demo.spec.ts`: each of the five patients gains a `trajectory`, tapped on the new-case
form between the shift and "More to record" — one more tap in `openPatient`, so the kit's own
action counts stay honest — and consistent with the outcome the patient is resolved as.

**Tests this item starts from:** `tests/db/demo-seed.test.ts`, `tests/demo/demo.spec.ts`.

### The guides

`docs/guide/nurse-quick-guide.md` and `docs/guide/demo-script.md` name the chip row, say that
Not decided yet is where a case starts and that nothing typed under another pathway is lost, and
say that "Show all outcomes" is there when the outcome is not on the short list. The drift guard
in `tests/unit/phase12-spec.test.ts` gains a Phase 15 block: both guides must name
**Patient trajectory** and **Show all outcomes**, and the chips they list must be the four the
journey component renders, each read off the component rather than off the prose.

---

## 8. Follow-up (a): count the escalation once

Phase 14 left this with Ahmed, in the words of the close: whether "Documented actions" should read
an escalation once rather than twice "when the tagged row it counts is the one the chip itself
produced".

`src/lib/cases/summary.ts` counts a kind as `tagged updates + 1 for the timestamp that records
it`. Phase 14's mirroring rule appends a `CaseUpdate` tagged `LEADERSHIP_ESCALATION` on the move
to Yes — so one escalation is a tagged row *and* a chip, and the panel reads
`Leadership escalation ×2`.

The rule becomes: **the case's own records of an escalation add one between them, and only when no
tagged update already stands for it.**

```ts
if (kind === 'LEADERSHIP_ESCALATION') {
  if (tagged > 0) return false
  return draft.medAdminInformedAt !== null || draft.escalatedToMedicalDirector === true
}
```

- chip Yes with text (so a mirrored tagged row): `1`. The bug.
- chip Yes with no text (no row to mirror): `1`, from the chip.
- `medAdminInformedAt` alone: `1`, unchanged since Phase 8b.
- two hand-tagged escalation updates: `2`, unchanged — two notes are two notes.
- `medAdminInformedAt` beside a tagged update: was `2`, now `1`. Deliberate and consistent:
  Ahmed's instruction is to count the escalation once, and the timestamp and the note are two
  recordings of one escalation exactly as the chip and its mirror are.

`BED_MANAGEMENT` and `FAX_RCC` are untouched: a bed-request time and a note about bed management
are two different pieces of evidence, and neither is mirrored from the other.

Nothing outside the summary panel and its Copy text changes. `actionsDocumented` in `kpi.ts`
counts **cases** per kind, not evidence, and is not edited: no figure in the weekly deck, the
printed report or either workbook moves.

**Tests this item starts from:** `src/lib/cases/__tests__/summary.test.ts` (the escalation's count
on a case carrying the chip and the mirrored update); `tests/db/cases.test.ts`.

---

## 9. Follow-up (b): the handover sheet cuts the delay action at 200 characters

The other question Phase 14 left with Ahmed: whether the delay-action text belongs on the handover
sheet at full length. It does not — `DELAY_ACTION_MAX` is 1000 characters and the sheet is an
11 px table a charge nurse reads standing up at a shift change.

`actionLine` in `src/components/board/HandoverSheet.tsx` cuts the action to its first
**`SHEET_ACTION_MAX = 200`** characters and appends a single `…` when it cut. Trailing whitespace
before the ellipsis goes, so a cut at a word break does not print `word …`.

**On the sheet only.** The case keeps the whole text: the box, the column, the mirrored
`CaseUpdate`, the summary sheet, the Updates sheet and the QCH Comments column are all untouched,
and the escalation half of the line is never cut. 200 characters is about two printed lines at
this size, which is what the row can hold without pushing a case onto a second page.

**Tests this item starts from:** `src/components/__tests__/handover.test.ts` (`actionLine` prints
the action in full).

---

## 10. Follow-up (c): retire the unused `addCaseUpdate` server action

`addCaseUpdate` in `app/cases/actions.ts` has had no caller since Phase 14 removed the Updates
composer. A server action is a public HTTP endpoint that Next generates an id for, so an unused
one is reachable surface with no screen behind it.

**Goes:** the `addCaseUpdate` export in `app/cases/actions.ts` and the now-unused
`AddUpdateResult` import beside it.

**Stays, and is named here so nothing is removed by accident:** `addCaseUpdate` in
`src/lib/cases/service.ts` with its `case.update.add` permission check, its zod parse, its audit
row and its `system: false` default; `AddUpdateResult` in `src/lib/cases/types.ts`;
`tests/db/cases.test.ts`, which drives the service function directly and is the only caller it now
has. Ahmed asked for the section to be hidden, not for the ability to append to be removed, and
`mirrorDelayAction` still appends through the same table.

**Tests this item starts from:** `tests/unit/server-actions.test.ts` (every export of
`app/cases/actions.ts` is a checked mutation); `tests/db/cases.test.ts` (the service function's
own tests, which must stay green untouched).

---

## 11. What each item's test starts from, and what is added

| Item | The assertion it starts from, and what is added |
| --- | --- |
| 1 column | `validation.test.ts`: the enum accepted, cleared, and an unknown value refused; `snapshot.test.ts` key list; `stats-mapper.test.ts` select list; `tests/db/cases.test.ts` round trip through create, save and resolve |
| 2 chip row | new `phase15-trajectory.spec.ts`: the four chips on `/cases/new` and on an open case, `Not decided yet` pressed by default, a tap stored and read back after a reload, at both viewports |
| 3 visibility | new `journey.test.ts` cases: the whole table above, every trajectory against every stage combination and against every disposition, plus "the disposition still governs" and "flow order however the steps were added"; e2e: Transfer shows the fax, the acceptance and the RCC steps and hides the admission ones; Admission the other way round; Not decided shows the core six |
| 4 dispositions | new `journey.test.ts` cases: each trajectory's list, the order, the chosen outcome always offered, `showAll`; e2e: the narrowed `<select>`'s option texts and `Show all outcomes` |
| 5 blocks | e2e: the Referral out block on trajectory Transfer with no referral reason and no outcome; the Ward chips at resolve on trajectory Admission |
| E nothing lost | e2e: a time entered under Transfer is on the "Also recorded" line after switching to Discharge, and is still there after a save and a reload |
| 6 shown | `summary.test.ts` line; `handover.test.ts` `actionLine`; `rows.test.ts` `CASES_HEADER` and `casesRow`; `tests/db/export.test.ts` header |
| 7 demo | `demo-seed.test.ts` (every seeded case carries one, and it agrees with the outcome), `demo.spec.ts`, `phase12-spec.test.ts` guide guard |
| 8 escalation | `summary.test.ts`: the chip and its mirrored row are one escalation; the chip alone is one; two hand-tagged rows are still two |
| 9 truncation | `handover.test.ts`: a 1000-character action prints 200 characters and an ellipsis, a 200-character one prints whole, the escalation half is never cut |
| 10 action | `server-actions.test.ts`: `addCaseUpdate` is not an export of `app/cases/actions.ts`; `tests/db/cases.test.ts` unchanged and green |

Gate captures, both viewports, into `design/screens/phase15-*.png`: `new-case-trajectory` (the
new-case form with the chip row), `journey-transfer` (the journey block on a Transfer),
`journey-admission` (the journey block on an Admission, with the Ward chips at resolve) and
`disposition-narrowed` (the Final disposition list narrowed, with "Show all outcomes" under it).

---

## 12. Contracts that stay

Nothing in this list may change, and every one of them is held by an existing test:

- **Taxonomy names.** No stage, reason, department, ward, ED area, disposition, shift, payer,
  investigation type, update action, case-management or pain-management string is renamed, added
  or removed. `Trajectory` is a new vocabulary of three values, in the way Phase 8b's answers and
  Phase 10's payers were.
- **The required-by-outcome table** in `journey.ts`: `requiredJourneyFields` and
  `missingJourneyTimes` read the disposition and nothing else. No trajectory makes a time
  mandatory, and none excuses one.
- **At "Open case"**: the MRN, the registration time and one delay reason. The trajectory is never
  required, at "Open case" or at "Mark resolved".
- **Nothing recorded is dropped by a hide** (Phase 13, decision G): no code path in this phase
  nulls a column because a control stopped being drawn.
- **`CaseUpdate` and `AuditLog` are append-only.** This phase adds no write to either.
- **Permissions.** VIEWER and a voided case get the same screen with every control disabled and no
  Save, Resolve or Void; every mutation is checked server-side; a stale write is a 409 and never
  auto-merged; a median below n=3 renders "n<3".
- **The rest of the Phase 13 and Phase 14 sheet**: the identity block and its labels,
  `Patient journey` / `case-times` and its twelve steps, `[data-journey-step]`, `[data-next-step]`,
  `[data-needed]`, `[data-also-recorded]`, `Where is the delay?` / `case-delay`,
  `Department / consulted team involved` / `case-teams`, `Investigation times` / `case-tests`,
  `Referral out`, `More to record`, `Resolve case` / `Resolved` / `case-resolve`,
  `What was done to solve the delay`, `Escalated to medical director`, `Check these times`, the
  read-only `[data-left-ed]` row with `Set Left ED to now`, `[data-resolve-missing]`,
  `[data-reopen-needs]`, `[data-review]`, and the five-chip "Jump to" strip.
- **The board**, the dashboard's panels, the alert thresholds, the printed report's layout, and
  the Adaa and QCH workbook formats.
- **`TimeRow`**, and no horizontal overflow at 390 px anywhere on the sheet.

---

## 13. What this phase does not do

- It does not filter the delay stages or the delay reasons by trajectory.
- It does not make the trajectory required, infer it from anything, or write it on a nurse's
  behalf when they choose a disposition.
- It does not change what an outcome requires, or what "Mark resolved" refuses.
- It does not remove an outcome from the app: every one of the eight stays reachable, through the
  trajectory's own list or through "Show all outcomes".
- It does not touch the permission matrix, the roles, the alert thresholds, the board's rows, the
  dashboard's layout, the Adaa or QCH workbook, or the printed report's layout.
- It does not remove the `CaseUpdate` model, the `addCaseUpdate` service function or its tests.
- It does not change any figure in the weekly deck, the Adaa form or the printed report: item 8
  moves a count on the case summary panel only.
