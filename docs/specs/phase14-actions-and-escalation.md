# Phase 14: what was done about the delay, and who it went to

Ahmed, 12 September 2026, after working the Phase 13 case sheet himself. Three requests, in his
words:

1. "Hide the time line from case inputs page";
2. "Hide the updates section";
3. in their place, two things in the Resolve block: a box for **what was done to solve the delay**,
   and a Yes / No answer for **escalated to medical director**.

And one thing he asked about rather than asked for: where the "Case management" block came from.
It is his own decision B of Phase 8b (`docs/specs/phase8b-decisions.md`), it stays behind "More to
record", and this phase does not touch it.

The sheet keeps everything else Phase 13 gave it. No taxonomy name is renamed, added or removed.
There is one additive migration: two nullable columns on `Case`, and no existing row is read or
written by it.

## Ahmed's decisions of 12 September 2026 (second set)

| # | Decision |
| --- | --- |
| A | The server-rendered Timeline is off the case page. It stays in the case summary sheet and on the handover sheet. |
| B | The Updates section — the composer with its action tag, and the list — is off the case page, and its chip leaves the "Jump to" strip. The model, the table and every writer stay. |
| C | In its place, in the Resolve block above "Final disposition": a free-text box "What was done to solve the delay" and a Yes / No chip row "Escalated to medical director". Both editable on an open case, before and after resolving. |
| D | Nothing recorded is lost. A change to that box appends one `CaseUpdate` written by the actor, so the deck's history, the board's staleness and the audit trail stay complete. |
| E | The weekly deck counts a case as having a documented action when it carries any update a person wrote **or** a non-empty "what was done" text; an escalation to the medical director counts as a leadership escalation exactly as `medAdminInformedAt` does. |

---

## Rules for every item

The hard rules in `CLAUDE.md`. Tests first: every item below names the assertion it starts from,
and that assertion must fail before the change and pass after. MRN only, and the new box carries
the `MrnOnlyHint` like every other free-text box. Every rule is enforced server-side and mirrored,
never replaced, on the client. `CaseUpdate` and `AuditLog` stay append-only: this phase adds one
more `create` and no `update` and no `delete`, and it never rewrites a row it wrote earlier. A
stale write is still a 409. One additive migration, and no data is touched by it.

---

## 1. The Timeline leaves the case page

`app/cases/[id]/page.tsx` stops passing the `timeline` slot, `CaseEditorProps.timeline` goes, and
`src/components/cases/CaseTimeline.tsx` is deleted, because the case page was its only caller.

**What is unchanged:** `LoadedCase.timeline` (`src/lib/cases/load.ts`) is still built, because
`summaryOf` reads it; `CaseSummarySheet`'s "Time sequence" list still renders it; the handover
sheet's per-case `[data-timeline-row]` line still prints it; the report is untouched. `timelineOf`
and `timeline()` in `kpi.ts` are not edited at all.

**One addition:** the summary dialog's list items gain `data-timeline-step={step.key}`, the same
attribute the case page's list carried, so the assertion that moves out of the case page can be
made in the place the timeline now lives rather than weakened.

The "Jump to" strip loses nothing here: Timeline never had a chip.

**Tests this item starts from:** `tests/e2e/cases.spec.ts` "the timeline lists the recorded steps
in order with the interval between them" (reads `[data-timeline] [data-timeline-step]` on the case
page and asserts the `Timeline` heading); `tests/e2e/phase8-screenshots.spec.ts` (waits for the
`Timeline` heading on the case page before the `phase8-timeline-*` capture).

---

## 2. The Updates section leaves the case page

Gone from `src/components/cases/CaseEditor.tsx`:

| What | Detail |
| --- | --- |
| the section | `<Section id={JUMP.updates} title="Updates">`, its list of rows and its empty-state line |
| the composer | the `Action taken (optional)` chip row, the `What changed?` box with its microphone, the `Add` button, its `MrnOnlyHint` and the identifier warnings under it |
| the strip chip | `{ id: JUMP.updates, label: 'Updates' }`, and the `JUMP.updates` id with it |
| the state | `updates`, `updateText`, `updateAction`, `updateWarnings`, `onAddUpdate`, and the `addCaseUpdate` action import |
| the prop | `CaseEditorProps.initialUpdates`, and the page's `initialUpdates={loaded.updates}` |

