# ER Navigator Tracker: Production Build Plan for Claude Code

You are building the production version of a mobile-first web app that replaces a WhatsApp group used by ER Navigator nurses at Qatif Central Hospital to track patients whose ED stay is running long. A validated clickable prototype and a locked design document exist. Your job is to turn them into a secure, multi-user, auditable system on Ahmed's server. Do not redesign the workflow. Do not rename anything in the taxonomy. Build exactly what is specified, stop at every gate, and report.

Owner: Ahmed (medical director). Users: ER Navigators, charge nurses and nurse managers, medical admin on-call, hospital leadership (read-only).

---

## 0. Pre-reads (mandatory, in this order, before writing any code)

1. `/reference/ER_Navigator_Tool_Design.md` : the locked data model and taxonomy. Treat every list in it as final.
2. `/reference/ERNavigatorTracker.jsx` : the working prototype. It is the source of truth for the taxonomy constants (`STAGES`, `DEPTS`, `WARDS`, `DISPOSITIONS`, `SHIFTS`, `MILESTONES`, `CONSULT_STEPS`, `INV_TYPES`, `ADM_STEPS`, `TRANSFER_STEPS`), the duration formulas, the validation rules, the board and dashboard behaviour, and the case editor flow. Port its logic; do not reinvent it.
3. `/reference/design-template/` : the visual template Ahmed attached. Extract colour, type, spacing, radius and elevation tokens from it. Use it for visual language only. Do not copy its content, copy, logos or component names.
4. `/reference/ER_Navigator_Cases_FirstPass_Extraction.xlsx` : optional, historical data for Phase 8 only.

If any pre-read file is missing, stop and ask for it. Do not proceed on assumptions.

Skills to invoke at this step: `Explore` / `code-explorer` on the reference folder. `idea-refine`: not applicable, the design is locked.

---

## 1. Stack (decided)

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js 15, App Router, TypeScript strict | Matches Ahmed's existing Next.js deployments |
| Data | Prisma ORM. Provider set at Gate 0 to whatever the server has: PostgreSQL 14+ preferred, MySQL 8 / MariaDB 10.6+ acceptable | Server is a general Node + SQL box; do not assume the engine |
| Auth | Auth.js v5, credentials provider, bcrypt (cost 12), database sessions | No external identity provider available on the hospital network |
| Validation | zod, shared schemas between server actions and client forms | Single source of truth for rules like MRN digits-only |
| Styling | Tailwind CSS, tokens derived from the attached template into `tailwind.config.ts` and CSS variables | |
| Charts | Recharts | Already used in the prototype |
| Export | exceljs, generated server-side, streamed | Real .xlsx with multiple sheets |
| Scheduling | node-cron in a separate worker process (`worker/alerts.ts`) | Threshold alerts must not depend on a browser being open |
| Email | nodemailer over SMTP, credentials from env | Ahmed has working SMTP on his domain |
| Tests | Vitest (unit), Playwright (e2e, mobile viewport 390×844) | |
| PWA | `manifest.webmanifest`, install prompt, `display: standalone`, no offline writes in v1 | |

Timezone: store UTC, display and bucket in `Asia/Riyadh`. Week starts Sunday. UI language: English in v1. Arabic RTL is Phase 8.

---

## 2. Roles and permissions

```ts
enum Role { NAVIGATOR, SUPERVISOR, ADMIN, VIEWER }
```

| Action | NAVIGATOR | SUPERVISOR | ADMIN | VIEWER |
|---|---|---|---|---|
| View board and case detail | yes | yes | yes | yes |
| Create case, edit case fields, add update, resolve, reopen | yes | yes | yes | no |
| Acknowledge threshold alert | no | yes | yes | no |
| Void a case (soft delete with reason) | no | yes | yes | no |
| Dashboard | yes | yes | yes | yes |
| Export xlsx, print report | no | yes | yes | yes |
| Manage users, reference lists, promote "Other" reasons, view audit log | no | no | yes | no |

