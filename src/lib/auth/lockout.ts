/**
 * Account lockout (locked plan section 5.1): ten failed logins lock the account for fifteen
 * minutes. Pure functions over dates — the caller owns the User row and the audit rows.
 *
 * The counter is cleared when the lock is applied, so every subsequent lock costs another ten
 * failures. Keeping the counter at ten instead would re-lock on the first attempt after the
 * window and turn a forgotten password into a permanent lockout needing an admin.
 */
export const MAX_FAILED_LOGINS = 10
export const LOCKOUT_MINUTES = 15
export const LOCKOUT_MS = LOCKOUT_MINUTES * 60_000

export type FailureResult = {
  /** The value to store in User.failedLogins. */
  failedLogins: number
  /** The value to store in User.lockedUntil — only when `locked`; otherwise leave the column alone. */
  lockedUntil: Date | null
  locked: boolean
}

export function isLocked(lockedUntil: Date | null | undefined, now: Date): boolean {
  return lockedUntil != null && lockedUntil.getTime() > now.getTime()
}

/** Whole minutes still to wait, rounded up, so the message never reads "0 minutes". */
export function lockMinutesRemaining(lockedUntil: Date | null | undefined, now: Date): number {
  if (!isLocked(lockedUntil, now)) return 0
  return Math.max(1, Math.ceil((lockedUntil!.getTime() - now.getTime()) / 60_000))
}

export function registerFailure(failedLogins: number, now: Date): FailureResult {
  const next = failedLogins + 1
  if (next >= MAX_FAILED_LOGINS) {
    return { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MS), locked: true }
  }
  return { failedLogins: next, lockedUntil: null, locked: false }
}