**The Jump to strip becomes:** `Delay`, `Teams`, `Tests`, `Times`, `Resolve` — the Phase 11 order
with one chip removed. Teams and Tests stay conditional.

**Everything else about updates stays, and is named here so nothing is removed by accident:**

- `prisma/schema.prisma`'s `CaseUpdate`, unchanged, append-only, with its `action` and `system`
  columns.
- `addCaseUpdate` in `src/lib/cases/service.ts` and in `app/cases/actions.ts`, with its
  `case.update.add` permission check, its zod parse and its audit row. It has no caller in the app
  after this phase; it is a writer, `tests/db/cases.test.ts` drives it, and Ahmed asked for the
  section to be hidden, not for the ability to append to be removed.
- The app's own notes: `resolveCase` ("Resolved: {disposition}"), `reopenCase` ("Reopened"),
  `voidCase` ("Voided: {reason}") and the alerts worker's threshold notes, all `system: true`.
- `LoadedCase.updates`, which `summaryOf` counts and dates.
- The summary sheet's "Documented actions" and "Updates" rows; the workbook's `Updates` sheet; the
  QCH sheet's `Comments/Notes` column, which joins every update's text; the board's
  `lastUpdateAt`, which is the newest `CaseUpdate.createdAt` and is what "Updated 3h ago" and the
  handover sheet's `Last update` column read; the admin audit view.

The board's staleness therefore keeps working with no edit at all: `src/lib/board/load.ts` reads
`updates: { orderBy: { createdAt: 'desc' }, take: 1 }` and item 4 keeps appending rows.

**Tests this item starts from:** `tests/e2e/cases.spec.ts` (four tests type into `What changed?`),
`tests/e2e/phase11-fixes.spec.ts` (the strip's chips are `[…, 'Updates', 'Resolve']` and the jump
lands on the `Updates` heading), `tests/e2e/phase13-case-sheet.spec.ts` (the same chip list, and
the resolve test reads the "Resolved: Transferred to another facility" line out of the update
list), `tests/e2e/screenshots.spec.ts` and `tests/e2e/phase11-fixes-screenshots.spec.ts` (both
compose an update before their capture), `tests/demo/demo.spec.ts` (`addUpdate` helper).

---

## 3. The two new inputs

Both are in the **Resolve** section (`case-resolve`), immediately **above** "Final disposition",
and both are enabled whenever the rest of that section is: an open case, a resolved case, and
neither on a VOIDED case nor for a VIEWER. `/cases/new` has no Resolve section, so they appear
once the case exists — the same as every other control in that block.

### (a) What was done to solve the delay

- A `Field` with `htmlFor`, label exactly **`What was done to solve the delay`**, no "(optional)"
  suffix and no helper sentence: a plain label, as Ahmed asked.
- A `DictationRow` round an `Input`, exactly as the working diagnosis and the resolution note are,
  so the microphone appears wherever the browser offers speech recognition.
- `maxLength={DELAY_ACTION_MAX}`, and a dictation is capped at the same number by
  `appendDictated`.
- A `MrnOnlyHint` under it, so the case page's hint count goes from three to four on an open case
  with "More to record" open (the working diagnosis, this box, the resolution note, and the void
  reason when the Void panel is open).
- `phiWarnings('The delay action', …)` joins the working diagnosis, the resolution note and the
  Other-reason boxes in the editor's warning list.

**`DELAY_ACTION_MAX = 1000`**, exported from `src/lib/domain/validation.ts`. The number is the
same as `UPDATE_TEXT_MAX` on purpose and not by coincidence: item 4 copies this text into a
`CaseUpdate`, whose own schema caps it at `UPDATE_TEXT_MAX`, so a value the box accepts can never
be a row the append refuses.

### (b) Escalated to medical director

