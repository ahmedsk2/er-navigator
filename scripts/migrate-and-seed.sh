#!/bin/sh
# One-shot migration + role reconciliation + seed. Runs as the OWNER role inside the `migrate`
# service before `app` starts. Idempotent: migrate deploy applies only pending migrations, the
# role sync is a set of CREATE-IF-MISSING/ALTER/GRANT statements, the seed only fills empty
# reference tables.
#
# If a migration fails, this exits non-zero, compose does not start `app`, and the site is DOWN
# until the migration is resolved (docs/RUNBOOK.md, "Deploy failed at migrate"). A plain
# redeploy of the previous commit does not recover: Prisma refuses to run with a failed
# migration recorded (P3009) until `prisma migrate resolve` is run.
set -eu
echo "[migrate] prisma migrate status"
pnpm exec prisma migrate status || true
echo "[migrate] prisma migrate deploy"
pnpm exec prisma migrate deploy
echo "[migrate] reconcile the app role"
pnpm exec tsx prisma/sync-app-role.ts
echo "[migrate] seed reference lists + first admin"
pnpm exec tsx prisma/seed.ts
echo "[migrate] done"
