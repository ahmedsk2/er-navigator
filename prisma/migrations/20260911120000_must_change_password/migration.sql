-- Phase 12 item 5 (readiness audit P12): force the first password to be changed.
-- Additive and defaulted, so every existing row reads false and no deploy locks the live admin
-- or the seeded `system` account out of the board.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