- A `ChoiceRow` — the same tap-to-choose, tap-again-to-clear gesture as CTAS, ED area, Payer and
  every Phase 8b answer — with the group label **`Escalated to medical director`** and the two
  chips **`Yes`** and **`No`**, whose strings are `ANSWER_LABELS.YES` and `ANSWER_LABELS.NO`.
- Nullable and unset by default: a case carries no answer until somebody taps one, and tapping the
  chosen chip again clears it back to unset. Three states, and the third is "nobody has said".
- Stored as a boolean, not as `Answer`: there is no "Not sure" here, and a boolean is what the KPI
  rule in item 5 asks of it.

### The data model

```prisma
model Case {
  // Phase 14 (Ahmed, 12 September 2026, decision C). Both nullable and both unset by default.
  delayActionTaken           String?   // "What was done to solve the delay", free text, <= 1000 by zod
  escalatedToMedicalDirector Boolean?  // null = nobody has answered; the chips are Yes and No
}
```

Migration `20260912120000_delay_action_escalation`, generated by `prisma migrate dev`, two
`ALTER TABLE "Case" ADD COLUMN` statements and nothing else. No default, no backfill, no read of
an existing row.

### Where the two values travel

| Module | Change |
| --- | --- |
| `prisma/schema.prisma` | the two columns above |
| `src/lib/cases/types.ts` | `CaseDraft.delayActionTaken: string` (`''` when unset, like every other controlled box) and `CaseDraft.escalatedToMedicalDirector: boolean \| null` |
| `src/lib/cases/load.ts` | `blankDraft` (`''` / `null`), `CaseRow`, `draftFromCase` (`?? ''`) |
| `src/lib/domain/validation.ts` | `DELAY_ACTION_MAX`, `delayActionSchema = freeText(DELAY_ACTION_MAX)`, and the two fields on `base`: `delayActionTaken: delayActionSchema.nullable().optional()`, `escalatedToMedicalDirector: z.boolean().nullable().optional()`. Neither is required, at "Open case" or at "Mark resolved". |
| `src/lib/cases/service.ts` | `caseScalarData` writes `delayActionTaken: blankToNull(d.delayActionTaken)` and `escalatedToMedicalDirector: d.escalatedToMedicalDirector ?? null` |
| `src/lib/cases/snapshot.ts` | both columns in `SnapshotSource` and in `caseSnapshot`, after `transferFacility`, so the audit `before`/`after` shows them change |
| `src/lib/cases/stats-mapper.ts` | both in `CASE_STATS_SELECT` and in `toCaseForStats` |
| `src/lib/domain/aggregates.ts` | both on `CaseForStats` |
| `src/lib/domain/kpi.ts` | both on `KpiCase` (optional there, like `updateActions` and `untaggedUpdatesCount`, which the module already reads defensively) |
| `src/lib/board/load.ts`, `src/lib/board/types.ts` | both on `BoardRow`, for the handover sheet |
| `src/lib/cases/summary.ts` | `CaseSummary.delayActionTaken` and `.escalatedToMedicalDirector`, and two lines in `summaryText` |

`Case.delayActionTaken` is free text a nurse typed, so it is subject to the same discipline as
every other: the box carries the hint, `phiWarnings` reads it, and `tests/unit/phi-guard.test.ts`
already refuses a column whose *name* could hold an identifier — neither of these two matches its
pattern.

