# Phase 1 spec: sessions, login, lockout, role gate, audit events

Written by the lead (Fable) for the implementation agent. It fixes the contract; the agent fixes the code. Anything not specified here follows the locked plan (`docs/reference/ER_Navigator_ClaudeCode_Plan.md`, sections 2, 4, 5.1, 7) and the repo's `CLAUDE.md`. Do not add features that are not listed.

## Already in the repo (use, do not rewrite)

- `prisma/schema.prisma`: `User` with `passwordHash`, `role`, `active`, `lastShift`, `failedLogins`, `lockedUntil`, `lastLoginAt`.
- `src/lib/db.ts`: `prisma` (lazy singleton over the pg adapter).
- `src/lib/audit.ts`: `audit()`, `auditQuietly()`, `contextFrom(headers, actorId)`, `clientIpFrom(headers)`, the `AuditAction` union (contains every auth event you need).
- `src/lib/authz/policy.ts`: `can(role, action)`, `ACTIONS`, `matrix()`.
- `prisma/seed.ts` creates the first ADMIN from env (`ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_DISPLAY_NAME`) with bcrypt cost 12 (`bcryptjs`).
- Tokens and layout in `app/globals.css` and `design/tokens.md`. Use the token utilities (`text-title`, `text-label`, `bg-panel`, `border-line`, `rounded-field`, `rounded-button`, `bg-accent`, `text-muted`, `.num`).

## 1. Session model (add to the schema, one new migration)

```prisma
model Session {
  id         String   @id @default(cuid())
  tokenHash  String   @unique           // sha256(hex) of the opaque cookie value
  userId     String
  createdAt  DateTime @default(now())
  lastSeenAt DateTime @default(now())
  expiresAt  DateTime
  ip         String?
  userAgent  String?
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@index([expiresAt])
}
```

