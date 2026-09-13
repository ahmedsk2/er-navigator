# Phase 16: "Forgot your password?", by email

Asked for by Ahmed on 13 September 2026, the day he was locked out of the admin account and let
back in by `node reset-password.js` on the host: *"create a very simple reset admin to email page
and link in the log in page using the minimal tokens"*.

He is the owner and the only administrator. The host script (P15.63) is the answer when nobody can
sign in at all, and it stays. What it is not is a path a person can walk on their own at 2 a.m.
with a phone, and that is what this phase adds: a link under the sign-in form, a page that takes a
username, an email with a one-time link, and a page that takes a new password.

Minimal, and correct. No new dependency, no new environment variable, no new container, no change
to the Content-Security-Policy, no change to any existing screen except one link and one notice on
`/login`.

---

## 1. What the user sees

1. **`/login`** grows one line under the form: **Forgot your password?**, a link to `/forgot`.
2. **`/forgot`** is public. One field, `Username`, one button, `Send the link`. On submit it always
   answers with the same sentence, whether or not the account exists, whether or not it has an
   email, and whether or not it has already asked three times this hour:

   > If that account has an email, a link is on its way. It works for 30 minutes.

3. The email is plain text. Subject `ER Navigator password reset`. The body carries the link, the
   30-minute note and one sentence for the person who did not ask. It names no username, no MRN and
   nothing else about the account.
4. **`/reset?token=…`** is public. Two fields, `New password` and `New password again`, the same
   twelve-character rule `/account` enforces. On success it redirects to `/login?reset=1`, which
   says **Password changed. Sign in.**
5. An invalid, used or expired token shows one plain sentence and a link back to `/forgot`:

   > That link does not work any more. Links last 30 minutes and can be used once.

VIEWER accounts may use it: it is their own password. The admin's own reset is the same flow. An
account with **no email address** cannot use it at all, and is told nothing different (see §5);
the host script is what answers that case, and the runbook says so.

---

## 2. Data: two models, one migration

`20260913…_password_reset_and_outbox`, additive, no column on an existing table changed.

```prisma
model PasswordResetToken {
  id          String    @id @default(cuid())
  userId      String
  tokenHash   String    @unique   // sha256 hex of the 32 random bytes in the link
  createdAt   DateTime  @default(now())
  expiresAt   DateTime
  usedAt      DateTime?
  requestedIp String?
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@index([expiresAt])
}

model Outbox {
  id        String    @id @default(cuid())
  to        String
  subject   String
  text      String
  createdAt DateTime  @default(now())
  sentAt    DateTime?
  attempts  Int       @default(0)
  lastError String?

  @@index([sentAt, createdAt])
}
```

**The raw token is never stored.** It exists in exactly two places: the link in the `Outbox` row's
`text`, and the URL in the person's mail client. `tokenHash` is `sha256(token)` in hex. No log
line, no audit payload and no error message anywhere carries it.

**`usedAt` means "cannot be used again"**, whether it was spent or superseded. Issuing a token
stamps `usedAt` on every earlier unused token of that user in the same transaction, so a person
who asks twice can only use the second link. That is what keeps the table free of a delete path.

**`Outbox` is append-only from the app.** The app inserts; only the worker stamps `sentAt`, or
`attempts` and `lastError`. `prisma/sync-app-role.ts` revokes `DELETE` on it, beside `Case`,
`User` and `Alert`. `PasswordResetToken` keeps its `DELETE`: it is not a record of anything, and a
future prune of expired rows should not need a migration to become possible.

Neither table can hold a patient identifier. `to` is a member of staff's work address, the same
data `User.email` already holds and for the same reason; `text` is generated from a template that
takes only a URL. `tests/unit/phi-guard.test.ts` is unchanged, and the PHI rule is about `Case`.

---

## 3. Sending: an outbox the worker drains

**The app does not send mail.** It has no nodemailer transport in any request path and this phase
does not give it one: a server action that opens an SMTP socket blocks a nurse's form submission on
a mail server, and a hospital SMTP host that is slow turns "ask for a link" into a thirty-second
spinner. The worker already owns the mailer, the retry rule and the log-only mode.

So the app writes a row and the worker sends it.

- **Poll**: every **20 seconds**, a single indexed query —
  `sentAt IS NULL AND attempts < 5`, oldest first, at most 10 rows. On a quiet instance that is one
  cheap query three times a minute and nothing else.
