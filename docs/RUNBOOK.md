# Runbook: production for ER Navigator

Live: https://nav.towardpcc.com. Everything here was created or verified on 2026-09-08. The plan (`docs/PLAN.md`) explains why; this file says what exists and how to operate it.

The host also runs other live clinical applications. Every command below is scoped to this app's containers and its own volume. Never touch another project's containers, databases or the shared proxy config.

## The pieces

| Piece | Value |
| --- | --- |
| Host | OCI `hosting-1`, `ubuntu@145.241.105.239` (`ssh -i ~/.ssh/oci_server`), passwordless sudo |
| Platform | Coolify 4.1.2 at https://deploy.towardpcc.com (API from the host: `http://localhost:8000/api/v1`, token `~/.coolify-token`) |
| Project / environment | `clinical` (`bzgokocrhao23bp4zj6amom5`) / `production` (`p7ozpkekn1lcuf8wbmaip0m4`) |
| Application | `er-navigator`, uuid `jqcjqhmcmizxs1u51wnqlfwv` |
| Build | `dockercompose`, `/docker-compose.production.yml`, base directory `/` |
| Domain binding | `docker_compose_domains = {"app":{"domain":"https://nav.towardpcc.com:3000"}}` |
| Repository | `git@github.com:ahmedsk2/er-navigator.git`, branch `main`, private |
| Deploy key | GitHub deploy key id `162688479` (read-only) = Coolify private key `er-navigator-deploy` (`l48u5xcuzddx3vr1hb4zsqlb`) |
| DNS | Cloudflare A `nav.towardpcc.com` → `145.241.105.239`, proxied, record id `3d0956409a57ac5f069bbc9736969e61` |
| TLS | Let's Encrypt via Traefik HTTP-01 through Cloudflare; zone SSL mode Full (strict) |
| Containers | `db` (postgres:16-alpine with the init script baked in; volume `jqcjqhmcmizxs1u51wnqlfwv_ernav-db`; networks `internal` and the Coolify per-app network `jqcjqhmcmizxs1u51wnqlfwv`, which only `coolify-proxy` also joins), `migrate` (one-shot, exits 0), `app` (:3000; networks `coolify`, `internal` and the per-app network), `worker` (threshold alerts, the same runner image as `app` running `node worker.js`; `internal` only, no port, no proxy label) |
| Probes | `GET /api/health` (liveness + `x-build-fingerprint`), `GET /api/ready` (SELECT 1), and for `worker` the container healthcheck on `/tmp/heartbeat` (unhealthy = no cycle completed successfully in 15 minutes; a failed cycle does not touch the file) plus the Uptime Kuma push monitor (`ALERT_PUSH_URL`), which is what actually pages when the worker stops |

## DNS rule

`nav.towardpcc.com` stays proxied (orange cloud). The OCI security list accepts 80/443 only from Cloudflare's ranges, so a grey cloud takes the site offline and breaks certificate renewal. This is also what makes trusting `CF-Connecting-IP` safe for rate limiting; opening those ports means changing the rate limiter in the same commit.

## Deploy a change

Merge to `main`, outside shift change. Coolify builds on the host (roughly 2 to 5 minutes, more when other tenants are building), then STOPS AND REMOVES every container of this application and starts the new set: `db`, then `migrate`, then `app`. There is no rolling update for compose applications; the site returns 404 for about a minute (db healthcheck, migrate, app start, first health probe). If `migrate` exits non-zero, `app` is not started and the site stays down: see "Deploy failed at migrate" below. Then verify by commit, not by tag, and confirm the app container carries no owner secrets:

```bash
curl -sI https://nav.towardpcc.com/api/health | grep -i x-build-fingerprint
printf %s "$(git rev-parse HEAD)" | sha256sum | cut -c1-16
curl -s https://nav.towardpcc.com/api/ready
# on the host: must print 0. Read the RUNNING process's environment (/proc/1/environ);
# `docker exec ... printenv` shows the container's configured env, which still has everything.
APP=$(sudo docker ps --format '{{.Names}}' | grep '^app-jqcjqhmcmizxs1u51wnqlfwv'); sudo docker exec "$APP" sh -c 'tr "\0" "\n" < /proc/1/environ | grep -c -E "^(POSTGRES_PASSWORD|ADMIN_PASSWORD)="'
```

A screen that stayed open across the deploy (the board on a phone, the login page) posts Server Action ids the new build does not know; the app log says `Failed to find Server Action` and the audit log shows no attempt. Since 10 September such a screen reloads itself: the root layout stamps every page with the build fingerprint, the error boundary compares it with `/api/health` and reloads when they differ, saying "ER Navigator was updated". The cost of a deploy to an open screen is therefore one reload and nothing typed on an earlier screen.

