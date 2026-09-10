/**
 * Whether the page in the browser was rendered by an older build than the one now serving.
 *
 * Every deploy replaces the containers, and a Server Action id from the previous build is unknown
 * to the new one: a form submitted from a screen that stayed open across the deploy fails with
 * "Failed to find Server Action" and lands on the error boundary with nothing in the audit log
 * (10 September: the login page, open since before the morning's deploy). The root layout stamps
 * `<html data-build>` with the server's fingerprint, the boundary asks /api/health for the live
 * one, and reloads when they differ. Unknown on either side is not evidence, so it never reloads.
 */
export function isStaleBuild(pageBuild: string | null | undefined, liveBuild: string | null | undefined): boolean {
  const page = (pageBuild ?? '').trim()
  const live = (liveBuild ?? '').trim()
  return page !== '' && live !== '' && page !== live
}
