# Phase 13: the case sheet, redesigned by patient flow

Ahmed, 12 September 2026, after the Phase 12 gate. Five requests, in his words:

1. merge "Nursing handover done" into "Left ED";
2. make the journey times required by outcome, shown together in one block, with some allowed
   to stay empty;
3. reorder the sheet by how a patient actually flows through the ED, with the times near the top;
4. hide what a case does not need;
5. progressive disclosure.

One question was put back to him and answered the same day: **at "Open case" only the MRN, the
registration time and one delay reason are required, exactly as today.** Everything else is
recorded as the stay goes on, and the rules bite at "Mark resolved".

This phase is the one place where the locked plan's "do not redesign the workflow" rule is
**overridden by the owner**, and only for the shape of the case sheet. The taxonomy NAMES are
untouched: no stage, reason, department, ward, ED area or disposition is renamed, added or
removed, and every step label below is the string `src/lib/domain/taxonomy.ts` already holds.

## Ahmed's decisions of 12 September 2026

| # | Decision |
| --- | --- |
| A | "Nursing handover done" is merged into "Left ED". The input, the export column, the timeline row and the warning link go; the database column stays, nullable, and is no longer written. |
| B | The journey times are one block, in flow order, near the top of the sheet, on the new-case form and on an open case alike. Some steps may stay empty. |
| C | Which times are required depends on the outcome, and is enforced when the case is resolved, not when it is opened. |
| D | At "Open case", only the MRN, the registration time and one delay reason are required. Unchanged. |
| E | A case hides what it does not need, and reveals a step when the case implies it. |
| F | A filled step collapses to one line; the next empty step is the one the thumb lands on. |
| G | Nothing recorded is ever dropped by a hide. |

---

## Rules for every item

The hard rules in `CLAUDE.md`. Tests first: every item below names the assertion it starts from,
and that assertion must fail before the change and pass after. MRN only, no patient identifiers.
Every rule is enforced server-side and mirrored, never replaced, on the client. `CaseUpdate` and
`AuditLog` stay append-only. Out-of-order times stay a warning and never block a save. No
migration: `prisma migrate diff --exit-code` must report no drift at the end of the phase.

---

## 1. Merge: "Nursing handover done" becomes "Left ED"

`handoverAt` is removed from everything a nurse or a reader can reach, and the column is kept.

**Goes:**

| Where | What goes |
| --- | --- |
| `src/lib/domain/taxonomy.ts` | the `['handoverAt', 'Nursing handover done']` pair in `ADMISSION_STEPS` |
| `src/lib/cases/types.ts` | `CaseDraft.handoverAt` |
| `src/lib/domain/validation.ts` | `handoverAt: timeSchema` in the case input schema |
| `src/lib/cases/service.ts` | `handoverAt` in `caseScalarData`, so no save or resolve writes it |
| `src/lib/cases/load.ts` | `handoverAt` in `blankDraft`, in `CaseRow` and in `draftFromCase` |
| `src/lib/export/rows.ts` | the "Nursing handover done" column of `CASES_HEADER`, which is generated from `ADMISSION_STEPS` |
| `src/lib/domain/kpi.ts` | `KpiCase.handoverAt`, its row in `timeline()` and its link in `isOutOfOrder` |
| `src/lib/domain/aggregates.ts` | `CaseForStats.handoverAt` |
| `src/lib/cases/stats-mapper.ts` | `handoverAt` in `CASE_STATS_SELECT` and in `toCaseForStats` |
| `src/lib/board/load.ts` | `handoverAt` in the row select, the row type and the timeline source |
| `src/lib/domain/warnings.ts` | `CaseTimes.handoverAt`; the admission chain shortens with `ADMISSION_STEPS` |

**Stays:** `prisma/schema.prisma`'s `handoverAt DateTime?`, untouched and unmigrated, and
`src/lib/cases/snapshot.ts`, which mirrors the stored row for the audit trail and must keep
showing what the column holds on the cases that already carry a value.

**Consumers repointed at Left ED (`departedAt`):**

