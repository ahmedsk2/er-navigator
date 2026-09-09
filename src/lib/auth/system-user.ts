/**
 * The `system` account: the author of the CaseUpdate the alerts worker appends and the actor on
 * its `alert.fire` audit rows (locked plan section 6). Phase 8's importer will open cases as it.
 *
 * It is seeded `active = false` with a random password nobody holds, so it can never sign in —
 * `getSession()` rejects an inactive user and `resolveSessionToken()` deletes the session on the
 * spot. Admin refuses every change to it for the same reason: reactivating a shared account with
 * an unknown password is not a thing an administrator should be able to do by accident.
 *
 * Constants only, so `prisma/seed.ts`, the worker and the admin screens can all import it
 * without pulling in a database client.
 */
export const SYSTEM_USERNAME = 'system'
export const SYSTEM_DISPLAY_NAME = 'System'

export function isSystemAccount(username: string): boolean {
  return username === SYSTEM_USERNAME
}