Force a redeploy without a push (from the host):

```bash
T=$(cat ~/.coolify-token); curl -s -H "Authorization: Bearer $T" "http://localhost:8000/api/v1/deploy?uuid=jqcjqhmcmizxs1u51wnqlfwv&force=false"
```

Poll `GET /api/v1/deployments/<deployment_uuid>` until `status` is `finished`. Read the deployment log in Coolify when it is not.

## Roll back

Coolify → er-navigator → Deployments → pick the last good deployment → Redeploy. Migrations are forward-only: a schema revert is a new migration. If the failure was in `migrate`, do the section below first; Redeploy alone fails at the same step.

## Stop, start, restart (without a deploy)

From the host, with the Coolify token. Stop takes every container of this application down,
the database included, and removes the built `db` image; the site answers 404 from Traefik until
Start finishes. Start is not a plain `docker compose up`: it queues a full deployment (rebuild,
migrate, seed, about three minutes, measured 2026-09-09), so a stop/start round trip costs about
the same downtime as a deploy. Sessions survive (they live in the database volume) and the
alerts worker resumes its cycle on Start. Restart is the same as Stop then Start.

```bash
T=$(cat ~/.coolify-token); A=jqcjqhmcmizxs1u51wnqlfwv
curl -s -H "Authorization: Bearer $T" "http://localhost:8000/api/v1/applications/$A/stop"
curl -s -H "Authorization: Bearer $T" "http://localhost:8000/api/v1/applications/$A/start"
curl -s -H "Authorization: Bearer $T" "http://localhost:8000/api/v1/applications/$A/restart"
```

The same three buttons exist in Coolify → er-navigator. Never `docker stop` the containers by
hand: Coolify would still believe they are running, and the next deploy or restart then fails
on names that already exist.

## Deploy failed at migrate

Symptoms: the deployment log ends with `dependency failed to start` or a Prisma error, no `app-…` container exists, the site is 404. Prisma has recorded the migration as failed in `_prisma_migrations` (`finished_at IS NULL`) and will refuse every further `migrate deploy` with P3009, on any commit, until that record is resolved.

```bash
U=jqcjqhmcmizxs1u51wnqlfwv
DB=$(sudo docker ps --format '{{.Names}}' | grep "^db-$U")
sudo docker logs $(sudo docker ps -a --format '{{.Names}}' | grep "^migrate-$U") 2>&1 | tail -40
sudo docker exec "$DB" psql -U ernav_owner -d ernav -tAc "SELECT migration_name, started_at, logs FROM _prisma_migrations WHERE finished_at IS NULL"
```

1. Read what the migration did before it failed. If part of its SQL applied, repair by hand as `ernav_owner` in `psql` (drop the half-created objects, or finish them).
2. Mark the record, using the migrate image that was just built (tag = commit sha) on the app's internal network. `--rolled-back` when you undid it, `--applied` when you finished it by hand:

```bash
IMG=$(sudo docker images --format '{{.Repository}}:{{.Tag}}' | grep "^${U}_migrate" | head -1)
PW=$(sudo docker exec "$DB" printenv POSTGRES_PASSWORD)
DBIP=$(sudo docker inspect "$DB" --format "{{(index .NetworkSettings.Networks \"${U}_internal\").IPAddress}}")
sudo docker run --rm --network "${U}_internal" -e DATABASE_URL="postgresql://ernav_owner:${PW}@${DBIP}:5432/ernav?schema=public" "$IMG" \
  sh -c 'pnpm exec prisma migrate resolve --rolled-back <migration_name>'
```

3. Fix the migration in a branch, merge, and let the deploy run again. Or, to get the site up first, Redeploy the last good deployment now that the record is resolved.

## Environment variables (Coolify → er-navigator → Environment Variables)

Every key the compose file passes through. Secrets are 48-character alphanumerics (a `$` in a value is interpolated by compose and silently truncated).

