#!/bin/sh
# Entrypoint for the app and the alerts worker containers (they share one image).
#
# Coolify writes EVERY variable set on the application into a .env file and attaches it to every
# compose service (env_file), so the app container would otherwise start with the database
# OWNER password, the admin bootstrap password and every other secret in its environment. Only
# the variables this process needs survive; everything else is unset before the server starts.
#
# Verify on the host by reading the RUNNING process's environment (/proc/1/environ), not with
# `docker exec ... printenv`, which shows the container's configured env and still has everything.
# See docs/RUNBOOK.md, "Deploy a change", for the exact command.
set -eu
KEEP=" DATABASE_URL APP_URL REPORT_HEADER SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD SMTP_FROM ALERT_INTERVAL_MINUTES ALERT_HEARTBEAT_FILE ALERT_PUSH_URL NODE_ENV NODE_OPTIONS PORT HOSTNAME SOURCE_COMMIT PATH HOME TZ NEXT_TELEMETRY_DISABLED "
for name in $(env | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p'); do
  case "$KEEP" in
    *" $name "*) ;;
    *) unset "$name" 2>/dev/null || true ;;
  esac
done
exec dumb-init -- "$@"
