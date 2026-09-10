-- Phase 10 (docs/specs/phase10-delays.md, "Data kit"): the two fields Ahmed asked for on
-- 10 September.
--
--   * Payer — who pays for the visit: GOVERNMENT, INSURED or SELF_PAY (the patient paying).
--     A new type, so it may be used by a column in the same migration (only ADD VALUE on an
--     existing type may not be).
--   * Case.diagnosis — a one-line working diagnosis, free text. The 80-character cap is zod's,
--     as every free-text cap in this app is; the database holds TEXT like the other notes.
--   * Case.payer — nullable, no default.
--
-- Both nullable and without a default: a column that is a catalogue entry until a navigator
-- records it, exactly as ctas and areaId were in Phase 8. Every existing row is untouched.
--
-- No GRANT here: ALTER DEFAULT PRIVILEGES (20260908190100) covers new tables, and
-- prisma/sync-app-role.ts re-applies the app role's grants on every deploy; a new column on an
-- existing table needs neither. Hand-written in the shape `prisma migrate diff` produces (the
-- shadow database does not work in this repository, docs/RUNBOOK.md) and read line by line.
CREATE TYPE "Payer" AS ENUM ('GOVERNMENT', 'INSURED', 'SELF_PAY');

ALTER TABLE "Case" ADD COLUMN     "diagnosis" TEXT,
ADD COLUMN     "payer" "Payer";
