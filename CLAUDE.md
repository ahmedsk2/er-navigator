# ER Navigator: session guide

Mobile-first web app replacing a WhatsApp group used by ER Navigator nurses to track ED patients whose stay is running long. Owner: Ahmed. Users: navigators, charge nurses, medical admin on-call, leadership (read-only).

## Read this, then only what the phase needs

1. `docs/PLAN.md` Section 5: the current phase, its recipe and its gate.
2. The locked plan sections that phase names: `docs/reference/ER_Navigator_ClaudeCode_Plan.md`.
3. The prototype by function name when porting behaviour: `docs/reference/ERNavigatorTracker.jsx`. Do not read it whole.

## Hard rules (the locked plan section 9, plus deployment)

- Do not redesign the workflow or rename anything in the taxonomy. The prototype wins on behaviour; the locked plan wins on permissions.
- No patient name, national ID or date of birth anywhere. Only the MRN. `tests/unit/phi-guard.test.ts` enforces it on the schema.
- Every permission is enforced server-side. VIEWER on a mutation gets 403 and an audit row.
- Stale writes get 409; never auto-merge. Medians below n=3 render as "n<3".
- `CaseUpdate` and `AuditLog` are append-only: no update or delete code path, and the app DB role has those privileges revoked.
- Stop at every gate. Report in the exact five-line shape. Wait for Ahmed's "confirm".
- Commit format: `[ERN-P{phase}.{n}] imperative summary`.

## Verify before claiming anything

`pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build`. UI claims come with Playwright screenshots at 390 x 844 and 1280 x 800. Deploys are verified by `x-build-fingerprint` on `/api/health` and `/api/ready`, about five minutes after the merge.

## Production, in one paragraph

Coolify application on the shared OCI host, deployed by merging to `main`. A deploy is stop-then-start (about a minute of downtime, so merge outside shift change) and a failed migration keeps the site down until it is resolved per the runbook. The host runs other live clinical apps: every command there is scoped to this app's containers and volume. `nav.towardpcc.com` stays proxied in Cloudflare. Details, UUIDs and the API cookbook: `docs/RUNBOOK.md` and `docs/PLAN.md` Section 7 and Appendix A.

## Cost discipline (revised 11 September 2026)

Opus does the work; Fable leads. A phase runs in an Opus session. Fable takes at most three turns per phase: the brief and the decisions at the start, the gate evidence and the five-line report at the end, and a tie-break when a bug survives two Opus attempts. Everything else is Opus: the spec from the brief, slices in worktrees tests first, the verification chain, the review with refuters, the deploy check, the docs and the memory. From a Fable session every Agent and Workflow call passes `model: 'opus'` explicitly, because agents inherit the session model. Fable never reads a large file or a diff: an Opus agent reads it and returns the summary and the evidence. Reviewers and refuters run at effort `high` (they stall at `max`); builders at the default or `max`. Sonnet and Haiku only for trivial mechanics. One session per phase; the gate report and `docs/CHANGELOG.md` are the handoff. `docs/PLAN.md` Section 6 has the full playbook.