- **The 5-minute alert cycle and the heartbeat are untouched.** The outbox poll is a second
  `setInterval` with its own overlap guard; it never writes `/tmp/heartbeat`, never calls the push
  monitor, and a failure in it is logged and cannot fail an alert cycle. A reset email is not a
  patient waiting twelve hours, and it must not be able to make the container look unhealthy.
- **Sent**: `sentAt` is stamped.
- **Failed**: `attempts` + 1 and `lastError` (truncated to 300 characters), `sentAt` left null. The
  next poll picks it up. After 5 attempts the row stops being selected and stays visibly unsent.
- **`SMTP_HOST` empty**: nothing is sent, the message is logged at info level exactly the way an
  alert is — `[outbox] SMTP_HOST is empty; would have emailed …` — and `sentAt` **is** stamped, so
  the queue does not grow for ever on an instance that has no mail. This is the demo's shape, and
  it is what makes the flow demonstrable there with nothing leaving the host.

`drainOutbox` lives in `src/lib/alerts/outbox.ts` behind an `OutboxStore` port and takes the same
`Mailer | null` and `Logger` the alert cycle takes, so the whole rule is unit tested with a fake
store and a fake mailer and no Postgres. `prismaOutboxStore()` joins `prismaAlertStore()` in
`src/lib/alerts/store.ts`.

### The email

```
Someone asked to reset the password for an ER Navigator account.

Choose a new password here:
{APP_URL}/reset?token={token}

The link works for 30 minutes and can be used once.

If you did not ask for this, ignore it. Nothing has changed.
```

Subject: `ER Navigator password reset`. Text only, no HTML part: there is nothing in it to lay
out, and a plain-text message is one fewer place for the link to be rewritten. No username, no
display name, no MRN, no IP address.

---

## 4. The request: `/forgot`

`app/forgot/page.tsx` (public, `metadata.title` "Forgot your password? · ER Navigator") and
`app/forgot/actions.ts`.

The action, in order:

1. Parse the username with the login schema's own `loginUsernameSchema` (trimmed, lower-cased,
   1..64). A parse failure answers **the same sentence**, not a validation error.
2. **Rate limit by client IP**, `clientIpFrom()`, five per rolling 60 seconds — the sign-in
   numbers, `LOGIN_RATE_LIMIT` and `LOGIN_RATE_WINDOW_MS`, from the same `SlidingWindowLimiter`
   class. A refusal answers the same sentence too, so the limiter cannot be used to learn
   anything either.

   **Recorded decision:** it is a *separate bucket* from `loginRateLimiter`, not the same instance.
   Sharing one would mean that the five failed sign-ins that made a nurse click the link are also
   what stops the link being sent. `passwordResetRateLimiter` is shared by `/forgot` and `/reset`.
3. Look the user up. Issue a token only when the row exists, is `active`, and has a non-null
   `email`.
4. **At most 3 requests per user per hour**, counted and enforced **inside** the issuing
   transaction, which opens with `SELECT id FROM "User" WHERE id = $1 FOR UPDATE`. A fourth is
   silently ignored — same sentence, no row, no email, no audit row.

   **Corrected 13 September (P16.40, security review).** This was two statements with a gap
   between them: the count ran outside `issue()` and nothing was locked, so eight requests that
   arrived together each counted zero and each wrote a link. A per-user rule that is not
   serialized per user bounds nothing at all. The lock is on `User` rather than on the token rows
   because the rows being counted are the ones about to be written; the app role may take it,
   having UPDATE on `User` already; and nothing in this application locks `User` and then a
   second table in the other order, so it cannot deadlock against the password write.
5. Still in that transaction: stamp `usedAt` on that user's earlier unused tokens, insert the new
   token, insert the `Outbox` row, append `auth.reset.requested` (`entity: 'User'`,
   `entityId: userId`, `after: { requested: true }`). The audit row carries the user id and
   nothing else: not the token, not the hash, not the email address, not the username.
6. Answer the same sentence.

The action is `async function requestPasswordReset` in `app/forgot/actions.ts`. It has no session
and no permission to check, so it joins `login` in `SESSION_ACTIONS` in
`tests/unit/server-actions.test.ts` with its reason written out.

---

## 5. The reset: `/reset?token=…`

