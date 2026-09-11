-- Phase 12 item 6 (readiness audit C1): an alert email that fails is not lost silently.
-- Additive and defaulted. The app role already holds UPDATE on Alert (only DELETE is
-- revoked), so no privilege changes and the CI privilege guard is unaffected.
ALTER TABLE "Alert" ADD COLUMN "emailAttempts" INTEGER NOT NULL DEFAULT 0,
                   ADD COLUMN "emailFailedAt" TIMESTAMP(3);
