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
| Backups | OCI Object Storage bucket `coolify-backups` (14-day WORM rule). Boot-volume backup policy attached. Corrected 11 September 2026 (readiness audit P15): this row said the bucket is mirrored daily to Ahmed's laptop by the `OracleBackupSync` task. That mirror has never worked, so there are two copies of an ER Navigator dump, the host and the bucket, not three |
| Monitoring | Uptime Kuma at `uptime.towardpcc.com`; OCI down/CPU alarms to email |
| SMTP | A relay exists on the host for other apps; this app does NOT use it (Ahmed, 9 September): it sends through the sending mailbox's own SMTP settings. Corrected 11 September 2026 (X2): the mailbox is on the secondary domain `towardpicu.com`, not `navigator@towardpcc.com` as this row said, and it carries that domain's own SPF, DKIM and DMARC. `towardpcc.com`'s SPF `-all` and DMARC `p=reject` stay exactly as they are and need no record for this app (Section 1, Email) |
| Tooling from the dev machine | SSH to the host with passwordless sudo, Coolify API via `http://localhost:8000` on the host (token at `~/.coolify-token` there), Cloudflare DNS API (token in `secrets.env`), GitHub CLI as `ahmedsk2` |

**Delivered this session (Phase 0, most of it)**

- This repository: Next.js 16 + TypeScript strict + Tailwind 4 + Prisma 7 + Postgres 16, with the authoritative Prisma schema, the Appendix A seed, the duration formulas ported from the prototype with unit tests, the PHI-guard test, security headers, health and readiness probes, a Dockerfile and production compose that follow the host's clinical pattern, CI, Dependabot.
- GitHub repository, Cloudflare record `nav.towardpcc.com`, Coolify application in project `clinical`, push-to-deploy webhook, first deploy verified by commit fingerprint and a live `SELECT 1`. The live facts are in `docs/RUNBOOK.md`.
- An adversarial review of this plan, the scaffold and the deployment config (five lenses, two independent refuters per finding, 55 agents). Nineteen findings survived; every one is either fixed in the scaffold or recorded in Section 1, Section 9 or the runbook. The refuted ones are not carried.

**Delivered by the end of Phase 7 (9 September, all gates 0 to 7 reported)**

- Phases 1 to 7 built, verified and live at `https://nav.towardpcc.com`: sessions and login, the case editor, the board, the dashboard, export and print report, admin and the alerts worker, hardening (nonce CSP, `__Host-` cookies, real 403s, PWA, accessibility, backups with an off-host copy and a drilled restore into production). `docs/CHANGELOG.md` has one line per slice; `docs/RUNBOOK.md` is the operator's document.
- A final adversarial review of the whole repository (eight lenses, one skeptic per finding, 44 agents; `docs/specs/phase7-review-findings.md`): 36 findings examined, 19 confirmed, all 19 fixed (`docs/specs/phase7-review-fixes.md`), plus the cheap true halves of the refuted ones.
- Still with Ahmed, rewritten 11 September 2026 against the readiness audit. Four of the six items this bullet used to list are done and were verified live: the first admin has signed in (three `auth.login` rows, X1), all five `SMTP_*` values are entered and the worker is in send mode from the secondary domain's mailbox, so no DKIM record is needed on `towardpcc.com` (X2), both Uptime Kuma monitors are live with the push URL in Coolify (X3), and Cloudflare refuses TLS 1.0 and 1.1 while serving 1.2 and 1.3 (X4). What is genuinely still with Ahmed: the hospital authorisation to put real patient data on this app (P1); changing the first admin's password, which is still the one seeded from Coolify (P4); making the repository private (P7); the SMTP test send and the `Authentication-Results` check, before any address is entered (P8); deciding who receives the 6 h+ alert emails (P9); the staff roster and their addresses in Admin → Users (P10); reviewing the reference lists against the hospital's own, including a paediatric ward (P13); and the cutover itself (P23).

**Delivered in Phase 13 (12 September; Ahmed, after the Phase 12 gate: merge the handover into "Left ED", require the journey times by outcome, reorder the sheet by patient flow, hide what a case does not need, progressive disclosure)**

- The case sheet is one flow again. "Patient journey" is a single block of times in the order a patient moves through the ED, second on the page and on the new-case form alike; a filled step collapses to one line with an Edit control, the next empty one is highlighted, a step the outcome cannot have is not drawn, and a hidden step that holds a time is still shown under "Also recorded". "More to record" holds the five answers a navigator fills in afterwards and opens itself on a case that already carries one of them.
- "Mark resolved" says what is missing and stays dead until nothing is, from the same table the server refuses on: the times each outcome cannot be resolved without, plus the ward for an admission and the tracking number and receiving facility for a transfer. "Open case" is unchanged: the MRN, the registration time and one delay reason.
- "Nursing handover done" is merged into "Left ED" everywhere a nurse or a reader can reach it. The database column stays, nullable and no longer written, so the cases that already carry one keep it; the Adaa admission band and the QCH ward column read the departure instead.
- The locked plan's "no redesign" rule was overridden by the owner for this phase only. No taxonomy name is renamed, added or removed and there is no migration.

**Delivered in Phase 12 (11 September; Ahmed, after the Phase 11 gate: what stands between the app and a staff demo, and between it and real patients)**

