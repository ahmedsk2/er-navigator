/**
 * Reconcile the limited runtime role on every deploy. Operator script, run by the `migrate`
 * service as the OWNER role after `prisma migrate deploy` (scripts/migrate-and-seed.sh).
 *
 * Why it exists: the Postgres image runs docker/postgres-init/01-app-role.sh only when the data
 * volume is first initialised, so without this step rotating APP_DB_PASSWORD in Coolify would
 * change the app's connection string but not the role's password, and the app would fail every
 * query while /api/health stayed green. This script makes "change it in Coolify, redeploy" true:
 * it creates the role if it is missing, sets its password to the current value, and re-applies
 * the same privileges the 20260908190100_app_role_privileges migration granted (that migration
 * stays as the historical record; this is the reconciler).
 *
 * This is the one place outside the readiness probe that issues raw SQL, because role and grant
 * statements are DDL Prisma has no API for. The role name is validated against a strict
 * identifier pattern and the password is escaped as a SQL literal.
 */
import { prisma } from '../src/lib/db'

async function main() {
  const user = process.env.APP_DB_USER?.trim()
  const password = process.env.APP_DB_PASSWORD
  if (!user || !password) {
    console.log('[sync-app-role] APP_DB_USER / APP_DB_PASSWORD not set — skipping')
    return
  }
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(user)) throw new Error(`[sync-app-role] refusing role name "${user}"`)
  const literal = password.replace(/'/g, "''")
  const rows = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`
  const db = rows[0]?.db
  if (!db) throw new Error('[sync-app-role] could not read current_database()')

  const statements = [
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${user}') THEN EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE', '${user}'); END IF; END $$`,
    `ALTER ROLE "${user}" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${literal}'`,
    `GRANT CONNECT ON DATABASE "${db}" TO "${user}"`,
    `GRANT USAGE ON SCHEMA public TO "${user}"`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${user}"`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${user}"`,
    // Append-only and never-deleted tables (locked plan sections 3 and 4).
    `REVOKE UPDATE, DELETE ON "AuditLog" FROM "${user}"`,
    `REVOKE UPDATE, DELETE ON "CaseUpdate" FROM "${user}"`,
    `REVOKE DELETE ON "Case" FROM "${user}"`,
    `REVOKE DELETE ON "User" FROM "${user}"`,
    `REVOKE DELETE ON "Alert" FROM "${user}"`,
    `REVOKE ALL ON "_prisma_migrations" FROM "${user}"`,
  ]
  for (const sql of statements) await prisma.$executeRawUnsafe(sql)
  console.log(`[sync-app-role] role "${user}" reconciled on database "${db}"`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