Every permission is enforced in the server action or route handler, never only in the UI. A VIEWER hitting a mutation endpoint gets 403 and an audit entry.

---

## 3. Data model (Prisma, authoritative)

```prisma
model User {
  id           String   @id @default(cuid())
  username     String   @unique
  passwordHash String
  displayName  String
  role         Role
  active       Boolean  @default(true)
  lastShift    Shift?
  createdAt    DateTime @default(now())
  lastLoginAt  DateTime?
  failedLogins Int      @default(0)
  lockedUntil  DateTime?
}

enum Shift { MORNING EVENING NIGHT }
enum CaseStatus { OPEN RESOLVED VOIDED }
enum RoomType { RESUS EXAM }
enum Disposition { ADMITTED DISCHARGED_HOME DISCHARGED_DAMA TRANSFERRED LEFT_WITHOUT_BEING_SEEN OTHER }
enum InvestigationType { LAB CT US XR }

model Case {
  id                   String     @id @default(cuid())
  mrn                  String     // digits only, any length, validated by zod /^\d+$/
  registrationAt       DateTime   // LOS clock start, entered manually, may be in the past
  openedAt             DateTime   @default(now())
  openedById           String
  shift                Shift?
  status               CaseStatus @default(OPEN)
  primaryReasonId      String?
  medAdminInformedAt   DateTime?
  // general journey milestones (single events)
  triageAt             DateTime?
  roomAt               DateTime?
  roomType             RoomType?
  physicianAt          DateTime?
  decisionAt           DateTime?
  departedAt           DateTime?
  // admission chain
  admOrderAt           DateTime?
  bedRequestedAt       DateTime?
  bedAssignedAt        DateTime?
  handoverAt           DateTime?
  // transfer chain
  transferRequestedAt  DateTime?
  transferAcceptedAt   DateTime?
  transportArrivedAt   DateTime?
  referralTrackingNo   String?
  transferFacility     String?
  // resolution
  disposition          Disposition?
  wardId               String?
  isolation            Boolean    @default(false)
  resolutionNote       String?
  resolvedAt           DateTime?
  voidReason           String?
  version              Int        @default(1)   // optimistic locking
  createdAt            DateTime   @default(now())
  updatedAt            DateTime   @updatedAt

  reasons        CaseReason[]
  consults       CaseConsult[]
  investigations CaseInvestigation[]
  updates        CaseUpdate[]
  alerts         Alert[]
  @@index([status, registrationAt])
  @@index([mrn])
}

model Stage   { id String @id; code String @unique; name String; sortOrder Int; active Boolean @default(true); reasons Reason[] }
model Reason  {
  id                 String  @id @default(cuid())
  stageId            String
  name               String
  requiresDepartment Boolean @default(false)
  requiresReferralNo Boolean @default(false)
  isOther            Boolean @default(false)
  active             Boolean @default(true)
  sortOrder          Int
  @@unique([stageId, name])
}
model CaseReason { caseId String; reasonId String; otherText String?; @@id([caseId, reasonId]) }

model Department { id String @id @default(cuid()); name String @unique; active Boolean @default(true); sortOrder Int }
model CaseConsult {
  id           String    @id @default(cuid())
  caseId       String
  departmentId String
  consultedAt  DateTime?
  seenAt       DateTime?
  repliedAt    DateTime?
  @@unique([caseId, departmentId])
}

model CaseInvestigation {
  id          String            @id @default(cuid())
  caseId      String
  type        InvestigationType
  orderedAt   DateTime?
  collectedAt DateTime?   // LAB only: sample collected
  receivedAt  DateTime?   // LAB only: received by lab
  doneAt      DateTime?   // imaging: scan done
  resultedAt  DateTime?   // LAB: resulted; imaging: reported
  @@unique([caseId, type])
}

model Ward { id String @id @default(cuid()); code String @unique; name String; active Boolean @default(true); sortOrder Int }

model CaseUpdate { id String @id @default(cuid()); caseId String; authorId String; createdAt DateTime @default(now()); text String }  // append-only, no update or delete route exists

model OtherReview {
  id               String   @id @default(cuid())
  caseId           String
  stageId          String
  text             String
  status           OtherReviewStatus @default(PENDING)
  reviewedById     String?
  reviewedAt       DateTime?
  promotedReasonId String?
}
enum OtherReviewStatus { PENDING PROMOTED DISMISSED }

model Alert {
  id               String    @id @default(cuid())
  caseId           String
  thresholdHours   Int       // 4, 6, 12, 24
  firedAt          DateTime  @default(now())
  emailSentAt      DateTime?
  acknowledgedById String?
  acknowledgedAt   DateTime?
  @@unique([caseId, thresholdHours])
}

model AuditLog {
  id        String   @id @default(cuid())
  at        DateTime @default(now())
  actorId   String?
  action    String   // e.g. case.create, case.update, case.resolve, case.void, user.create, list.update, auth.login, auth.fail, auth.forbidden
  entity    String
  entityId  String?
  before    Json?
  after     Json?
  ip        String?
  userAgent String?
}
```

