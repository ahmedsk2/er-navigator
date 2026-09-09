-- Phase 8, Slice D: the three collection fields the ED reports ask for and the app did not hold
-- (docs/specs/phase8-brief.md §5, docs/specs/phase8-reports.md "Slice D").
--
--   * Case.ctas            — the triage acuity level, 1..5. Every KPI in the monthly ER Journey
--                            deck and in the national Adaa form is reported per CTAS. Left as a
--                            plain nullable integer: the 1..5 bound is a zod rule
--                            (src/lib/domain/validation.ts), not a CHECK constraint, so a future
--                            level is an Admin decision rather than a migration.
--   * Case.areaId          — the ED area the patient was assigned to, from the new Admin-editable
--                            EdArea list. ON DELETE RESTRICT like every other reference relation:
--                            nothing in this app deletes a reference row, it deactivates it.
--   * CaseInvestigation.preliminaryAt — the verbal/preliminary imaging report, which is what the
--                            ward acts on hours before the official one. Imaging rows only; a LAB
--                            row keeps it null.
--
-- All three columns are nullable with no default, so this is a catalogue-only change on Postgres:
-- no table rewrite, no lock held while rows are read.
--
-- No GRANT here. 20260908190100_app_role_privileges left ALTER DEFAULT PRIVILEGES in place, so a
-- table created by the owner (which is who runs migrations) gives ernav_app CRUD automatically,
-- and prisma/sync-app-role.ts re-applies the same grants on every deploy. EdArea is an ordinary
-- reference list like Ward — not append-only — so there is nothing to revoke on it.
--
-- Generated with `prisma migrate diff --from-schema <the schema before this change>
-- --to-schema prisma/schema.prisma --script` (the shadow database does not work in this
-- repository) and read line by line before being committed.

-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "areaId" TEXT,
ADD COLUMN     "ctas" INTEGER;

-- AlterTable
ALTER TABLE "CaseInvestigation" ADD COLUMN     "preliminaryAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EdArea" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "EdArea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EdArea_code_key" ON "EdArea"("code");

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "EdArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