`app/reset/page.tsx` reads the token from the query, checks it, and renders either the form (with
the token in a hidden field) or the one refusal sentence with the link back to `/forgot`. The page
never renders the username, the display name or the email: it says nothing about the account
except that the link works.

`app/reset/actions.ts`, in order:

1. Rate limit by IP on the same `passwordResetRateLimiter`.
2. Parse the two passwords: `newPasswordSchema` (12 characters minimum, the rule
   `/account` uses, from `src/lib/auth/password.ts`) and an equality refinement. `too_short` and
   `mismatch` are the only two messages that differ from the refusal, and they are about what was
   typed rather than about the token.
3. `sha256` the presented token, `findUnique` on `tokenHash`, then **`timingSafeEqual`** on the
   two digests before accepting. The lookup is by an indexed hash of 32 random bytes, so the
   compare is belt and braces; it is there because a token check that is not constant-time is the
   kind of thing that gets copied.
4. Refuse a row that is missing, has `usedAt` set, or has `expiresAt <= now`. One outcome,
   `invalid`, and one sentence — a used link and an expired link must not be distinguishable.
   Write `auth.fail` with `after: { reason: 'reset_token_invalid' }` and no token value.
5. Otherwise, in this order:
   - `applyChosenPassword()` in `src/lib/auth/password-reset.ts` — the same store port P15.63
     built, so this is not a second place that writes a password. It sets the hash at
     `BCRYPT_COST`, clears `failedLogins` and `lockedUntil`, sets `mustChangePassword` **false**
     (the user chose this password; nobody read it out to them), and appends `user.password` with
     `after: { username, self: true, via: 'email-reset', mustChangePassword: false }` in the same
     transaction.
   - deletes every session of that user, through the same port. Whoever was signed in on that
     account is signed out, which is the point if the reason for the reset is that somebody else
     was.
   - stamps `usedAt` on the token.
6. `redirect('/login?reset=1')`.

The change to `src/lib/auth/password-reset.ts` is one new `ResetOrigin` variant, `{ by: 'email' }`,
one exported predicate `mustChangeAfterReset(origin)` that the Prisma store reads instead of the
literal `true`, and `applyChosenPassword()` beside `resetPassword()`. Admin → Users and the host
script are byte-identical in behaviour and their audit payloads are unchanged.

---

## 6. Security, stated as the rules the tests assert

| Rule | Where |
| --- | --- |
| 32 random bytes, `randomBytes(32)`, base64url in the link | `src/lib/auth/reset-token.ts` |
| Only `sha256` of it is stored; the raw token is in the mail and nowhere else | the store; the unit tests grep the audit payload and the log lines |
| Constant-time compare of the digests | `timingSafeEqual` in `verifyResetToken` |
| Single use | `usedAt`, stamped in the same transaction as the password write |
| 30 minutes | `RESET_TOKEN_TTL_MS`, checked against `now` at use |
| Earlier tokens invalidated on a new request | one transaction |
| At most 3 per user per hour | counted on `createdAt` inside the issuing transaction, behind `SELECT … FOR UPDATE` on the account row, so simultaneous requests cannot each read the same count |
| Five requests a minute per IP on both pages | `passwordResetRateLimiter` |
| No enumeration | one sentence for every outcome of `/forgot`; one sentence for every bad token |
| The reset page reveals no username | the page renders only the form |
| Audit rows for request, completion and failure | `auth.reset.requested`, `user.password`, `auth.fail` |
| No token in any log or audit payload | asserted by grep in the unit suite |
| CSP unchanged | server actions, no inline script; `proxy.ts` gains two public paths and nothing else |
| `noindex` | already global, `app/layout.tsx` |

**Threats deliberately accepted.** A person who can read the mailbox can take the account: that is
what "reset by email" means, and it is why the address lives in Admin → Users and not on a screen
the user can edit. The in-process rate limiter is per container, as it has been since Phase 1, and
the same one-replica caveat in `rate-limit.ts` applies. An `Outbox` row's `text` holds a live
token for up to 30 minutes: the app role can read the table, which is the same trust boundary the
session table already sits inside. And the **GET** of `/reset` is not rate limited — only the
submission is — so a stranger can make one indexed lookup of a 32-byte digest per request; that is
the same cost as rendering `/login`, and the thing being guessed is 256 bits.

---

## 7. What does not change

