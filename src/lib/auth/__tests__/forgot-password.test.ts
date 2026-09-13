/**
 * Phase 16 (docs/specs/phase16-forgot-password.md, sections 4 and 5) against fake stores — the
 * `PasswordResetStore` pattern P15.63 uses and the `AlertStore` pattern before it.
 *
 * The two rules that carry the security of this feature are asserted here, with no database and
 * no browser: `/forgot` answers the same sentence whatever it decides, and it writes nothing at
 * all unless the account exists, is active, has an address and has not already asked three times
 * this hour. The Prisma half — that those really are the rows written, in one transaction — is
 * tests/db/forgot-password.test.ts.
 */
import bcrypt from 'bcryptjs'
import { describe, expect, it } from 'vitest'
import {
  buildResetEmail,
  completePasswordReset,
  requestPasswordReset,
  resetLink,
  RESET_EMAIL_SUBJECT,
  RESET_REQUESTED_AUDIT_AFTER,
  RESET_REQUESTED_MESSAGE,
  type CompleteResetStore,
  type ForgotPasswordStore,
  type IssueResetInput,
  type ResetTokenLookup,
} from '../forgot-password'
import type { ApplyResetInput, PasswordResetStore } from '../password-reset'
import { hashResetToken, RESET_REQUESTS_PER_HOUR, RESET_TOKEN_TTL_MINUTES } from '../reset-token'

const NOW = new Date('2026-09-13T10:00:00.000Z')
const APP_URL = 'https://nav.towardpcc.com'

type Account = { id: string; email: string }

class FakeRequestStore implements ForgotPasswordStore {
  issued: IssueResetInput[] = []
  recentRequests = 0
  constructor(private readonly accounts: Record<string, Account> = {}) {}

  async findTarget(username: string): Promise<Account | null> {
    return this.accounts[username] ?? null
  }

  async countRequestsSince(): Promise<number> {
    return this.recentRequests
  }

  async issue(input: IssueResetInput): Promise<void> {
    this.issued.push(input)
  }
}

const withAccount = (): FakeRequestStore =>
  new FakeRequestStore({ 'demo.lead': { id: 'user-1', email: 'demo.lead@demo.invalid' } })

const ask = (store: ForgotPasswordStore, username: string, token = 'TOKEN-FOR-THE-TEST') =>
  requestPasswordReset(username, '203.0.113.9', { store, appUrl: APP_URL, now: NOW, newToken: () => token })

describe('the sentence /forgot always answers with', () => {
  it('names the thirty minutes the token actually lasts, and no account', () => {
    expect(RESET_REQUESTED_MESSAGE).toBe(
      `If that account has an email, a link is on its way. It works for ${RESET_TOKEN_TTL_MINUTES} minutes.`,
    )
  })

  it('is the same for a good account, an unknown one, an inactive one and one with no email', async () => {
    const good = withAccount()
    const empty = new FakeRequestStore()
    const answers = [await ask(good, 'demo.lead'), await ask(empty, 'nobody.at.all')]
    for (const answer of answers) expect(answer.message).toBe(RESET_REQUESTED_MESSAGE)
    // The store is what decides "active, and has an address": `findTarget` returns null for all
    // three, which is why they are one case here and three columns in the database test.
    expect(good.issued).toHaveLength(1)
    expect(empty.issued).toHaveLength(0)
  })

  it('is the same for the fourth request within the hour, which writes nothing', async () => {
    const store = withAccount()
    store.recentRequests = RESET_REQUESTS_PER_HOUR
    const answer = await ask(store, 'demo.lead')
    expect(answer.message).toBe(RESET_REQUESTED_MESSAGE)
    expect(answer.issued).toBe(false)
    expect(store.issued).toEqual([])
  })

  it('still issues the third', async () => {
    const store = withAccount()
    store.recentRequests = RESET_REQUESTS_PER_HOUR - 1
    expect((await ask(store, 'demo.lead')).issued).toBe(true)
  })

  it('lower-cases and trims the username the way the sign-in form does', async () => {
    const store = withAccount()
    expect((await ask(store, '  DEMO.LEAD  ')).issued).toBe(true)
  })

  it('answers the same sentence for a username the schema refuses outright', async () => {
    const store = withAccount()
    const answer = await ask(store, '')
    expect(answer.message).toBe(RESET_REQUESTED_MESSAGE)
    expect(store.issued).toEqual([])
  })
})

describe('what /forgot writes when it does issue', () => {
  it('stores the digest and puts the raw token only in the mail', async () => {
    const store = withAccount()
    const token = 'a-token-nobody-else-has'
    await ask(store, 'demo.lead', token)

    const issued = store.issued[0]!
    expect(issued.tokenHash).toBe(hashResetToken(token))
    expect(issued.tokenHash).not.toContain(token)
    expect(issued.userId).toBe('user-1')
    expect(issued.email).toBe('demo.lead@demo.invalid')
    expect(issued.requestedIp).toBe('203.0.113.9')
    expect(issued.expiresAt.toISOString()).toBe('2026-09-13T10:30:00.000Z')
    // The one place the raw token appears.
    expect(issued.text).toContain(token)
    expect(JSON.stringify({ ...issued, text: '' })).not.toContain(token)
  })

  it('writes an audit payload that says only that a link was asked for', () => {
    expect(RESET_REQUESTED_AUDIT_AFTER).toEqual({ requested: true })
    const json = JSON.stringify(RESET_REQUESTED_AUDIT_AFTER)
    for (const leak of ['token', 'hash', 'email', 'username', '@']) expect(json).not.toContain(leak)
  })
})

