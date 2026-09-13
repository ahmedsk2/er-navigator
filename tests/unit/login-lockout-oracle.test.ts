import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * P16.44, a Phase 1 defect the Phase 16 security review found while it was looking at `/forgot`.
 *
 * `/login` answers "Wrong username or password." for a wrong password, an unknown username and a
 * deactivated account — one message, on purpose, since Phase 1. It answered a LOCKED account
 * differently: "Too many attempts. Try again in 15 minutes." Only a real account can be locked,
 * so ten wrong passwords against a name told you, deterministically and in a handful of requests,
 * whether that name belongs to a member of staff. Every other enumeration control in this
 * application, including the whole of Phase 16, is undone by that one sentence.
 *
 * The fix is the smallest one that removes it: the lock stays, and it stays silent. The service
 * still distinguishes the outcomes, still refuses the sign-in and still writes `auth.locked`, so
 * the record and the runbook are unchanged; the ACTION collapses it, because a difference in the
 * response payload is an oracle whether or not a page renders it. The nurse guide is where a
 * nurse learns that ten wrong passwords means waiting fifteen minutes, and section 1 says so.
 *
 * Read off the source, because a `'use server'` module cannot be imported here. The type is the
 * other half of the guard: with `locked` gone from `LoginErrorCode`, nothing downstream can
 * render it by accident.
 */
const ROOT = path.resolve(__dirname, '../..')
const read = (relative: string): string => readFileSync(path.join(ROOT, relative), 'utf8')

describe('the sign-in form cannot be asked whether an account exists', () => {
  it('gives the action no locked outcome and no minutes to report', () => {
    const actions = read('app/login/actions.ts')

    const codes = /export type LoginErrorCode = ([^\n]+)/.exec(actions)?.[1] ?? ''
    expect(codes, 'the action can still answer "locked"').not.toContain('locked')
    expect(actions, 'the action still returns a locked state').not.toMatch(/error: 'locked'/)
    expect(actions, 'the action still carries the minutes to the page').not.toContain(
      'lockedMinutes:',
    )
  })

  it('leaves the form no lockout sentence to render', () => {
    const form = read('app/login/login-form.tsx')
    expect(form, 'the form still has a locked branch').not.toMatch(/case 'locked'/)
    expect(form, 'the form still names the wait').not.toMatch(/Try again in \$\{/)
    // The generic sentence is what every failed sign-in gets, and it is still there.
    expect(form).toContain('Wrong username or password.')
  })

  /**
   * The lock itself is NOT what was removed. `attemptLogin` still refuses a locked account and
   * still writes the `auth.locked` row, which is what an administrator reads in the audit viewer
   * when somebody says they cannot get in; `tests/db/auth.test.ts` asserts that against a real
   * database. Only the sentence changed.
   */
  it('keeps the lock, and keeps it on the record', () => {
    const service = read('src/lib/auth/login.ts')
    expect(service).toContain("error: 'locked'")
    expect(service).toContain("action: 'auth.locked'")
  })
})