**Tests this item starts from:** `src/lib/domain/__tests__/validation.test.ts` (a draft with an
unknown key is stripped, and a 1001-character box is refused on its own path);
`src/lib/cases/__tests__/snapshot.test.ts` (the snapshot's key list);
`src/lib/cases/__tests__/stats-mapper.test.ts` ("asks for every field CaseForStats needs and
nothing else"); `tests/db/cases.test.ts` (create/save/resolve round-trip).

---

## 4. The mirroring rule: a change to the box appends one `CaseUpdate`

This is what makes hiding the composer safe. The deck reads `CaseUpdate`; the board's staleness
reads `CaseUpdate`; the QCH sheet's Comments column reads `CaseUpdate`. If the one place a
navigator now writes prose were a column and nothing else, all three would go quiet.

In `src/lib/cases/service.ts`, inside the **same transaction** as the write, in both `saveCase`
and `resolveCase`:

```
mirrorDelayAction(tx, caseId, actor, before, d, ctx)
```

1. `next = blankToNull(d.delayActionTaken)`, `previous = before.delayActionTaken` (already
   NULL-or-text in the database).
2. If `next === null` or `next === previous`, do nothing. Clearing the box writes no row, and
   saving a case whose box is untouched writes no row.
3. Otherwise create exactly one `CaseUpdate`:
   - `text: next`
   - `authorId: actor.id` — the person who pressed Save, which is what "authored by the actor"
     means.
   - `system: false` — the default. This is a navigator documenting an action, so the deck must
     count it, unlike the resolve, reopen, void and alert notes (Phase 8b review C2).
   - `action`: **`LEADERSHIP_ESCALATION`** when `d.escalatedToMedicalDirector === true` **and**
     `before.escalatedToMedicalDirector !== true`; **`null`** otherwise.
4. Write the ordinary `case.update.add` audit row for it, with
   `after: { caseId, text, action, mirrored: true }`, so the append is legible in the audit trail
   on its own and not only as a column diff on the `case.update` row beside it.

**Why `null` and not one of the other five tags.** The tag list in `src/lib/domain/taxonomy.ts` is
`UPDATE_ACTION_LABELS`: Leadership escalation, Case / bed management, External transfer / fax /
RCC, PRO / social work, Forced / safety admission, DAMA management. Those are six specific
operational responses; "what was done to solve the delay" is the general question, and guessing
which of the six an arbitrary sentence describes would put invented categories into the weekly
deck. The one case where the app genuinely knows is the escalation chip, and that is the one case
it tags. An untagged row is not a gap — `actionsDocumented` has a seventh row for exactly it.

**Why only on the transition to Yes.** The tag records an event, and the event is the escalation.
A second edit to the text on a case that was already escalated is a second note, not a second
escalation, and tagging it would double-count nothing (the deck counts a case once per kind) while
saying something untrue about that row.

**What is never done:** no `caseUpdate.update`, no `caseUpdate.delete`, no rewrite of the row a
previous save appended. Two saves with two different texts leave two rows, oldest first, which is
the history. `tests/db/cases.test.ts` asserts the earlier row is byte-identical after the second
save.

**Order inside `resolveCase`:** the mirrored row is appended **before** the "Resolved: …" system
note, so the case's history reads "what we did", then "and then it was resolved".

**A note on the escalation alone.** Flipping the chip to Yes without touching the box appends
nothing: there is no text to append, and an empty `CaseUpdate` is refused by `updateTextSchema`.
The escalation is still counted, by item 5, from the column itself — exactly as
`medAdminInformedAt` has been counted since Phase 8b without ever writing an update.

**Tests this item starts from:** `tests/db/cases.test.ts` "saveCase writes every scalar and an
audit row" (no `CaseUpdate` is expected) and `src/lib/cases/__tests__` (no mirroring unit exists).

---

## 5. The KPI rule

`src/lib/domain/kpi.ts`, `actionKindsOf`, gains two clauses:

```ts
if (c.medAdminInformedAt || c.escalatedToMedicalDirector === true) kinds.add('LEADERSHIP_ESCALATION')
if (c.delayActionTaken?.trim()) kinds.add('UNTAGGED')
```

- **The escalation implication.** Decision E, and the phrasing Ahmed used: the medical director is
  who a navigator escalates to. `medAdminInformedAt` recorded the same fact as a time; the chip
  records it as an answer; either counts. `false` does not count, and `null` does not count.
- **"Actions documented".** A case counts as documented when `actionKindsOf` returns anything,
  which after this change is: any tagged update, any untagged update a person wrote, the
  escalation time, the escalation chip, a bed request, a transfer request, **or** a non-empty
  "what was done" text. Nothing that counted before stops counting.

**Recorded reading.** Ahmed's words were "any `CaseUpdate` or a non-empty new text". "Any
`CaseUpdate`" is read as any update a **person** wrote, which is the rule the module already has:
Phase 8b review C2 deliberately excluded the app's own resolve, reopen, void and alert notes,
because a case that was resolved is not a case somebody documented an action on. Counting them now
would make every resolved case "documented" and empty the figure of meaning. The mirroring rule in
item 4 is what makes the two readings agree in practice anyway: a non-empty text is always also a
person-written `CaseUpdate` from the moment it is saved through the app.

The `UNTAGGED` row's label, "Update without an action tag", is unchanged, and a case whose only
signal is the new text lands in it. That is honest: something was written and no category was
named.

Nothing else in `kpi.ts` moves. `timeline()` is untouched, so the printed report changes only
through the "Actions documented" figures.

**Tests this item starts from:** `src/lib/domain/__tests__/kpi.test.ts` `actionsDocumented` (a
case with `medAdminInformedAt` is a leadership escalation; a case with nothing is in `none`).

---

## 6. The export columns

`src/lib/export/rows.ts`, the **Cases** sheet, two columns appended after `Note`:

```
'What was done to solve the delay', 'Escalated to medical director'
```

`casesRow` writes `c.delayActionTaken ?? ''` and `yesNoOrBlank(c.escalatedToMedicalDirector)` —
`'Yes'`, `'No'` or `''` for unset, the shape `yesOrBlank` already establishes in that file.

**Recorded reading.** The brief says "beside the existing update columns". The Cases sheet has
none: `UPDATES_HEADER` is `MRN, Time, Update, By` on a sheet of one row per update, and adding a
per-case column there would repeat one value down every row and miss every case with no update at
all. The two columns are per-case facts and go on the per-case sheet. The text does reach the
update columns, by the route item 4 built: the mirrored row is in the `Updates` sheet with its
author and its time, and in the QCH sheet's `Comments/Notes` column, with no edit to either.

The Adaa and QCH workbooks are not widened. Both are external forms with a fixed column list that
the receiving side matches on, and neither has a column for this.

**Tests this item starts from:** `src/lib/export/__tests__/rows.test.ts` (`CASES_HEADER` and the
row's length and contents), `tests/db/export.test.ts` (the Cases sheet's header row).

---

## 7. Where the two values are shown besides the sheet

### The case summary sheet (`CaseSummarySheet`, `summary.ts`)

Two rows, after `Teams` and before `Documented actions`:

| Row header | Value |
| --- | --- |
| `What was done` | the text, or the row is not drawn |
| `Escalated to medical director` | `Yes`, `No`, or the row is not drawn |

and the same two lines in `summaryText`, so the pasted block says them too.

**Recorded exception.** `summary.ts` carries a rule — no free text a navigator typed, with the
working diagnosis and the "Other" reason box as its two exceptions — and this is a third. It is
here because Ahmed asked for it and because it meets the same test the other two do: it is the
clinical or operational line the summary is *about*, and it is identifier-warned in the editor.
The resolution note and an update's text are still never quoted.

### The handover sheet (`HandoverSheet`)

One extra full-width row under each case, `[data-action-row="{mrn}"]`, drawn only when the case
carries a text or an answer, in the same place and the same 10 px as the timeline line:

```
Action: Bed manager called twice; ICU holding a bed for 14:00 · Escalated to medical director: Yes
```

The seven columns are unchanged: a ward printer's page is already full, and this is a line, not a
column.

### The printed report

Unchanged, except through the KPI (item 5).

**Tests this item starts from:** `src/lib/cases/__tests__/summary.test.ts` (`summaryText`'s lines),
`src/components/__tests__/handover.test.ts`, `tests/e2e/cases.spec.ts` (the summary dialog's rows).

---

## 8. The demo

`scripts/demo-seed.ts` writes `CaseUpdate` rows directly, which is a path that still exists and is
left alone. What changes: **every resolved seeded case carries a "what was done" text**, and the
two cases whose story is an escalation carry `escalatedToMedicalDirector: true`, so a presenter
opening a resolved case finds the new box filled rather than empty. The seed writes the column and
the matching `CaseUpdate` itself, exactly as the service would; it is not a code path that mirrors,
it is seed data that is already consistent.

`tests/demo/demo.spec.ts` adds updates through the composer today. Its `addUpdate` helper becomes
`recordAction(page, text, escalated?)`: fill the box, tap the chip when asked, press
**Save changes**, wait for "Saved.". The steps of the script that read an update back off the page
read the summary sheet instead.

**Tests this item starts from:** `tests/db/demo-seed.test.ts`, `tests/demo/demo.spec.ts`.

---

## 9. What each item's test starts from, and the new ones

| Item | The assertion it starts from, and what is added |
| --- | --- |
| 1 timeline | `cases.spec.ts` reads `[data-timeline]` on the case page → it reads the summary dialog's `[data-summary-timeline] [data-timeline-step]`; e2e: no `Timeline` heading and no `[data-timeline]` on `/cases/[id]`, at both viewports |
| 2 updates | `phase11-fixes.spec.ts` / `phase13-case-sheet.spec.ts` chip lists → `['Delay','Teams','Tests','Times','Resolve']`; e2e: no `Updates` heading, no `What changed?` box, no `Action taken (optional)` group on the case page |
| 3 inputs | new `validation.test.ts` cases (the two fields accepted, cleared, and the box refused over its cap); new `load.test` coverage through `tests/db/cases.test.ts`; e2e: both controls inside `#case-resolve`, above "Final disposition", round-tripped through a save and a reload, at both viewports, with no sideways scroll at 390 |
| 4 mirroring | new `tests/db/cases.test.ts` cases: one row on the first save; none on a save that does not change it; none when it is cleared; a second text appends a second row and leaves the first byte-identical; the tag is `LEADERSHIP_ESCALATION` on the transition to Yes and `null` afterwards; the row is `system: false`; the audit row exists; `resolveCase` mirrors before its own note |
| 5 KPI | new `kpi.test.ts` cases: the chip alone documents a leadership escalation; the text alone documents an untagged action; `false` and `null` do not |
| 6 export | `rows.test.ts` `CASES_HEADER` and `casesRow`; `tests/db/export.test.ts` header assertion |
| 7 shown | `summary.test.ts` lines; `handover.test.ts` row; e2e: the summary sheet shows the text a save mirrored |
| 8 demo | `demo-seed.test.ts`, `demo.spec.ts` |

Gate captures, both viewports, into `design/screens/phase14-*.png`: `case-page` (the whole case
page top to bottom, with neither section on it) and `resolve-inputs` (the Resolve block with the
box filled and the chip on Yes).

---

## 10. Contracts that stay

Nothing in this list may change, and every one of them is held by an existing test:

- **Taxonomy names.** No stage, reason, department, ward, ED area, disposition, shift, payer,
  investigation type, update action, case-management or pain-management string is renamed, added
  or removed. `UPDATE_ACTION_LABELS` keeps all six entries even though nothing on the case page
  offers them any more.
- **`CaseUpdate` and `AuditLog` are append-only.** No update path, no delete path, and the app DB
  role has those privileges revoked. This phase adds one `create` in one place.
- **Permissions.** VIEWER and a voided case get the same screen with every control disabled and no
  Save, Resolve or Void; every mutation is checked server-side; a stale write is a 409 and never
  auto-merged; a median below n=3 renders "n<3".
- **The rest of the Phase 13 sheet**: the identity block and its labels, `Patient journey` and
  `case-times` with its twelve steps, `Where is the delay?` / `case-delay`,
  `Department / consulted team involved` / `case-teams`, `Investigation times` / `case-tests`,
  `Referral out`, `More to record` with its four answers, `Resolve case` / `Resolved` /
  `case-resolve`, `Check these times`, the read-only `[data-left-ed]` row and its
  `Set Left ED to now` button, `[data-resolve-missing]`, `[data-reopen-needs]`, `[data-review]`.
- **The buttons**: `Open case`, `Save changes`, `Void`, `Void this case` / `Tap again to void`,
  `Mark resolved`, `Reopen case` / `Tap again to reopen`, `Summary`, `Mark reviewed` / `Mark
  again`, `Acknowledge`, every `Now — {label}` and every `Edit — {label}`.
- **The required-by-outcome table** in `src/lib/domain/journey.ts`, unchanged: neither new field is
  ever required, at "Open case" or at "Mark resolved".
- **The board**, the dashboard's other panels, the alert thresholds, the two external workbook
  formats, and the printed report's layout.
- **`TimeRow`** and no horizontal overflow at 390 px anywhere on the sheet.

---

## 11. Every test and document that referenced the two sections, and what happens to it

| File | What it referenced | What it becomes |
| --- | --- | --- |
| `tests/e2e/cases.spec.ts` "a navigator opens a case, adds an update and resolves it" | composes an update; counts three `[data-mrn-hint]` | records a delay action and saves; counts four hints (the fourth is the new box) |
| `tests/e2e/cases.spec.ts` "a dictated phrase stops at the cap" | `What changed?` at `UPDATE_TEXT_MAX` | `What was done to solve the delay` at `DELAY_ACTION_MAX` |
| `tests/e2e/cases.spec.ts` "the case summary opens over the case" | writes the name-bearing text through the composer, asserts it is not quoted | writes it into the **resolution note**, which the summary still never quotes; the mirrored update supplies the `Updates: 1` count; the new `What was done` row is asserted present |
| `tests/e2e/cases.spec.ts` "the timeline lists the recorded steps" | `Timeline` heading and `[data-timeline]` on the case page | asserts both are **absent**, then reads the same sequence from the summary dialog and from the handover sheet |
| `tests/e2e/cases.spec.ts` "an update can carry one of the deck action categories" | the composer's chip row | becomes the mirroring test in the UI: a save with the escalation chip on Yes writes an update tagged Leadership escalation, read back on the summary sheet's Documented actions row |
| `tests/e2e/phase11-fixes.spec.ts` | strip chips `[…,'Updates','Resolve']`; `sectionOf` maps `Updates` | the five-chip list, and the map loses its `Updates` entry |
| `tests/e2e/phase13-case-sheet.spec.ts` | the same chip list twice; reads "Resolved: Transferred to another facility" off the update list | the five-chip list; the resolve is confirmed by the section heading becoming `Resolved` |
| `tests/e2e/phase11-fixes-screenshots.spec.ts` | composes an update, then jumps to `Updates` | records a delay action and saves; jumps to `Resolve` |
| `tests/e2e/screenshots.spec.ts` | composes an update before `case-resolved` | records a delay action before it |
| `tests/e2e/phase8-screenshots.spec.ts` | waits for the case page's `Timeline` heading before the capture | opens the case summary and captures the time sequence there |
| `tests/demo/demo.spec.ts` | `addUpdate` through the composer, four times | `recordAction` through the new box and Save |
| `tests/unit/phase12-spec.test.ts` | the guide guard | gains a Phase 14 block: the guides must name the new box and the escalation chips, must not describe an Updates composer or a Timeline section on the case page, and the strip they list must be the five chips the editor renders |
| `docs/guide/nurse-quick-guide.md` | section 4 "Updates and delay reasons"; the strip's six chips | section 4 becomes "Delay reasons as the shift moves" and section 5 gains the two inputs; the strip is five chips |
| `docs/guide/demo-script.md` | the presenter adds updates | the presenter records what was done and escalates |
| `docs/PLAN.md`, `docs/CHANGELOG.md` | Phase 13's description of the sheet | a Phase 14 entry in each; Phase 13's text is history and is left alone |

Captures of earlier phases that happen to show the case page (`phase11-fixes-case-*`,
`phase13-*`, `case-resolved-*`, `phase8-timeline-*`) are historical records of those phases and are
restored unchanged at the end of the run, as every phase since 8 has done.

---

## 12. What this phase does not do

- It does not delete or change one `CaseUpdate` row, or add any path that could.
- It does not remove the `CaseUpdate` model, the `addCaseUpdate` service function or its server
  action.
- It does not change the permission matrix, the roles, the alert thresholds, the board's rows, the
  dashboard's layout, the Adaa or QCH workbook, or the printed report's layout.
- It does not make any field required, at "Open case" or at "Mark resolved".
- It does not touch `Case.handoverAt`, or any other column.
- It does not rename anything in the taxonomy, and it does not touch the "Case management" block,
  which stays behind "More to record" as Ahmed's decision B of Phase 8b put it.
