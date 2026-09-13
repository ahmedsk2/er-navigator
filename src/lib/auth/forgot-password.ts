/**
 * "Forgot your password?" (Phase 16, docs/specs/phase16-forgot-password.md; Ahmed, 13 September
 * 2026, the day the host script let him back into the admin account).
 *
 * Two flows, both behind ports, for the reason `password-reset.ts` and `alerts/cycle.ts` are:
 * everything that decides anything is here and is asserted against fakes in the unit suite
 * (`__tests__/forgot-password.test.ts`), and the Prisma implementations in `forgot-password-
 * store.ts` are asserted against a real Postgres in `tests/db/forgot-password.test.ts`.
 *
 * THE ONE RULE TO READ FIRST. `/forgot` answers the same sentence whatever it decides — unknown
 * username, deactivated account, no address on file, three links already asked for this hour, or
 * a link genuinely on its way. The form is public, so any difference between those answers is a
 * way to ask this application whether a member of staff exists. The same discipline the login
 * form has had since Phase 1, where "wrong password" and "no such user" are one message.
 *
 * The app does not send the mail. It writes an `Outbox` row and the alerts worker sends it
 * (`src/lib/alerts/outbox.ts`): a server action that opens a socket to a mail server would block
 * a nurse's form on that mail server, and the worker already owns the transport, the retries and
 * the log-only mode.
 */
import { loginUsernameSchema } from './password'
import { applyChosenPassword, type PasswordResetStore } from './password-reset'
import {
  hashResetToken,
  generateResetToken,
  resetRequestWindowStart,
  resetTokenExpiry,
  resetTokenUsable,
  RESET_REQUESTS_PER_HOUR,
  RESET_TOKEN_TTL_MINUTES,
  type ResetTokenRow,
} from './reset-token'

/** The one answer `/forgot` gives, whatever it decided. */
export const RESET_REQUESTED_MESSAGE = `If that account has an email, a link is on its way. It works for ${RESET_TOKEN_TTL_MINUTES} minutes.`

/** The one answer a token that cannot be spent gets: missing, already used, or too old. */
export const RESET_LINK_DEAD_MESSAGE = `That link does not work any more. Links last ${RESET_TOKEN_TTL_MINUTES} minutes and can be used once.`

/** What `/login?reset=1` says after a successful reset. */
export const RESET_DONE_MESSAGE = 'Password changed. Sign in.'

export const RESET_EMAIL_SUBJECT = 'ER Navigator password reset'

/**
 * The whole `after` of the `auth.reset.requested` row. The target is on the row's `entityId`; the
 * payload deliberately holds nothing else, because the username was typed on a public form by
 * somebody who may not be the account holder and the address is not theirs to have recorded here.
 */
export const RESET_REQUESTED_AUDIT_AFTER = { requested: true } as const