- `isOutOfOrder` (`kpi.ts`): the admission chain becomes `admOrderAt → bedRequestedAt →
  bedAssignedAt`.
- `timeWarnings` (`warnings.ts`): the same three, because the loop reads `ADMISSION_STEPS`.
- `orderToLeaveHours` (`kpi.ts`), the Adaa "Admission to unit" fallback: was
  `hoursBetween(c.admOrderAt, leftAt(c) ?? c.handoverAt)`, becomes
  `hoursBetween(c.admOrderAt, leftAt(c))`. A case with an order and no departure is now in no
  admission band, which is the honest answer: the app no longer records a handover.
- `qchRow` (`export/qch.ts`), the QCH column "Time of Disposition TO WARD": was
  `admitted || (c.disposition == null && (c.admOrderAt || c.wardCode || c.handoverAt)) ? (c.handoverAt ?? left) : null`,
  becomes `admitted || (c.disposition == null && (c.admOrderAt || c.wardCode)) ? left : null`.
- The QCH Read me sentence, which said "Time of Disposition TO WARD is the nursing handover, or
  the departure from the ED when no handover was recorded, and is blank for a patient who was
  never admitted", becomes: **"Time of Disposition TO WARD is the departure from the ED, and is
  blank for a patient who was never admitted."**