- A twelve-agent read-only readiness audit of the repository, the host and the live app answered the question in 50 items (15 demo, 30 production, 5 after go-live, 10 already done), and Ahmed chose option B for the demo and authorised the subdomain: a hosted copy on its own subdomain, its own database, its own secrets, blank SMTP. `docs/specs/phase12-go-live-readiness.md` set out the half Claude owned, and a four-lens review of that spec with three refuters per finding put up twenty-one findings and confirmed nine, six of which changed it before a line of code was written: the banner's white text moved off the 3.63:1 amber and gained `print-color-adjust`, a caller who must change their password is refused on the API rather than exempted from it, and the alert retry was bounded so it cannot outrun the worker's heartbeat. `tests/unit/phase12-spec.test.ts` holds the arithmetic of that document against the code it describes.
- The mark now prints: the medical cross sits on the report masthead and the handover sheet in a tone that survives a black-and-white printer. The playbook was rewritten for how Phases 10 and 11 actually ran: Opus does the work, Fable leads the brief, the gate and the tie-breaks.
- **12A, the code.** `INSTANCE_LABEL` names the copy you are looking at, on the sign-in panel and above every page, and production, which sets nothing, is unchanged. A first password must be changed before anything else: `User.mustChangePassword` is set on every account an admin creates or resets and enforced at one choke point in `requireUser`, with `/account` the only exemption and an API caller refused 401 before the exemption is read. One MRN-only hint sits under all five free-text boxes. The workbook download and the printed report now write audit rows. An alert e-mail that fails carries its attempt count and its last error instead of disappearing, and the admin panel says “Failed ×2”. A demo seed of four accounts and ten invented patients ships in the runner image and refuses anything that is not a labelled, demo-hosted instance. The hygiene items landed too: patient spreadsheets are gitignored, the login limit is configurable, and three Dependabot bumps were taken with the fourth refused in writing beside the Dockerfile line it would have broken.
- **12C, the documents.** This plan and the runbook stopped being true in a dozen places during Phases 7 to 11, and one of them, the runbook's “the repository is private”, is a statement an operator would act on. Every one is corrected in place and dated, and each says what it used to say: the repository is public until Ahmed flips it, the worker is in send mode from the secondary domain's mailbox rather than log-only awaiting DKIM on `towardpcc.com`, the push monitor is live, the report header is an environment variable and not a settings row, the mark is the Envato cross and not a placeholder, Dependabot's npm updater has never opened a pull request, and the laptop backup mirror has never worked, so the chain is two copies and not three. New: `docs/guide/nurse-quick-guide.md`, one printable page for a navigator that opens on “MRN only, never a name”, and `docs/guide/demo-script.md`, a fifteen-minute presenter script in the order of `tests/demo/demo.spec.ts`.
- **12B, the demo instance**, live at `https://demo-nav.towardpcc.com`: a proxied Cloudflare record, a Coolify project `demo` and an application `er-navigator-demo` with its own database, its own volume and twenty environment keys, every secret freshly generated and no production value reused. It runs the same build as production. `INSTANCE_LABEL=DEMO`, the login limit at 60 a minute for a ward behind one address, a report header that begins “DEMO.”, and SMTP and the alert push URL left blank so the worker is log-only and nothing pages anyone for a demo that is switched off. It holds four accounts and ten invented patients on `999999…` MRNs, six open and four resolved. Production was proved untouched by the same fingerprint and the same sha256 of its sorted environment key list before and after. It does not auto-deploy and is deployed by hand, and it has no monitor and no backup, both deliberate; `docs/RUNBOOK.md` “Demo instance” carries the uuids, the seed, the reset and the delete.
- Reviewed and deployed. A four-lens review of the merged diff with three refuters per finding raised thirteen findings and confirmed seven, all fixed with a test that failed first: the demo seed's production refusal could never fire, because the database host is `db` on both copies, so it now reads the container's own `APP_URL`; the spec still described the redirect the code had replaced; the changelog named an export action that has never existed; the DEMO banner pushed the desktop rail's last link off an 800 px screen; and the export audit-row assertion read the newest row written by any spec and was flaky. The chain the phase left green: 1,063 unit and database tests in 65 files, 221 Playwright tests at 390 × 844 and 1280 × 800 with 63 project skips, 15 in `tests/instance`, the privilege guard, the build and no schema drift. The phase closes at commit `258eaed` ([ERN-P12.61]), fingerprint `89532d505d3eb9b6`, with `/api/ready` returning `ready` and `verify-live` green. The fingerprint of the live build is that of the latest docs commit; the numbers here name the close commit.
- Still with Ahmed after this phase: changing the first admin's password, which is still the one seeded from Coolify; making the repository private; the SMTP test send and the `Authentication-Results` check; the staff roster and their accounts in Admin → Users; the hospital authorisation before any real MRN goes off-site; whether the ward Wi-Fi reaches the demo subdomain and behind how many addresses; the first sign-in on the demo, with its two passwords read off that application's own Coolify page; and the eight questions the spec leaves open, which Section 5 lists.

**Delivered in Phase 11 (11 September; Ahmed: "perform a complete hands on demo … check how it goes from UI and UX point of view … maybe add to it graphs")**

- A hands-on demo on the production build over a throwaway database: an admin created two navigators, a charge nurse and the medical director; five invented patients were opened, worked and resolved; the charge nurse reviewed and exported; the medical director read the dashboard on a phone and a laptop. Every step worked. Its findings, fixed: recorded times were cut off on a phone (the day was the part lost); the case page's Updates and Resolve were seven screens down (now one tap on a sticky strip); "Open case" was at the bottom of a long form (now pinned); selects were named by their value; no visible way to "Account and password"; admin Users cut off on a phone; the sign-in trace through the headline; "Updated 0h 00m ago". The dashboard gained the Adaa KPIs against their bands, the stay split by outcome, the last days by day, and arrivals by weekday and hour; whole bar labels; two columns on a laptop (a fifth shorter) and jump chips on a phone. The mark is the medical cross Ahmed chose on Envato Elements, in the app's teal. Repeatable: `tests/demo`.

