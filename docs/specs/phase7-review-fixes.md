# Phase 7 final review: fixes

The final adversarial review (2026-09-09, eight lenses, one skeptic per finding, 36 findings
examined, 19 confirmed, 17 refuted) produced the items below. `docs/specs/phase7-review-findings.md`
holds the full text of every confirmed finding with the skeptic's reasoning; the numbers here
(C1 ... C19) refer to it.

Rules for every slice: the hard rules in `CLAUDE.md`; no new dependencies; tests first where a
test can express the defect; `pnpm typecheck`, `pnpm lint`, `pnpm test` (with the dev database)
and the relevant Playwright specs green before handing back; do NOT edit `docs/CHANGELOG.md`,
`docs/PLAN.md` or `docs/RUNBOOK.md` (the lead writes those from your report); commit format
`[ERN-P7.{n}] imperative summary`.

## Slice A (Opus agent 1): authorization on every page, and the board's dead-session poll

**C1 (high).** Every page under `app/(app)/admin/` must carry its own server-side check; the
shared layout stays as defence in depth but is no longer the only gate, because Next skips
ancestor layouts on an RSC request whose `next-router-state-tree` already contains the segment.

- `admin/audit/page.tsx` → `await requireAction('admin.audit.view')`
- `admin/lists/page.tsx` → `await requireAction('admin.lists')`
- `admin/other/page.tsx` → `await requireAction('admin.other.review')`
- `admin/users/page.tsx` → `await requireAction('admin.users')` (replace the bare `requireUser()`)
- `admin/alerts/page.tsx` and `admin/page.tsx` → these have no action of their own in the locked
  matrix. Do NOT add a new action name to the policy; gate them with `requireAction('admin.users')`
  is wrong too (it is a different permission). Instead: `const user = await requireUser(); if
  (user.role !== 'ADMIN') forbidden()` is the minimum, but the better shape is a small helper in
  `src/lib/auth/session.ts`, `requireRole(...roles)`, that writes the same `auth.forbidden` audit
  row (entity `Role`, entityId the required role) and calls `forbidden()` for pages. Use it on
  those two pages and in `admin/layout.tsx` (replacing its raw comparison).
- Make the same defence-in-depth pass over the rest of `app/(app)`: `dashboard/page.tsx` should
  call `requireAction('dashboard.view')` (it exists in the matrix and is ALL roles today, so this
  changes nothing for users but makes the policy load-bearing); `page.tsx` (the board) and
  `account/page.tsx` already call `requireUser()`, which is correct for them.
- The admin loaders in `src/lib/admin/*.ts` and `src/lib/alerts/service.ts` may stay unguarded
  (the page is the boundary for reads; mutations already go through `assertCan` in the actions).
- Test: add to `tests/e2e/admin.spec.ts` a case that signs in as a NAVIGATOR, then issues the RSC
  request from the finding (headers `rsc: 1` and `next-router-state-tree` set to the encoded tree
  `["",{"children":["(app)",{"children":["admin",{"children":["__PAGE__",{}]}]}]},null,null,true]`)
  against `/admin/audit`, `/admin/other`, `/admin/lists`, `/admin/users`, `/admin/alerts` and
  `/admin` and asserts a 403 status for each, and the same for a VIEWER against `/admin/users`.
  Use `page.request` (it shares the signed-in cookie jar). Also assert that an ADMIN gets 200 for
  the same request, so the test cannot pass by every request failing. Add a unit assertion to
  `tests/unit/server-actions.test.ts` or a new `tests/unit/page-guards.test.ts` that every
  `app/(app)/admin/**/page.tsx` file contains `requireAction(` or `requireRole(`.

**C6 and C19 (medium, low).** `src/components/board/Board.tsx`: the 30 s poll treats a 401
like a dropped packet.

- On `response.status === 401`: `clearInterval`, then `window.location.assign('/login?expired=1')`
  (the route gate clears the cookies on that path).
- Track the time of the last successful payload and whether the latest poll failed. Under the
  counts strip render one small muted line: "Updated 14:32" normally; "Not updating since 14:32.
  Check the connection." once a poll has failed (network error or non-2xx other than 401). Keep the
  rows on screen either way. Riyadh time, 24 h, via the existing time helpers.
- Playwright: in `tests/e2e/board.spec.ts`, a test that routes `/api/board*` to a 503 (with
  `page.route`) after the first load and asserts the "Not updating since" line appears; and one
  that routes it to 401 and asserts the page lands on `/login?expired=1` with the session cookie
  cleared.

