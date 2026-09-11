#!/usr/bin/env bash
# The hands-on demo's database (Phase 11): thrown away and brought up fresh, migrated, with the app
# role and the seed. Compose project ernav-demo on port 55450; never the production database.
set -euo pipefail
cd "$(dirname "$0")/.."
export DEV_DB_PORT=55450
docker compose -p ernav-demo -f docker-compose.dev.yml down -v >/dev/null 2>&1
docker compose -p ernav-demo -f docker-compose.dev.yml up -d --wait db >/dev/null 2>&1
OWNER="postgresql://ernav_owner:devowner@localhost:55450/ernav?schema=public"
DATABASE_URL="$OWNER" pnpm exec prisma migrate deploy >/dev/null
DATABASE_URL="$OWNER" APP_DB_USER=ernav_app APP_DB_PASSWORD=devapp pnpm exec tsx prisma/sync-app-role.ts >/dev/null
DATABASE_URL="$OWNER" ADMIN_USERNAME=admin ADMIN_PASSWORD="${DEMO_ADMIN_PASSWORD:-demo-only-admin-password}" ADMIN_DISPLAY_NAME='Demo Admin' pnpm exec tsx prisma/seed.ts | tail -1
