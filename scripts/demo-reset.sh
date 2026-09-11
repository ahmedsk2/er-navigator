#!/usr/bin/env bash
# The hands-on demo's database (Phase 11): thrown away and brought up fresh, migrated, with the app
# role and the seed. Compose project ernav-demo on port 55450; never the production database.
#
# Phase 12 item 2 (readiness audit D3). This script's first act is `down -v`, which destroys a
# volume. It was safe only because it never named production, which is not a guarantee — an edit
# to $OWNER or a $DEV_DB_PORT from the environment could repoint it, and one run against the live
# database would be permanent: the audit log is append-only and a case can only be voided.
#
# So it refuses unless BOTH of these hold, and says which one failed:
#   1. the owner URL it is about to use names a loopback host (localhost or 127.0.0.1) — the URL
#      itself is tested with a `case` pattern, never echoed, so no password reaches a log; OR
#      INSTANCE_LABEL is set and non-empty, which is how a labelled demo instance identifies
#      itself (src/lib/demo-guard.ts states the same rule for the TypeScript callers);
#   2. DEV_DB_PORT has not been pointed at the production Postgres port.
set -euo pipefail
cd "$(dirname "$0")/.."

DEV_DB_PORT="${DEV_DB_PORT:-55450}"
if [ "$DEV_DB_PORT" = "5432" ]; then
  echo "[demo-reset] refusing: DEV_DB_PORT is 5432, the production Postgres port." >&2
  exit 1
fi
export DEV_DB_PORT

OWNER="postgresql://ernav_owner:devowner@localhost:${DEV_DB_PORT}/ernav?schema=public"
case "$OWNER" in
  *localhost*|*127.0.0.1*) ;;
  *)
    if [ -z "${INSTANCE_LABEL:-}" ]; then
      echo "[demo-reset] refusing: the target is not loopback and INSTANCE_LABEL is not set." >&2
      exit 1
    fi
    ;;
esac

docker compose -p ernav-demo -f docker-compose.dev.yml down -v >/dev/null 2>&1
docker compose -p ernav-demo -f docker-compose.dev.yml up -d --wait db >/dev/null 2>&1
DATABASE_URL="$OWNER" pnpm exec prisma migrate deploy >/dev/null
DATABASE_URL="$OWNER" APP_DB_USER=ernav_app APP_DB_PASSWORD=devapp pnpm exec tsx prisma/sync-app-role.ts >/dev/null
DATABASE_URL="$OWNER" ADMIN_USERNAME=admin ADMIN_PASSWORD="${DEMO_ADMIN_PASSWORD:-demo-only-admin-password}" ADMIN_DISPLAY_NAME='Demo Admin' pnpm exec tsx prisma/seed.ts | tail -1
