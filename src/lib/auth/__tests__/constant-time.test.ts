/**
 * P16.41, raised by the security review of 13 September and confirmed by all three refuters.
 *
 * `/forgot` answers one sentence whatever it decides, which is the whole point of the page — and
 * it answered it in about 1 ms for a username nobody has and about 10 ms for one somebody does,
 * because the miss path returned before the database write the hit path pays for. Over HTTP the
 * reviewer measured p50 13.7 ms against 22.8 ms, which is a clean read of whether a member of
 * staff exists from a form that exists to reveal nothing.
 *
 * The answer is the one `/login` has used since Phase 1, where a username nobody has is still
 * put through a bcrypt comparison against a dummy hash: make the cheap path pay. Here the floor
 * is a wall-clock envelope around the whole action rather than one fake computation, because
 * these actions' costs are database round trips and there is no dummy transaction to run.
 *
 * Fake timers, so this asserts the rule rather than the machine it runs on.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RESET_RESPONSE_FLOOR_MS, withConstantTimeFloor } from '../constant-time'

const ROOT = path.resolve(__dirname, '../../../..')

afterEach(() => {
  vi.useRealTimers()
})

/** Resolves when the promise settles, without ever letting a rejection escape unhandled. */
function watch<T>(promise: Promise<T>): { settled: () => boolean; outcome: Promise<unknown> } {
  let done = false
  const outcome = promise.then(
    (value) => {
      done = true
      return { ok: true, value }
    },
    (error: unknown) => {
      done = true
      return { ok: false, error }
    },
  )
  return { settled: () => done, outcome }
}

describe('the floor itself', () => {
  it('is the number both actions are held to', () => {
    expect(RESET_RESPONSE_FLOOR_MS).toBe(300)
  })
})

describe('withConstantTimeFloor', () => {
  it('does not answer before the floor, however little the work cost', async () => {
    vi.useFakeTimers()
    const run = watch(withConstantTimeFloor(async () => 'the same sentence'))

    await vi.advanceTimersByTimeAsync(RESET_RESPONSE_FLOOR_MS - 1)
    expect(run.settled(), 'the miss path answered early').toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(run.settled()).toBe(true)
    expect(await run.outcome).toEqual({ ok: true, value: 'the same sentence' })
  })

  it('does not answer before the floor when the work cost most of it either', async () => {
    vi.useFakeTimers()
    const run = watch(
      withConstantTimeFloor(async () => {
        await new Promise((resolve) => setTimeout(resolve, 120))
        return 'the same sentence'
      }),
    )

    await vi.advanceTimersByTimeAsync(RESET_RESPONSE_FLOOR_MS - 1)
    expect(run.settled(), 'the hit path answered early').toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(run.settled()).toBe(true)
  })

  it('never makes an answer later than the work already made it', async () => {
    vi.useFakeTimers()
    const run = watch(
      withConstantTimeFloor(async () => {
        await new Promise((resolve) => setTimeout(resolve, RESET_RESPONSE_FLOOR_MS + 500))
        return 'slow'
      }),
    )

    // A floor, not a fixed duration: a database that took longer than 300 ms is answered as soon
    // as it comes back, because padding to a constant would mean padding to the worst case.
    await vi.advanceTimersByTimeAsync(RESET_RESPONSE_FLOOR_MS + 500)
    expect(run.settled()).toBe(true)
    expect(await run.outcome).toEqual({ ok: true, value: 'slow' })
  })

  /**
   * `/reset` ends in `redirect()`, which Next implements by throwing. If the floor let a throw
   * past without padding it, the one outcome that means "the password changed" would be the one
   * outcome with a different shape on the clock.
   */
  it('holds a throw to the floor as well, which is what a redirect is', async () => {
    vi.useFakeTimers()
    const boom = new Error('NEXT_REDIRECT')
    const run = watch(
      withConstantTimeFloor(async () => {
        throw boom
      }),
    )

    await vi.advanceTimersByTimeAsync(RESET_RESPONSE_FLOOR_MS - 1)
    expect(run.settled(), 'the redirect escaped the envelope').toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(await run.outcome).toEqual({ ok: false, error: boom })
  })

  it('takes its own clock and sleeper, so a caller can hold it to a different number', async () => {
    const slept: number[] = []
    let clock = 1_000
    const value = await withConstantTimeFloor(
      async () => {
        clock += 40
        return 'done'
      },
      {
        floorMs: 100,
        now: () => clock,
        sleep: async (ms) => {
          slept.push(ms)
        },
      },
    )
    expect(value).toBe('done')
    expect(slept).toEqual([60])
  })

  /**
   * The envelope is only worth anything if it is around the WHOLE action, including the early
   * returns: a rate-limit refusal that answers in a microsecond is as good a signal as a miss.
   * Read off the source, because there is no way to import a `'use server'` module here.
   */
  it('is around the whole of both public actions, early returns included', () => {
    for (const relative of ['app/forgot/actions.ts', 'app/reset/actions.ts']) {
      const source = readFileSync(path.join(ROOT, relative), 'utf8')
      expect(source, `${relative} does not import the floor`).toContain(
        "from '@/src/lib/auth/constant-time'",
      )
      // The wrap is the first statement of the exported action, so nothing runs outside it.
      expect(source, `${relative} does not open its action with the floor`).toMatch(
        /export async function \w+\([^)]*\)[^{]*\{\n\s*return withConstantTimeFloor\(async \(\) => \{/,
      )
    }
  })

  it('sleeps for nothing at all when the work already outlasted the floor', async () => {
    const slept: number[] = []
    let clock = 0
    await withConstantTimeFloor(
      async () => {
        clock += 900
      },
      { floorMs: 300, now: () => clock, sleep: async (ms) => void slept.push(ms) },
    )
    expect(slept).toEqual([])
  })
})