describe('the email', () => {
  const token = 'a-token-nobody-else-has'
  const body = buildResetEmail(resetLink(APP_URL, token))

  it('is the subject Ahmed will look for in a mailbox', () => {
    expect(body.subject).toBe(RESET_EMAIL_SUBJECT)
    expect(RESET_EMAIL_SUBJECT).toBe('ER Navigator password reset')
  })

  it('carries the link, the thirty minutes and the sentence for whoever did not ask', () => {
    expect(body.text).toContain(`${APP_URL}/reset?token=${token}`)
    expect(body.text).toContain(`${RESET_TOKEN_TTL_MINUTES} minutes`)
    expect(body.text).toContain('If you did not ask for this, ignore it.')
  })

  it('names no account: not the username, not the display name, not the address', () => {
    expect(body.text.toLowerCase()).not.toContain('demo.lead')
    expect(body.text).not.toContain('@')
    expect(body.text).not.toMatch(/\bMRN\b/)
  })

  it('drops a trailing slash on APP_URL rather than doubling it', () => {
    expect(resetLink('https://demo-nav.towardpcc.com/', 'x')).toBe(
      'https://demo-nav.towardpcc.com/reset?token=x',
    )
  })
})

// --- /reset -------------------------------------------------------------------------------

class FakePasswordStore implements PasswordResetStore {
  applied: ApplyResetInput[] = []
  signedOut: string[] = []
  async apply(input: ApplyResetInput): Promise<void> {
    this.applied.push(input)
  }
  async deleteSessions(userId: string): Promise<number> {
    this.signedOut.push(userId)
    return 2
  }
}

class FakeCompleteStore implements CompleteResetStore {
  readonly passwords = new FakePasswordStore()
  used: string[] = []
  actors: string[] = []
  constructor(private readonly row: ResetTokenLookup | null) {}

  async findToken(tokenHash: string): Promise<ResetTokenLookup | null> {
    return this.row && this.row.tokenHash === tokenHash ? this.row : null
  }
  async markTokenUsed(tokenId: string): Promise<void> {
    this.used.push(tokenId)
  }
  passwordStore(actorId: string): PasswordResetStore {
    this.actors.push(actorId)
    return this.passwords
  }
}

const TOKEN = 'the-token-in-the-link'
const liveRow = (overrides: Partial<ResetTokenLookup> = {}): ResetTokenLookup => ({
  id: 'token-1',
  tokenHash: hashResetToken(TOKEN),
  expiresAt: new Date(NOW.getTime() + 60_000),
  usedAt: null,
  user: { id: 'user-1', username: 'demo.lead', active: true },
  ...overrides,
})

const complete = (store: CompleteResetStore, token = TOKEN, password = 'a-password-only-they-know') =>
  completePasswordReset({ store, token, newPassword: password, now: NOW })

describe('completePasswordReset', () => {
  it('sets the password through the shared port, signs every device out and spends the token', async () => {
    const store = new FakeCompleteStore(liveRow())
    const chosen = 'a-password-only-they-know'
    const outcome = await complete(store, TOKEN, chosen)

    expect(outcome).toEqual({ ok: true, userId: 'user-1', sessionsDeleted: 2 })
    expect(store.actors).toEqual(['user-1'])
    const applied = store.passwords.applied[0]!
    expect(applied.origin).toEqual({ by: 'email' })
    expect(await bcrypt.compare(chosen, applied.passwordHash)).toBe(true)
    expect(store.passwords.signedOut).toEqual(['user-1'])
    // The token is spent AFTER the password is written: a crash between the two leaves a live
    // link and a changed password, never a spent link and the old password.
    expect(store.used).toEqual(['token-1'])
  })

  it('refuses a token that is not in the table', async () => {
    const store = new FakeCompleteStore(null)
    expect(await complete(store)).toEqual({ ok: false, error: 'invalid' })
    expect(store.passwords.applied).toEqual([])
  })

  it('refuses a used token and an expired token with the same answer', async () => {
    for (const row of [
      liveRow({ usedAt: new Date(NOW.getTime() - 1000) }),
      liveRow({ expiresAt: new Date(NOW.getTime() - 1000) }),
    ]) {
      const store = new FakeCompleteStore(row)
      expect(await complete(store)).toEqual({ ok: false, error: 'invalid' })
      expect(store.passwords.applied).toEqual([])
      expect(store.used).toEqual([])
    }
  })

  it('refuses a token whose account has since been deactivated', async () => {
    const store = new FakeCompleteStore(liveRow({ user: { id: 'user-1', username: 'demo.lead', active: false } }))
    expect(await complete(store)).toEqual({ ok: false, error: 'invalid' })
    expect(store.passwords.applied).toEqual([])
  })

  it('refuses a token that was never issued, without touching the one that was', async () => {
    const store = new FakeCompleteStore(liveRow())
    expect(await complete(store, 'a-token-somebody-guessed')).toEqual({ ok: false, error: 'invalid' })
    expect(store.used).toEqual([])
  })
})
