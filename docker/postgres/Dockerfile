# Postgres 16 with the first-boot init script baked in, so the compose file needs no bind
# mount (Coolify rewrites relative host paths; a named image does not depend on them).
# Digest captured 2026-09-08.
FROM postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685
COPY docker/postgres-init/01-app-role.sh /docker-entrypoint-initdb.d/01-app-role.sh
RUN chmod 0755 /docker-entrypoint-initdb.d/01-app-role.sh