**Delivered in Phase 10 (10 September; Ahmed's six requests, all with the recommended defaults)**

- The delay fields: a one-line working diagnosis beside CTAS and a payer (Government · Insured · Self-pay), on the editor, the board, the handover sheet and the workbook; an in-app microphone on every free-text box where the browser offers speech recognition (the iPhone keeps its keyboard microphone). The filter: one bar on the board, the dashboard and the export page, by stage, reason, ED area, department, CTAS, payer and disposition, include or exclude, "among others" or "the lone finding", carried in the address so a filtered view can be sent as a link. The case summary: a sheet on the phone and a dialog on a laptop in the shape of the weekly deck's ranked-table row plus the time sequence, with Copy as text, MRN only. "Where the time goes": the stay in three parts, front end, decision and after the decision, with medians, shares and the reasons grouped by phase, and "By payer", both on the dashboard and the report with drill-downs. Spec `docs/specs/phase10-delays.md`; the KPI additions verified by two independent recomputations; three Opus slices in worktrees. A seven-lens adversarial review of the merged tree and a second pass over the fixes found about thirty defects and test gaps, each proven by a test that failed first and fixed in two rounds of Opus worktrees; the ones a nurse would have met: a handover sheet printed from a filtered board did not say it was partial, a tap on a sheet's backdrop could open the row beneath it, a filtered workbook did not say it was filtered, and the ten "Other" reasons lit together in the filter panel.

**Delivered in Phase 9 (10 September; Ahmed: "the design looks so plain")**

- The visual refresh, direction A of the proposal page and the app chrome: a teal hero and white sheet for sign-in (a split with the band colours as the picture on a laptop), the heart-and-trace mark and wordmark, a coloured header with the user's initials, a tab bar with icons on the phone and a navy left rail with full-width rows on a laptop, rows as cards with the elapsed time in a band-coloured pill, section cards and tinted icon tiles on the dashboard and the report. Nothing in the workflow, the taxonomy, the fields, the copy or the routes changed; the existing Playwright suite at both viewports was the proof, and every gate screenshot was re-taken. Spec `docs/specs/phase9-visual-refresh.md`; three Opus slices in worktrees. The mark was a placeholder here; corrected 11 September 2026 (X5): Phase 11 replaced it with the licensed Envato Elements medical cross in the app's teal, which is the mark in the app today. A hospital logo, if one is ever sent, is optional.

**Delivered in Phase 8 (9 September, evening; Ahmed's request of the same day)**

- The dashboard and the print report carry the weekly delayed-tickets deck (headline tiles with the previous period, stay bands, pathways, longest stays, actions documented, outcomes, repeat visits, documentation checks), the monthly deck's and the Adaa form's figures on tracked cases (KPI 1 to 6 with benchmarks, treated-within and admission-to-unit bands, the five QCH working targets, turnaround, exam-to-consult, by CTAS, by ED area), and each case has a generated time sequence. Three collection fields: CTAS, ED area, imaging preliminary report. Two new export formats: the Adaa ED KPIs workbook and the QCH navigator sheet. The KPI module was verified by three independent recomputations; the finished code by a five-lens adversarial review (4 confirmed findings, all fixed).
- Ahmed's decisions A to H, answered the same evening and built as Phase 8b (`docs/specs/phase8b-decisions.md`): the pain-management block for Adaa KPI 8, the case-management block, "instructions given" and "family engaged", an action tag on updates in the weekly deck's six categories, Deceased and Referred to UCC as dispositions (no LAMA), MRI, and a supervisor "reviewed" mark; the treating physician is not recorded. The dashboard gained KPI 7 and KPI 8 with the pain block and a discharge-communication section; the Adaa and QCH workbooks fill the columns that were blank. The KPI additions were verified by two independent recomputations and an adjudication; the finished code by a four-lens adversarial review (14 findings examined, 2 confirmed, both fixed: the Adaa painkiller cells for a dose on the day before registration, and the app's own resolve, reopen, void and alert notes no longer counted as undocumented actions).

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
| Email | nodemailer over SMTP | Same. The sending mailbox's OWN SMTP host, port, username and password from Coolify env vars, exactly as a mail client would hold them; no relay (Ahmed, 9 September). The transport refuses to fall back to cleartext on 587 (`requireTLS`) and never negotiates below TLS 1.2 | Corrected 11 September 2026 (X2): the mailbox is on the secondary domain `towardpicu.com`, which publishes its own SPF, DKIM selector and DMARC, so alignment is on that domain. The `towardpcc.com` SPF (`-all`) and DMARC (`p=reject`, strict alignment) records are guarded by another product's ADR, are not touched, and need no selector record for this app |
| Alert recipients | `ALERT_EMAIL_MAP` env var | `User.email` (nullable, unique; migration `20260909150000_user_email`), set by Admin per user; the worker mails the active SUPERVISOR and ADMIN rows that have one (Phase 7) | A directory in an env var needed a redeploy per change and could not be audited; on the user row it is edited in Admin and lands in the audit log like every other user change |
| Session cookie names | Not specified (`ern_session` in Phase 1) | `__Host-ern_session` and `__Host-ern_remember`, `Secure` unconditionally (Phase 7, security audit item SPC-WEB-002) | The prefix makes every browser refuse the cookie unless it is Secure, `Path=/` and has no Domain, so a sibling app under `*.towardpcc.com` can never plant or shadow the session. Browsers accept Secure cookies on `http://localhost`, which is all local development and Playwright use |
| Dependency overrides | Not specified | `pnpm.overrides` pins `deepmerge-ts ^8`, `mysql2 ^3.23.1` and `uuid ^11.1.1` (all transitive, none reachable from app code). Corrected 11 September 2026 (readiness audit A1): Dependabot does **not** keep them current. Dependabot alerts and automated security fixes are disabled on the repository, and the npm updater's only run failed with "Error processing typescript", so it has never opened a pull request; the four Dependabot pull requests that do exist are all from the github-actions and docker ecosystems. `pnpm audit --prod` is clean today, but nothing is watching it. Turning the alerts on is a repository setting and belongs with the private flip | Cleared `pnpm audit` at moderate and above without waiting for prisma 8 or exceljs to update; the migration path was re-proven on an empty database after the `deepmerge-ts` major (changelog P7.8) |
| Backups | Nightly dump script, 30-day retention | Phase 7: `scripts/backup.sh` on the host's systemd timer, `pg_dump` to a dated gzip, 30 local days, upload to the `coolify-backups` bucket. This row said the laptop sync mirrors that bucket and gives the third copy for free; corrected 11 September 2026 (P15), it never has, so the chain is two copies until that task is repaired | Plugs into the backup chain Ahmed already runs and drills |
| Client IP for rate limiting | Not specified | Read `CF-Connecting-IP` | Safe only because the origin is locked to Cloudflare. If those ports are ever opened, this must change in the same commit (towardpcc has the same dependency) |
| Repository | Not specified; Ahmed allowed an open repo for now | `github.com/ahmedsk2/er-navigator`, PUBLIC during the build by Ahmed's decision (9 September), read-only deploy key in Coolify; flipped private when the build finishes. Nothing hospital-specific beyond the plan and prototype, and never a secret or a patient identifier, may enter it | Ahmed's call; the deploy path does not care either way |
| Model tiers for delegation | Not specified | Fable leads and reviews; Opus does the implementation slices; Sonnet and Haiku only for trivial mechanics (formatting, renames, doc sweeps). Ahmed asked for Opus over Sonnet and Haiku on 9 September | Fewer iterations per slice at a modest cost increase |
| Design tokens | "the attached template" (missing) | Extracted from the Envato items in Section 4 once Ahmed downloads them. Until then the prototype palette is the baseline in `app/globals.css` | The threshold colours are information design and are not up for restyling |
| Collection fields beyond the locked schema | Section 3 as written | Phase 8 (Ahmed's request, 9 September): `Case.ctas` (1–5, optional), `Case.areaId` to an Admin-editable `EdArea` list seeded with the six areas of the August sheet (not Appendix A), `CaseInvestigation.preliminaryAt` on imaging rows. All optional; nothing in the workflow or the taxonomy names changes | Every KPI in both ED decks and the Adaa form is per CTAS; the monthly deck splits everything by ED area; the report delay is the commonest imaging pathway and the August sheet records the preliminary read separately |
| Demo, UX fixes and dashboard figures (Phase 11) | Section 3; the Phase 9 visual layer | Ahmed's request of 11 September: a hands-on demo and a UX review, graphs on the dashboard, and a logo. Additions and presentation only: four dashboard figures (Adaa bullets, stay split by outcome, by day, arrivals by weekday and hour) with their drill-downs, a two-column dashboard on a laptop, a sticky section strip and a pinned Open case on the phone, stacked time rows, and the Envato Elements medical cross as the mark | No stored field, workflow step or taxonomy name changes; the printed report keeps its order |
| Delay fields and filters (Phase 10) | Section 3 as written; the Section 2 matrix | Ahmed's six requests of 10 September: `Case.diagnosis` (one line, 80 characters, identifier-warned) and `Case.payer` (a new `Payer` enum: Government, Insured, Self-pay) as optional additions; a case filter carried in the address on the board, the dashboard and the export; a per-case summary sheet (MRN only, no free text) with Copy; a "Where the time goes" section splitting the stay into front end, decision and after the decision; "By payer"; a microphone button (Permissions-Policy `microphone=(self)`) | Additions only; nothing in the workflow or the taxonomy names changes. The phase grouping of the stages (front end: Registration, Triage, Resus room, Exam room; decision: Investigations, Referral / consulted team, Disposition decision; after: Admission process, Discharge process, Administrative / coordination) is Ahmed's confirmed reading |
| Visual layer (Phase 9) | Section 4 tokens "kept from the prototype" and "not adopted": band stripe on rows, no decorative cards, no sidebar, plain dashboard tiles | Ahmed's decision of 10 September after seeing the live app: the stripe becomes a band-coloured pill, rows and sections become cards, desktop gets a navy rail and full-width rows, tiles get a tinted icon, sign-in gets a teal hero. Tokens, type ramp, contrast rules, information design and every accessible name stay | The information design was right and the identity around it was missing; the templates' tokens had been taken but not their finish |
| Collection decisions (Phase 8b) | Section 3 as written; dispositions and investigation types as in Appendix A; the Section 2 matrix | Ahmed's answers of 9 September to the brief's eight questions: a pain-management block (painkiller prescribed, pethidine and dose, time given, sickle-cell treatment) for Adaa KPI 8; a case-management block (referred to a case manager or the complex-care coordinator, criteria, action, call and reply times); "instructions given" and "family engaged" at resolution; an optional action tag on each update in the weekly deck's six categories; `Deceased` and `Referred to UCC` added to the disposition list (LAMA not added); `MRI` added to the investigation types; a supervisor "reviewed" mark with a new `case.review` action for SUPERVISOR and ADMIN. The treating physician is NOT recorded (decision A) | The owner's decisions; each is an addition, and nothing in the workflow or the existing taxonomy names changes. Recorded here because the disposition list, the investigation types and the permission matrix are otherwise locked |
| KPIs the app reports | Not specified | The Adaa KPIs, the weekly deck's figures and the August sheet's working thresholds, computed in `src/lib/domain/kpi.ts` over TRACKED cases only, with one door (earlier of registration and triage) and one leaving time (departed, else resolved) everywhere; labelled "tracked cases, not the whole ED" wherever shown | The whole-ED population (9,962 patients a month) is in the hospital system, not in this app; a KPI that pretended otherwise would mislead |
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
                 └─ nightly pg_dump → host → OCI bucket (Phase 7; the laptop mirror
                    this line used to end with has never worked, P15)
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

To build: the session design decided at Gate 0 (Section 1, Sessions row) with bcrypt cost 12 credentials, httpOnly/secure/sameSite=lax cookie, 12 h sliding expiry, rotation on login, revocation on deactivation; login rate limit (5 per minute per IP via `CF-Connecting-IP`; first hop of `X-Forwarded-For`, then one shared bucket, as fallbacks); lockout (15 min after 10 failures); role checks in a `proxy.ts` gate plus every server action; audit wrapper writing before/after JSON; `auth.login`/`auth.fail`/`auth.forbidden` events. Install `scripts/backup.sh` on the host timer at this gate, before any real case is entered, and record the first restore drill in the runbook.

Tests: formula tests (done), PHI guard (done), role matrix test (every action x every role), lockout test, audit wrapper test, a DB privilege test that asserts `has_table_privilege('ernav_app','"AuditLog"','DELETE')` is false.

Recipe: Fable designs the auth and audit module boundaries and reviews at the gate (one session). Opus implements the credentials flow and the audit wrapper from the design in a worktree, tests first, and writes the role-matrix test table from Section 2 of the locked plan.

### Phase 2: case vertical slice

Create, edit, resolve, reopen, void. Conditional sections, chains, "Check these times" panel (port `timeWarnings`), primary selector, optimistic locking with 409 and the "changed by {name} at {time}" message, append-only updates, "Other" text to review queue, deselect-Other cleanup.

Tests: zod rules from locked plan section 4, one unit test per rule; Playwright: navigator opens a case in under 15 UI actions, adds an update, resolves; a second session gets 409 on a stale save.

Free text is the realistic PHI path (update text, resolution note, Other text, void reason): a shared `freeText` zod schema trims and caps every one of them, and, if Ahmed approves Section 9 question 10, adds a warning to the existing warnings channel when a 10-digit run appears (Saudi ID, Iqama and mobile numbers are 10 digits; MRNs vary, so warn rather than block). Every free-text field carries a persistent "MRN only, no names" hint. (Checked 11 September 2026: this was true of one box of five for most of the build. The readiness audit found the hint under the Updates box only, and Phase 12 put the same component under the working diagnosis, the Other-reason description, the resolution note and the void reason, so the sentence is true again.) The runbook already has the owner-role scrub procedure for the day a name slips through.

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

### Phase 8: reports and collection fields (asked for on 9 September)

Ahmed asked for the ideas in the monthly ER Journey deck, the weekly delayed-tickets deck, the Adaa ED KPI form and the navigators' August sheet to go into the dashboard, for the collection form to take what those sheets have and the app lacks, and for an export per sheet filled from a chosen date range. The analysis and the eight decisions that stay with Ahmed are in `docs/specs/phase8-brief.md`; the build is `docs/specs/phase8-reports.md`: the KPI module (lead, verified by three independent recomputations), Slice D (CTAS, ED area, imaging preliminary report, the stats loader), Slice E (the dashboard sections, the per-case timeline, the print report) and Slice F (the Adaa and QCH export formats). Every KPI the app shows is labelled "tracked cases, not the whole ED"; the whole-ED figures stay with the hospital system.

Recipe: Fable writes the brief, the spec and the rules code and verifies the rules with a workflow; three Opus agents implement the slices in worktrees; Fable reviews, merges and deploys once.

Still only if asked: historical xlsx import, server-sent events for the board, Arabic RTL (Tailwick ships RTL), WhatsApp Business notifications.

### Phase 13: the case sheet, redesigned by patient flow (asked for on 12 September)

Ahmed asked for five things after the Phase 12 gate: merge "Nursing handover done" into "Left ED"; make the journey times required by outcome and show them together in one block, with some allowed to stay empty; reorder the sheet by how a patient actually flows through the ED, with the times near the top; hide what a case does not need; progressive disclosure. One question went back to him and he answered it the same day: at "Open case" only the MRN, the registration time and one delay reason are required, exactly as today.

This is the one phase where the locked plan's "do not redesign the workflow" rule is overridden, by the owner, and only for the shape of the case sheet. The taxonomy NAMES are untouched: no stage, reason, department, ward, ED area, disposition, shift, payer, investigation type or update action is renamed, added or removed, the permission matrix is what it was, and there is no migration. The one taxonomy edit in the phase is the deletion of a single `ADMISSION_STEPS` pair, which is decision A.

`docs/specs/phase13-case-sheet.md` is the spec: the exact labels and ids, the required-by-outcome table, the disclosure rules, the KPI and export consequences, the failing assertion each item starts from, the labels that change with the tests updated for them, and a "contracts that stay" list that every existing test already holds.

**What changed on the screen.** The times were in four places (an optional "Add journey times" toggle near the foot of the page, an "Admission times" section, the transfer chain inside "Referral out", and "Left ED at" inside Resolve), so a nurse recording a stay walked the whole form twice. They are one block now, "Patient journey" at `case-times`, second on the page and on the new-case form alike, in the order a patient moves through the ED: triage, resus or exam room, first physician contact, disposition decided, then whichever outcome chain the case is on, then Left ED, then the medical admin on-call. A step with a time collapses to one line with an Edit control, the first empty step is the highlighted one, a step the outcome cannot have is not drawn, a required one carries a "needed to resolve" tag, and a hidden step that holds a time is listed under "Also recorded", because a hide must never drop a value. The five answers a navigator fills in when writing the case up (the shift, the working diagnosis, the payer, pain management, case management) are behind "More to record", closed on a new case and open on one that already carries any of them. The jump strip keeps its Phase 11 chips and their order.

**What changed in the rules.** "Mark resolved" now says what is missing and stays dead until nothing is, from the same table the server refuses on (`src/lib/domain/journey.ts`): an admission needs the triage, the physician contact, the decision, the written order, the bed and the departure, plus its ward; a transfer needs the request and the acceptance, plus the tracking number and, new in this phase, the receiving facility; a discharge home, a DAMA and a referral to UCC need the first three and the departure; a death needs no disposition decision; a patient who left without being seen needs the departure alone and is shown no physician contact or decision at all; and Other needs the triage and the departure. Nothing was added at "Open case", and out-of-order times stay warning-only.

**What changed in the figures.** "Nursing handover done" is gone from the sheet, from the workbook's Cases sheet, from the per-case timeline and from the warning chain; `Case.handoverAt` stays in the database, nullable and no longer written, so the cases that already carry one keep it on the record and in their audit snapshots. The Adaa admission-to-unit band is the admission order to the leaving time with no handover fallback, so a resolved case with no departure time is in no band at all rather than banded on a time the app no longer records. The QCH column "Time of Disposition TO WARD" is the departure for an admitted patient, and its Read me sentence says so.

Verified on the lead database: typecheck, lint, 1,118 unit and database tests in 66 files, the production build, 233 Playwright tests at 390 x 844 and 1280 x 800 (63 project-specific skips), the app-role privilege guard, and `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` reporting no difference. Gate captures in `design/screens/phase13-*.png`.

Recipe as run: one Opus session on `main` in the main checkout, spec first and then tests first per item, one commit per coherent item, the whole chain green before the close.

### Phase 12: what stands between the app and a staff demo, and between it and production (asked for on 11 September)

Ahmed asked, at the Phase 11 gate, what is left before staff can try this themselves and before real patients go on it, and for the part that is Claude's to be built. A twelve-agent read-only audit of the repository, the host and the live app answered the first half in 50 items ranked by what would go wrong first (15 demo, 30 production, 5 after go-live, 10 already done). Ahmed's decision on the demo was option B, and he authorised the subdomain: a hosted copy on its own subdomain, a second Coolify application from the same repository with its own database, its own secrets, blank SMTP and no alert push URL, so that production is not touched by any of it.

What the audit found that this phase answers, in its order: nothing on the screen said which copy you were looking at, so a demo and the real board were the same pixels; the demo tooling would run against production if it were pointed at it; there was no seed that produces cases, so a hosted demo would have opened on an empty board; invented MRNs looked real; the “MRN only, no names” hint was on one free-text box of five while the plan claimed it was on all of them; the first password was never forced to change, so a password read out across a ward desk could stay in use for ever; an alert e-mail that failed twice was lost and both monitors stayed green; an export or a printed report left no audit row; the login limit would have turned away the sixth person in a minute at a demo behind one hospital address; `.gitignore` would not have stopped a patient spreadsheet being committed; four Dependabot pull requests were open, one of which breaks the Docker build; several documents stated things that were no longer true; and there was no user documentation at all.

`docs/specs/phase12-go-live-readiness.md` was the build, in three slices, and all three are delivered.

**12A, the code** (merged as [ERN-P12.30]): the instance banner behind a new `INSTANCE_LABEL`, the must-change-password gate on any account an admin creates or resets, the MRN-only hint under all five free-text boxes, audit rows for the workbook download and the printed report, a bounded retry with an attempt count and a durable trace for an alert e-mail that failed, a demo seed of four accounts and ten invented patients shipped in the runner image beside `worker.js` that refuses to run against anything but a labelled demo instance, and the hygiene items (the spreadsheet gitignore with a `git check-ignore` proof that `src/` and `app/` are not caught by it, a configurable login limit, three safe Dependabot bumps applied locally so the pull requests close themselves and the fourth refused in writing). One departure from the spec, recorded in it: the `x-pathname` redirect the spec specified loops for ever inside a server action's own render, and was replaced by an explicit `allowMustChange` option that a test holds to two callers.

**12C, the documents** (merged as [ERN-P12.31]): the stale statements in this plan and the runbook, corrected in place and dated with what each used to say; `docs/guide/nurse-quick-guide.md`; `docs/guide/demo-script.md`; the runbook's “Demo instance” section; and this section.

**12B, the demo instance** ([ERN-P12.50]): `demo-nav.towardpcc.com`, a proxied Cloudflare A record, a Coolify project `demo` and an application `er-navigator-demo` with its own database and volume, twenty environment keys with every secret regenerated on the host and none of production's values reused, the five keys the runbook records as dead deliberately not copied, SMTP and the push URL blank, `INSTANCE_LABEL=DEMO`, the login limit at 60 a minute and a report header that begins “DEMO.”. It runs the same build as production and was seeded with four accounts and ten invented patients on `999999…` MRNs, six open and four resolved, a second run adding nothing. Production's fingerprint and the sha256 of its sorted environment key list were identical before and after. It is deployed by hand, because the repository's one GitHub webhook is signed with production's secret; it has no Uptime Kuma monitor and no backup, both deliberate; and the first sign-in is Ahmed's, since login is a server action and not curl-able.

Nothing in this phase changed the workflow, the taxonomy, the permission matrix or any stored clinical field, and production with `INSTANCE_LABEL` unset behaves exactly as it did before: the live login page carries no banner, and `noindex` stays unconditional in the root layout.

**Three decisions this phase deliberately left open**, recorded here rather than taken quietly:

1. **Whether VIEWER keeps `export.xlsx`.** Leadership can download the whole workbook of MRNs today (`policy.ts` grants `export.xlsx` to SUPERVISOR, ADMIN and VIEWER). The audit's second half of C2 proposed removing it. That is a change to the locked permission matrix, so Phase 12 only made the download auditable and left the grant alone.
2. **Whether `.github/dependabot.yml` gains an ignore rule for docker `node` semver-major updates.** PR #2 moves the Dockerfile to `node:26-alpine` while `package.json` pins `engines.node ">=24 <25"` and `.npmrc` sets `engine-strict=true`, so the build aborts in the deps stage and CI's green check means nothing because CI never builds the Dockerfile. An ignore rule would suppress the pull request rather than leave it visibly refused. Suppressing it is Ahmed's call.
3. **The retention period** (audit C10): how long a case, its updates and its audit rows are kept. Part of the hospital authorisation conversation (P1), and the honest answer at the demo is “being agreed”.

The spec leaves five more questions open that only Ahmed can close: the real hospital MRN length and range, which the `999999` demo prefix is chosen to stay clear of; whether the ward Wi-Fi reaches the demo subdomain and behind how many addresses, which is what the login limit is set for; who is first and second line support for the quick guide; whether the demo keeps its hand-deploy arrangement; and whether the four demo accounts should carry `.invalid` addresses.

Recipe as run, and what went wrong with it. Fable wrote the brief and Ahmed confirmed it and authorised the hosted demo. Opus did everything else: the code map, the spec, a four-lens spec review with three refuters per finding (twenty-one findings, nine confirmed, six of which changed the spec) and its fixes, each held in place by `tests/unit/phase12-spec.test.ts`, which parses the document and checks it against `app/globals.css`, `docker-compose.production.yml` and `worker/alerts.ts` rather than trusting its prose; then the two build slices in their own worktrees, tests first, the whole chain green before hand-back; the merges and two fixes they needed; a four-lens review of the merged diff with three refuters per finding (thirteen findings, seven confirmed, all fixed with a test that failed first); the deploy check; 12B on the host by hand; and these documents.

The orchestration took three attempts, which is the part worth keeping. The first run lost both builders to a worktree error, because the session's working directory was outside the repository when the worktrees were created; its later stages then ran on nothing and closed the phase prematurely, leaving an honest “what did not happen” note that this section replaces. The second run built both slices from worktrees the builders made for themselves, and was halted by a script guard. The remaining stages were run as single Opus agents, because the permission classifier refuses further workflow launches after repeated runs. Three smaller lessons: an agent's `blocked` field is a report, not a throw condition; Turbopack refuses a junctioned `node_modules` unless `turbopack.root` names the main checkout; and a junction has to be unlinked before its worktree can be removed.

### Phase 11: the hands-on demo, the fixes it asked for, a dashboard that reads at a glance (asked for on 11 September)

Ahmed asked for a complete demo, from creating users to five patients' full cycle, a UI and UX check, graphs where they help, and a logo. The demo ran as a script on the production build over a throwaway database (`ernav-demo`), so nothing reached the live data; its ten findings became `docs/specs/phase11-demo-ux-dashboard.md`. Two Opus slices built it in worktrees (11A the fixes on the phone, 11B the dashboard), the mark came from the Envato Elements template Ahmed downloaded, a four-lens review with refuters checked the whole diff, and the same demo was run again on the new build for the before-and-after screens.

Recipe as run: Opus led (Fable's allowance had run out in Phase 10) with the UI/UX Pro Max skill for the review and the chart choices; two Opus agents in worktrees, tests first, the whole suite green before hand-back; one review workflow; one deploy.

### Phase 10: the delay fields, the filters, the case summary, where the time goes (asked for on 10 September)

Ahmed's six requests after the refresh: make sure every delay has its reason with an "Other" free text that can be dictated; a one-line diagnosis beside CTAS; a patient summary in the shape of the deck's tables, as a popup; a filter to keep or drop cases by cause or area of delay, with "among others" or "the lone finding"; a dashboard view of the delays that belong to the doctor's decision and those that come after it; and whether the patient is government, insured or self-paying. The brief page put each beside what existed and the decision it needed; all six took the recommended default. `docs/specs/phase10-delays.md` is the build: the lead's data kit and KPI section (verified by two independent recomputations), Slice 10A (the fields and the microphone), Slice 10B (the filter contract, the bar on three pages), Slice 10C (the summary sheet, its route and its Copy).

Recipe as run: Fable mapped the code with a four-reader workflow, wrote the spec and the kit, built and verified the KPI split, merged the slices and started the review; three Opus agents built the slices in worktrees with their own databases and ports, the whole suite green before hand-back. Fable's monthly allowance ran out during the review; Ahmed said to continue with Opus, which finished the review, ran two fix rounds of three worktree agents each, re-reviewed the fixes and deployed once.

### Phase 9: the visual refresh (asked for on 10 September)

Ahmed found the live app plain, wanted the phone to come first and the laptop to look right too, and asked for a sign-in page drawn from Envato rather than the DMC project's. The proposal page showed the diagnosis (no mark, no coloured surface, the phone column centred on a laptop, text-only navigation) and three sign-in directions as live mockups; he chose A and the app chrome. `docs/specs/phase9-visual-refresh.md` is the build: the lead's identity kit (mark, icons, tokens, one band map), Slice 9A (sign-in and the holding screens, the PWA icons), Slice 9B (the shell: header, tab bar, rail, page headers), Slice 9C (surfaces: row cards and pills, section cards, tiles, the ui primitives). The contract was that nothing moves: every role, accessible name, `data-*` hook and class hook the suite selects on stays, and the suite at both viewports is the proof.

Recipe: Fable maps the UI code with a five-reader workflow, writes the spec and the kit, merges and reviews; three Opus agents build the slices in worktrees with their own databases and ports, tests first, the whole suite green before hand-back; Fable deploys once.

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

## 6. The playbook: Opus does the work, Fable leads (revised 11 September 2026)

Fable's monthly allowance ran out in the middle of the Phase 10 review on 10 September. Opus finished that review, ran two fix rounds of three worktree agents each and re-reviewed the fixes. It then ran Phase 11 end to end: the hands-on demo, the spec, two slices in worktrees, a four-lens review with three refuters per finding that confirmed seven real findings and refuted five, the fixes, the deploy and the docs. The chain stayed green at the gate: 966 unit and database tests, 198 Playwright tests at both viewports. On 11 September Ahmed asked to use Opus for the majority of the work. The evidence of the two phases is that Opus, given the spec, the rules in `CLAUDE.md` and the verification chain, produces the same quality across a whole phase. Fable's value is therefore concentrated in a few decisions and in the gate, and that is the only place it is spent.

**The split**

- Fable, the phase brief. What the phase does, what it does not do, and the decisions it needs from Ahmed. One turn.
- Fable, the gate. Read the Opus gate summary, the test totals and the screenshots, then write the five-line report. One turn.
- Fable, tie-breaks. A bug that survived two Opus attempts. A disagreement between an Opus builder and an Opus reviewer. A security question about auth, DB privileges or headers where the Opus review's summary is not conclusive.
- Opus, everything else. The spec from the brief; the slices in worktrees, tests first; scoped runs while building and the full chain at hand-back; the end-of-phase review workflow (finders, refuters, fixes); deploy verification by fingerprint; the `docs/CHANGELOG.md` and `docs/PLAN.md` entries; the memory updates; the plan page.
- Sonnet or Haiku, trivial mechanics only. Formatting, renames, lockfile bumps, doc sweeps.

**Mechanics that make it cheap**

- Run the phase in an Opus session. Switch the desktop app's model picker to Fable only for the brief and for the gate, then switch back.
- From a Fable session, pass `model: 'opus'` on every Agent and every Workflow agent. Agents inherit the session model, so an unset `model` spends Fable tokens on the whole tree.
- Fable's turns carry summaries, test totals and screenshot paths. Never file contents. An Opus agent reads the file or the diff and returns what the decision needs.
- Effort: `high` for reviewers and refuters, because they stall at `max`; the default or `max` for builders; `low` for mechanics.
- Worktrees share the main checkout's `node_modules` through a directory junction instead of a fresh install. Windows long paths make an installed worktree hard to delete.
- Prompt caching rewards a stable prefix: the same pre-reads at the top of every session, the new task at the bottom.
- Tests before code for every slice. A failing test is a cheaper spec than a paragraph, and it stops the iterate-until-it-looks-right loop that burns tokens.
- Verify with tools, not prose: Playwright screenshots at 390 x 844 and 1280 x 800, `pnpm test`, `curl /api/health` for the fingerprint.
- Scoped test runs while building (`vitest run src/lib/domain`), the full suite at hand-back and at the gate.
- Push-to-deploy. Nobody deploys by hand; nobody polls Coolify. Wait about five minutes, then read the fingerprint.

**Workflows, where they pay**

- Yes: the end-of-phase adversarial review, four lenses with three refuters per finding, as run in Phase 11.
- Yes: independent recomputation of the KPI fixtures, as in Phases 4 and 10.
- Yes: read-only audits with skeptics, as the go-live audit of 11 September.
- No: parallel edits of the same files.
- No: exploration that one pass can do.
- No: any loop that runs until a budget is spent.
- Reviewers and refuters run at effort `high` in every one of these.

**What still wastes tokens**

- Re-reading large files a second time in the same session. Read once, keep the summary in this plan or in `CLAUDE.md`.
- Long gate reports. The locked plan gives the exact five-line shape; use it.
- Letting the lead model write boilerplate (CRUD forms, table rows, seed data) that an Opus subagent produces identically.
- Debugging a deploy by re-deploying. Read the Coolify deployment log once, fix the cause, push once.
- Re-litigating locked decisions at each gate. The do-not list in the locked plan section 9 is final; this plan's Section 1 is final once Gate 0 passes.
- Running a phase from a Fable session with agents that inherit Fable.
- Fable running the verification chain itself. An Opus agent runs it and reports the totals.
- Fable reading a diff instead of the review's verdict.

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
| Threshold alerts depend on the worker; if it dies, nobody is emailed | Worker has `restart: unless-stopped` (process exit only; Docker never restarts on an unhealthy probe), a healthcheck that goes unhealthy when no cycle has COMPLETED in 15 minutes, and a GET to an Uptime Kuma push monitor after every successful cycle (`ALERT_PUSH_URL`, final review 2026-09-09). The push monitor is what pages. Corrected 11 September 2026 (X3): this said it waits for Ahmed to create it. It is live. Both Uptime Kuma monitors exist, the push URL is in both Coolify copies, and the push monitor has recorded 289 heartbeats. The `Alert` unique index makes restarts idempotent |
| A migration runs against production data with a mistake | `migrate` runs before `app`, so a failing migration never starts the new app, but the site is down until it is resolved (runbook procedure); nightly dump installed at Gate 1 with a drilled restore; schema PRs get Fable review and are merged outside shift change |
| Optimistic-locking conflicts frustrate nurses on a busy shift | The 409 message names who changed the case and when; `CaseUpdate` rows never conflict, so the most common action (add an update) always succeeds |
| Someone opens 80/443 to the world for another app | `CF-Connecting-IP` becomes spoofable. The runbook records the dependency. When the header is absent the limiter keys on the first hop of `X-Forwarded-For`, and when that is absent too every such request shares one bucket (the app never sees a socket address behind Traefik); the same commit that opens the ports must change `clientIpFrom` in `src/lib/audit.ts` |
| Envato template pushes the UI toward decorative dashboards | Section 4 rules: tokens only. Gate screenshots are reviewed against the prototype's information design |
| Shared host under build load slows deploys | Accept; verify by fingerprint after five minutes rather than reacting early |
| Public repository (if flipped) leaks hospital specifics | No PHI, no secrets, no hospital data in git by construction; the plan and prototype are the only hospital-specific text. Keep private unless there is a reason |

---

## 9. Gate 0: questions and answers

Answered by Ahmed on 9 September, with the items he left to my judgement ("go as you see fit") decided and marked.

1. Design document: received (`docs/reference/ER_Navigator_Tool_Design.md`, Draft v3) and reconciled in Section 0.
2. Templates: received, five items under `design-template\`.
3. SMTP sender: sent through the sending mailbox's own SMTP settings like any mail client (host, port, username, password), not through a relay (Ahmed, 9 September). **Corrected 11 September 2026 (readiness audit X2 and P8.)** This item used to name `navigator@towardpcc.com`, require a DKIM selector record on `towardpcc.com`, and end "Alerts stay log-only until then". All three are now wrong. All five `SMTP_*` values are set in both Coolify copies and the worker starts in **send** mode, logging `smtp <mailhost>:465`. The mailbox is on the secondary domain (`towardpicu.com`), which publishes its own SPF record, DKIM selector and DMARC policy, so DMARC aligns on that domain and `towardpcc.com` needs no record for this app. `towardpcc.com` keeps `v=spf1 -all` and DMARC `p=reject` with strict alignment exactly as they are, deliberately locked for sending and guarded by another product's ADR; this app does not touch them. Nothing has actually been sent: the `Alert` table is empty, `--test` has never run, and no user has an email address, so the recipient set is empty. What remains is the test send itself and reading `dkim=pass` and `dmarc=pass` out of its `Authentication-Results` header, which is Ahmed's step (P8) and must happen before any address goes into Admin → Users (P9).
4. First ADMIN: `admin`, display name Ahmed, as seeded; password lives only in Coolify. Decided by me; change in Phase 1 if wanted.
5. Report header: "Qatif Central Hospital, Emergency Department. ER Navigator" as the placeholder. Decided by me. Corrected 11 September 2026 (readiness audit P14): this said the header is held in a settings row Admin can edit. It is not, and there is no `Setting` model in the schema. It is the `REPORT_HEADER` environment variable, on the entrypoint allowlist, defaulted in the compose file and in `src/lib/export/report-header.ts`; the deviation was recorded at the time in `docs/specs/phase6-admin-alerts.md`. The live value still matches the default byte for byte, so the placeholder is what prints on every report today, and confirming or replacing the wording is Ahmed's. The demo instance sets its own, prefixed `DEMO.`.
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