Seed `Stage`, `Reason`, `Department`, `Ward` from the prototype constants verbatim (see Appendix A). Every stage gets exactly one `isOther = true` reason named "Other".

Hard rule: no column may ever hold a patient name, national ID, or date of birth. Add a Vitest test that greps `schema.prisma` and fails if any field matches `/name|national|dob|birth/i` on `Case`.

---

## 4. Business rules and formulas (port exactly from the prototype)

```ts
// durations: null when either side missing or out of order; never negative
duration(a?: Date, b?: Date): number | null  // hours; (b - a) / 36e5; null if !a || !b || b < a

endAt(c: Case): Date | null  // RESOLVED: departedAt ?? resolvedAt; OPEN: null
elapsedHours(c, now): number | null // duration(registrationAt, endAt(c) ?? now)

band(h): 'ok' | 'h4' | 'h6' | 'h12' | 'h24'   // <4, ≥4, ≥6, ≥12, ≥24

median(xs: (number|null)[]): number | null     // ignore nulls; null if empty
MIN_N = 3  // any median with n < 3 renders as "n<3", never a number

// per-department consult response
consultToSeen  = duration(consultedAt, seenAt)
consultToReply = duration(consultedAt, repliedAt)

// investigations
LAB: mid = duration(orderedAt, collectedAt); final = duration(orderedAt, resultedAt)
CT/US/XR: mid = duration(orderedAt, doneAt);  final = duration(orderedAt, resultedAt)

// admission chain
orderToBed   = duration(admOrderAt, bedAssignedAt)
requestToBed = duration(bedRequestedAt, bedAssignedAt)
bedToLeave   = duration(bedAssignedAt, departedAt)

// threshold table, for t in [4,6,12,24]
openPast(t)  = count(OPEN cases with elapsedHours >= t)
allPast(t)   = count(non-VOIDED cases with elapsedHours >= t)

// weekly buckets: Sunday-start weeks in Asia/Riyadh, keyed by registrationAt
```

Validation (zod, shared):
- `mrn`: `/^\d+$/`, no length limit, trimmed.
- `registrationAt` ≤ now. Default in the new-case form: now minus 6 hours, with 4h/6h/8h/12h and ±30m quick-adjust chips.
- At least one reason. If more than one reason, `primaryReasonId` is required and must be one of them.
- If any selected reason has `requiresDepartment`, at least one consult row is required.
- If any selected reason has `requiresReferralNo` or `disposition = TRANSFERRED`, `referralTrackingNo` is required on resolve.
- Resolve requires `disposition`; `ADMITTED` requires `wardId`.
- Out-of-order timestamps do not block save. They return a `warnings: string[]` list (port `timeWarnings()` from the prototype) that the UI shows in a "Check these times" panel, and they are excluded from every aggregate because `duration()` returns null.
- Deselecting an "Other" reason deletes its `otherText` and the pending `OtherReview` row.

