-- Phase 8b: Ahmed's collection decisions (docs/specs/phase8b-decisions.md, "Data model").
--
-- Five new enums, two widened ones and sixteen nullable columns. Nothing is renamed and nothing
-- is dropped: every value Appendix A names is still there, and every existing row is untouched.
--
--   * Disposition += DECEASED, REFERRED_UCC (decision E). LAMA was declined — DAMA covers it.
--   * InvestigationType += MRI (the ED orders them; the app could not record one).
--   * Answer / CaseManagementReferral / CaseManagementCriteria / CaseManagementAction /
--     UpdateAction — the vocabularies decisions B, C, D and F ask for.
--   * Case.painkiller* / pethidine* / sickleCellTreatment — Adaa KPI 8 (decision F).
--   * Case.instructionsGiven, Case.familyEngagement — discharge communication (decision D).
--   * Case.caseMgmt* — the case-management referral, its outcome and its two times (decision B).
--   * Case.reviewedAt / reviewedById — the supervisor review (decision H). ON DELETE RESTRICT
--     like every other relation here: nothing in this app deletes a user.
--   * CaseUpdate.action — the weekly deck's action category, written with the update and never
--     changed afterwards, so the table stays append-only.
--
-- The enum values are added with ALTER TYPE ... ADD VALUE and NOTHING IN THIS MIGRATION USES
-- THEM. PostgreSQL 12 and later allow the ADD VALUE inside the transaction Prisma wraps a
-- migration in, but forbid using the new value in that same transaction; the columns below are
-- all nullable with no default, so none of them does. That also makes every ADD COLUMN a
-- catalogue-only change: no table rewrite, no lock held while rows are read.
--
-- No GRANT here. 20260908190100_app_role_privileges left ALTER DEFAULT PRIVILEGES in place and
-- prisma/sync-app-role.ts re-applies the grants on every deploy; no table is created, so there is
-- nothing new to revoke either — CaseUpdate keeps the UPDATE/DELETE revocation it already has.
--
-- Generated with `prisma migrate diff --from-schema <the schema before this change> --to-schema
-- prisma/schema.prisma --script` (the shadow database does not work in this repository) and read
-- line by line before being committed.

-- CreateEnum
CREATE TYPE "Answer" AS ENUM ('YES', 'NO', 'NOT_SURE');

-- CreateEnum
CREATE TYPE "CaseManagementReferral" AS ENUM ('CASE_MANAGER', 'COMPLEX_CARE');

-- CreateEnum
CREATE TYPE "CaseManagementCriteria" AS ENUM ('MEETS', 'NOT_MEETING');

-- CreateEnum
CREATE TYPE "CaseManagementAction" AS ENUM ('ENROLLED', 'FOR_ENROLLMENT');

-- CreateEnum
CREATE TYPE "UpdateAction" AS ENUM ('LEADERSHIP_ESCALATION', 'BED_MANAGEMENT', 'FAX_RCC', 'PRO_SOCIAL_WORK', 'FORCED_SAFETY_ADMISSION', 'DAMA_MANAGEMENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Disposition" ADD VALUE 'DECEASED';
ALTER TYPE "Disposition" ADD VALUE 'REFERRED_UCC';

-- AlterEnum
ALTER TYPE "InvestigationType" ADD VALUE 'MRI';

-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "caseMgmtAction" "CaseManagementAction",
ADD COLUMN     "caseMgmtCalledAt" TIMESTAMP(3),
ADD COLUMN     "caseMgmtCriteria" "CaseManagementCriteria",
ADD COLUMN     "caseMgmtReferral" "CaseManagementReferral",
ADD COLUMN     "caseMgmtRepliedAt" TIMESTAMP(3),
ADD COLUMN     "familyEngagement" "Answer",
ADD COLUMN     "instructionsGiven" "Answer",
ADD COLUMN     "painkillerAt" TIMESTAMP(3),
ADD COLUMN     "painkillerPrescribed" "Answer",
ADD COLUMN     "pethidineDoseMg" INTEGER,
ADD COLUMN     "pethidinePrescribed" "Answer",
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "sickleCellTreatment" "Answer";

-- AlterTable
ALTER TABLE "CaseUpdate" ADD COLUMN     "action" "UpdateAction";

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
