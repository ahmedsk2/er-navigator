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

- `ER_Navigator_Cases_FirstPass_Extraction.xlsx`: Phase 8 only.

**Inputs received on 9 September (Gate 0)**

- `docs/reference/ER_Navigator_Tool_Design.md` (Draft v3). Reconciled against Appendix A and the schema: every stage and reason matches; v3's single "Imaging acquisition delay (CT / US / X-ray / KUB, sub-select)" is the three imaging reasons Appendix A already carries; "Isolation/negative pressure room (tag alongside any ward)" is the `isolation` flag on the case; "Time flagged" is `openedAt`; "Navigator (creator)" comes from the login. One difference: v3 lists Dermatology as a tentative department; Appendix A (which wins) does not include it, and Admin can add it in Phase 6 if QCH refers there. RCC is read as Regional Coordination Center.
- The five Envato items, unzipped under `Documents\Navigators\design-template\` (Tailwick, Vristo, LuminaHealth, MedAxis, Hospenta). Licensed files; never committed.

**Infrastructure found and verified this session**

| Item | Value |
| --- | --- |
| Host | OCI `hosting-1`, `145.241.105.239`, me-riyadh-1, Ubuntu 24.04 ARM64, 4 OCPU / 24 GB, 131 GB free |
| Platform | Coolify 4.1.2 + Traefik 3.6, Docker 29.6. Apps deploy from GitHub via read-only deploy keys, push-to-deploy. For compose applications a deploy is stop-then-start: every container of the app is removed, then `docker compose up -d` runs, so expect about a minute of 404 per deploy (verified in the first deploy log) |
| Existing clinical pattern | `qch` and `endorsement`: project `clinical`, build pack `dockercompose`, `/docker-compose.production.yml`, isolated DB container on a private network, Traefik reaches the app on the `coolify` network |
| DNS | Cloudflare zone `towardpcc.com`. Every subdomain on this host is PROXIED and must stay so: the OCI security list accepts 80/443 only from Cloudflare ranges. Zone SSL mode: Full (strict). Origin certs: Let's Encrypt via Traefik HTTP-01 through Cloudflare |
| Backups | OCI Object Storage bucket `coolify-backups` (14-day WORM rule), mirrored daily to Ahmed's laptop by the `OracleBackupSync` task. Boot-volume backup policy attached |
| Monitoring | Uptime Kuma at `uptime.towardpcc.com`; OCI down/CPU alarms to email |
| SMTP | Working relay credentials exist in `ORACLE MCP/infra/secrets.env` (Infomaniak `mail.dmc-im.com:587`). No app on the host currently sends from `towardpcc.com` (its SPF is `-all`) |
| Tooling from the dev machine | SSH to the host with passwordless sudo, Coolify API via `http://localhost:8000` on the host (token at `~/.coolify-token` there), Cloudflare DNS API (token in `secrets.env`), GitHub CLI as `ahmedsk2` |

**Delivered this session (Phase 0, most of it)**

- This repository: Next.js 16 + TypeScript strict + Tailwind 4 + Prisma 7 + Postgres 16, with the authoritative Prisma schema, the Appendix A seed, the duration formulas ported from the prototype with unit tests, the PHI-guard test, security headers, health and readiness probes, a Dockerfile and production compose that follow the host's clinical pattern, CI, Dependabot.
- GitHub repository, Cloudflare record `nav.towardpcc.com`, Coolify application in project `clinical`, push-to-deploy webhook, first deploy verified by commit fingerprint and a live `SELECT 1`. The live facts are in `docs/RUNBOOK.md`.
- An adversarial review of this plan, the scaffold and the deployment config (five lenses, two independent refuters per finding, 55 agents). Nineteen findings survived; every one is either fixed in the scaffold or recorded in Section 1, Section 9 or the runbook. The refuted ones are not carried.

---

## 1. Decisions: what this plan fixes relative to the locked plan

The locked plan wins on workflow, taxonomy, rules, screens and permissions. This table is the complete list of places where this plan decides something the locked plan left to Gate 0, or updates a version. Anything not listed is unchanged.