Concurrency: every case mutation sends `version`. Server runs `UPDATE ... WHERE id = ? AND version = ?`; on zero rows affected respond 409 with the current record and the display name and time of the last editor. Client shows "This case was changed by {name} at {time}. Reload to continue." `CaseUpdate` rows are append-only and never conflict.

Audit: a Prisma middleware or explicit wrapper writes an `AuditLog` row with `before` and `after` JSON for every create, update, resolve, reopen, void, user change, list change and login event. There is no code path that deletes a `Case`, `CaseUpdate` or `AuditLog` row.

---

## 5. Screens (mobile-first, 390px design width, must also work at desktop)

Port the prototype's flows one-to-one. Where this list and the prototype differ, the prototype wins for behaviour and this list wins for permissions.

1. **Login** `/login`: username, password, remember device. Rate limit 5 attempts per minute per IP; lock account for 15 minutes after 10 failures; audit both.
2. **Board** `/` : open cases sorted by elapsed time descending, colour band per threshold, MRN search, filter Open/Resolved/All, "no update for Xh" staleness (amber at ≥2h), counts strip (open, past 6h, past 12h), auto-refresh every 30s via polling, floating "New case" button (hidden for VIEWER). Print stylesheet produces a shift handover sheet.
3. **Case editor** `/cases/new`, `/cases/[id]` : identical section order to the prototype: identity and registration → where is the delay (stage chips, reason chips per stage, Other text, primary selector) → departments with per-team consulted/seen/replied → investigation times per test → admission times → referral out with tracking number, facility and transfer chain → journey times (numbered, they are a sequence) with medical admin informed at → updates (append-only, Enter to add) → resolve/reopen → "Check these times" panel → save. Every timestamp has a "Now" button. Name and shift prefill from `User.displayName` and `User.lastShift`.
4. **Dashboard** `/dashboard` : date range chips (7/30/90/all), tiles (open now, open past 6h, median LOS resolved), threshold table (tap row → drill-down), weekly bars + median line, primary reason, stage, departments, consulted team response table, investigation turnaround table, admission chain table, by shift, by weekday, disposition, Other review queue. Every bar and table row drills down to the underlying case list. Apply `MIN_N`.
5. **Export** `/export` : date range, status filter, "Download Excel" (sheets: Summary, Cases, Consults, Investigations, Updates), "Print report" (opens `/report?from&to` which renders the dashboard sections with hospital header, date range and generated-at, print-optimised).
6. **Admin** `/admin` (ADMIN only): users (create, deactivate, reset password, change role), reference lists (departments, wards, reasons per stage: add, rename, deactivate, reorder), Other review queue (promote to a new reason under its stage, or dismiss; promotion re-tags the originating case), alerts (fired, acknowledged), audit log viewer with filters.

Design: derive all tokens from `/reference/design-template/`. Keep the prototype's information design: left threshold band on rows, tabular numerals for all times, no all-caps labels, no decorative cards, one memorable element (the elapsed clock). Skills: `ui-ux-pro-max` for the token system, `taste-skill` (minimalist variant) for review. Screenshots at 390×844 and 1280×800 via `Claude_Browser` at every gate.

---

## 6. Alerts worker

`worker/alerts.ts`, run as its own process, every 5 minutes:

```ts
for each OPEN case:
  h = elapsedHours(case, now)
  for t of [4, 6, 12, 24]:
    if h >= t and no Alert(caseId, t): create Alert; append CaseUpdate "Reached {t}h threshold" by system user;
      if t >= 6: send email to SUPERVISOR and ADMIN users (template: MRN, wait, primary reason, departments, link); set emailSentAt
```

