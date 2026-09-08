#!/bin/sh
# Runs ONCE, on first initialisation of the data volume (postgres image convention).
# Creates the limited runtime role. Table privileges are granted by a Prisma migration
# (they need the tables to exist), so this script only creates the login.
set -eu
: "${APP_DB_USER:?APP_DB_USER is required}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE "$APP_DB_USER" LOGIN PASSWORD '$APP_DB_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO "$APP_DB_USER";
GRANT USAGE ON SCHEMA public TO "$APP_DB_USER";
SQL