| Area | Locked plan | This plan | Why |
| --- | --- | --- | --- |
| Framework | Next.js 15, App Router, TS strict | Next.js 16.3, App Router, TS strict | Current stable. The exact combination (Next 16, React 19, Prisma 7, Auth.js v5 beta, zod 4, Tailwind 4) already runs on this host in `towardpcc`, so it is proven on this ARM64 build path |
| ORM | Prisma, provider chosen at Gate 0 | Prisma 7 on PostgreSQL 16 with the `pg` driver adapter | Prisma 7 has no native engine, so it runs on the Windows-ARM64 dev box and the Linux-ARM64 host alike |
| Database placement | "whatever the server has" | Dedicated Postgres 16 container inside this app's compose, on a private network, two roles: `ernav_owner` (migrations, seed) and `ernav_app` (runtime; UPDATE/DELETE revoked on `AuditLog` and `CaseUpdate`) | Matches the `qch`/`endorsement` isolation rule for anything holding patient identifiers. The app can be created, moved or destroyed without touching another system's data. Append-only is enforced at the database, not only in code |
| Migrations | Not specified | Automatic on every deploy: a one-shot `migrate` service runs `prisma migrate deploy`, reconciles the app role's password and privileges, then seeds, all as the owner role; `app` starts only after it exits 0. A failed migration is an outage until it is resolved (Section 7) | Removes the "merged a schema change, forgot the migration" failure recorded in the towardpcc runbook |
| Secrets inside containers | Not specified | Coolify writes every application variable into an env file attached to every service, so the owner password would reach the app container. The app image's entrypoint unsets everything not on its allowlist before starting the server; the runbook's deploy verification checks it | Keeps the database-level append-only guarantee meaningful: code running in the app process cannot connect as the owner |
| Deploy model | Rolling update assumed | Stop-then-start (Coolify's behaviour for compose apps): about a minute of downtime per deploy, merge outside shift change, and a failed migration keeps the site down until `prisma migrate resolve` is run (runbook, "Deploy failed at migrate") | Measured on the first deploy; the plan must not promise a rolling update it does not get |
| Seed contract | Seed reference lists verbatim | The seed fills EMPTY reference tables only and never updates an existing row, because Admin renames, reorders and deactivates them from Phase 6 | Otherwise every merge to `main` would revert Admin's edits and resurrect renamed rows |
| Phase sequencing | Schema, migrations, seed, formula tests and PHI guard belong to Phase 1 | Pulled forward into the Phase 0 scaffold so the pipeline could be proven end to end. Gate 1 still reviews them | Listed here so the Gate 0 report can name it as a deviation rather than hide it |
| Sessions | Auth.js v5 credentials provider with database sessions | Auth.js refuses that combination (the credentials provider only supports JWT sessions), so Phase 1 needs a decision at Gate 0, Section 9 question 9. Recommended: option A, hand-rolled opaque-cookie sessions stored in a `Session` table (about 200 lines plus tests), which satisfies locked section 7 literally: 12 h sliding, rotated on login, revoked on deactivation, no beta dependency | Discovered in review; deciding it mid-phase would cost a Sonnet loop |
| Weekly chart | Prototype: one dual-axis chart, bars = cases, line = median hours | Two aligned panels over the same weeks (cases; median stay), one scale each, same colours and footnote | A dual axis is the first anti-pattern of the charting guidance this build follows, and on real data (stays of tens of hours against a handful of cases a week) the shared-scale version collapsed the bars to the baseline. Both marks are kept; a two-line change restores the single chart if Ahmed prefers it |
| Amber threshold colour | Prototype `#C98A1B` | Band `#B8790F` (3.6:1 on white) with a text variant `#8A5E0E` (5.7:1); a unit test enforces 4.5:1 for text tokens and 3:1 for bands | The prototype's amber is 2.9:1, below AA for text and below 3:1 for graphics; the plan's own acceptance would have failed at Gate 3 |
| Hosting | NSSM + Caddy + Cloudflare Tunnel, or systemd + Caddy | Coolify application, build pack `dockercompose`, Traefik in front, push-to-deploy from `main` | This is what the server runs. No new moving parts |
| Domain | "public hostname" at Gate 0 | `nav.towardpcc.com`, Cloudflare A record to `145.241.105.239`, proxied | Same zone and lock as the other clinical apps |
| Alerts worker | `worker/alerts.ts` as its own process | Same code, run as a `worker` service in the compose from the same image with a different command (Phase 6) | One image, one deploy, separate process as the plan requires |
| Email | nodemailer over SMTP | Same. Credentials come from Coolify env vars; provider decided at Gate 0 (Section 9) | The host has a working relay; sending from `towardpcc.com` needs an SPF change first |
| Backups | Nightly dump script, 30-day retention | Phase 7: `scripts/backup.sh` on the host's systemd timer, `pg_dump` to a dated gzip, 30 local days, upload to the `coolify-backups` bucket. The laptop sync already mirrors that bucket, which gives the third copy for free | Plugs into the backup chain Ahmed already runs and drills |
| Client IP for rate limiting | Not specified | Read `CF-Connecting-IP` | Safe only because the origin is locked to Cloudflare. If those ports are ever opened, this must change in the same commit (towardpcc has the same dependency) |
| Repository | Not specified; Ahmed allowed an open repo for now | `github.com/ahmedsk2/er-navigator`, PUBLIC during the build by Ahmed's decision (9 September), read-only deploy key in Coolify; flipped private when the build finishes. Nothing hospital-specific beyond the plan and prototype, and never a secret or a patient identifier, may enter it | Ahmed's call; the deploy path does not care either way |
| Model tiers for delegation | Not specified | Fable leads and reviews; Opus does the implementation slices; Sonnet and Haiku only for trivial mechanics (formatting, renames, doc sweeps). Ahmed asked for Opus over Sonnet and Haiku on 9 September | Fewer iterations per slice at a modest cost increase |
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
| Production env vars | Coolify → the application → Environment Variables. Every key set there reaches every container (Coolify's env file); the compose `environment:` blocks fix defaults, and the app entrypoint keeps only its allowlist |
| Local dev env | `.env` (gitignored), from `.env.example` |
| Infrastructure secrets (Cloudflare, Coolify, SMTP) | `C:\Users\ahmed\Documents\ORACLE MCP\infra\secrets.env` on the dev machine and `~/.coolify-token`, `~/.cloudflare-token` on the host. Never in this repository |
| Health | `GET /api/health` (liveness, returns `x-build-fingerprint` = first 16 hex of sha256 of the deployed commit) and `GET /api/ready` (runs `SELECT 1`, 503 when the database is down) |

Rules that apply to every command run on the host: scope everything to this app's containers and volume. The host runs other live clinical applications. Never touch another project's containers, databases or the shared proxy config.

---

## 4. Design system and the Envato Elements shortlist

The locked plan uses the template for visual language only: colour, type, spacing, radius, elevation. It keeps the prototype's information design: a left threshold band on every row, tabular numerals for all times, no all-caps labels, no decorative cards, and one memorable element, the elapsed clock. That is the brief for choosing a template: calm, dense, readable one-handed, with a token system that is easy to lift.

**Downloads (received 9 September; Envato Elements, licensed per project)**

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
4. Contrast is a test, not a preference: every token used as text is at least 4.5:1 on both grounds and every band at least 3:1 (`tests/unit/tokens.test.ts`). The prototype's amber failed both and is already replaced (Section 1).

**Acceptance for the visual layer (checked at every gate with Playwright screenshots at 390 x 844 and 1280 x 800)**

- Lighthouse mobile: performance and accessibility at or above 90 on Board and Case editor (Phase 7 gate; tracked from Phase 3).
- Touch targets at least 44 px; body text at least 15 px on mobile; all times in tabular numerals; contrast AA.
- One-handed use of the case editor exactly as the prototype has it: chips, "Now" buttons, quick-adjust registration chips, the save button after the "Check these times" panel. No sticky save bar: it would let a nurse save without passing the warnings and would stack on the tab bar.
- Print stylesheet produces the shift handover sheet (Phase 3) and the report (Phase 5).

---

## 5. Phases, gates and the Fable recipe per phase

The locked plan's phases, gates, report format and commit format are unchanged. Each phase below adds three things: what is already done, what "done" means for this deployment, and the Fable recipe (which model does what) so the work is cheap.

Cross-cutting checklist for every feature slice, unchanged: schema → zod → server action → UI → audit row → unit test → e2e step → `docs/CHANGELOG.md` line. A slice missing a layer is not done.

Model tiers used below: **Fable** = Claude Fable 5.1 (lead). **Opus** = Claude Opus 5 subagent, the default for implementation (Ahmed's preference, 9 September). **Sonnet** and **Haiku** only for trivial mechanics. Section 6 explains the split.

### Phase 0: discovery and scaffold (mostly done 2026-09-08)

Done: pre-reads, scaffold, schema, seed, formulas with tests, PHI guard, headers, probes, Dockerfile, compose, CI, repository, DNS, Coolify app, first deploy, this plan.

Remaining before Gate 0 closes:

- 0.1 Ahmed answers Section 9.
- 0.2 Ahmed downloads the Section 4 items.
- 0.3 Token extraction session: `design/tokens.md`, `app/globals.css`. Fable, one short session, `frontend-design` and `ui-ux-pro-max` skills loaded, screenshots of the holding page before and after.
- 0.4 Task list created from this plan (`taskmanager:plan` over `docs/PLAN.md`).

Gate 0 report, then wait for "confirm".

### Phase 1: schema, seed, auth, audit

Done (pulled forward, Section 1): schema, migrations including the privileges migration, seed, two DB roles, role reconciliation on deploy.

To build: the session design decided at Gate 0 (Section 1, Sessions row) with bcrypt cost 12 credentials, httpOnly/secure/sameSite=lax cookie, 12 h sliding expiry, rotation on login, revocation on deactivation; login rate limit (5 per minute per IP via `CF-Connecting-IP`, socket address as fallback); lockout (15 min after 10 failures); role checks in a `proxy.ts` gate plus every server action; audit wrapper writing before/after JSON; `auth.login`/`auth.fail`/`auth.forbidden` events. Install `scripts/backup.sh` on the host timer at this gate, before any real case is entered, and record the first restore drill in the runbook.

Tests: formula tests (done), PHI guard (done), role matrix test (every action x every role), lockout test, audit wrapper test, a DB privilege test that asserts `has_table_privilege('ernav_app','"AuditLog"','DELETE')` is false.

Recipe: Fable designs the auth and audit module boundaries and reviews at the gate (one session). Opus implements the credentials flow and the audit wrapper from the design in a worktree, tests first, and writes the role-matrix test table from Section 2 of the locked plan.

### Phase 2: case vertical slice

Create, edit, resolve, reopen, void. Conditional sections, chains, "Check these times" panel (port `timeWarnings`), primary selector, optimistic locking with 409 and the "changed by {name} at {time}" message, append-only updates, "Other" text to review queue, deselect-Other cleanup.

Tests: zod rules from locked plan section 4, one unit test per rule; Playwright: navigator opens a case in under 15 UI actions, adds an update, resolves; a second session gets 409 on a stale save.

Free text is the realistic PHI path (update text, resolution note, Other text, void reason): a shared `freeText` zod schema trims and caps every one of them, and, if Ahmed approves Section 9 question 10, adds a warning to the existing warnings channel when a 10-digit run appears (Saudi ID, Iqama and mobile numbers are 10 digits; MRNs vary, so warn rather than block). Every free-text field carries a persistent "MRN only, no names" hint. The runbook already has the owner-role scrub procedure for the day a name slips through.

Recipe: Fable writes `validation.ts` and `warnings.ts` itself (they encode the rules; getting them wrong is the expensive failure) and reviews the server actions. Opus builds the editor UI from the prototype section by section, one component per subagent, each with its own Playwright step. Screenshots at both viewports at the gate.

### Phase 3: board

Sorting by elapsed time, bands, MRN search, Open/Resolved/All filter, staleness at 2 h, counts strip, 30 s polling, floating New case (hidden for VIEWER), print handover sheet.

Recipe: Opus ports the board from the prototype. Fable reviews information density on the mobile screenshot and the print sheet. First Lighthouse run recorded here.

### Phase 4: dashboard

All sections from locked plan section 5.4, drill-down everywhere, date ranges, Sunday-start weeks in Asia/Riyadh, `MIN_N`, shift and weekday, disposition, Other review queue.

Tests: a fixture set of about 40 cases with hand-computed answers; one unit test per aggregate. Load the `dataviz` skill for chart review.

Recipe: Fable writes `aggregates.ts` and the fixture answers (the numbers must be right). Opus builds the sections and drill-downs. A small Workflow of adversarial verifiers checks the fixture answers independently before the gate.

### Phase 5: export and print report

exceljs streamed workbook (Summary, Cases, Consults, Investigations, Updates), `/report?from&to` with hospital header, generated-at, print styles.

Tests: exported Cases sheet row count equals the filtered query count; hours columns equal `elapsedHours`.

Recipe: Opus end to end, Fable reviews the sheet mapping against the prototype's export columns.

### Phase 6: admin and alerts

Users, reference lists, Other promotion (re-tags the originating case, closes the review), audit viewer, alerts worker (5 min cron over OPEN cases, thresholds 4/6/12/24, email from 6 h up to SUPERVISOR and ADMIN, retry once, never crash), `worker` service added to the compose.

Preconditions this phase must build first: a `worker` Dockerfile target (the runner image has no TypeScript runtime; bundle `worker/alerts.ts` with esbuild into the runner image and run it with `node`, reusing the entrypoint allowlist) and a seeded system user (fixed username, `active = false`, role NAVIGATOR) to own the "Reached Nh threshold" updates, because `CaseUpdate.authorId` is required. The Phase 8 importer uses the same user.

Recipe: Fable designs the worker's idempotency (unique on caseId+threshold does the heavy lifting) and the email template. Opus builds admin screens. Test: promoting an Other reason re-tags the case and closes the review.

### Phase 7: hardening and deployment

`slop-remover` pass, `security-pan-check:sec-web` and `sec-code` passes and fixes, `npm audit` clean of high/critical, Lighthouse mobile at or above 90 on Board and Case editor, CSP tightened (hashed inline styles), PWA manifest and install prompt, `scripts/backup.sh` on the host timer with a restore drill recorded, Uptime Kuma monitor on `/api/ready`, `docs/RUNBOOK.md` complete (start, stop, restore, add a user, rotate secrets). Gate 7 = production ready.

Recipe: Fable runs the security review and the restore drill personally. Opus does the slop pass; Haiku the doc sweeps.

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

- Fable: architecture and module boundaries, the rules code (`validation.ts`, `warnings.ts`, `aggregates.ts`), security (auth, audit, DB privileges, headers), gate reviews, any bug that survives one Opus attempt, and the final answers to Ahmed's questions.
- Opus: implementing a well-specified slice (a server action from its zod schema, a UI section from the prototype, a Playwright step), in a worktree, with the test written first; also table-driven tests from an existing matrix.
- Sonnet or Haiku: only trivial mechanics where a wrong answer is obvious and cheap: formatting, renames, lockfile bumps, doc sweeps.
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
- Letting the lead model write boilerplate (CRUD forms, table rows, seed data) that an Opus subagent produces identically.
- Debugging a deploy by re-deploying. Read the Coolify deployment log once, fix the cause, push once.
- Re-litigating locked decisions at each gate. The do-not list in the locked plan section 9 is final; this plan's Section 1 is final once Gate 0 passes.

---

## 7. Deployment procedure

**Ship a change**

1. Work on a branch, open a PR, CI must be green (lint, typecheck, unit, build).
2. Merge to `main`, outside shift change. Coolify builds on the host (about 2 to 5 minutes; longer when other tenants are building), then stops and removes every container of this app and starts the new set: `db`, then `migrate`, then `app`. The site returns 404 for about a minute. If `migrate` fails, `app` does not start and the site stays down: follow the runbook's "Deploy failed at migrate" section, because redeploying the previous commit does not clear a failed migration record.
3. Verify by fingerprint, not by tag: `curl -sI https://nav.towardpcc.com/api/health | grep x-build-fingerprint` and compare with `printf %s "$(git rev-parse HEAD)" | sha256sum | cut -c1-16`. Then `curl -s https://nav.towardpcc.com/api/ready` must return `ready`, and on the host the running process's environment (`/proc/1/environ` in the app container, not `docker exec printenv`, which shows the configured env) must contain no `POSTGRES_PASSWORD`.

**Roll back**: Coolify → the application → Deployments → pick the last good one → Redeploy. Migrations are forward-only; a rollback that needs a schema revert gets its own migration. After a failed migration, run `prisma migrate resolve` first (runbook), or the redeploy fails at the same step.

**Change a secret**: edit it in Coolify (both the production and the preview copy), then redeploy; a plain restart keeps the old environment. `APP_DB_PASSWORD` rotates this way because the migrate step re-applies it to the role. `POSTGRES_PASSWORD` is the exception: change it in the database first, then in Coolify (runbook). Verify with a hash of the value inside the container, never by printing it.

**DNS**: `nav.towardpcc.com` stays proxied. Turning the orange cloud off takes the site offline and breaks certificate renewal.

**When a deploy fails**: read the deployment log in Coolify first. The three usual causes on this host are a lockfile out of sync (`pnpm install --frozen-lockfile` fails), an env var with `$` in it (compose interpolates and truncates it; use 48-char alphanumerics), and a migration that needs data the seed has not created yet.

---

## 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Threshold alerts depend on the worker; if it dies, nobody is emailed | Worker has `restart: unless-stopped`, its own healthcheck, and an Uptime Kuma push monitor (Phase 6). The `Alert` unique index makes restarts idempotent |
| A migration runs against production data with a mistake | `migrate` runs before `app`, so a failing migration never starts the new app, but the site is down until it is resolved (runbook procedure); nightly dump installed at Gate 1 with a drilled restore; schema PRs get Fable review and are merged outside shift change |
| Optimistic-locking conflicts frustrate nurses on a busy shift | The 409 message names who changed the case and when; `CaseUpdate` rows never conflict, so the most common action (add an update) always succeeds |
| Someone opens 80/443 to the world for another app | `CF-Connecting-IP` becomes spoofable. The runbook records the dependency; the rate limiter falls back to the socket address when the header is absent |
| Envato template pushes the UI toward decorative dashboards | Section 4 rules: tokens only. Gate screenshots are reviewed against the prototype's information design |
| Shared host under build load slows deploys | Accept; verify by fingerprint after five minutes rather than reacting early |
| Public repository (if flipped) leaks hospital specifics | No PHI, no secrets, no hospital data in git by construction; the plan and prototype are the only hospital-specific text. Keep private unless there is a reason |

---

## 9. Gate 0: questions and answers

Answered by Ahmed on 9 September, with the items he left to my judgement ("go as you see fit") decided and marked.

1. Design document: received (`docs/reference/ER_Navigator_Tool_Design.md`, Draft v3) and reconciled in Section 0.
2. Templates: received, five items under `design-template\`.
3. SMTP sender: **navigator@towardpcc.com**, sent through that mailbox's own SMTP settings like any mail client (host, port, username, password), not through a relay (Ahmed, 9 September). Recorded in Coolify as `SMTP_FROM`; the four `SMTP_*` connection values are entered by Ahmed in Coolify (both copies) once the mailbox exists, then a redeploy. Deliverability: `towardpcc.com` publishes `v=spf1 -all` and DMARC `p=reject` with strict alignment, and both stay exactly as they are (the TowardPCC residency canary guards them). DMARC passes when the mailbox provider DKIM-signs the mail with `d=towardpcc.com`, so the one DNS change is a DKIM selector record for that provider in Cloudflare (a specific selector overrides the zone's empty `*._domainkey` wildcard). Phase 6 sends a test message to Ahmed and checks the `Authentication-Results` header for `dkim=pass` and `dmarc=pass` before the worker goes live. Alerts stay log-only until then.
4. First ADMIN: `admin`, display name Ahmed, as seeded; password lives only in Coolify. Decided by me; change in Phase 1 if wanted.
5. Report header: "Qatif Central Hospital, Emergency Department. ER Navigator" as the placeholder, held in a settings row Admin can edit (Phase 6). Decided by me.
6. Next.js 16 and Prisma 7: confirmed.
7. Repository: public during the build, private at the end. Done.
8. Preview deployments: not for now. Decided by me; adds a build per PR on a shared host for little gain before Phase 3.
9. Sessions: option A, hand-rolled opaque-cookie database sessions. Decided by me on the recommendation in Section 1.
10. Free text: warn, never block, plus the "MRN only, no names" hint. Decided by me.
11. Delegation: Opus for implementation slices rather than Sonnet and Haiku, per Ahmed.

**GATE 0 REPORT**

```
GATE 0 REPORT
Built: scaffold (Next.js 16, TypeScript strict, Tailwind 4, Prisma 7, Postgres 16), authoritative schema and migrations, Appendix A seed, duration formulas with tests, PHI guard, token contrast test, security headers, health and readiness probes, Dockerfile and compose (isolated Postgres, owner and app roles, env allowlist), CI (verify + e2e), repo, DNS, Coolify app, push-to-deploy, live at nav.towardpcc.com, plan, runbook, design-asset guide
Tests: unit 61/61, e2e 2/2 (CI green at 792e563)
Screenshots: design/screens/phase0-home-mobile-390x844.png, design/screens/phase0-home-desktop-1280x800.png
Deviations from spec: Next.js 16 not 15; Prisma 7; schema, migrations, seed, formula tests and PHI guard pulled forward from Phase 1; amber band #B8790F (+ text variant) instead of #C98A1B; seed is insert-if-missing; sessions hand-rolled, not Auth.js; deploy is stop-then-start, not rolling; Dermatology not seeded (Appendix A wins over design doc v3)
Questions: SMTP sender (item 3 above) needs Ahmed's decision before Phase 6 email
```

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