Alerts never auto-fill `medAdminInformedAt`. That stays a human confirmation. Email failures are logged, retried once, and never crash the worker. WhatsApp or SMS: Phase 8, not now.

---

## 7. Security checklist (all must pass before Gate 7)

- All routes behind auth except `/login`, `/manifest.webmanifest`, icons.
- Role checks server-side on every server action and route handler.
- Sessions: httpOnly, secure, sameSite=lax, 12h sliding expiry, rotated on login.
- zod on every input. Prisma only, no raw SQL.
- Headers: CSP (self + inline styles hashed), HSTS, X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy minimal.
- Secrets only in `.env`, `.env.example` committed with placeholders.
- `npm audit` clean of high/critical. `security web check` skill run and its findings fixed.
- Nightly DB dump script (`scripts/backup.{sh,ps1}`) to a dated file, 30-day retention.
- No PHI beyond MRN. Prototype's synthetic sample loader must not exist in production; seed only reference lists and the first ADMIN user.

---

## 8. Phases and gates

Work in vertical slices. For every feature apply the cross-cutting checklist before calling it done: schema → zod → server action → UI → audit row → unit test → e2e step → docs line in `docs/CHANGELOG.md`. A slice missing any layer is not done.

At each gate: stop, commit, and report in this exact shape:
```
GATE {n} REPORT
Built: ...
Tests: unit {pass}/{total}, e2e {pass}/{total}
Screenshots: {paths}
Deviations from spec: none | list
Questions: none | list
```
Then wait. Ahmed's "confirm" or "yes" is the only signal to continue. Do not start the next phase early.

Commit format: `[ERN-P{phase}.{n}] imperative summary`. No hedging language.

**Phase 0: Discovery and scaffold**
Read pre-reads. Extract design tokens to `design/tokens.md` and `tailwind.config.ts`. Ask Ahmed for: DB engine and connection string, server OS and process manager (Windows NSSM + Caddy + Cloudflare Tunnel is his known setup; Linux systemd + Caddy is the alternative), SMTP credentials, public hostname. Scaffold Next.js, Prisma, Auth.js, Tailwind, Vitest, Playwright, ESLint, Prettier, GitHub Actions (lint, typecheck, unit, build). `taskmanager`: create the task list from this document. Gate 0.

**Phase 1: Schema, seed, auth, audit**
Prisma schema as above, migrations, seed script (Appendix A + first ADMIN from env). Auth.js credentials flow, lockout, role middleware, audit wrapper. Unit tests: duration formulas ported from the prototype tests, PHI-field guard test, role matrix test. Gate 1.

**Phase 2: Case vertical slice**
Create, edit, resolve, reopen, void. All conditional sections, chains, warnings panel, primary selector, version conflict handling, update log. Playwright: navigator opens a case in under 15 UI actions, adds an update, resolves; second session gets a 409 on a stale save. Gate 2.

**Phase 3: Board**
Sorting, bands, search, staleness, polling, handover print sheet. `Claude_Browser` screenshots. Gate 3.

**Phase 4: Dashboard**
All sections, drill-down, date range, weekly trend, `MIN_N`, shift and weekday, Other queue. `dataviz` skill for chart review. Unit tests for every aggregate against a fixture set with known answers. Gate 4.

**Phase 5: Export and print report**
exceljs sheets, `/report` route, print stylesheet. Test: exported Cases sheet row count equals filtered query count; hours columns match `elapsedHours`. Gate 5.

**Phase 6: Admin and alerts**
Users, reference lists, Other promotion, audit viewer, alerts worker, email. Test: promoting an Other reason re-tags the originating case and closes the review. Gate 6.

**Phase 7: Hardening and deployment**
`slop-remover` pass. `security web check` pass. Lighthouse mobile ≥ 90 performance and accessibility on Board and Case editor. PWA manifest and install prompt. Backup script. Deployment per Gate 0 answers: service definitions (NSSM or systemd) for web and worker, Caddy config, Cloudflare Tunnel route, `docs/RUNBOOK.md` (start, stop, restore from backup, add a user, rotate secrets). Gate 7 = production ready.

