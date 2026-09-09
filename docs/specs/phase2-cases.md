# Phase 2 spec: the case vertical slice

Written by the lead (Fable) for the implementation agent. Port the prototype's case editor one to one (`docs/reference/ERNavigatorTracker.jsx`, `CaseEditor`, `Chips`, `TimeRow`, `Chain`, `Field`, `ConfirmButton`), on top of the rules code that already exists. Where this spec and the prototype differ on behaviour, the prototype wins; on permissions, the locked plan section 2 wins.

## Already in the repo (use, do not rewrite)

- Rules: `src/lib/domain/validation.ts` (`buildCaseSchemas(meta)`, `voidSchema`, `updateTextSchema`, `phiWarnings`, `REGISTRATION_*`), `src/lib/domain/warnings.ts` (`timeWarnings`), `src/lib/domain/time.ts` (`elapsedHours`, `band`, `fmtHours`), `src/lib/domain/taxonomy.ts` (labels and step lists).
- Auth (Phase 1): `requireUser()`, `requireAction(action)`, `getSession()` in `src/lib/auth/`; `can()` in `src/lib/authz/policy.ts`; `audit()` / `contextFrom()` in `src/lib/audit.ts`.
- Schema: `Case`, `CaseReason`, `CaseConsult`, `CaseInvestigation`, `CaseUpdate`, `OtherReview`, reference tables. No schema change is expected in this phase. If you believe one is needed, stop and say so in your report instead of adding it.
- Tokens: `app/globals.css`, `design/tokens.md`. The prototype's CSS (`.chip`, `.field`, `.input`, `.btn`, `.section`, `.row`, `.band`) maps onto the tokens; recreate those as small components under `src/components/ui/` (Chip, Chips, Field, Input, Button, Section, TimeRow, Chain, ConfirmButton).

## Routes

- `/cases/new` (NAVIGATOR, SUPERVISOR, ADMIN; VIEWER gets 403 page and an `auth.forbidden` audit row).
- `/cases/[id]` (everyone may view; mutations gated per action). VIEWER sees the same editor rendered read-only: inputs disabled, no Save, no Add update, no Resolve, no Void.
- The "‹ Back" link goes to `/` (the board arrives in Phase 3; today `/` is the authenticated shell).

## Server actions (`app/cases/actions.ts`), each: session → `requireAction` → zod → transaction → audit → revalidate

Reference data for the schema factory: load active stages, reasons (with `requiresDepartment`, `requiresReferralNo`, `isOther`), departments and wards once per request in `src/lib/cases/reference.ts` and build `buildCaseSchemas(meta)` from it.