**Tests this item starts from:** `src/lib/domain/__tests__/warnings.test.ts` (the in-order case
passes `handoverAt`), `src/lib/domain/__tests__/kpi.test.ts` (the timeline label list contains
"Nursing handover done"), `src/lib/export/__tests__/qch.test.ts` (an open case with a handover
and no departure reads 11:00 in the ward column), `src/lib/export/__tests__/rows.test.ts`,
`src/lib/cases/__tests__/stats-mapper.test.ts` (the select's key list and the mapped value),
`tests/e2e/phase11-fixes.spec.ts` (fills and reads "Nursing handover done"),
`tests/demo/demo.spec.ts` (two patients record it).

---

## 2. One times block: "Patient journey"

One `Section`, `id="case-times"`, heading **"Patient journey"**, rendered on `/cases/new` and on
`/cases/[id]` alike, immediately under the identity block. It replaces three things: the
"Add journey times (optional)" toggle and its `MILESTONES` rows, the "Admission times" section,
and the `TRANSFER_STEPS` chain inside "Referral out".

"Patient journey" rather than "Journey times": the block is now the spine of the sheet rather
than an optional appendix, and the heading a nurse reads should say what it is about, not what
kind of value it holds.

### The steps, in flow order

Every label is the string the taxonomy already holds; nothing is renamed.

| # | Field | Label | Group | Ever required? |
| --- | --- | --- | --- | --- |
| 1 | `triageAt` | `Triage` | core | yes |
| 2 | `roomAt` | `Resus / exam room` | core | never |
| 3 | `physicianAt` | `First physician contact` | core | yes |
| 4 | `decisionAt` | `Disposition decided` | core | yes |
| 5 | `admOrderAt` | `Admission order written` | admission | yes |
| 6 | `bedRequestedAt` | `Bed requested (fax sent)` | admission | never |
| 7 | `bedAssignedAt` | `Bed assigned` | admission | yes |
| 8 | `transferRequestedAt` | `Transfer requested` | transfer | yes |
| 9 | `transferAcceptedAt` | `Accepted by facility` | transfer | yes |
| 10 | `transportArrivedAt` | `RCC / transport arrived` | transfer | never |
| 11 | `departedAt` | `Left ED` | core | always |
| 12 | `medAdminInformedAt` | `Medical admin on-call informed at` | core | never |

The registration time is **not** in this block: it starts the clock, it is the one time a case
cannot be opened without, and it keeps its place in the identity block with its `4h ago / 6h ago
/ 8h ago / 12h ago / −30m / +30m` chips.

`Left ED` is **one input**, bound to `departedAt`, and it lives here. The resolve block shows the
same value read-only with a "Now" affordance (item 6), and `resolveCase` still defaults it to the
current instant when it is empty, exactly as it does today.

### The pure module

The step list and the disclosure and requirement rules are one pure module,
`src/lib/domain/journey.ts`, so the server rule and the client mirror cannot drift:

```ts
export type JourneyField = 'triageAt' | 'roomAt' | … | 'medAdminInformedAt'
export const JOURNEY_STEPS: ReadonlyArray<readonly [JourneyField, string]>   // flow order, table above
export const CORE_JOURNEY_STEPS / ADMISSION_JOURNEY_STEPS / TRANSFER_JOURNEY_STEPS
export function visibleJourneyFields(input: { disposition, stageCodes, requiresReferralNo }): JourneyField[]
export function requiredJourneyFields(disposition): JourneyField[]
export function missingJourneyTimes(disposition, values): Array<readonly [JourneyField, string]>
export const JOURNEY_LABELS: Record<JourneyField, string>
```

`JOURNEY_STEPS` is composed from `MILESTONES`, `ADMISSION_STEPS`, `TRANSFER_STEPS` and one new
`MED_ADMIN_STEP` pair in `taxonomy.ts`, so a label can only ever be changed in one place, and a
unit test asserts the composition rather than a copy of the strings.

---

## 3. Required by outcome

Enforced server-side in `buildCaseSchemas(...).resolve` in `src/lib/domain/validation.ts`, on the
same `superRefine` that already asks ADMITTED for a ward, and mirrored in the editor so that
"Mark resolved" says what is missing before it is pressed.

| Disposition | Times required | Also required | Steps hidden |
| --- | --- | --- | --- |
| `ADMITTED` | Triage, First physician contact, Disposition decided, Admission order written, Bed assigned, Left ED | ward (as today) | transfer |
| `DISCHARGED_HOME` | Triage, First physician contact, Disposition decided, Left ED | — | admission, transfer |
| `DISCHARGED_DAMA` | Triage, First physician contact, Disposition decided, Left ED | — | admission, transfer |
| `REFERRED_UCC` | Triage, First physician contact, Disposition decided, Left ED | — | admission, transfer |
| `TRANSFERRED` | Triage, First physician contact, Disposition decided, Transfer requested, Accepted by facility, Left ED | referral tracking number (as today) and receiving facility | admission |
| `LEFT_WITHOUT_BEING_SEEN` | Left ED | — | First physician contact, Disposition decided, admission, transfer |
| `DECEASED` | Triage, First physician contact, Left ED | — | admission, transfer |
| `OTHER` | Triage, Left ED | — | admission and transfer, unless a selected stage implies them |

"Disposition decided" is deliberately **optional** for `DECEASED`, and hidden for
`LEFT_WITHOUT_BEING_SEEN`: neither patient has a disposition decision in the sense the field
means.

The receiving facility joins the referral tracking number as a `TRANSFERRED` requirement. Today
only the number is refused when it is blank; a transfer with no named facility cannot be reported
to the RCC and the QCH sheet leaves the column empty, so the two are asked for together.

**The server message**, one per missing time, on the field's own path:

```
Enter the {label} time before resolving.
```

so a missing triage on an admitted case reads "Enter the Triage time before resolving." The ward
message ("Choose the ward.") and the referral-number message ("Enter the referral tracking
number.") are unchanged; the facility's is "Enter the receiving facility."

**The client mirror**: while a disposition is chosen and anything required is missing, "Mark
resolved" is disabled and a line under it, `[data-resolve-missing]`, reads:

```
Before resolving, enter: Triage, First physician contact, Left ED.
```

with the ward, the referral number and the receiving facility named in the same list when they
are the ones missing. With no disposition chosen the button stays disabled as it is today and no
list is shown.

At **"Open case"** nothing changes: MRN, registration time, one reason. Out-of-order times stay
warning-only in "Check these times" and are still left out of the averages.

---

## 4. The order of the sheet

Top to bottom, on `/cases/[id]`:

1. **Identity** — MRN, registration time and its chips, "Waiting Xh Ym so far", Navigator, CTAS,
   ED area.
2. **Patient journey** (`case-times`) — item 2.
3. **Where is the delay?** (`case-delay`) — unchanged.
4. **Department / consulted team involved** (`case-teams`) — unchanged trigger, unchanged
   contents.
5. **Investigation times** (`case-tests`) — unchanged trigger, unchanged contents.
6. **Referral out** — unchanged trigger (a `requiresReferralNo` reason, or the `TRANSFERRED`
   disposition), now holding only the referral tracking number and the receiving facility,
   because its three times moved into the journey block.
7. **More to record** — item 5.
8. **Updates** (`case-updates`) — unchanged.
9. Timeline (server-rendered slot) — unchanged.
10. **Resolve case** (`case-resolve`) — item 6.
11. **Check these times** — unchanged.
12. Save / Void, or the sticky "Open case" bar on a new case.

Shift, Working diagnosis and Payer leave the identity block for "More to record"; the Navigator
box stays and takes the full width the Shift select used to share with it.

The **Jump to** strip keeps its Phase 11 chips and its Phase 11 order — `Delay`, `Teams`,
`Tests`, `Times`, `Updates`, `Resolve` — with `Times` pointing at `case-times`. The order is now
one chip out of page order (Times is above Delay on the page), and that is deliberate: the strip
is a set of destinations a nurse has learned, and reshuffling it costs more than it explains.

`/cases/new` renders 1, 2, 3, 4, 5, 6, 7 and the sticky bar, and no strip, as today.

---

## 5. Progressive disclosure

### (i) A filled step collapses

A step with a value renders as one line inside the journey block:

```
Triage · 12/09 10:42        [Edit]
```

`[data-journey-step="triageAt"]`, the stamp is `fmtStamp` (Asia/Riyadh, `dd/mm HH:mm`), and the
button carries `aria-label="Edit — Triage"` over the visible word "Edit". The day is kept rather
than showing "10:42" alone, which is what the proposal drew: a stay that runs to 27 hours is
exactly the case this app is for, and a bare clock time on it is ambiguous — the same reason
Phase 11 widened every time box until the date fitted. Pressing it reopens
that step's `TimeRow` for the rest of the session; the value is unchanged until it is edited.

The **first empty visible step** carries `[data-next-step]` and a soft accent tint, so the thumb
lands on the one thing the case is waiting for. Every empty step keeps its `TimeRow`, its full
`datetime-local` box and its `Now — {label}` button, and `TimeRow` keeps its Phase 11 behaviour:
the label on its own line below `sm`, a 240 px box from `sm`, and the whole date visible at
390 px.

### (ii) Before a disposition is chosen

The block shows the six core steps, plus:

- the three admission steps when the `adm` stage ("Admission process") is selected;
- the three transfer steps when the `ref` stage ("Referral / consulted team") is selected, or any
  selected reason is `requiresReferralNo`.

### (iii) Once a disposition is chosen

The outcome's row in the item 3 table decides: the steps it cannot have are hidden, and each
required step that is still empty carries a small tag, `[data-needed]`, reading **"needed to
resolve"**. `OTHER` is the one outcome that hides nothing the stage rules did not already hide.

### (iv) Nothing hidden is dropped

A hidden step whose value is not null is not rendered as a row and is **not cleared**: the value
stays in the draft, is saved by "Save changes" and "Mark resolved", and is listed on one line at
the foot of the block:

```
Also recorded: Transfer requested · 12/09 09:10, RCC / transport arrived · 12/09 11:40
```

`[data-also-recorded]`, absent when every hidden step is empty. This is the whole of the "never
silently drop data on hide" rule: no code path in this phase nulls a time because a step stopped
being shown.

---

## 6. Left ED in two places

- In the journey block: the `Left ED` `TimeRow`, the only input bound to `departedAt`, editable
  before and after the resolve.
- In the resolve block: a read-only row, `[data-left-ed]`, reading `Left ED` and either the
  stamp or `Not recorded`, with one button, `aria-label="Set Left ED to now"`, visible text
  "Now", and a caption pointing at the journey block. The `Field label="Left ED at (defaults to
  now)"` and its `LocalTimeInput` are gone.
- `resolveCase` keeps its default: a resolve that reaches the server with `departedAt` empty is
  written with the current instant, as it does today. `Left ED` is required for every outcome, so
  the editor never sends that draft; the default stays as the server's own guard for any other
  caller. The server's own floor under it is the resolve schema, where `departedAt` is
  non-nullable and has been since Phase 2.

---

## 7. "More to record"

One `Section`, `[data-more]`, whose whole visible content when closed is a button:

- role `button`, accessible name **"More to record"**, `aria-expanded="false"` when closed;
- pressing it reveals, in this order: **Shift**, **Working diagnosis (optional)**, **Payer**,
  **Pain management (Adaa KPI 8)** and **Case management**, each keeping every label, group name
  and per-field condition it has today (the pethidine row and the painkiller time only under a
  "Yes"; the criteria, action and two times only under a chosen referral);
- the two blocks keep their headings, as `h3` inside this section rather than `h2` section
  titles, so `getByRole('heading', { name: 'Pain management (Adaa KPI 8)' })` still finds them
  once the section is open.

It opens **closed on a new case**, and **open on an existing case where any of its fields has a
value**: a non-blank diagnosis, or a non-null payer, `painkillerPrescribed`,
`pethidinePrescribed`, `pethidineDoseMg`, `painkillerAt`, `sickleCellTreatment`,
`caseMgmtReferral`, `caseMgmtCriteria`, `caseMgmtAction`, `caseMgmtCalledAt` or
`caseMgmtRepliedAt`. Computed once, from the initial draft, so opening and closing it by hand is
never undone by a re-render.

**The shift is deliberately not one of those fields.** `blankDraft` fills it from the navigator's
last shift, so every case carries one from the moment it is opened; counting it would mean the
section is open on every case there is, which is the state this item exists to avoid.

---

## 8. What each item's test starts from

| Item | Failing assertion it starts from |
| --- | --- |
| 1 merge | `warnings.test.ts` "is empty when everything is in order" passes `handoverAt`; `kpi.test.ts` timeline labels include "Nursing handover done"; `qch.test.ts` "the ward time is the departure or handover"; `stats-mapper.test.ts` "asks for every field CaseForStats needs and nothing else" |
| 2 block | new `journey.test.ts`: `JOURNEY_STEPS` is the twelve fields in flow order with the taxonomy's own labels; e2e: `/cases/new` shows the "Patient journey" heading and the six core steps and no admission step |
| 3 required | new `validation.test.ts` cases: every disposition, both directions (a draft missing one required time is refused on that path; the same draft with it is accepted); e2e: "Mark resolved" disabled with the list, then enabled |
| 4 order | e2e: the sections' DOM order on `/cases/[id]`; the strip's five or six chips unchanged |
| 5 disclosure | new `journey.test.ts`: `visibleJourneyFields` per stage and per disposition; e2e: filling Triage collapses it and Edit reopens it; LWBS hides physician and decision; a hidden recorded value appears in "Also recorded" |
| 6 Left ED | e2e: no `Left ED at (defaults to now)` control; the resolve block shows the value read-only; the journey block's `Left ED` is the input |
| 7 more | e2e: closed by default on a new case; open on a reload of a case with a payer |
| KPI/export | `rows.test.ts` `CASES_HEADER`; `qch.test.ts` ward column and Read me; `kpi.test.ts` `orderToLeaveHours` through `admissionToUnitBands` |

Gate captures, both viewports, into `design/screens/phase13-*.png`: `new-case-blank`,
`journey-midway`, `resolve-missing`, `more-expanded`.

---

## 9. Contracts that stay

Nothing in this list may change, and every one of them is held by an existing test:

- **Taxonomy names.** No stage, reason, department, ward, ED area, disposition, shift, payer,
  investigation type, update action, case-management or pain-management string is renamed. The
  only taxonomy edit in the phase is the deletion of one `ADMISSION_STEPS` pair.
- **The identity block's labels**: `MRN (digits only)`, `Registration time (clock starts here)`,
  the four "Nh ago" chips and `−30m` / `+30m`, `Navigator`, the `CTAS` and `ED area` chip groups.
- **Section headings and ids**: `Where is the delay?` / `case-delay`,
  `Department / consulted team involved` / `case-teams`, `Investigation times` / `case-tests`,
  `Referral out`, `Updates` / `case-updates`, `Resolve case` and `Resolved` / `case-resolve`,
  `Check these times`.
- **The Jump to strip**: the navigation's name "Jump to", the chip labels `Delay`, `Teams`,
  `Tests`, `Times`, `Updates`, `Resolve`, their order, the conditional Teams and Tests, the
  scroll-and-focus behaviour that pushes no history entry.
- **Buttons**: `Open case`, `Save changes`, `Void`, `Void this case` / `Tap again to void`,
  `Mark resolved`, `Reopen case`, `Add`, `Summary`, `Mark reviewed` / `Mark again`,
  `Acknowledge`, and every `Now — {label}`.
- **The chains that did not move**: `CONSULT_STEPS` under each department,
  `INVESTIGATION_STEPS` per test type, both with every label unchanged.
- **`TimeRow`**: stacked below `sm`, 240 px box from `sm`, the whole date visible at 390 px, the
  `Now — {label}` button, no horizontal overflow at 390 px anywhere on the sheet.
- **Permissions and record-keeping**: VIEWER and a voided case get the same screen with every
  control disabled and no Save, Add, Resolve or Void; every mutation is checked server-side;
  `CaseUpdate` and `AuditLog` stay append-only; a stale write is a 409 and never auto-merged;
  a median below n=3 renders "n<3".
- **The resolve rules that already existed**: a disposition is required, ADMITTED needs a ward, a
  `requiresReferralNo` reason or `TRANSFERRED` needs the referral tracking number, and the
  resolve schema runs the whole of the draft's cross-field rules (Phase 7, C5).
- **Warnings never block a save**, and their wording ("`<later>` is before `<earlier>`") is the
  prototype's.
- **No migration.** `prisma migrate diff --from-config-datasource --to-schema
  prisma/schema.prisma --exit-code` reports no drift.

---

## 10. Labels that change, and the tests updated for them

Named here so the change is deliberate rather than discovered:

| Was | Is | Tests updated |
| --- | --- | --- |
| button `Add journey times (optional)` / `Hide journey times (optional)` | gone; the block is always open, heading `Patient journey` | `tests/e2e/cases.spec.ts`, `tests/e2e/phase11-fixes.spec.ts`, `tests/demo/demo.spec.ts` |
| `Nursing handover done` (input, export column, timeline row) | gone | `phase11-fixes.spec.ts`, `demo.spec.ts`, `kpi.test.ts`, `rows.test.ts`, `qch.test.ts`, `warnings.test.ts`, `stats-mapper.test.ts` |
| section `Admission times` | the admission steps inside `Patient journey` | `tests/e2e/cases.spec.ts` |
| the transfer chain inside `Referral out` | the transfer steps inside `Patient journey` | `tests/e2e/phase11-fixes.spec.ts`, `tests/demo/demo.spec.ts` |
| field `Left ED at (defaults to now)` | `Left ED` in the journey block; read-only in resolve | `tests/e2e/cases.spec.ts`, `tests/demo/demo.spec.ts` |
| sections `Pain management (Adaa KPI 8)` and `Case management` as `h2` on the page | `h3` inside "More to record", which must be opened first | `tests/e2e/cases.spec.ts` |
| Shift, Working diagnosis, Payer in the identity block | inside "More to record" | `tests/e2e/cases.spec.ts`, `tests/demo/demo.spec.ts` |

---

## 11. What this phase does not do

- It does not change the database. One column stops being written; nothing is dropped, added or
  retyped.
- It does not change the permission matrix, the roles, the alert thresholds, the board, the
  dashboard, the export formats other than the one deleted column and the one rewritten Read me
  sentence, or the printed report.
- It does not touch the demo or production instances beyond the ordinary deploy.
- It does not make any new field mandatory at "Open case".