**Phase 8 (only if asked): extensions**
Historical import from the first-pass xlsx (map to cases, mark `openedById` = system, flag as imported). Server-sent events for the board. Arabic RTL. WhatsApp Business notifications.

Skills not applicable anywhere in this build: `idea-refine`, `dispatching-parallel-agents` except read-only schema review in Phase 1.

---

## 9. Do not

- Do not add a tiered escalation dropdown. The only escalation fields are `medAdminInformedAt` and the `Alert` table.
- Do not rename "consulted team" to "consultant", or change any taxonomy string.
- Do not store patient names, national IDs or anything beyond MRN.
- Do not use localStorage or sessionStorage for case data.
- Do not compute medians with fewer than three values.
- Do not auto-merge a stale write; always 409.
- Do not add departments, wards or reasons that are not in Appendix A; Ahmed adds those through Admin.
- Do not skip a gate or merge behaviours that "seem better" without asking at the gate.

---

## Appendix A: Seed lists (verbatim)

**Stages and reasons** (each stage also gets "Other", `isOther = true`)

- Registration: Registration desk/system delay; Missing/incorrect patient information
- Triage: Waiting for triage nurse availability; Re-triage required
- Resus room: No resus bay available; Equipment/monitor not available
- Exam room: No exam room available; Waiting for isolation/negative pressure room
- Investigations: Lab: delay in sample collection; Lab: delay in transport/pickup to lab; Lab: delay in lab receiving specimen; Lab: delay in processing; Lab: delay in results release to ED; Imaging: acquisition delay (CT); Imaging: acquisition delay (US); Imaging: acquisition delay (X-ray/KUB); Imaging: report delay; Waiting for transport to imaging
- Referral / consulted team (`requiresDepartment = true` on all): Awaiting consulted team response/callback; Consulted team seen patient, awaiting plan; Referral sent, awaiting acceptance; Disagreement between teams on ownership
- Disposition decision: Plan made, awaiting written admission order; Awaiting senior/attending sign-off
- Admission process: No bed available on accepting ward; Bed available, awaiting transport/porter; Bed available, awaiting nursing handover; Referred out: no bed in accepting department (`requiresReferralNo`); Referred out: care not available on-site (`requiresReferralNo`); Waiting for RCC / transfer acceptance (`requiresReferralNo`)
- Discharge process: Awaiting discharge paperwork/prescription; Awaiting pharmacy; Awaiting patient transport home; Patient signing DAMA; Social/family factor delaying discharge
- Administrative / coordination: Bed coordinator office delay; Fax/communication breakdown between units; System/network downtime

**Departments**: MROD; Internal Medicine; General Surgery; ICU; CCU; Orthopedics; Urology; Neurology / Neurosurgery; OB/GYN; Psychiatry; Radiology; Respiratory Therapy; ENT; Ophthalmology; Pediatrics; Other

**Wards**: FMW (Female Medical Ward); MMW (Male Medical Ward); FSW (Female Surgical Ward); MSW (Male Surgical Ward); ICU; CCU; SDU (Step Down Unit); OBW (OB Ward)

**Dispositions**: Admitted; Discharged home; Discharged DAMA; Transferred to another facility; Left without being seen; Other

**Shifts**: Morning; Evening; Night

**Investigation step labels**: LAB: Ordered, Sample collected, Received by lab, Resulted. CT / US / X-ray-KUB: Ordered, Scan done, Reported.

**Admission steps**: Admission order written; Bed requested (fax sent); Bed assigned; Nursing handover done.

**Transfer steps**: Transfer requested; Accepted by facility; RCC / transport arrived.

**Journey milestones** (numbered, in order): Triage; Resus / exam room; First physician contact; Disposition decided; Left ED.
