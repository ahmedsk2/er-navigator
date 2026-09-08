# ER Navigator: delivery plan v1.0

Date: 2026-09-08. Target: https://nav.towardpcc.com. Owner: Ahmed (medical director). Builder: Claude Code, Fable 5.1 as lead.

This plan turns the locked build plan (`docs/reference/ER_Navigator_ClaudeCode_Plan.md`) and the validated prototype (`docs/reference/ERNavigatorTracker.jsx`) into a production system on Ahmed's Oracle server. It changes nothing about the workflow, taxonomy, screens or business rules. It fixes the things the locked plan left open: the exact hosting model, the database, the domain, the repository, the design-token source, and how to spend Fable tokens well.

Read order for any session: `CLAUDE.md` (short), then the section of this plan for the current phase, then the locked plan sections it points to. Nothing else up front.

---

## 0. Where things stand

**Inputs found**

- `docs/reference/ERNavigatorTracker.jsx`: the working prototype. Source of truth for taxonomy constants, duration formulas, validation, board and dashboard behaviour, and the case editor flow.
- `docs/reference/ER_Navigator_ClaudeCode_Plan.md`: the locked plan. Data model, roles, rules, screens, phases, gates, do-nots, Appendix A seed lists.

**Inputs still missing (Gate 0 asks for them)**

- `ER_Navigator_Tool_Design.md`: the locked design document the plan names as pre-read 1. Everything it locks is already reflected in the prototype and plan, so work can start; it is still wanted for cross-checking.
- The visual design template. Section 4 tells Ahmed exactly which Envato Elements items to download and where to put them.
- `ER_Navigator_Cases_FirstPass_Extraction.xlsx`: Phase 8 only.

**Infrastructure found and verified this session**

| Item | Value |
| --- | --- |
| Host | OCI `hosting-1`, `145.241.105.239`, me-riyadh-1, Ubuntu 24.04 ARM64, 4 OCPU / 24 GB, 131 GB free |
| Platform | Coolify 4.1.2 + Traefik 3.6, Docker 29.6. Apps deploy from GitHub via read-only deploy keys, push-to-deploy, rolling update gated on healthcheck |
| Existing clinical pattern | `qch` and `endorsement`: project `clinical`, build pack `dockercompose`, `/docker-compose.production.yml`, isolated DB container on a private network, Traefik reaches the app on the `coolify` network |
| DNS | Cloudflare zone `towardpcc.com`. Every subdomain on this host is PROXIED and must stay so: the OCI security list accepts 80/443 only from Cloudflare ranges. Zone SSL mode: Full (strict). Origin certs: Let's Encrypt via Traefik HTTP-01 through Cloudflare |
| Backups | OCI Object Storage bucket `coolify-backups` (14-day WORM rule), mirrored daily to Ahmed's laptop by the `OracleBackupSync` task. Boot-volume backup policy attached |
| Monitoring | Uptime Kuma at `uptime.towardpcc.com`; OCI down/CPU alarms to email |
| SMTP | Working relay credentials exist in `ORACLE MCP/infra/secrets.env` (Infomaniak `mail.dmc-im.com:587`). No app on the host currently sends from `towardpcc.com` (its SPF is `-all`) |
| Tooling from the dev machine | SSH to the host with passwordless sudo, Coolify API via `http://localhost:8000` on the host (token at `~/.coolify-token` there), Cloudflare DNS API (token in `secrets.env`), GitHub CLI as `ahmedsk2` |

**Delivered this session (Phase 0, most of it)**

- This repository: Next.js 16 + TypeScript strict + Tailwind 4 + Prisma 7 + Postgres 16, with the authoritative Prisma schema, the Appendix A seed, the duration formulas ported from the prototype with unit tests, the PHI-guard test, security headers, health and readiness probes, a Dockerfile and production compose that follow the host's clinical pattern, CI, Dependabot.
- GitHub repository, Cloudflare record `nav.towardpcc.com`, Coolify application in project `clinical`, first deploy. The live facts are in `docs/RUNBOOK.md`.

---

## 1. Decisions: what this plan fixes relative to the locked plan

The locked plan wins on workflow, taxonomy, rules, screens and permissions. This table is the complete list of places where this plan decides something the locked plan left to Gate 0, or updates a version. Anything not listed is unchanged.