1. `createCase(input)` (`case.create`): validate with `draft`; create `Case` (`openedById` = session user, `openedAt` = now, `status = OPEN`, `version = 1`, `shift` from input, default the form's shift from `User.lastShift` and write `User.lastShift` back on save), `CaseReason` rows (with `otherText` for Other reasons), `CaseConsult`, `CaseInvestigation`; for every Other reason with text create an `OtherReview` (`PENDING`, `stageId` of that reason); audit `case.create` with `after` = the full case snapshot; redirect to `/cases/[id]`.
2. `saveCase(id, input)` (`case.edit`): validate with `draft`; optimistic locking: `updateMany({ where: { id, version: input.version, status: { not: 'VOIDED' } }, data: { ...fields, version: { increment: 1 } } })`; if `count === 0` load the case and the latest audit row for it (`entity 'Case'`, `entityId id`, newest `at`, join actor `displayName`) and return `{ ok: false, error: 'conflict', changedBy, changedAt }` (409 semantics; the UI shows "This case was changed by {name} at {time}. Reload to continue." and offers a Reload button; it never merges). Replace child rows (reasons, consults, investigations) inside the same transaction with a diff (delete the removed, upsert the kept); deselecting an Other reason deletes its `otherText` row and its `PENDING` `OtherReview`; adding Other text creates one. Audit `case.update` with before/after snapshots.
3. `addUpdate(id, text)` (`case.update.add`): `updateTextSchema`; insert `CaseUpdate` (`authorId` = session user); no version check (append-only rows never conflict, locked plan section 4); audit `case.update.add`. Return the new row.
4. `resolveCase(id, input)` (`case.resolve`): validate with `resolve`; `departedAt` defaults to now in the form (prototype: "Left ED at (defaults to now)"); set `status = RESOLVED`, `resolvedAt = departedAt`, disposition, ward, isolation, note, referral fields; version check as in 2; append a `CaseUpdate` "Resolved: {disposition label}" by the session user; audit `case.resolve`.
5. `reopenCase(id, version)` (`case.reopen`): `status = OPEN`, `resolvedAt = null` (keep `departedAt` as entered; the prototype clears `resolvedAt` only); version check; append `CaseUpdate` "Reopened"; audit `case.reopen`.
6. `voidCase(id, { version, voidReason })` (`case.void`, SUPERVISOR and ADMIN): `status = VOIDED`, `voidReason`; version check; append `CaseUpdate` "Voided: {reason}"; audit `case.void`. Voided cases render read-only with a banner. There is no delete anywhere; the prototype's Delete button becomes Void (SUPERVISOR/ADMIN) and is absent for NAVIGATOR.

Every action returns `{ ok: true, ... } | { ok: false, error: 'validation', issues } | { ok: false, error: 'conflict', changedBy, changedAt } | { ok: false, error: 'forbidden' }`. Never throw validation errors to the client.

## Editor UI (`app/cases/[id]/page.tsx` + `src/components/cases/CaseEditor.tsx`, client component)

Section order and behaviour exactly as the prototype:

1. Header row: "‹ Back" and the elapsed clock (26 px, tabular, coloured by `band()`; `none` uses the neutral band token). The clock ticks every 30 s for OPEN cases.
2. Identity and registration: MRN (numeric keyboard, digits only enforced on input), registration time (`datetime-local`, `max` = now), quick chips "4h ago / 6h ago / 8h ago / 12h ago / −30m / +30m", "Waiting {h} so far" line, Navigator (read-only, the session user's display name) and Shift select (prefilled from `User.lastShift`).
3. Where is the delay: stage chips (multi-select) → per selected stage its reason chips (multi-select) with an Other text input when Other is on; primary selector appears when more than one reason; double-tap a reason chip also sets it primary (prototype). Deselecting a stage drops its reasons (prototype `toggleStage`).
4. Department / consulted team: shown when any selected reason `requiresDepartment`, or the Admission or Disposition stage is selected (prototype condition). Department chips; per selected department the consult chain (Consulted at / Seen patient at / Replied / plan given at), each with a Now button.
5. Investigation times: shown when the Investigations stage is selected. Type chips (Lab, CT, Ultrasound, X-ray / KUB); per type its step chain from `INVESTIGATION_STEPS`.
6. Admission times: shown when the Admission stage is selected or disposition is ADMITTED. `ADMISSION_STEPS` chain.
7. Referral out: shown when any selected reason `requiresReferralNo` or disposition is TRANSFERRED: tracking number, receiving facility, `TRANSFER_STEPS` chain.
8. Journey times: collapsible "Add journey times (optional)" (open by default on an existing case), numbered milestones 1–5 from `MILESTONES` each with Now, then "Medical admin on-call informed at" with Now. Alerts never fill this field; only a person does.
9. Updates (existing cases only): list newest last with `dd/mm HH:mm` timestamp, text, author; input "What changed?" + Add, Enter submits. Persistent hint under the input: "MRN only, no names." After a save, if `phiWarnings` flags the text, show the warning inline and keep the row (warn, never block).
10. Resolve / Resolved: disposition select; ADMITTED reveals ward chips (single select) and the isolation checkbox; "Left ED at (defaults to now)"; resolution note; "Mark resolved" (disabled until a disposition is chosen) or "Reopen case".
11. "Check these times" panel (amber left border, `--color-band-h4-ink` heading) listing `timeWarnings()` plus `phiWarnings()` for note and Other texts; "You can still save. Out-of-order times are left out of the averages."
12. Save row: "Open case" / "Save changes" (disabled until MRN valid, registration set and at least one reason) and, for SUPERVISOR/ADMIN on existing cases, the two-tap "Void" confirm button (prototype `ConfirmButton`, 3 s arm window) that asks for a reason in a small inline field.

Layout: 390 px first, one column, sections full-bleed with hairline top and bottom (`bg-panel`, `border-line`), 16 px padding, chips 44 px tall, inputs 16 px text. Desktop (1280): same column centred at max 720 px; no sidebar.

All times are entered and shown in Asia/Riyadh (use the browser's local time for `datetime-local` and convert to UTC ISO strings on submit; the server stores UTC). Do not add a timezone library; `Intl` is enough for display.

## Tests

- Unit: the child-row diff helper (which rows are deleted/kept/added); the snapshot function used for audit before/after (stable key order, no password-bearing relations); the conflict-info lookup (latest audit row → display name).
- DB-backed (`tests/db/cases.test.ts`): create → edit → 409 on a stale version → add update → resolve (ADMITTED needs ward) → reopen → void (NAVIGATOR forbidden, SUPERVISOR allowed); Other text creates an `OtherReview` and deselecting removes it; every mutation leaves exactly one audit row with before/after.
- Playwright (`tests/e2e/cases.spec.ts`, mobile project): a navigator opens a case in under 15 UI actions (count them in the test and assert ≤ 15), adds an update, resolves as Discharged home; a second browser context saves a stale version and sees the "changed by" message; a VIEWER sees the read-only editor with no Save. Seed the users the test needs through a test-only script under `tests/e2e/fixtures/` that uses the owner URL (never through the app).
- Screenshots of `/cases/new` (empty and with a referral stage selected) and `/cases/[id]` (resolved) at both viewports under `design/screens/phase2-*`.

## Do not

- No new schema fields, no delete code path, no auto-merge on conflict, no localStorage for case data, no change to any taxonomy string, no board, no dashboard, no export.
- Do not edit `src/lib/domain/*`; if a rule is wrong, report it.
