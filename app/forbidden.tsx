import Link from 'next/link'

/**
 * The body of every HTTP 403 this app serves (Phase 7). `requireAction()` calls Next's
 * `forbidden()` after writing the `auth.forbidden` audit row, and Next renders this at status
 * 403: a VIEWER opening /cases/new and a NAVIGATOR opening /export both land here.
 *
 * Deliberately short and role-neutral. The page cannot know which action was refused — Next
 * renders it without arguments — so it says the true thing for all of them and points back at
 * the board, which every signed-in role can read. Being at the root of `app/` it renders inside
 * `app/layout.tsx` only, without the tab bar; that is right for a refusal, and it is also what
 * makes it correct for `/cases/*`, which lives outside the shell group.
 */
export default function Forbidden() {
  return (
    <main className="mx-auto max-w-md p-4 pt-8">
      <h1 className="text-title">Not allowed</h1>
      <p className="mt-3 text-body text-ink-2">
        Your role cannot open this screen. Nothing is wrong with your sign-in, and the attempt has
        been recorded. If you need it, ask an administrator to change your role.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-11 items-center rounded-button border border-line bg-panel px-4 text-body font-semibold text-accent-ink"
      >
        ‹ Board
      </Link>
    </main>
  )
}
