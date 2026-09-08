-- Runtime privileges for the limited app role (ernav_app). Migrations run as the owner
-- (POSTGRES_USER, ernav_owner), so this is where table-level rights are set once the tables
-- exist. Guarded: a local database without the role (plain dev Postgres) migrates cleanly.
--
-- The role names are fixed by docker/postgres-init/01-app-role.sh and the compose defaults.
-- Renaming APP_DB_USER without updating this migration leaves the app with no privileges,
-- which fails loudly at first query rather than silently widening access.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ernav_app') THEN
    GRANT USAGE ON SCHEMA public TO ernav_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ernav_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ernav_app;

    -- Append-only at the database level (locked plan sections 3 and 4).
    REVOKE UPDATE, DELETE ON "AuditLog" FROM ernav_app;
    REVOKE UPDATE, DELETE ON "CaseUpdate" FROM ernav_app;

    -- Never deleted: cases are voided, users are deactivated, alerts are acknowledged.
    REVOKE DELETE ON "Case" FROM ernav_app;
    REVOKE DELETE ON "User" FROM ernav_app;
    REVOKE DELETE ON "Alert" FROM ernav_app;

    -- Migration bookkeeping belongs to the owner.
    REVOKE ALL ON "_prisma_migrations" FROM ernav_app;

    -- Tables and sequences created by later migrations (run by this same owner role)
    -- receive CRUD automatically; any new append-only table gets its own REVOKE.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ernav_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ernav_app;
  END IF;
END $$;
