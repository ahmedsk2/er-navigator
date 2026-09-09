-- Staff work address on the user record (Phase 7). It replaces the ALERT_EMAIL_MAP environment
-- directory: the alerts worker's recipients are now the active SUPERVISOR and ADMIN rows that
-- have an email, read from the database on every cycle.
--
-- Nullable, because nobody has one until an Admin fills it in on Admin → Users, and unique, so
-- two accounts cannot claim the same mailbox. Staff contact data, never a patient's — the PHI
-- rule (locked plan section 3) is about Case, and tests/unit/phi-guard.test.ts still reads only
-- that model.
--
-- No GRANT here: 20260908190100_app_role_privileges already granted ernav_app CRUD on "User"
-- (with DELETE revoked), and a new column on an existing table inherits the table's privileges.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "email" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
