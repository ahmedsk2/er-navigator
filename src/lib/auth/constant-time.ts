/**
 * A constant-time envelope for the two public password-reset actions (P16.41, from the security
 * review of 13 September; docs/specs/phase16-forgot-password.md, sections 4 and 6).
 *
 * THE PROBLEM IT SOLVES. `/forgot` answers the same sentence for every outcome, which is the
 * whole point of the page. It answered it at different speeds: about 1 ms for a username nobody
 * has, because the miss path returns before any write, and about 10 ms for one somebody does,
 * because the hit path pays for a transaction. Over HTTP the reviewer measured p50 13.7 ms
 * against 22.8 ms. One sentence read at two speeds is still two answers, and a public form that
 * can be asked whether a member of staff exists is the thing this page was built not to be.
 *
 * THE SHAPE OF THE ANSWER is `/login`'s, which has since Phase 1 run a bcrypt comparison against
 * a dummy hash for a username nobody has, so that the fast path costs what the slow one costs.
 * What differs here is that these actions' cost is database round trips, and there is no dummy
 * transaction worth running: so the padding is wall clock, measured from entry and awaited before
 * anything is returned or thrown.
 *
 * A FLOOR, NOT A FIXED DURATION. Work that already outlasted the floor is answered the moment it
 * finishes. Padding every answer to the worst case would mean holding a nurse's form for as long
 * as the slowest database call this page has ever made, to hide a difference that is already
 * below the noise of the network by then. What the floor removes is the reliable, repeatable gap
 * between "nothing happened" and "a row was written".
 *
 * IT PADS A THROW TOO. `/reset` finishes with `redirect()`, which Next implements by throwing, so
 * the one outcome that means "the password changed" would otherwise be the one outcome with a
 * different shape on the clock. The pad is in a `finally`.
 *
 * Pure and injectable, with no Next and no Prisma, so the rule is asserted with fake timers in
 * `__tests__/constant-time.test.ts` rather than against whatever the machine was doing.
 */

/**
 * Three hundred milliseconds: comfortably above every measurement the review took of either path
 * (the slowest, the hit path over HTTP, was 22.8 ms at p50), and far below what a person notices
 * on a form they have just pressed a button on.
 */
export const RESET_RESPONSE_FLOOR_MS = 300

export type ConstantTimeDeps = {
  /** Defaults to `RESET_RESPONSE_FLOOR_MS`. */
  floorMs?: number
  /** Defaults to `Date.now`. */
  now?: () => number
  /** Defaults to `setTimeout`. */
  sleep?: (ms: number) => Promise<void>
}

const realSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * Run `work`, and do not let its result — or its exception — out before `floorMs` have passed
 * since this was called.
 */
export async function withConstantTimeFloor<T>(
  work: () => Promise<T>,
  deps: ConstantTimeDeps = {},
): Promise<T> {
  const floorMs = deps.floorMs ?? RESET_RESPONSE_FLOOR_MS
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? realSleep
  const started = now()
  try {
    return await work()
  } finally {
    const remaining = floorMs - (now() - started)
    if (remaining > 0) await sleep(remaining)
  }
}
