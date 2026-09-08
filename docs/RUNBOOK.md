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
| Containers | `db` (postgres:16-alpine, volume `ernav-db`, network `internal` only), `migrate` (one-shot), `app` (:3000, networks `coolify` + `internal`) |
| Probes | `GET /api/health` (liveness + `x-build-fingerprint`), `GET /api/ready` (SELECT 1) |

## DNS rule

`nav.towardpcc.com` stays proxied (orange cloud). The OCI security list accepts 80/443 only from Cloudflare's ranges, so a grey cloud takes the site offline and breaks certificate renewal. This is also what makes trusting `CF-Connecting-IP` safe for rate limiting; opening those ports means changing the rate limiter in the same commit.

## Deploy a change

Merge to `main`. Coolify builds on the host and rolls the new container in after its healthcheck passes; the `migrate` service runs first and a failed migration leaves the old container serving. Builds take roughly 2 to 5 minutes, more when other tenants are building. Then verify by commit, not by tag:

```bash
curl -sI https://nav.towardpcc.com/api/health | grep -i x-build-fingerprint
printf %s "$(git rev-parse HEAD)" | sha256sum | cut -c1-16
curl -s https://nav.towardpcc.com/api/ready
```

Force a redeploy without a push (from the host):

```bash
T=$(cat ~/.coolify-token); curl -s -H "Authorization: Bearer $T" "http://localhost:8000/api/v1/deploy?uuid=jqcjqhmcmizxs1u51wnqlfwv&force=false"
```

Poll `GET /api/v1/deployments/<deployment_uuid>` until `status` is `finished`. Read the deployment log in Coolify when it is not.

## Roll back

Coolify → er-navigator → Deployments → pick the last good deployment → Redeploy. Migrations are forward-only: a schema revert is a new migration.

## Environment variables (Coolify → er-navigator → Environment Variables)

Every key the compose file passes through. Secrets are 48-character alphanumerics (a `$` in a value is interpolated by compose and silently truncated).

| Key | Purpose |
| --- | --- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | database name and OWNER role (migrations, seed). Do not rename the user: the privileges migration names `ernav_owner`/`ernav_app` |
| `APP_DB_USER`, `APP_DB_PASSWORD` | limited runtime role, created on first boot by `docker/postgres-init/01-app-role.sh` |
| `APP_URL`, `APP_TIMEZONE` | `https://nav.towardpcc.com`, `Asia/Riyadh` |
| `AUTH_SECRET` | Auth.js session signing (Phase 1) |
| `ADMIN_USERNAME`, `ADMIN_DISPLAY_NAME`, `ADMIN_PASSWORD` | first ADMIN, created by the seed only if the username does not exist yet |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | threshold alert email (Phase 6). Empty host = log only |
| `LOG_LEVEL` | `info` |

Changing a secret: edit both the production and the preview copy, then a `restart_only` deployment (a plain restart keeps the old environment). Verify with a hash inside the container, never by printing the value:

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

## Backup and restore (Phase 7 completes this)

Planned: `scripts/backup.sh` on the host's daily systemd timer runs `pg_dump` from the `db` container to `/home/ubuntu/backups/ernav/ernav-YYYY-MM-DD.sql.gz`, keeps 30 days locally, uploads to the OCI bucket `coolify-backups` (14-day WORM), which the laptop task `OracleBackupSync` mirrors. A restore drill into a scratch database is part of Gate 7 and is recorded here with its date.

Restore (planned shape):

```bash
gunzip -c ernav-YYYY-MM-DD.sql.gz | sudo docker exec -i "$DB" psql -U ernav_owner -d ernav_restore_test
```

## Add a user

Phase 6 adds Admin → Users. Until then: none; the seed creates the first ADMIN only.

## Monitoring

Uptime Kuma (`uptime.towardpcc.com`): add an HTTP monitor on `https://nav.towardpcc.com/api/ready` expecting `ready` (Phase 7). OCI alarms already cover host down and CPU.

## History

- 2026-09-08: repository, deploy key, DNS record, Coolify application created; Phase 0 scaffold deployed.
