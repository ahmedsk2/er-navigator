#!/bin/sh
# One-shot migration + seed. Runs as the OWNER role inside the `migrate` service.
# Idempotent: prisma migrate deploy applies only pending migrations; the seed upserts.
set -eu
echo "[migrate] prisma migrate deploy"
pnpm exec prisma migrate deploy
echo "[migrate] seed reference lists + first admin"
pnpm exec tsx prisma/seed.ts
echo "[migrate] done"