/** `${APP_URL}/reset?token=…`, with any trailing slash on APP_URL removed (as `caseLink` does). */
export function resetLink(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/reset?token=${encodeURIComponent(token)}`
}

/**
 * Plain text, and nothing in it but the link. No username, no display name, no address, no MRN:
 * a reset mail is delivered on the strength of an address somebody else typed into Admin → Users,
 * so it must be worth nothing to a reader who is not the account holder.
 */
export function buildResetEmail(link: string): { subject: string; text: string } {
  return {
    subject: RESET_EMAIL_SUBJECT,
    text: [
      'Someone asked to reset the password for an ER Navigator account.',
      '',
      'Choose a new password here:',
      link,
      '',
      `The link works for ${RESET_TOKEN_TTL_MINUTES} minutes and can be used once.`,
      '',
      'If you did not ask for this, ignore it. Nothing has changed.',
      '',
      'This is an automatic message from ER Navigator. Do not reply.',
    ].join('\n'),
  }
}

// --- asking for a link ------------------------------------------------------------------------

/** An account a link may be sent to: it exists, it is active, and it has an address. */
export type ResetRequestTarget = { id: string; email: string }

/** Everything one issued link writes, in one transaction, and the rule that may refuse it. */
export type IssueResetInput = {
  userId: string
  tokenHash: string
  expiresAt: Date
  requestedIp: string | null
  now: Date
  /** The outbox row: who it goes to and what it says. The raw token lives only inside `text`. */
  email: string
  subject: string
  text: string
  /** The oldest request that still counts against the hour, `resetRequestWindowStart(now)`. */
  since: Date
  /** `RESET_REQUESTS_PER_HOUR`. Passed in rather than read here, so the store owns one rule. */
  maxPerWindow: number
}

export type ForgotPasswordStore = {
  /** Null unless the account exists, is active and has an address. One query, one answer. */
  findTarget(identifier: string): Promise<ResetRequestTarget | null>
  /**
   * Count and write as ONE decision, serialized per account (P16.40).
   *
   * One transaction that first locks the account row, then counts this user's tokens since
   * `since`, then — only if that count is under `maxPerWindow` — stamps `usedAt` on its earlier
   * unused tokens, inserts the new token, inserts the outbox row and appends
   * `auth.reset.requested`. Returns whether it issued.
   *
   * The lock is the point. Counting outside the transaction is what the security review of 13
   * September found: eight requests arriving together each read the same count and each wrote a
   * link, so the three-an-hour rule bounded nothing at all under concurrency.
   */
  issue(input: IssueResetInput): Promise<boolean>
}

export type RequestResetDeps = {
  store: ForgotPasswordStore
  appUrl: string
  now?: Date
  /** Injected only by the tests; production always uses `generateResetToken`. */
  newToken?: () => string
}

export type RequestResetResult = {
  /** Always `RESET_REQUESTED_MESSAGE`. It is returned rather than assumed so the action cannot
   *  accidentally grow a second sentence. */
  message: string
  /** For the tests and for nobody else: never rendered, never logged, never returned to a page. */
  issued: boolean
}

export async function requestPasswordReset(
  rawUsername: string,
  requestedIp: string | null,
  deps: RequestResetDeps,
): Promise<RequestResetResult> {
  const answer = (issued: boolean): RequestResetResult => ({ message: RESET_REQUESTED_MESSAGE, issued })
  const now = deps.now ?? new Date()

  // P16.41. Every path pays for the token, its digest and the message body, whether or not there
  // is an account to send one to. It is a handful of microseconds and it buys the one thing the
  // envelope in `constant-time.ts` cannot buy cheaply: the paths differ by a database write and
  // nothing else. Doing this work only where it is used is a difference somebody can time.
  const token = (deps.newToken ?? generateResetToken)()
  const tokenHash = hashResetToken(token)
  const { subject, text } = buildResetEmail(resetLink(deps.appUrl, token))

  // The same shape the sign-in form parses, so "AHMED " and "ahmed" reach the same row. A
  // username this refuses is answered exactly like one it accepts.
  const parsed = loginUsernameSchema.safeParse(rawUsername)
  if (!parsed.success) return answer(false)

  const target = await deps.store.findTarget(parsed.data)
  if (!target) return answer(false)

  // The count and the insert are the store's one transaction, under a lock on the account
  // (P16.40): reading the count out here is what let eight simultaneous requests write eight
  // links against a rule that allows three.
  const issued = await deps.store.issue({
    userId: target.id,
    tokenHash,
    expiresAt: resetTokenExpiry(now),
    requestedIp,
    now,
    email: target.email,
    subject,
    text,
    since: resetRequestWindowStart(now),
    maxPerWindow: RESET_REQUESTS_PER_HOUR,
  })
  return answer(issued)
}

// --- spending the link ------------------------------------------------------------------------

/** The token row plus the account it belongs to, which is all the decision needs. */
export type ResetTokenLookup = ResetTokenRow & {
  id: string
  user: { id: string; username: string; active: boolean }
}

export type CompleteResetStore = {
  findToken(tokenHash: string): Promise<ResetTokenLookup | null>
  markTokenUsed(tokenId: string, at: Date): Promise<void>
  /**
   * The P15.63 port, with the actor known: the person who followed the link is the actor on their
   * own `user.password` row. A factory because the actor is not known until the token resolves.
   */
  passwordStore(actorId: string): PasswordResetStore
}

export type CompleteResetOutcome =
  | { ok: true; userId: string; sessionsDeleted: number }
  /** One error, on purpose: "already used" and "expired" are facts about somebody else's account. */
  | { ok: false; error: 'invalid' }

/**
 * Is this link still worth showing a form for? Read-only, and used by `/reset` on the GET so a
 * dead link says so before the person types a password twice. It changes nothing: the token is
 * checked again, against the same rule, when the form is submitted.
 */
export async function resetTokenIsLive(deps: {
  store: Pick<CompleteResetStore, 'findToken'>
  token: string
  now?: Date
}): Promise<boolean> {
  const now = deps.now ?? new Date()
  const presentedHash = hashResetToken(deps.token)
  const row = await deps.store.findToken(presentedHash)
  return resetTokenUsable(row, presentedHash, now) && row!.user.active
}

export async function completePasswordReset(deps: {
  store: CompleteResetStore
  token: string
  newPassword: string
  now?: Date
}): Promise<CompleteResetOutcome> {
  const now = deps.now ?? new Date()
  const presentedHash = hashResetToken(deps.token)
  const row = await deps.store.findToken(presentedHash)
  if (!resetTokenUsable(row, presentedHash, now)) return { ok: false, error: 'invalid' }
  // Non-null after `resetTokenUsable`; narrowed here because that helper takes the row, not this
  // wider type.
  const found = row!
  if (!found.user.active) return { ok: false, error: 'invalid' }

  const { sessionsDeleted } = await applyChosenPassword(
    deps.store.passwordStore(found.user.id),
    found.user,
    deps.newPassword,
  )
  // Spent AFTER the password is written, deliberately: a crash between the two leaves a live link
  // and a changed password, which is recoverable, rather than a spent link and the old password,
  // which locks the person out of the door they were just let through.
  await deps.store.markTokenUsed(found.id, now)
  return { ok: true, userId: found.user.id, sessionsDeleted }
}