- No new environment variable, on the app or on the worker. `APP_URL` builds the link and both
  already have it; `docker/entrypoint.sh` and its allowlist are untouched.
- The alert cycle, its interval, its retry pass, its heartbeat and its push monitor.
- The demo seed. The four demo accounts already carry `<username>@demo.invalid` addresses from
  Phase 12, which is exactly what this flow needs to be demonstrable with nothing leaving the
  host. `tests/demo/demo.spec.ts` is unaffected.
- Every existing screen except the one link and the one notice on `/login`.
- The permission matrix. Nothing here is an authorised action: both pages run before there is a
  session.

---

## 8. Tests, fail-first

**Unit** (`src/**/__tests__`)

- `reset-token.test.ts`: 32 bytes, base64url, different every time; the hash is sha256 hex of the
  raw token and never equal to it; expiry arithmetic; `verifyResetToken` refuses a used row, an
  expired row and a mismatched digest, and accepts a good one.
- `forgot-password.test.ts`, against a fake store: the same sentence for an unknown user, an
  inactive user, a user with no email and a good user; a token and an outbox row only in the last
  case; earlier tokens invalidated; the fourth request in an hour writes nothing; the audit
  payload carries the user id and no token, hash, username or address; the email body carries the
  link, the 30-minute note and the "did not ask" sentence and no username.
- `outbox.test.ts`: a pending row is sent and stamped; a throwing mailer increments `attempts` and
  records `lastError` and leaves `sentAt` null; a null mailer logs "would have emailed" and stamps
  `sentAt`; the batch is capped; nothing logged contains the token.

**Database** (`tests/db/forgot-password.test.ts`, owner role)

- A request for a real user with an email creates exactly one token row, one outbox row and one
  `auth.reset.requested` row, in one transaction.
- The reset consumes the token, changes the password (proved by running the real `attemptLogin`
  with the new one and with the old one), deletes every session, leaves `mustChangePassword`
  false, and writes `user.password` with `via: 'email-reset'`.
- A used token and an expired token are both refused, and the password does not change.
- `drainOutbox` in log-only mode stamps `sentAt` on a real row.
- The app role has no `DELETE` on `Outbox`.

**End to end** (`tests/e2e/phase16-forgot-password.spec.ts`, both viewports)

- The login page carries the link and it goes to `/forgot`.
- `/forgot` accepts a username and shows the sentence; an unknown username shows the same one.
- The whole flow: submit `/forgot` for a seeded account with an address, read the link out of the
  `Outbox` row in the test database, open it, set a new password, land on `/login?reset=1`, and
  sign in with the new one.
- An expired token (a row written straight to the database) is refused.
- No horizontal overflow at 390 on either page.

Two fixture accounts, `e2e_forgot_mobile` and `e2e_forgot_desktop`, seeded by
`tests/e2e/global-setup.ts` with `@example.invalid` addresses: this spec changes the password of
the account it uses, so it cannot share one with the projects running beside it.

**Gate captures** (`tests/e2e/phase16-screenshots.spec.ts`): `design/screens/phase16-login-link-*`,
`phase16-forgot-*`, `phase16-reset-*`, at 390 x 844 and 1280 x 800.

**Drift guards**

- `tests/unit/server-actions.test.ts`: the file list grows by two and `SESSION_ACTIONS` grows from
  three to five, each with its reason. That is the point of the assertion on its size.
- `tests/unit/phase12-spec.test.ts`: a Phase 16 block reading the link off `app/login/page.tsx`
  and the sentence off the nurse guide, so the two cannot drift apart.

---

## 9. Documents

- `docs/RUNBOOK.md`: "Forgot password (Phase 16)" under "The alerts worker" — the outbox, the
  20-second poll, that `SMTP_HOST` must be set for a link to actually go out and that a blank host
  logs it instead; and one line under "Reset a password from the host" pointing at it and saying
  that an account with no email cannot use it.
- `docs/RUNBOOK.md`, "Demo instance": the demo has no `SMTP_HOST`, so a reset request there is
  logged by the worker and stamped sent, and nothing leaves the host.
- `docs/guide/nurse-quick-guide.md`, section 1: one sentence.
- `docs/CHANGELOG.md`: `## Phase 16`, above Phase 15.
- `docs/PLAN.md`: `### Phase 16` in section 5 and a "Delivered in Phase 16" block in section 0.