| Key | Purpose |
| --- | --- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | database name and OWNER role (migrations, role sync, seed). Do not rename the user: the privileges migration names `ernav_owner`/`ernav_app`. Rotate in the database first (below) |
| `APP_DB_USER`, `APP_DB_PASSWORD` | limited runtime role, created on first boot and re-applied on every deploy by `prisma/sync-app-role.ts`. Rotate by redeploy |
| `APP_URL` | `https://nav.towardpcc.com`; the case links in alert emails. The display timezone is not a variable: `Asia/Riyadh` is fixed in `src/lib/domain/time.ts` |
| `ADMIN_USERNAME`, `ADMIN_DISPLAY_NAME`, `ADMIN_PASSWORD` | first ADMIN, created by the seed only if the username does not exist yet |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | threshold alert email (Phase 6): the `navigator@towardpcc.com` mailbox's own SMTP settings, as in a mail client (no relay). `SMTP_FROM` is set; Ahmed enters the other four in Coolify (both copies) and redeploys. Empty host = log only. Deliverability needs the provider's DKIM selector record in Cloudflare; SPF and DMARC stay unchanged |
| `ALERT_INTERVAL_MINUTES` | how often the `worker` scans the open cases. Default 5. The healthcheck allows 15 minutes between cycles, so anything above ~7 needs the healthcheck widened too |
| *(no recipient variable)* | who the 6 h+ alerts go to is **not** an environment variable. It is the active SUPERVISOR and ADMIN users that have an email address in **Admin → Users**, read from the database on every cycle — so adding or removing someone takes effect within one interval, with no redeploy. Someone on those roles with no address is skipped and logged at warn level, never guessed at; nobody with an address = alerts are still recorded, just not emailed. Phase 7 removed `ALERT_EMAIL_MAP`; delete it from both Coolify copies if it is still set |
| `ALERT_HEARTBEAT_FILE` | the file the worker touches after every SUCCESSFUL cycle. Default and healthcheck path: `/tmp/heartbeat`. Leave unset |
| `ALERT_PUSH_URL` | the Uptime Kuma push monitor's URL (Monitoring, below). The worker GETs it after every successful cycle; empty = no external monitor, the worker logs `pushMonitor: none` at start |

Removed on 2026-09-09 after the final review because no code read them: `AUTH_SECRET`, `AUTH_TRUST_HOST` (Auth.js leftovers; sessions are opaque database tokens), `APP_TIMEZONE`, `LOG_LEVEL`. They may still exist in Coolify's variable list; deleting them there is harmless, leaving them is too, since the entrypoint strips them.

