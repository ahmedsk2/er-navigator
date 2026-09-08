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
| Containers | `db` (postgres:16-alpine with the init script baked in; volume `jqcjqhmcmizxs1u51wnqlfwv_ernav-db`; networks `internal` and the Coolify per-app network `jqcjqhmcmizxs1u51wnqlfwv`, which only `coolify-proxy` also joins), `migrate` (one-shot, exits 0), `app` (:3000; networks `coolify`, `internal` and the per-app network) |
| Probes | `GET /api/health` (liveness + `x-build-fingerprint`), `GET /api/ready` (SELECT 1) |

## DNS rule

`nav.towardpcc.com` stays proxied (orange cloud). The OCI security list accepts 80/443 only from Cloudflare's ranges, so a grey cloud takes the site offline and breaks certificate renewal. This is also what makes trusting `CF-Connecting-IP` safe for rate limiting; opening those ports means changing the rate limiter in the same commit.

## Deploy a change

Merge to `main`, outside shift change. Coolify builds on the host (roughly 2 to 5 minutes, more when other tenants are building), then STOPS AND REMOVES every container of this application and starts the new set: `db`, then `migrate`, then `app`. There is no rolling update for compose applications; the site returns 404 for about a minute (db healthcheck, migrate, app start, first health probe). If `migrate` exits non-zero, `app` is not started and the site stays down: see "Deploy failed at migrate" below. Then verify by commit, not by tag, and confirm the app container carries no owner secrets:

```bash
curl -sI https://nav.towardpcc.com/api/health | grep -i x-build-fingerprint
printf %s "$(git rev-parse HEAD)" | sha256sum | cut -c1-16
curl -s https://nav.towardpcc.com/api/ready
# on the host: must print nothing (the entrypoint strips every variable not on its allowlist)
APP=$(sudo docker ps --format '{{.Names}}' | grep '^app-jqcjqhmcmizxs1u51wnqlfwv'); sudo docker exec "$APP" printenv POSTGRES_PASSWORD ADMIN_PASSWORD
```

Force a redeploy without a push (from the host):

```bash
T=$(cat ~/.coolify-token); curl -s -H "Authorization: Bearer $T" "http://localhost:8000/api/v1/deploy?uuid=jqcjqhmcmizxs1u51wnqlfwv&force=false"
```

Poll `GET /api/v1/deployments/<deployment_uuid>` until `status` is `finished`. Read the deployment log in Coolify when it is not.

## Roll back

Coolify → er-navigator → Deployments → pick the last good deployment → Redeploy. Migrations are forward-only: a schema revert is a new migration. If the failure was in `migrate`, do the section below first; Redeploy alone fails at the same step.

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
| `APP_URL`, `APP_TIMEZONE` | `https://nav.towardpcc.com`, `Asia/Riyadh` |
| `AUTH_SECRET` | Auth.js session signing (Phase 1) |
| `ADMIN_USERNAME`, `ADMIN_DISPLAY_NAME`, `ADMIN_PASSWORD` | first ADMIN, created by the seed only if the username does not exist yet |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | threshold alert email (Phase 6). Empty host = log only |
| `LOG_LEVEL` | `info` |

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
sudo docker exec "$CID" sh -c 'printenv AUTH_SECRET | sha256sum | cut -c1-8'
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

## Backup and restore (install at Gate 1, before the first real case)

`scripts/backup.sh` (in the repository) runs `pg_dump` in custom format from the `db` container to `/home/ubuntu/backups/ernav/ernav-YYYY-MM-DD-HHMM.dump`, keeps 30 days locally, and uploads through `UPLOAD_CMD` when one is configured (target: the OCI bucket `coolify-backups`, 14-day WORM, mirrored by the laptop task `OracleBackupSync`). Install it as `ernav-backup.timer` (daily, 02:30 UTC) the same way `towardpcc-canary.timer` is installed; record the install date and the first restore drill here.

Data-volume guard rails: the Coolify server setting "Delete unused volumes" must stay OFF (it is), and deleting the application in Coolify deletes `jqcjqhmcmizxs1u51wnqlfwv_ernav-db` unless the volumes box is unticked. Every deploy removes and recreates the db container; the volume persists.

Restore drill (scratch database, never over production):

```bash
DB=$(sudo docker ps --format '{{.Names}}' | grep '^db-jqcjqhmcmizxs1u51wnqlfwv')
sudo docker exec "$DB" createdb -U ernav_owner ernav_restore_test
sudo docker exec -i "$DB" pg_restore -U ernav_owner -d ernav_restore_test --no-owner < /home/ubuntu/backups/ernav/<file>.dump
sudo docker exec "$DB" psql -U ernav_owner -d ernav_restore_test -tAc 'SELECT count(*) FROM "Case"'
sudo docker exec "$DB" dropdb -U ernav_owner ernav_restore_test
```

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

## Add a user

Phase 6 adds Admin → Users. Until then: none; the seed creates the first ADMIN only.

## Monitoring

Uptime Kuma (`uptime.towardpcc.com`): add an HTTP monitor on `https://nav.towardpcc.com/api/ready` expecting `ready` (Phase 7). OCI alarms already cover host down and CPU.

## History

- 2026-09-08: repository, deploy key, DNS record, Coolify application and GitHub push webhook (id 676338800) created. First deploy (commit ac3672f, fingerprint cf6c356bcc69ff4b) verified: migrations applied, seed counts 10/48/16/8/1, app role privileges AuditLog DELETE=f, CaseUpdate DELETE=f, Case DELETE=f, superuser=f; Traefik router Host(nav.towardpcc.com) → app:3000; db on `internal` plus the per-app network.
- 2026-09-08 (later): adversarial review found that Coolify's env file put the owner and admin passwords in the app container (fixed by the entrypoint allowlist), that the seed would overwrite Admin edits (now insert-if-missing), that rotating the app role password would break the app (now reconciled on every deploy), that compose deploys are stop-then-start (documented), and that the Prisma client leaked a pool per query in production (fixed).