## Slice B (Opus agent 2): the case editor

**C4 and C10 (medium).** A reference row (reason, department, ward) deactivated in Admin makes
every existing case that carries it unsavable and the nurse cannot even deselect it, because
chips and validation metadata both come from the active-only reference.

- `src/lib/cases/reference.ts`: add `loadReferenceForCase(caseId)` (or an options argument) that
  returns the active rows PLUS any inactive row the case already references (reasons on its
  updates/rows, departments on its consults, its ward), each such row flagged `retired: true`.
- `app/cases/[id]/page.tsx` uses it for both the editor's chips and the validation metadata;
  `app/cases/new/page.tsx` keeps the strict active-only reference.
- `src/lib/domain/validation.ts` / `src/lib/cases/service.ts` (`checkReferenceIds`, the reason
  meta map): a retired id that is already on the case being edited is accepted; a retired id that
  is NOT already on the case is still rejected (a nurse cannot add a retired reason). `createCase`
  keeps the strict rule.
- Chips (`src/components/ui/index.tsx` + `CaseEditor.tsx`): a retired option renders greyed with a
  "(retired)" suffix and can only be deselected, never selected.
- Tests: `tests/db/cases.test.ts` — deactivate a reason and a department that an open case
  carries, then `saveCase` with the unchanged draft succeeds, `saveCase` after removing them
  succeeds, and `saveCase` adding the retired reason to a different case is rejected;
  a Playwright case in `tests/e2e/cases.spec.ts` if it can be done in under 40 lines, else skip it.

**C5 (medium).** `src/lib/domain/validation.ts`: the `resolve` schema is built from `base`, not
from `withRules`, so "Mark resolved" skips every cross-field rule "Save changes" enforces (Other
text, requiresDepartment, duplicate rows, unknown reason ids, registrationAt <= now). Derive
`resolve` from the refined schema (extract the shared `superRefine` callback and apply it to
both), and add unit tests in `src/lib/domain/__tests__/validation.test.ts` that an empty Other
text, a missing consult for a requiresDepartment reason and a future registrationAt are rejected
by `resolve`. Note Slice B also touches this file for C4; keep the two changes separate commits.

**C11 (medium).** `CaseEditor.tsx` `run()` is try/finally with no catch: a thrown server action
(dropped connection, a 404 during a deploy, a Prisma transaction timeout) leaves no message and
the button just re-enables. Add a catch that sets a persistent, `role="alert"` message next to the
Save button: "Could not reach the server. Nothing was saved. Check the connection and try again."
Apply the same to the admin panels in `src/components/admin/*` (their equivalent of `run`). Unit
or Playwright coverage: route the action to abort with `page.route` and assert the message.

**C18 (low).** `CaseEditor.tsx` `setDepartments`: toggling a department chip off and on again
loses that team's consult times; the prototype keeps them (`ERNavigatorTracker.jsx` around line
338 keeps `c.consults` keyed by department). Keep a session-local map of consults removed since
the case was opened and restore from it on re-select. Nothing persisted changes.

**Tests the review found missing (from the refuted list, still worth having):** in
`tests/db/cases.test.ts`, stale-version (409/conflict) tests for `resolveCase` and `voidCase`,
mirroring the existing ones for `saveCase` and `reopenCase`.

## Lead (Fable): rules, worker, tests, docs

- C2/C3 weekly median n-guard (`DashboardView.tsx`, `WeeklyChart.tsx`, `aggregates.ts` fixture).
- C7 `safeNext` open redirect (`app/login/actions.ts`) with unit tests; login username lowercased.
- C14 `fmtHours`/`spokenHours` carry (`src/lib/domain/time.ts`).
- C15/C16 heartbeat only after a successful cycle; C17 SMTP timeouts; C9/C13 Uptime Kuma push
  (`ALERT_PUSH_URL`) at the end of a successful cycle, compose + entrypoint + runbook + plan.
- C12 `tests/unit/server-actions.test.ts`: the module that defines `assertCan` is not a guarded
  service; arrow-function exports are checked too.
- CI privilege guard extended to all eight revoked privileges; PHI guard over every model except
  `User`.
- Dead configuration removed (`AUTH_SECRET`, `AUTH_TRUST_HOST`; `LOG_LEVEL` and `APP_TIMEZONE`
  either wired or removed).
- C8 restore-into-production procedure, drilled.