Every variable set here reaches every container of the app (Coolify's env file). The app image's entrypoint unsets everything except its allowlist (`docker/entrypoint.sh`); `migrate` keeps the full set for the seconds it runs; `db` ignores what it does not use.

Rotate by redeploy (everything except the owner password): edit both the production and the preview copy in Coolify, then Redeploy (a plain restart keeps the old environment; a deploy is a minute of downtime). Once login exists, delete `ADMIN_PASSWORD` from both copies after the first login; the seed never overwrites an existing admin.

Rotate the owner password in the database first, or the next deploy fails authentication and the site stays down:

```bash
DB=$(sudo docker ps --format '{{.Names}}' | grep '^db-jqcjqhmcmizxs1u51wnqlfwv')
sudo docker exec "$DB" psql -U ernav_owner -d ernav -c "ALTER ROLE ernav_owner PASSWORD '<new 48-char alphanumeric>'"
# then set POSTGRES_PASSWORD (both copies) in Coolify, Redeploy, and check /api/ready
```

Verify a rotation with a hash inside the container, never by printing the value:

```bash
CID=$(sudo docker ps --format '{{.Names}}' | grep '^app-jqcjqhmcmizxs1u51wnqlfwv')
sudo docker exec "$CID" sh -c 'tr "\0" "\n" < /proc/1/environ | grep "^DATABASE_URL=" | sha256sum | cut -c1-8'
```

## Database access

Only through the `db` container of this app. Owner role for schema work, app role for anything else.

```bash
DB=$(sudo docker ps --format '{{.Names}}' | grep '^db-jqcjqhmcmizxs1u51wnqlfwv')
sudo docker exec "$DB" psql -U ernav_owner -d ernav -tAc \
  "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY started_at"
sudo docker exec "$DB" psql -U ernav_owner -d ernav -tAc \
  "SELECT has_table_privilege('ernav_app','\"AuditLog\"','DELETE')"   # must be f
```

## Backup and restore (installed 2026-09-09)

Installed on the host: `/opt/ernav-backup/backup.sh` (a copy of `scripts/backup.sh`; re-copy after changing it), `ernav-backup.service` and `ernav-backup.timer` (daily 02:30 UTC, persistent, 5 min jitter). Dumps land in `/home/ubuntu/backups/ernav/` as root-owned, mode 600 files. First run 2026-09-09 06:38 UTC (37826 bytes); restore drill the same morning into a scratch database: 10 stages, 48 reasons, 16 departments, 8 wards, 1 user, 2 migrations. Off-host copy (2026-09-09 11:15 UTC): `/opt/ernav-backup/upload.sh` runs `rclone copy` to the OCI bucket `coolify-backups/ernav/` (S3-compatible endpoint; the rclone remote `oci` is configured in `/root/.config/rclone/rclone.conf`, mode 600, using the same S3 keys as Coolify's own backups). The unit passes it as `UPLOAD_CMD`. Verified the same day: the dump `ernav-2026-09-09-1115.dump` uploaded, was pulled back from the bucket and restored into a scratch database (10 stages, 1 user, 3 migrations, 1 session), then dropped. The laptop task `OracleBackupSync` mirrors the bucket daily, which is the third copy.

`scripts/backup.sh` (in the repository) runs `pg_dump` in custom format from the `db` container to `/home/ubuntu/backups/ernav/ernav-YYYY-MM-DD-HHMM.dump`, keeps 30 days locally, and uploads through `UPLOAD_CMD` when one is configured (target: the OCI bucket `coolify-backups`, 14-day WORM, mirrored by the laptop task `OracleBackupSync`). It is installed as `ernav-backup.timer` (above); every drill is recorded in History.

Data-volume guard rails: the Coolify server setting "Delete unused volumes" must stay OFF (it is), and deleting the application in Coolify deletes `jqcjqhmcmizxs1u51wnqlfwv_ernav-db` unless the volumes box is unticked. Every deploy removes and recreates the db container; the volume persists.

Restore drill (scratch database, never over production):

```bash
DB=$(sudo docker ps --format '{{.Names}}' | grep '^db-jqcjqhmcmizxs1u51wnqlfwv')
sudo docker exec "$DB" createdb -U ernav_owner ernav_restore_test
sudo cat /home/ubuntu/backups/ernav/<file>.dump | sudo docker exec -i "$DB" pg_restore -U ernav_owner -d ernav_restore_test --no-owner
sudo docker exec "$DB" psql -U ernav_owner -d ernav_restore_test -tAc 'SELECT count(*) FROM "Case"'
sudo docker exec "$DB" dropdb -U ernav_owner ernav_restore_test
```

### Restore into production

For the case the backups exist for: a migration or an operator mistake has destroyed or
corrupted case data. Everything runs on the host. The application must be STOPPED for the
restore, so no client holds a connection while tables are dropped and recreated. Two facts the
drill established (2026-09-09): Coolify's Stop also removes the built `db` image, and Start is a
full deployment (rebuild, migrate, seed), so the site is down from the stop until that deployment
finishes, five minutes in the drill; and the restore itself recreates the tables under the
owner's default privileges, which GRANT the app role DELETE on `AuditLog` until the deployment's
`sync-app-role` revokes it again. Step 6's privilege check is therefore not optional.

```bash
T=$(cat ~/.coolify-token); A=jqcjqhmcmizxs1u51wnqlfwv

# 1. A fresh dump of what is there NOW, so the restore itself can be undone, then pick the file.
sudo UPLOAD_CMD=/opt/ernav-backup/upload.sh /opt/ernav-backup/backup.sh
ls -la /home/ubuntu/backups/ernav/
FILE=/home/ubuntu/backups/ernav/<the dump to restore>.dump

# 2. Stop the application (all containers AND the built db image go; the volume stays).
curl -s -H "Authorization: Bearer $T" "http://localhost:8000/api/v1/applications/$A/stop"; echo
until [ -z "$(sudo docker ps -q --filter "name=$A")" ]; do sleep 2; done

# 3. A throwaway Postgres on the SAME volume, from the SAME pinned base image the db image is
#    built from (the FROM line of docker/postgres/Dockerfile; alpine, so the collation library
#    matches the data directory), reachable by nothing else.
IMG=postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685
sudo docker pull -q "$IMG"
sudo docker run -d --name ernav-restore -v "${A}_ernav-db:/var/lib/postgresql/data" -e POSTGRES_PASSWORD=unused "$IMG"
until sudo docker exec ernav-restore pg_isready -q -U ernav_owner -d ernav; do sleep 2; done

# 4. Restore over the live database: every object in the dump is dropped and recreated.
#    pg_restore exits 1 when it ignored an error; read the "errors ignored" line and the
#    messages above it before going on. "does not exist" lines are suppressed by --if-exists.
sudo cat "$FILE" | sudo docker exec -i ernav-restore pg_restore -U ernav_owner -d ernav --clean --if-exists --no-owner --single-transaction
sudo docker exec ernav-restore psql -U ernav_owner -d ernav -tAc 'SELECT count(*) FROM "Case"; SELECT count(*) FROM "AuditLog"; SELECT max(migration_name) FROM _prisma_migrations'

# 5. Remove the throwaway container, then Start, which queues a full deployment (about three
#    minutes): migrate applies anything newer than the dump, sync-app-role re-applies the app
#    role's grants and REVOKEs, the seed adds nothing. Poll /api/ready until it answers 200.
sudo docker rm -f ernav-restore
curl -s -H "Authorization: Bearer $T" "http://localhost:8000/api/v1/applications/$A/start"; echo
until [ "$(curl -s -m 10 -o /dev/null -w '%{http_code}' https://nav.towardpcc.com/api/ready)" = "200" ]; do sleep 5; done

# 6. Verify, as after a deploy: ready, fingerprint, privileges, the counts from step 4.
curl -s https://nav.towardpcc.com/api/ready
DB=$(sudo docker ps --format '{{.Names}}' | grep "^db-$A")
sudo docker exec "$DB" psql -U ernav_owner -d ernav -tAc "SELECT has_table_privilege('ernav_app','\"AuditLog\"','DELETE')"   # must be f
```

`--single-transaction` makes the restore all-or-nothing: a failure leaves the database as it
was. Drop it only if a dump is too large for one transaction, and then restore into a scratch
database first. Drilled on production on 2026-09-09 (see History): stop 5 s, restore under a
second, Start-to-ready 2 min 50 s, site down 5 min 10 s in all, counts and migrations identical
before and after, app role privileges back to `f|f|f` once the deployment had run.

## PHI scrub

Only the MRN may identify a patient. If a name, national ID or phone number is typed into free text (an update, a resolution note, an Other description, a void reason), the app cannot remove it: `CaseUpdate` and `AuditLog` are append-only for the app role by design. The owner role scrubs it, and the scrub is itself audited:

```bash
DB=$(sudo docker ps --format '{{.Names}}' | grep '^db-jqcjqhmcmizxs1u51wnqlfwv')
sudo docker exec -i "$DB" psql -U ernav_owner -d ernav <<'SQL'
BEGIN;
UPDATE "CaseUpdate" SET text = '[redacted 2026-01-01 by <admin username>: identifying text removed]' WHERE id = '<row id>';
-- repeat for AuditLog.before / AuditLog.after rows that copied the text (jsonb_set on the field),
-- and for Case.resolutionNote / Case.voidReason / CaseReason.otherText / OtherReview.text as applicable
INSERT INTO "AuditLog" (id, action, entity, "entityId", after) VALUES (gen_random_uuid()::text, 'phi.scrub', 'CaseUpdate', '<row id>', '{"reason":"identifying text"}');
COMMIT;
SQL
```

Then take a fresh backup, and remember the previous dumps (local, bucket, laptop mirror) still hold the text until they age out.

## The alerts worker

Its own container, no inbound traffic, the same image as `app`. Every `ALERT_INTERVAL_MINUTES` it
scans the OPEN cases and, the first time one passes 4, 6, 12 or 24 hours, writes an `Alert`, the
`system` user's "Reached {t}h threshold" update and an `alert.fire` audit row in one transaction;
from 6 hours up it also emails the active supervisors and admins **that have an email address in
Admin → Users** — that list is the whole directory and is re-read every cycle, so a change there
takes effect within one interval without a redeploy. It never fills in "medical admin informed".
A unique index on `(caseId, thresholdHours)` is what makes a restart or a second worker harmless.
Acknowledging is done in the app: Admin → Alerts, or the case editor's header.

```bash
U=jqcjqhmcmizxs1u51wnqlfwv
W=$(sudo docker ps --format '{{.Names}}' | grep "^worker-$U")
sudo docker logs "$W" --tail 50               # "[alerts] cycle done { ... }" every interval
sudo docker inspect --format '{{.State.Health.Status}}' "$W"
sudo docker exec "$W" sh -c 'cat /tmp/heartbeat'   # the last SUCCESSFUL cycle, ISO 8601; a failed cycle leaves it alone
```

Before enabling mail in production, send one test message and check the headers of what arrives
(plan section 9, item 3 — it must show `dkim=pass` and `dmarc=pass`):

```bash
sudo docker exec "$W" node worker.js --test ahmed@example.com   # prints the SMTP response
```

If `SMTP_HOST` is empty the worker logs each message at info level instead of sending it and
leaves `emailSentAt` null — the alerts themselves are still recorded, so nothing is lost by
leaving mail switched off until the DKIM record is in place.

## Add a user

Admin → Users, as an ADMIN: create (the temporary password is shown once — read it out, it cannot
be recovered), change role, set or clear the work email, reset password, deactivate. Deactivating
and resetting a password delete that user's sessions immediately; changing an email does not, it
is contact data rather than a credential. Nobody is ever deleted, and an administrator cannot
deactivate or change the role of their own account: ask another administrator.

The Email column is the alerts directory: a supervisor or administrator with an address there
receives the 6 h+ threshold mail, and emptying the box and pressing Save takes them off the list
without touching anything else.

First login (Phase 1): sign in at https://nav.towardpcc.com/login with ADMIN_USERNAME and the
ADMIN_PASSWORD that was in Coolify when the database was first seeded, then change it at
/account (at least 12 characters). Changing it signs out every other device and leaves a
user.password audit row. The seeded password is never re-applied — the seed only creates the
admin when the username is absent — so clearing ADMIN_PASSWORD in Coolify afterwards is safe.

For the same reason, CHANGING ADMIN_PASSWORD in Coolify after the first seed changes nothing:
on 10 September it had been changed the morning after the seed, every sign-in with the new value
failed (five `auth.fail` rows, no lock yet), and the fix was to re-hash the current value into the
row as the owner role. Either sign in with the original value and change it at /account, or run
this on the host. The value is read from the last migrate container (the one place outside
Coolify that holds it), hashed with the host's python3-bcrypt, and piped straight into psql, so
neither the value nor the hash is ever printed or re-read by a shell:

```bash
M=$(sudo docker ps -a --format '{{.Names}}' | grep '^migrate-jqcjqhmcmizxs1u51wnqlfwv')
D=$(sudo docker ps --format '{{.Names}}' | grep '^db-jqcjqhmcmizxs1u51wnqlfwv')
HASH=$(sudo docker inspect "$M" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^ADMIN_PASSWORD=' | cut -d= -f2- | tr -d '\n' | python3 -c 'import sys,bcrypt; print(bcrypt.hashpw(sys.stdin.buffer.read(), bcrypt.gensalt(12)).decode(), end="")')
printf '%s\n' "UPDATE \"User\" SET \"passwordHash\" = '$HASH', \"failedLogins\" = 0, \"lockedUntil\" = NULL WHERE username = 'admin';" "INSERT INTO \"AuditLog\" (id, action, entity, \"entityId\", after, \"userAgent\") VALUES (gen_random_uuid()::text, 'user.password', 'User', (SELECT id FROM \"User\" WHERE username = 'admin'), '{\"reason\":\"ADMIN_PASSWORD re-hashed by the owner role\"}', 'runbook: owner SQL');" | sudo docker exec -i "$D" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'
unset HASH
```

Expect `UPDATE 1` and `INSERT 0 1`. The row's failure count and lock are cleared with it. Done
this way on 2026-09-10 03:54 UTC (audit row `user.password`, user agent `runbook: owner SQL`).
Ten failed sign-ins lock an account for 15 minutes. To clear a lock before then, an Admin uses
Admin → Users → Reset password on that user: it clears the lock and the failure count, signs
the user out everywhere and leaves a `user.password` audit row. Only when no Admin can sign in
(every Admin locked at once) fall back to SQL as the owner role, and write an AuditLog row by
hand as in "PHI scrub": `UPDATE "User" SET "lockedUntil" = NULL, "failedLogins" = 0 WHERE
username = '<name>';`

## Reports and exports (Phase 8)

Everything the dashboard, the print report and the three workbooks show is computed over the
cases ER Navigator tracks, never the whole ED; every KPI panel and every Read me sheet says so.
The whole-ED figures (all attendances, % non-urgent, mortality) stay with the hospital system.

`/export` offers three formats over one date range (registration date, Asia/Riyadh) and one
status filter:

| Format | File | For |
| --- | --- | --- |
| ER Navigator workbook | `ER_Navigator_{from}_to_{to}.xlsx` | the app's own five sheets (Cases, Consults, Investigations, Updates, Summary) |
| Adaa ED KPIs | `adaa-ed-kpis_{from}_to_{to}.xlsx` | the national form's twenty input columns (paste `A2:T…` into the official file's `ED KPIs 1-6 - manual` sheet), a KPI summary per CTAS coloured by the Adaa benchmarks, and a Read me |
| QCH navigator sheet | `qch-navigator-sheet_{from}_to_{to}.xlsx` | the navigators' August collection log, seventy columns in its order and spelling, without the patient name; columns the app does not record are present and blank, and the Read me lists them |

Definitions that a reader of the sheets will ask about are on each workbook's Read me: the
door is the earlier of registration and triage (KPI 1 and KPI 5 alike); the time of
disposition is when the patient left the ED (departure, else resolution); KPI 6 is DAMA only
until LAMA exists as a disposition; a triage on the Riyadh day before the registration cannot be
written into the Adaa form and is counted for hand entry; a ward left on a patient who was then
discharged is not reported as an admission. A read is logged, not audited; a refused download
writes the `auth.forbidden` row with the format.

New collection fields since Phase 8: CTAS (1 to 5), ED area (Admin → Reference lists → ED
areas, seeded with the six areas of the August sheet) and the imaging preliminary report time.
Since Phase 8b (Ahmed's collection decisions, 9 September): a pain-management block (painkiller
prescribed, pethidine and its dose, time given, sickle-cell treatment) that feeds Adaa KPI 8; a
case-management block (referred to a case manager or the complex-care coordinator, criteria,
action, call and reply times); "instructions given" and "family engaged" at resolution; an
optional action tag on each update in the weekly deck's six categories; the dispositions
Deceased and Referred to UCC; MRI as an investigation type; and a supervisor "reviewed" mark.
All optional. A supervisor or an admin marks a case reviewed under the resolve block; the mark is
audited (`case.review`), cleared by any later save or resolve, and shown as a chip on resolved
board rows. The dashboard's Documentation section lists resolved cases not yet reviewed and pain
records that cannot enter a KPI (a painkiller with no time, a pethidine with no on-list dose).
The per-case timeline on the case page and the handover sheet is computed from what is recorded;
it never asks for anything new.

## Monitoring

Uptime Kuma (`uptime.towardpcc.com`, Coolify service `f20u98778pmpgcwkl97ihmgl`), two monitors, both created 10 September 2026 with the default email notification (Ahmed's Gmail):

1. `ER Navigator — ready` (monitor 8): HTTP(s) - Keyword on `https://nav.towardpcc.com/api/ready`, keyword `"status":"ready"`, accepted status codes 200-299 (Kuma's default), interval 60 s, retries 1. Covers the app and the database: a database outage answers 503 with `{"status":"database unreachable"}`, which fails both checks.
2. `ER Navigator — worker` (monitor 9): type Push, heartbeat interval 900 s (three five-minute cycles), retries 1. Its URL `https://uptime.towardpcc.com/api/push/<token>?status=up&msg=OK&ping=` is `ALERT_PUSH_URL` in both Coolify copies (set through the API the same day). The worker GETs it after every successful cycle, logs `pushMonitor: set` at start and `push monitor answered { status: 200 }` per cycle; Kuma alerts when the pushes stop, which is the only thing that notices a worker that is hung, crash-looping or unable to reach the database (the container healthcheck goes unhealthy but Docker does not restart on that, and `/api/ready` stays green).

The Kuma UI sits behind a Traefik basic-auth middleware (`kuma-auth`, a label in the service's compose), which also answered 401 to the push URL. The service's compose therefore carries a second router, `https-push-f20u98778pmpgcwkl97ihmgl-uptime-kuma`, for `Host(uptime.towardpcc.com) && PathPrefix(/api/push/)` with the `gzip` middleware only and priority 100: the push endpoint is authenticated by its per-monitor token, the rest of the site stays guarded. If the Kuma service is ever recreated from scratch, that router has to come back or every push monitor on this host answers 401 (the worker logs the status it got). To change the token, use Reset Token on the monitor, then update `ALERT_PUSH_URL` in both copies and Redeploy (a Restart keeps the old environment).

OCI alarms already cover host down and CPU.

## Hands-on demo (Phase 11)

A full walk-through on the production build over a throwaway database, never the production one
(the audit log is append-only and cases can only be voided, so demo users and patients there would
be permanent). The same script produced the before-and-after screens of the Phase 11 gate.

1. `bash scripts/demo-reset.sh` drops and recreates the demo database (compose project
   `ernav-demo`, port 55450), migrates it, reconciles the app role and seeds it; the first admin's
   password is `DEMO_ADMIN_PASSWORD`, or `demo-only-admin-password`.
2. `pnpm build`, then start the app against it:
   `PORT=3300 DATABASE_URL=postgresql://ernav_app:devapp@localhost:55450/ernav?schema=public pnpm start`.
3. `pnpm exec playwright test --config tests/demo/playwright.demo.config.ts`: the admin creates two
   navigators, a charge nurse and the medical director; the navigators open five invented patients
   and work each to resolution; the charge nurse reviews three and pulls the workbook and the report;
   the medical director reads the dashboard on a phone and a laptop. Screens (`NN-step.png`) and a
   per-step log of actions and seconds (`log.json`) land in `test-results/demo-shots`, or in
   `DEMO_SHOTS`.
4. `docker compose -p ernav-demo -f docker-compose.dev.yml down -v` when done.

## Security headers

Since Phase 10 the Permissions-Policy allows the microphone to this origin only (`microphone=(self)`): the in-app dictation button uses the browser's speech recognition where it exists (Chrome, Android); every other feature in the header stays denied. `tests/e2e/headers.spec.ts` pins the exact string.

Every response carries HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options`, a strict
Referrer-Policy, a Permissions-Policy that denies every device and tracking feature the app
does not use, and `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy: same-origin`
from `next.config.ts`, plus a Content-Security-Policy built per request in `proxy.ts` — the
only place that can mint the nonce it carries. There is exactly one source for the CSP, and a
unit test fails if a second one appears in the config. `tests/e2e/headers.spec.ts` asserts the
whole set on every CI run.

The session cookies are `__Host-ern_session` and `__Host-ern_remember`: `Secure`, `HttpOnly`,
`SameSite=Lax`, `Path=/`, no Domain. The `__Host-` prefix makes the browser refuse the cookie
under any other attributes, so nothing else served under `*.towardpcc.com` can set or shadow a
session for this app. Consequence for a local `pnpm start` on plain HTTP: only `localhost`
works (browsers treat it as secure); an IP address or a LAN hostname will never sign in.

Cloudflare-side settings that complete the picture (zone → SSL/TLS, founder account): minimum
TLS version 1.2 (set; verified through the API on 10 September, with TLS 1.3 enabled) and, if
ever wanted, a restricted cipher list. The cipher list is optional: customising it needs the paid
Advanced Certificate Manager add-on, and with TLS 1.0/1.1 already refused the remaining default
TLS 1.2 suites are the ECDHE ones every current browser uses. Both settings are zone-wide, so they
apply to every proxied towardpcc.com hostname at once (the apex and www are DNS-only and
unaffected); the origin only ever hears from Cloudflare, so nothing on the server changes.

```bash
curl -sI https://nav.towardpcc.com/login | grep -i 'content-security-policy'
# script-src 'self' 'nonce-<16 random bytes, different every request>' 'strict-dynamic'
```

`script-src` has no `'unsafe-inline'` and no `'unsafe-eval'`. `style-src` keeps
`'unsafe-inline'` because Recharts writes `style="…"` attributes on the dashboard's charts and
a style attribute cannot carry a nonce; measured, removing it leaves the dashboard chartless
and changes nothing anywhere else. If a page ever renders blank after a deploy, check the
browser console for a CSP refusal before anything else.

## History

- 2026-09-09 13:58 to 14:03 UTC: PLANNED OUTAGE, 5 min 10 s, the restore-into-production drill ("Backup and restore"). Fresh dump 13:57 (uploaded), Coolify Stop, restore over the live database with `--clean --if-exists --single-transaction` from a throwaway `postgres:16-alpine` on the volume (the built db image is removed by Stop; first attempt failed on that and on a `sudo` glob, both fixed in the procedure), Coolify Start = a full deployment, ready after 2 min 50 s. Counts and migrations identical before and after; the app role held DELETE on `AuditLog` between the restore and the deployment's `sync-app-role`, then `f` again.
- 2026-09-09 (final review, `docs/specs/phase7-review-findings.md`): session cookies renamed `__Host-ern_session`/`__Host-ern_remember`; COOP/CORP headers; every admin page checks its own permission (the shared layout was skippable on an RSC request); the weekly chart applies n<3; heartbeat only after a completed cycle plus the `ALERT_PUSH_URL` push monitor; `AUTH_SECRET`, `AUTH_TRUST_HOST`, `APP_TIMEZONE`, `LOG_LEVEL` dropped as dead configuration.
- 2026-09-09 (Phase 7): `ALERT_EMAIL_MAP` removed — alert recipients are now the users with an email in Admin → Users. CSP moved into `proxy.ts` with a per-request nonce and no `'unsafe-inline'` for scripts. A refused page answers HTTP 403. Installable as a PWA (`/manifest.webmanifest`, `/icons/*`, `/apple-touch-icon.png`, all public). Lighthouse mobile: board 98/100, case editor 96/100 (performance/accessibility). `pnpm audit` clean at moderate and above, with three `pnpm.overrides` pins.
- 2026-09-08: repository, deploy key, DNS record, Coolify application and GitHub push webhook (id 676338800) created. First deploy (commit ac3672f, fingerprint cf6c356bcc69ff4b) verified: migrations applied, seed counts 10/48/16/8/1, app role privileges AuditLog DELETE=f, CaseUpdate DELETE=f, Case DELETE=f, superuser=f; Traefik router Host(nav.towardpcc.com) → app:3000; db on `internal` plus the per-app network.
- 2026-09-08 (later): adversarial review found that Coolify's env file put the owner and admin passwords in the app container (fixed by the entrypoint allowlist), that the seed would overwrite Admin edits (now insert-if-missing), that rotating the app role password would break the app (now reconciled on every deploy), that compose deploys are stop-then-start (documented), and that the Prisma client leaked a pool per query in production (fixed).
- 2026-09-08 23:17 to 23:24 (Riyadh): OUTAGE, about 7 minutes. A scripted documentation edit wrote a NUL and a newline into a comment in `docker/entrypoint.sh`; `sh` then failed with an unterminated quote and the app container crash-looped after a deploy. Fixed by rewriting the file and pushing; CI now runs `sh -n` on every shell script and rejects NUL bytes. Lesson: never patch shell scripts with escape-bearing text through a scripted replace, and parse them before pushing.
