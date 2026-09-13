-- Phase 16 (docs/specs/phase16-forgot-password.md): "Forgot your password?", asked for by Ahmed on
-- 13 September 2026 after the host script let him back into the admin account. Two new tables and
-- nothing else: no column of any existing table is added, renamed, retyped or backfilled.
--
--   * PasswordResetToken — one-time reset links. The same shape Session uses and for the same
--     reason: the link carries 32 random bytes and the row carries only sha256 of them, so a
--     database leak cannot be replayed as a reset. `usedAt` means "cannot be used again", spent or
--     superseded, which is what keeps the table free of a delete path. ON DELETE CASCADE from
--     User, like Session: a token is not a clinical record.
--   * Outbox — the mail the app writes and the alerts worker sends. The app INSERTs only; the
--     worker UPDATEs `sentAt`, or `attempts` and `lastError`. prisma/sync-app-role.ts revokes
--     DELETE on it, beside Case, User and Alert.
--
-- Neither table can hold a patient identifier: `Outbox.to` is a member of staff's work address,
-- the same data User.email already holds, and `text` is generated from a template that takes a URL.

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "requestedIp" TEXT,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outbox" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "Outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_createdAt_idx" ON "PasswordResetToken"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX "Outbox_sentAt_createdAt_idx" ON "Outbox"("sentAt", "createdAt");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

