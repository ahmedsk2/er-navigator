# Phase 6 spec: admin and the alerts worker

Written by the lead (Fable). Locked plan sections 5.6 and 6.

## Preconditions (build first, in this order)

1. **System user**: seed a user `system` (display name "System", role NAVIGATOR, `active = false`, random unusable password hash) in `prisma/seed.ts`, insert-if-missing. It is the author of worker-written updates and the `openedBy` of Phase 8 imports. An inactive user cannot log in; `getSession()` already rejects inactive users.
2. **Worker build target**: bundle `worker/alerts.ts` with esbuild (already in `node_modules/.bin` through Next; add `esbuild` as a devDependency explicitly) to `dist/worker.js` during the Docker `build` stage, copy it into the runner image, and add a `worker` service to `docker-compose.production.yml`: same image (`target: runner`), `command: ["node", "worker.js"]`, same entrypoint allowlist (add `ALERT_INTERVAL_MINUTES`, `ALERT_EMAIL_FROM` as needed to the allowlist), `restart: unless-stopped`, networks `internal` only (it needs no inbound traffic), a healthcheck that checks a heartbeat file the worker touches every cycle (`test: ["CMD", "sh", "-c", "test $(( $(date +%s) - $(stat -c %Y /tmp/heartbeat) )) -lt 900"]`), `depends_on: migrate: service_completed_successfully`. Update `docs/RUNBOOK.md` (containers table, env table).
3. **Settings row**: a `Setting` model is NOT added; keep the report header in env `REPORT_HEADER` with the placeholder default until a real need for editable settings appears. (Recorded deviation: the plan said "held in a settings row Admin can edit"; env is enough for one string and avoids a schema change.)

## Alerts worker (`worker/alerts.ts`)

Every `ALERT_INTERVAL_MINUTES` (default 5), with `node-cron` or a plain `setInterval` with overlap protection:

```
for each OPEN case:
  h = elapsedHours(case, now)
  for t of [4, 6, 12, 24]:
    if h >= t and no Alert(caseId, t):
      in one transaction: create Alert(caseId, thresholdHours=t, firedAt=now);
                          create CaseUpdate "Reached {t}h threshold" by the system user;
                          audit alert.fire (actor = system user)
      if t >= 6: email SUPERVISOR and ADMIN users (active); set Alert.emailSentAt on success
```

- Idempotency: the unique index `(caseId, thresholdHours)` makes a duplicate insert fail; catch the unique-violation and skip (two workers or a restart mid-cycle cannot double-fire).
- Alerts never write `medAdminInformedAt`.
- Email: nodemailer over SMTP with the `navigator@towardpcc.com` mailbox's own settings from `SMTP_*` env (host, port 465 with TLS or 587 with STARTTLS as the provider states, username = the full address, password); `From` = `SMTP_FROM`; no relay. Template (text + minimal HTML): MRN, waiting time, primary reason, departments, link `${APP_URL}/cases/{id}`. Subject "ER Navigator: MRN {mrn} past {t}h". When `SMTP_HOST` is empty, log the message at info level instead of sending, and leave `emailSentAt = null`. Send failures: log, retry once after 30 s, never throw out of the cycle. Recipients are looked up each cycle (no caching). Before enabling in production: send one test message to Ahmed from the worker's `--test` flag and confirm `dkim=pass` and `dmarc=pass` in its `Authentication-Results` header (plan section 9, item 3).
- Heartbeat: touch `/tmp/heartbeat` at the end of every cycle; Uptime Kuma push monitor optional (document).
- Unit tests with an injected clock and a fake mailer: fires 4h once, 6h sends email, restart does not re-fire, a case resolved between cycles fires nothing new, send failure retried once and logged.

## Admin (`/admin/*`, ADMIN only; the Admin tab appears only for ADMIN)

1. **Users** `/admin/users`: list (username, display name, role, active, last login), create (username, display name, role, temporary password shown once), deactivate/reactivate (deactivation deletes the user's sessions), reset password (new temporary password shown once, sessions deleted), change role. Every change audited (`user.create`, `user.update`, `user.password`). A user cannot deactivate or demote themselves.
2. **Reference lists** `/admin/lists`: departments, wards, and reasons per stage: add, rename, deactivate/reactivate, reorder (up/down buttons; no drag). Renaming keeps the id (cases stay linked). Audited as `list.update` with before/after. The seed never overwrites these (already insert-if-missing). Stages themselves are fixed.
3. **Other review queue** `/admin/other`: PENDING `OtherReview` rows with case MRN, stage, text, date. Actions: Promote (choose a name, default = the text; creates a Reason under that stage or picks an existing active one; re-tags the originating case: replaces its Other `CaseReason` for that stage with the new reason, clears `otherText`, sets `primaryReasonId` to the new reason if the Other one was primary; marks the review PROMOTED with `promotedReasonId`, `reviewedById`, `reviewedAt`) and Dismiss (DISMISSED; the case keeps its Other text). Audited `other.promote` / `other.dismiss`. Test: promoting re-tags the case and closes the review; a second promotion of the same text reuses the reason.
4. **Alerts** `/admin/alerts`: fired alerts (case MRN, threshold, fired at, email sent at, acknowledged by/at), Acknowledge button for SUPERVISOR and ADMIN (`alert.acknowledge`, audited). Also reachable from the case editor header for SUPERVISOR/ADMIN when an unacknowledged alert exists.
5. **Audit log** `/admin/audit`: filters (action, entity, actor, date range), paginated, before/after shown as a diff of changed keys.

Layout: desktop first for admin (1280) but usable at 390; plain lists, no sidebar (a left list on desktop is fine).

## Tests

Unit: worker logic (above), promotion re-tag logic. DB-backed: promotion end to end; user deactivation deletes sessions; the audit rows. Playwright (desktop): admin creates a user, deactivates it, the user cannot log in; promotes an Other; acknowledges an alert. Screenshots `design/screens/phase6-*`.

## Do not

- No WhatsApp or SMS. No tiered escalation. No editing of stages. No deleting anything (users are deactivated, lists deactivated, alerts acknowledged).
