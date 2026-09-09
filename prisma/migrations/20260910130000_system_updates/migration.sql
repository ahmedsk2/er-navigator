-- Phase 8b review, finding C2 (docs/specs/phase8b-decisions.md, "Data model").
--
-- `CaseUpdate.system` marks the rows the application appends on its own: the "Resolved: …",
-- "Reopened" and "Voided: …" notes the case service writes at those transitions, and the
-- "Reached Nh threshold" notes the alerts worker writes as the `system` user. The figures over
-- what the navigators documented (the dashboard's "Actions documented" panel, its "Update without
-- an action tag" and "No action documented" rows) count operator notes only. Without the flag
-- every resolved case looked documented, because its own resolve note carried no tag.
--
-- The backfill is the one UPDATE this table sees: it runs once, here, as the migration owner, and
-- marks only the rows the application itself is known to have written — the system user's, and
-- the three fixed transition texts. The app role keeps its UPDATE/DELETE revocation on the table;
-- nothing about the grants changes.
ALTER TABLE "CaseUpdate" ADD COLUMN     "system" BOOLEAN NOT NULL DEFAULT false;

UPDATE "CaseUpdate"
SET "system" = true
WHERE "authorId" IN (SELECT "id" FROM "User" WHERE "username" = 'system')
   OR "text" LIKE 'Resolved: %'
   OR "text" = 'Reopened'
   OR "text" LIKE 'Voided: %';