Add `sessions Session[]` to `User`. Migration name `20260909100000_sessions`. Generate the SQL with `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script` (needs a shadow database: use `docker compose -f docker-compose.dev.yml up -d --wait db` and `DATABASE_URL` from `.env.example`'s dev values), and check the SQL by eye. The privileges migration's `ALTER DEFAULT PRIVILEGES` gives the app role CRUD on the new table automatically; `Session` rows may be deleted by the app (logout, revoke).

## 2. Session mechanics (`src/lib/auth/session.ts`)

- Cookie name `ern_session`; value = 32 random bytes, base64url. Store only `sha256(value)` as `tokenHash`.
- Attributes: `httpOnly`, `secure` (except when `NODE_ENV !== 'production'`), `sameSite: 'lax'`, `path: '/'`. "Remember this device" checked: `maxAge` 12 h. Unchecked: a session cookie (no `maxAge`); the server-side expiry is still 12 h.
- Sliding expiry: on every authenticated request where `lastSeenAt` is older than 5 minutes, set `lastSeenAt = now` and `expiresAt = now + 12 h` (one UPDATE, not per request).
- Rotation: login always creates a new session and deletes any session whose cookie was presented. Logout deletes the session and clears the cookie. Deactivating a user or changing a password deletes all of that user's sessions.
- `getSession()` (server, cached per request with `React.cache`): reads the cookie, looks up by hash, returns `{ user, session }` or `null`; returns `null` if expired or `user.active === false` (and deletes the row). Never returns the password hash.
- `requireUser()` throws a redirect to `/login` (pages) or returns 401 (route handlers) when there is no session.
- `requireAction(action)` = `requireUser()` then `can(role, action)`; on failure writes `auth.forbidden` (entity `Action`, entityId = the action) via `auditQuietly` and throws a `ForbiddenError` that route handlers map to 403 and server actions return as `{ ok: false, error: 'forbidden' }`.

## 3. Login (`app/login/page.tsx`, `app/login/actions.ts`)

- Fields: username, password, "Remember this device" checkbox. Mobile-first at 390 px, one column, inputs 16 px, the accent button full width, the app name and hospital line above. No marketing copy.
- Server action `login(formData)`:
  1. zod: username trimmed 1..64, password 1..256.
  2. Rate limit per IP (`clientIpFrom`): 5 attempts per rolling 60 s. Implementation: `src/lib/auth/rate-limit.ts`, an in-process Map with a sliding window (single container in v1; document that a second replica needs a shared store). When exceeded: return `{ ok: false, error: 'rate_limited' }`, audit `auth.fail` with `after: { reason: 'rate_limited' }`.
  3. Find the user by username. Compute the bcrypt comparison EVEN when the user does not exist (compare against a fixed dummy hash) so timing does not reveal usernames.
  4. If `lockedUntil > now`: `{ ok: false, error: 'locked' }`, audit `auth.locked`.
  5. On wrong password or unknown/inactive user: increment `failedLogins`; when it reaches 10, set `lockedUntil = now + 15 min` and audit `auth.locked`; always audit `auth.fail` (actorId = user id if known). Return `{ ok: false, error: 'invalid' }`. The UI shows one message for invalid and unknown ("Wrong username or password.") and a different one for locked ("Too many attempts. Try again in N minutes.").
  6. On success: `failedLogins = 0`, `lockedUntil = null`, `lastLoginAt = now`; create the session; audit `auth.login`; redirect to `/`.
- `logout` server action: delete the session, clear the cookie, audit `auth.logout`, redirect to `/login`.

## 4. Route gate (`proxy.ts` at the repo root, Next 16's request gate; not `middleware.ts`)

- Public: `/login`, `/api/health`, `/api/ready`, `/manifest.webmanifest`, `/icons/*`, `/_next/*`, `/favicon.ico`, `/robots.txt`.
- Everything else: if the `ern_session` cookie is absent, redirect to `/login?next=<path>`. The gate only checks cookie presence (no database access in the gate); pages and actions do the real check with `getSession()`.
- Authenticated users visiting `/login` are redirected to `/`.

## 5. Post-login shell (`app/(app)/layout.tsx`, `app/(app)/page.tsx`)

- Move the current holding page content out. `/` now requires a user and shows: a header with "ER Navigator", the user's display name and role, and a Logout button; a body that says the board arrives in Phase 3 and shows the elapsed-time band legend that is on the holding page today (keep that component). Keep the bottom tab bar out until Phase 3.
- `/account` page: change my password (current password, new password twice; zod: min 12 chars). On success delete all other sessions of the user, keep the current one (rotate it), audit `user.password`.

## 6. Tests

- Unit (`src/lib/auth/__tests__/`): token hashing is one-way and unique; expiry and sliding logic (pure functions over dates); lockout counter and 15-minute window; rate limiter window (inject a clock); the dummy-hash timing path runs bcrypt for unknown users (assert the compare function is called).
- Database-backed (`tests/db/auth.test.ts`, vitest, run only when `DATABASE_URL` is set; add `tests/db/**` to the vitest include with a `globalSetup` that skips when the variable is absent): create a user, log in through the action's core function, assert a `Session` row and an `auth.login` audit row; 10 failures lock the user and write `auth.locked`; a VIEWER calling `requireAction('case.create')` writes `auth.forbidden`.
- Playwright (`tests/e2e/auth.spec.ts`): wrong password shows the message; correct login lands on `/` with the display name; logout returns to `/login`; `/account` rejects a short password; a locked user sees the locked message (seed a locked user through the DB in `globalSetup` or a test-only script). Wire the CI `e2e` job's seed so the admin user exists (it already does: `ADMIN_USERNAME=admin`, `ADMIN_PASSWORD=ci-only-password`).
- Every test must pass with `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`, and `pnpm exec playwright test` against `pnpm start` with the dev compose database.

## 7. Do not

- Do not add Auth.js, NextAuth, JWTs or any auth library. Sessions are opaque cookies in the database.
- Do not store the raw token, log passwords, or return password hashes anywhere.
- Do not touch the seed's taxonomy behaviour, the Dockerfile, the compose file, the CI workflow (except adding the `tests/db` run if needed), or the docs beyond `docs/CHANGELOG.md` (one line) and a short note in `docs/RUNBOOK.md` under "Add a user" if the first-login flow changes.
- Do not create the Board, the case editor, or any Phase 2+ screen.

## Done means

All checks green; the e2e suite passes locally against the dev database; `docs/CHANGELOG.md` has one `[ERN-P1.n]` line; a short list of anything you had to decide that this spec left open, in your final message.