| Area | Locked plan | This plan | Why |
| --- | --- | --- | --- |
| Framework | Next.js 15, App Router, TS strict | Next.js 16.3, App Router, TS strict | Current stable. The exact combination (Next 16, React 19, Prisma 7, Auth.js v5 beta, zod 4, Tailwind 4) already runs on this host in `towardpcc`, so it is proven on this ARM64 build path |
| ORM | Prisma, provider chosen at Gate 0 | Prisma 7 on PostgreSQL 16 with the `pg` driver adapter | Prisma 7 has no native engine, so it runs on the Windows-ARM64 dev box and the Linux-ARM64 host alike |
| Database placement | "whatever the server has" | Dedicated Postgres 16 container inside this app's compose, on a private network, two roles: `ernav_owner` (migrations, seed) and `ernav_app` (runtime; UPDATE/DELETE revoked on `AuditLog` and `CaseUpdate`) | Matches the `qch`/`endorsement` isolation rule for anything holding patient identifiers. The app can be created, moved or destroyed without touching another system's data. Append-only is enforced at the database, not only in code |
| Migrations | Not specified | Automatic on every deploy: a one-shot `migrate` service runs `prisma migrate deploy` and the seed as the owner role; `app` starts only after it exits 0 | Removes the "merged a schema change, forgot the migration" failure recorded in the towardpcc runbook. The owner connection string never enters the app container |
| Hosting | NSSM + Caddy + Cloudflare Tunnel, or systemd + Caddy | Coolify application, build pack `dockercompose`, Traefik in front, push-to-deploy from `main` | This is what the server runs. No new moving parts |
| Domain | "public hostname" at Gate 0 | `nav.towardpcc.com`, Cloudflare A record to `145.241.105.239`, proxied | Same zone and lock as the other clinical apps |
| Alerts worker | `worker/alerts.ts` as its own process | Same code, run as a `worker` service in the compose from the same image with a different command (Phase 6) | One image, one deploy, separate process as the plan requires |
| Email | nodemailer over SMTP | Same. Credentials come from Coolify env vars; provider decided at Gate 0 (Section 9) | The host has a working relay; sending from `towardpcc.com` needs an SPF change first |
| Backups | Nightly dump script, 30-day retention | Phase 7: `scripts/backup.sh` on the host's systemd timer, `pg_dump` to a dated gzip, 30 local days, upload to the `coolify-backups` bucket. The laptop sync already mirrors that bucket, which gives the third copy for free | Plugs into the backup chain Ahmed already runs and drills |
| Client IP for rate limiting | Not specified | Read `CF-Connecting-IP` | Safe only because the origin is locked to Cloudflare. If those ports are ever opened, this must change in the same commit (towardpcc has the same dependency) |
| Repository | Not specified; Ahmed allowed an open repo for now | `github.com/ahmedsk2/er-navigator`, private, read-only deploy key in Coolify (the host's existing pattern). Can be flipped public at any time | Private costs nothing here and the deploy path does not need public access |
| Design tokens | "the attached template" (missing) | Extracted from the Envato items in Section 4 once Ahmed downloads them. Until then the prototype palette is the baseline in `app/globals.css` | The threshold colours are information design and are not up for restyling |
| Timezone, week start, language | UTC storage, Asia/Riyadh display, Sunday, English | Unchanged | |

---

## 2. Architecture

```
Nurse phone / desktop
   │  https://nav.towardpcc.com
   ▼
Cloudflare (proxied, WAF, TLS to origin: Full strict)
   │  only Cloudflare ranges may reach 80/443
   ▼
OCI hosting-1 ── Traefik (coolify-proxy, Let's Encrypt HTTP-01)
   │  Host(nav.towardpcc.com) → app:3000 on the `coolify` network
   ▼
docker compose (Coolify application `er-navigator`)
   ├─ app      Next.js 16 standalone, non-root, DATABASE_URL = ernav_app role
   ├─ worker   (Phase 6) node-cron: threshold alerts every 5 min, SMTP
   ├─ migrate  one-shot on each deploy: prisma migrate deploy + seed, ernav_owner role
   └─ db       postgres:16-alpine, `internal` network only, volume ernav-db
                 └─ nightly pg_dump → host → OCI bucket → laptop mirror (Phase 7)
```

Application layers inside `app`, all server-enforced:

1. `prisma/schema.prisma`: the model (locked plan section 3, made relation-complete).
2. `src/lib/domain/`: pure functions. `time.ts` (durations, bands, median, MIN_N), `taxonomy.ts` (seed lists), later `validation.ts` (zod schemas shared by server actions and forms), `warnings.ts` (`timeWarnings` port), `aggregates.ts` (dashboard maths).
3. Server actions and route handlers: every mutation checks the session role, validates with zod, sends `version` for optimistic locking, writes an `AuditLog` row with before/after.
4. UI: App Router pages per locked plan section 5, mobile-first at 390 px, tokens from `app/globals.css`.
5. `worker/alerts.ts` (Phase 6): the only writer of `Alert` rows and the "Reached Nh threshold" `CaseUpdate` rows.

---

## 3. Environment and access

Everything an agent needs to deploy or debug, and where each secret lives. Values that are not secrets are written down; secrets are named, never copied.

| Thing | Where |
| --- | --- |
| Source | `git@github.com:ahmedsk2/er-navigator.git`, branch `main` |
| Coolify application | project `clinical` → environment `production`. UUIDs and the deploy-key name are recorded in `docs/RUNBOOK.md` after creation |
| Production env vars | Coolify → the application → Environment Variables. The compose file lists every key it passes through; a key not listed there does nothing |
| Local dev env | `.env` (gitignored), from `.env.example` |
| Infrastructure secrets (Cloudflare, Coolify, SMTP) | `C:\Users\ahmed\Documents\ORACLE MCP\infra\secrets.env` on the dev machine and `~/.coolify-token`, `~/.cloudflare-token` on the host. Never in this repository |
| Health | `GET /api/health` (liveness, returns `x-build-fingerprint` = first 16 hex of sha256 of the deployed commit) and `GET /api/ready` (runs `SELECT 1`, 503 when the database is down) |

Rules that apply to every command run on the host: scope everything to this app's containers and volume. The host runs other live clinical applications. Never touch another project's containers, databases or the shared proxy config.

---

## 4. Design system and the Envato Elements shortlist

The locked plan uses the template for visual language only: colour, type, spacing, radius, elevation. It keeps the prototype's information design: a left threshold band on every row, tabular numerals for all times, no all-caps labels, no decorative cards, and one memorable element, the elapsed clock. That is the brief for choosing a template: calm, dense, readable one-handed, with a token system that is easy to lift.

**Recommended downloads (Envato Elements, all licensed per project; register the project name "ER Navigator" when downloading)**

| Priority | Item | Use it for | Why this one |
| --- | --- | --- | --- |
| 1 | Tailwick, 15-in-1 Tailwind CSS Admin & Dashboard (themesdesign). https://elements.envato.com/tailwick-15-in-1-tailwind-css-admin-dashboard-8UZCM3G | The primary source of tokens and component patterns: colour scale, type ramp, spacing, radii, shadows, form controls, tables, chips. Download the **Next.js 15 + TypeScript** variant and the **Figma** file | Same stack family as this build (Tailwind 4, TypeScript, Next.js), RTL and dark mode built in (Arabic is Phase 8), Figma included so tokens can be read rather than reverse-engineered |
| 2 | LuminaHealth Hospital Management Dashboard UI Kit (CreateBigSupply), Figma. https://elements.envato.com/luminahealth-hospital-management-dashboard-ui-kit-9D5ZWGL | Healthcare visual language: emergency alert widgets, patient-flow and bed-occupancy blocks, global colour and text styles | Closest subject match on the platform (ED flow, alerts). Its colour and text styles are a good second opinion on the palette |
| 3 | MedAxis, Clinic Management Dashboard UI Kit (Vktr Supply), Figma/XD/Sketch/PSD. https://elements.envato.com/medaxis-clinic-management-dashboard-ui-kit-BZ9NTYS | Minimalist reference for tables and forms, open-source fonts | Restraint. Where Tailwick is busy, this shows the quieter version of the same components |
| Optional | Vristo, Tailwind React/Next.js Admin Template (sbthemes). https://elements.envato.com/vristo-tailwind-reactjs-nextjs-admin-template-TNR7P9L | Fallback to item 1 if its Next.js variant disappoints on inspection | Next App Router, TypeScript, Figma, i18n/RTL |
| Optional | Hospenta Healthcare Mobile App UI Kit (Analogousstudio), Figma. https://elements.envato.com/hospenta-healthcare-mobile-app-ui-kit-LMXN9HM | Mobile spacing and touch-target reference for the case editor | Phone-first layouts of long clinical forms |

Not worth buying: fonts (use Google Fonts: Inter or IBM Plex Sans, both with tabular figures), icons (Lucide, MIT), charts (Recharts is already in the prototype), a hospital-specific admin template in React or Angular (wrong stack, and the content would be discarded anyway).

**What to do with the downloads**

1. Put the unzipped folders under `C:\Users\ahmed\Documents\Navigators\design-template\` (one folder per item). Do not commit them: they are licensed assets.
2. Phase 0.3 (a short Fable session): extract tokens into `design/tokens.md` and `app/globals.css` `@theme`: neutral scale, accent, semantic colours, type ramp (sizes, weights, line heights), spacing scale, radii, elevation. Keep the five threshold colours from the prototype unless the template's semantic colours meet WCAG AA on white and stay distinguishable from each other; record the decision in `design/tokens.md`.
3. Extract only tokens and layout patterns. No content, copy, logos, illustrations or component names from the template reach this repository.

**Acceptance for the visual layer (checked at every gate with Playwright screenshots at 390 x 844 and 1280 x 800)**

- Lighthouse mobile: performance and accessibility at or above 90 on Board and Case editor (Phase 7 gate; tracked from Phase 3).
- Touch targets at least 44 px; body text at least 15 px on mobile; all times in tabular numerals; contrast AA.
- One-handed use of the case editor: chips, "Now" buttons, quick-adjust registration chips, sticky save.
- Print stylesheet produces the shift handover sheet (Phase 3) and the report (Phase 5).

---

## 5. Phases, gates and the Fable recipe per phase

The locked plan's phases, gates, report format and commit format are unchanged. Each phase below adds three things: what is already done, what "done" means for this deployment, and the Fable recipe (which model does what) so the work is cheap.

Cross-cutting checklist for every feature slice, unchanged: schema → zod → server action → UI → audit row → unit test → e2e step → `docs/CHANGELOG.md` line. A slice missing a layer is not done.

Model tiers used below: **Fable** = Claude Fable 5.1 (lead). **Sonnet** = Claude Sonnet 5 subagent. **Haiku** = Claude Haiku 4.5 subagent. Section 6 explains the split.

### Phase 0: discovery and scaffold (mostly done 2026-09-08)

Done: pre-reads, scaffold, schema, seed, formulas with tests, PHI guard, headers, probes, Dockerfile, compose, CI, repository, DNS, Coolify app, first deploy, this plan.

Remaining before Gate 0 closes:

- 0.1 Ahmed answers Section 9.
- 0.2 Ahmed downloads the Section 4 items.
- 0.3 Token extraction session: `design/tokens.md`, `app/globals.css`. Fable, one short session, `frontend-design` and `ui-ux-pro-max` skills loaded, screenshots of the holding page before and after.
- 0.4 Task list created from this plan (`taskmanager:plan` over `docs/PLAN.md`).

Gate 0 report, then wait for "confirm".

### Phase 1: schema, seed, auth, audit

Done: schema, migrations, seed, two DB roles.

To build: Auth.js v5 credentials provider, bcrypt cost 12, database sessions (httpOnly, secure, sameSite=lax, 12 h sliding, rotated on login), login rate limit (5 per minute per IP via `CF-Connecting-IP`), lockout (15 min after 10 failures), role middleware, audit wrapper writing before/after JSON, `auth.login`/`auth.fail`/`auth.forbidden` events, grants migration that revokes UPDATE/DELETE on `AuditLog` and `CaseUpdate` from `ernav_app`.

Tests: formula tests (done), PHI guard (done), role matrix test (every action x every role), lockout test, audit wrapper test, a DB privilege test that asserts `has_table_privilege('ernav_app','"AuditLog"','DELETE')` is false.

Recipe: Fable designs the auth and audit module boundaries and reviews at the gate (one session). Sonnet implements the credentials flow and the audit wrapper from the design in a worktree, tests first. Haiku writes the role-matrix test table from Section 2 of the locked plan.

### Phase 2: case vertical slice

Create, edit, resolve, reopen, void. Conditional sections, chains, "Check these times" panel (port `timeWarnings`), primary selector, optimistic locking with 409 and the "changed by {name} at {time}" message, append-only updates, "Other" text to review queue, deselect-Other cleanup.

Tests: zod rules from locked plan section 4, one unit test per rule; Playwright: navigator opens a case in under 15 UI actions, adds an update, resolves; a second session gets 409 on a stale save.

Recipe: Fable writes `validation.ts` and `warnings.ts` itself (they encode the rules; getting them wrong is the expensive failure) and reviews the server actions. Sonnet builds the editor UI from the prototype section by section, one component per subagent, each with its own Playwright step. Screenshots at both viewports at the gate.

### Phase 3: board

Sorting by elapsed time, bands, MRN search, Open/Resolved/All filter, staleness at 2 h, counts strip, 30 s polling, floating New case (hidden for VIEWER), print handover sheet.

Recipe: Sonnet ports the board from the prototype. Fable reviews information density on the mobile screenshot and the print sheet. First Lighthouse run recorded here.

### Phase 4: dashboard

All sections from locked plan section 5.4, drill-down everywhere, date ranges, Sunday-start weeks in Asia/Riyadh, `MIN_N`, shift and weekday, disposition, Other review queue.

Tests: a fixture set of about 40 cases with hand-computed answers; one unit test per aggregate. Load the `dataviz` skill for chart review.

Recipe: Fable writes `aggregates.ts` and the fixture answers (the numbers must be right). Sonnet builds the sections and drill-downs. A small Workflow of adversarial verifiers checks the fixture answers independently before the gate.

### Phase 5: export and print report

exceljs streamed workbook (Summary, Cases, Consults, Investigations, Updates), `/report?from&to` with hospital header, generated-at, print styles.

Tests: exported Cases sheet row count equals the filtered query count; hours columns equal `elapsedHours`.

Recipe: Sonnet end to end, Fable reviews the sheet mapping against the prototype's export columns.

### Phase 6: admin and alerts

Users, reference lists, Other promotion (re-tags the originating case, closes the review), audit viewer, alerts worker (5 min cron over OPEN cases, thresholds 4/6/12/24, email from 6 h up to SUPERVISOR and ADMIN, retry once, never crash), `worker` service added to the compose.

Recipe: Fable designs the worker's idempotency (unique on caseId+threshold does the heavy lifting) and the email template. Sonnet builds admin screens. Test: promoting an Other reason re-tags the case and closes the review.

### Phase 7: hardening and deployment

`slop-remover` pass, `security-pan-check:sec-web` and `sec-code` passes and fixes, `npm audit` clean of high/critical, Lighthouse mobile at or above 90 on Board and Case editor, CSP tightened (hashed inline styles), PWA manifest and install prompt, `scripts/backup.sh` on the host timer with a restore drill recorded, Uptime Kuma monitor on `/api/ready`, `docs/RUNBOOK.md` complete (start, stop, restore, add a user, rotate secrets). Gate 7 = production ready.

Recipe: Fable runs the security review and the restore drill personally. Haiku does the slop pass and doc sweeps.

### Phase 8: only if asked

Historical xlsx import, server-sent events for the board, Arabic RTL (Tailwick ships RTL), WhatsApp Business notifications.

**Effort estimate (Fable-led sessions, everything else delegated; treat as a planning aid, not a quote)**

| Phase | Sessions | Notes |
| --- | --- | --- |
| 0 remainder | 1 short | tokens + task list |
| 1 | 1 to 2 | auth is security-critical; do not rush the gate |
| 2 | 2 to 3 | the largest surface; most Sonnet work |
| 3 | 1 | |
| 4 | 2 | fixture maths dominates |
| 5 | 1 | |
| 6 | 1 to 2 | |
| 7 | 1 to 2 | includes the restore drill |

---

## 6. The Fable playbook: best results at the lowest cost

Fable is the most capable model available here and the most expensive per token. The cheapest way to use it is to let it do only what smaller models get wrong, and to make every Fable turn short and well fed.

**Split the work by what fails expensively**

- Fable: architecture and module boundaries, the rules code (`validation.ts`, `warnings.ts`, `aggregates.ts`), security (auth, audit, DB privileges, headers), gate reviews, any bug that survives one Sonnet attempt, and the final answers to Ahmed's questions.
- Sonnet: implementing a well-specified slice (a server action from its zod schema, a UI section from the prototype, a Playwright step), in a worktree, with the test written first.
- Haiku: mechanical work. Porting constants, renames, formatting, doc updates, lockfile bumps, writing table-driven tests from a matrix that already exists.
- Effort setting: `low` for mechanical subagents, default for implementation, `high` only for gate review and security review. `max` is not needed anywhere in this project.

**Keep every Fable turn small**

- One session per phase. The handoff between sessions is the gate report plus `docs/CHANGELOG.md`, not the previous conversation.
- Load only the plan section for the phase and the locked-plan sections it names. Never paste the prototype; reference its path and the function names.
- `CLAUDE.md` stays under 60 lines. Detail lives in this plan and the runbook, one hop away.
- Prompt caching rewards a stable prefix: the same pre-reads at the top of every session, the new task at the bottom.
- Tests before code for every slice. A failing test is a cheaper spec than a paragraph, and it stops the iterate-until-it-looks-right loop that burns tokens.
- Verify with tools, not prose: Playwright screenshots at 390 x 844 and 1280 x 800, `pnpm test`, `curl /api/health` for the fingerprint. Never ask Fable to describe what a screen probably looks like.
- Scoped test runs while building (`vitest run src/lib/domain`), full suite only at the gate.
- Push-to-deploy. Nobody deploys by hand; nobody polls Coolify every thirty seconds. Wait about five minutes, then read the fingerprint.

**Use multi-agent workflows only where they pay**

- Yes: end-of-phase adversarial review (independent finders, then refuters per finding) for Phases 1, 2, 4 and 7; independent recomputation of the Phase 4 fixture answers.
- No: writing code in parallel on the same files, "exploring the codebase" with several agents when one `Explore` pass will do, and any loop that runs until a budget is spent.

**Things that waste Fable tokens, seen in comparable projects**

- Re-reading large files a second time in the same session. Read once, keep the summary in the plan or the CLAUDE.md.
- Long gate reports. The locked plan gives the exact five-line shape; use it.
- Letting the lead model write boilerplate (CRUD forms, table rows, seed data) that a subagent produces identically.
- Debugging a deploy by re-deploying. Read the Coolify deployment log once, fix the cause, push once.
- Re-litigating locked decisions at each gate. The do-not list in the locked plan section 9 is final; this plan's Section 1 is final once Gate 0 passes.

---

## 7. Deployment procedure

**Ship a change**

1. Work on a branch, open a PR, CI must be green (lint, typecheck, unit, build).
2. Merge to `main`. Coolify builds on the host (about 2 to 5 minutes; longer when other tenants are building) and rolls the new `app` container in only after its healthcheck passes. The `migrate` service runs first; if a migration fails, the old container keeps serving.
3. Verify by fingerprint, not by tag: `curl -sI https://nav.towardpcc.com/api/health | grep x-build-fingerprint` and compare with `printf %s "$(git rev-parse HEAD)" | sha256sum | cut -c1-16`. Then `curl -s https://nav.towardpcc.com/api/ready` must return `ready`.

**Roll back**: Coolify → the application → Deployments → pick the last good one → Redeploy. Migrations are forward-only; a rollback that needs a schema revert gets its own migration.

**Change a secret**: edit it in Coolify (both the production and the preview copy), then a `restart_only` deployment; a plain restart keeps the old environment. Verify with a hash of the value inside the container, never by printing it.

**DNS**: `nav.towardpcc.com` stays proxied. Turning the orange cloud off takes the site offline and breaks certificate renewal.

**When a deploy fails**: read the deployment log in Coolify first. The three usual causes on this host are a lockfile out of sync (`pnpm install --frozen-lockfile` fails), an env var with `$` in it (compose interpolates and truncates it; use 48-char alphanumerics), and a migration that needs data the seed has not created yet.

---

## 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Threshold alerts depend on the worker; if it dies, nobody is emailed | Worker has `restart: unless-stopped`, its own healthcheck, and an Uptime Kuma push monitor (Phase 6). The `Alert` unique index makes restarts idempotent |
| A migration runs against production data with a mistake | `migrate` runs before `app` and the old container keeps serving on failure; nightly dump plus a drilled restore (Phase 7); schema PRs get Fable review |
| Optimistic-locking conflicts frustrate nurses on a busy shift | The 409 message names who changed the case and when; `CaseUpdate` rows never conflict, so the most common action (add an update) always succeeds |
| Someone opens 80/443 to the world for another app | `CF-Connecting-IP` becomes spoofable. The runbook records the dependency; the rate limiter falls back to the socket address when the header is absent |
| Envato template pushes the UI toward decorative dashboards | Section 4 rules: tokens only. Gate screenshots are reviewed against the prototype's information design |
| Shared host under build load slows deploys | Accept; verify by fingerprint after five minutes rather than reacting early |
| Public repository (if flipped) leaks hospital specifics | No PHI, no secrets, no hospital data in git by construction; the plan and prototype are the only hospital-specific text. Keep private unless there is a reason |

---

## 9. Gate 0 questions for Ahmed

1. Please add `ER_Navigator_Tool_Design.md` to `docs/reference/` (or say it is superseded by the prototype and plan).
2. Download the Section 4 items into `Documents\Navigators\design-template\` and say when they are there.
3. SMTP for alerts: use the existing Infomaniak relay (`mail.dmc-im.com`, from `info@dmc-im.com`), or a `towardpcc.com` sender (needs an SPF change and DKIM)? Alerts stay log-only until this is answered.
4. First ADMIN username and display name (the password is set once in Coolify as `ADMIN_PASSWORD` and consumed by the seed; change it after first login).
5. Hospital header text for the printed report and handover sheet (exact wording, English).
6. Confirm Next.js 16 and Prisma 7 instead of the plan's Next.js 15 (Section 1).
7. Keep the repository private with a deploy key (recommended), or make it public as you offered?
8. Preview deployments: Coolify can build PRs on `pr-N.nav.towardpcc.com`. Wanted from Phase 2, or not at all?

---

## Appendix A: Coolify and Cloudflare cookbook (verified this session)

All Coolify calls run on the host over SSH: `ssh -i ~/.ssh/oci_server ubuntu@145.241.105.239`, token `~/.coolify-token`, base URL `http://localhost:8000/api/v1`.

- Create the app: `POST /applications/private-deploy-key` with `project_uuid`, `server_uuid`, `environment_uuid`, `private_key_uuid`, `git_repository`, `git_branch`, `build_pack: dockercompose`, `docker_compose_location`, `base_directory: /`, `name`, `instant_deploy`.
- Bind the domain to the compose service: `PATCH /applications/{uuid}` with `docker_compose_domains` as JSON `{"app":{"domain":"https://nav.towardpcc.com:3000"}}` (the port after the host is the container port Traefik targets).
- Env vars: `PATCH /applications/{uuid}/envs/bulk` with `{ "data": [ { "key", "value", "is_preview": false } ] }`; set each secret twice (`is_preview` false and true) with different values, per the towardpcc runbook.
- Deploy: `GET /deploy?uuid={uuid}&force=false`; poll `GET /deployments/{deployment_uuid}` until `status` is `finished`.
- Cloudflare: `POST /zones/91d9abd839af2cfff133f91de8f5cf61/dns_records` with `{type:"A", name:"nav", content:"145.241.105.239", proxied:true, ttl:1}` using the DNS-edit token in `secrets.env`.

## Appendix B: scaffold file map

```
app/                      layout, holding page, api/health, api/ready, globals.css (@theme tokens)
src/lib/db.ts             lazy PrismaClient over the pg adapter
src/lib/domain/           taxonomy.ts (Appendix A), time.ts (formulas), __tests__/
prisma/schema.prisma      authoritative model; prisma/migrations/; prisma/seed.ts
prisma.config.ts          Prisma 7 CLI config (DATABASE_URL from env)
tests/unit/phi-guard.test.ts, tests/e2e/smoke.spec.ts
Dockerfile                targets: deps, build, migrate, runner
docker-compose.production.yml   db + migrate + app (+ worker in Phase 6)
docker/postgres-init/01-app-role.sh   creates ernav_app on first boot
scripts/migrate-and-seed.sh
.github/workflows/ci.yml, .github/dependabot.yml
docs/PLAN.md (this), docs/RUNBOOK.md, docs/DESIGN-ASSETS.md, docs/CHANGELOG.md, docs/reference/
```
