# Phase 12: what stands between the app and a staff demo, and between the app and production

Ahmed, 11 September, after the Phase 11 gate: find out what is left before staff can try this
themselves and before real patients go on it, and build the part that is Claude's.

A twelve-agent read-only audit answered the first half
(`readiness-audit.md`, 50 items: 15 demo, 30 production, 5 after go-live, 10 already done).
Ahmed's decision on the demo: **option B**, a hosted demo copy on its own subdomain — a second
Coolify application from the same repository with its own database, its own secrets, blank SMTP
and no alert push URL. Production is not touched by any of it.

This spec is the build. Item ids in brackets are the audit's.

**Status (11 September 2026): reviewed, corrected, being built.** The six corrections of the
review round [P12.4a to g] are folded into the text below, so this document is what the slices
build from. 12C, the documents, is done. 12A is in progress; 12B follows once 12A is live, and
`demo-nav.towardpcc.com` does not exist until it runs. The gate report records what each slice
shipped.

## What the audit found that this phase answers

Ranked by what would go wrong first.

1. **Nothing on the screen says which copy you are looking at** (D6). `INSTANCE_LABEL`,
   `DEMO_MODE`, `NEXT_PUBLIC_*` return zero lines across `src`, `app` and `worker`. A demo copy
   and the production copy are the same pixels. Two nurses on two phones, one of them on the
   demo, is the accident this phase exists to prevent.
2. **The demo tooling would run against production if pointed at it** (D3).
   `tests/demo/playwright.demo.config.ts:19` is `baseURL: process.env.DEMO_BASE_URL ?? 'http://localhost:3300'`
   with no host check, and `scripts/demo-reset.sh` is safe only because it never names production.
   One run against the live database would put invented patients there permanently: the audit log
   is append-only and cases can only be voided.
3. **There is no seed that produces cases** (D7). `prisma/seed.ts` is documented "Idempotent,
   never touches Case data"; the Phase 11 kit is a Playwright script that needs a browser, ends
   with every case resolved, and hands out random temporary passwords for three of its five
   accounts. A hosted demo needs a board and a dashboard worth looking at, seeded server-side,
   in seconds, repeatably.
4. **Invented MRNs today look real** (D4). `MRN_RE = /^\d+$/` — digits only, no length or range
   bound — and the Phase 11 kit uses five consecutive plausible 7-digit numbers.
5. **The "MRN only, no names" hint is on one free-text box of five** (C4), while `PLAN.md:226`
   claims it is on all of them. The one that has it is the Updates box
   (`CaseEditor.tsx:1214`); the working diagnosis — where a name is most natural to type — the
   resolution note, the Other-reason description and the void reason carry none.
6. **The first password is never forced to change** (P12). `model User` has no such column, and
   `UsersPanel` shows the temporary password once with "Read this temporary password out now".
   A password read out across a ward desk can stay in use for ever, and the audit log names that
   account for everything done with it.
7. **An alert email that fails twice is lost and nothing notices** (C1). `cycle.ts:75-100` tries,
   sleeps 30 s, tries again, logs "giving up for this alert" and returns null; the Alert row is
   already committed and the unique index on `(caseId, thresholdHours)` makes every later cycle a
   no-op for it. `worker/alerts.ts:157-166` touches the heartbeat and pushes Kuma unconditionally.
   A wrong SMTP password stops every 6 h+ escalation while both monitors stay green.
8. **An export or a print leaves no audit row** (C2). `src/lib/audit.ts:15-37` lists 21 actions,
   none of them an export or a print; `export/service.ts:10-12` states the decision verbatim
   ("An export is a read, so there is no audit row") and writes a `console.info` instead, which
   lives in container logs. `policy.ts:32` grants `export.xlsx` and `report.print` to VIEWER too.
9. **The login limit would turn away the sixth person in a minute** (P3). 5 per rolling 60 s per
   client IP (`rate-limit.ts:74-75`), keyed on `CF-Connecting-IP`. Fifteen staff behind one
   hospital NAT address at a demo is exactly that case.
10. **`.gitignore` would not stop a patient spreadsheet being committed** (P16). `git check-ignore`
    reports `.xlsx`, `.csv` and `.xls` sample paths as NOT ignored; the file lists no data
    extension at all. The history is clean today (X8: gitleaks over all 219 commits, no leaks;
    the only matching tracked files are the eight `prisma/migrations/*/migration.sql`).
11. **Four Dependabot pull requests are open** (P6, P19), one of which breaks the build: #2 moves
    the Dockerfile to `node:26-alpine` while `package.json` pins `engines.node ">=24 <25"` and
    `.npmrc` sets `engine-strict=true`, so `pnpm install --frozen-lockfile` aborts in the deps
    stage. CI never builds the Dockerfile, so its green check means nothing.
12. **Documents state things that are no longer true** (P24, X1–X5), including one an operator
    would act on: `RUNBOOK.md:11` says the repository is private. It is public until Ahmed
    flips it.
13. **There is no user documentation at all** (P21) and no presenter script (D10): a grep for
    quick guide / user guide / training / talk track over `docs/`, `README` and `public/` returns
    zero hits, and there is no help route.

What is deliberately **not** in this phase: everything whose owner is Ahmed (P1 hospital
authorisation, P4 the admin password change, P7 making the repository private, P8 the SMTP test
send, P9 recipients, P10 the roster, P13 the reference lists, P23 the cutover), and everything
in AFTER GO-LIVE. Nothing here changes the workflow, the taxonomy, the permission matrix or any
stored clinical field.

---

## Rules for every slice

The hard rules in `CLAUDE.md`. Tests first: every change is proven by a test that failed before
the change and passes after, and the spec below names the failing assertion each item starts
from. MRN only. Permissions server-side. `CaseUpdate` and `AuditLog` stay append-only. `n<3`
unchanged. No new runtime dependency. Every colour is a token
(`tests/unit/colour-literals.test.ts` and `tokens.test.ts` stay green). The whole chain —
`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm exec playwright test` at
390 × 844 and 1280 × 800 — green before hand-back. Commit format
`[ERN-P12.n] imperative summary` with the `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
trailer.

Demo data never enters the production database. Nothing in this phase writes to production.

---

# Slice 12A — code

Ten items. They are independent except where noted: **item 5 (must-change) and item 3 (the demo
seed) share one field**, and **item 1 (the banner) and item 8 (the login limit) share the
entrypoint allowlist line**. Two builders can take 1–2–8–9–10 and 3–4–5–6–7 respectively; both
touch `docker/entrypoint.sh` and `prisma/schema.prisma`, in different places.

## 1. Instance label and banner (D6)

### Contracts

**Environment variable** `INSTANCE_LABEL`. Unset or blank in production; `DEMO` on the demo
instance. Added to the `KEEP` allowlist in `docker/entrypoint.sh` (the same line
`REPORT_HEADER` is on) and defaulted in `docker-compose.production.yml` under the `app`
service as `INSTANCE_LABEL: ${INSTANCE_LABEL:-}`, exactly as `REPORT_HEADER` and `SMTP_HOST`
are. Not added to the `worker` service: the worker renders nothing.

**New module `src/lib/instance.ts`**, modelled line for line on
`src/lib/export/report-header.ts` (the established pattern for a runtime environment string):

```ts
/** `[A-Za-z0-9 ._-]`, 1 to 24 characters. Anything else is treated as unset. */
export const INSTANCE_LABEL_RE = /^[A-Za-z0-9 ._-]{1,24}$/
export function instanceLabel(env: NodeJS.ProcessEnv = process.env): string | null
export function instanceBannerText(label: string): string   // `${label}: invented patients only`
```

`instanceLabel` trims; returns `null` for unset, blank, or a value that fails
`INSTANCE_LABEL_RE`. With `INSTANCE_LABEL=DEMO` the banner text is exactly
`DEMO: invented patients only`.

**New component `src/components/shell/InstanceBanner.tsx`**, a server component with no props.
Returns `null` when `instanceLabel()` is `null`. Otherwise renders exactly one element:

```html
<div data-instance-banner="DEMO" class="… bg-band-h4-ink text-white [print-color-adjust:exact]">DEMO: invented patients only</div>
```

- **Not a heading and not a landmark.** `tests/e2e/auth.spec.ts:148` asserts
  `getByRole('heading', { name: 'ER Navigator' })` has count 1 on `/login`, and
  `tests/e2e/export.spec.ts` and `tests/e2e/phase12-mark-on-paper.spec.ts` assert the report's
  `<h1>` is exactly the report header line. A `<div>` with text breaks neither.
- **Cannot be dismissed:** no button, no `hidden`, no local storage, no client component.
- **In normal flow at the very top of `<body>`**, not `position: sticky`. Sticky would fight the
  Phase 11 sticky case-page strip, the tab bar and the FAB, all of which the existing suite
  measures by geometry. In flow costs one banner height at the top of every page and nothing else.
- **Prints.** No `no-print` class: a demo handover sheet or report that comes off the printer
  says DEMO on it. This is half of what D6 asked for. Printing coloured text on a coloured ground
  takes one more class: **`[print-color-adjust:exact]` on the banner element**. The CSS default is
  `print-color-adjust: economy`, so a browser drops the background and keeps the light text —
  white on white paper, a printed demo sheet indistinguishable from a real one, which is the exact
  accident the banner exists to prevent. `app/globals.css` has no global rule (its `@media print`
  block sets `html, body { background: #fff }` and the comment above it says the coloured screen
  rows are deliberately dropped), so the opt-in is per element, as it already is on
  `AdaaBullets.tsx:31`, `ArrivalTable.tsx:47`, `BarList.tsx:46` and `StaySplit.tsx:33`. Phase 12
  item 1's own predecessor made the same call for the same reason: `e525bc0` used an SVG `rect`
  fill for the mark "so the tile prints in a browser that drops background graphics". (Added in
  the Phase 12 review round.)
- **Colours are tokens only.** Use the existing amber pair `bg-band-h4-ink` with `text-white` —
  the same pair `BAND_PILL.h4` uses (`src/components/bands.ts:38`), for the same reason.
  `--color-band-h4-ink` is `#8a5e0e`, 5.69:1 against white; `--color-band-h4` is `#b8790f`, only
  3.63:1, below the 4.5:1 AA minimum for normal text, and
  `src/components/__tests__/bands.test.ts:65` already asserts that it fails. `bands.ts:10` says it
  in words: "`band-h4` is fine as a surface; it is too light for text." (Corrected in the Phase 12
  review round: the first draft said `bg-band-h4` and claimed `tests/unit/tokens.test.ts` carried
  its contrast. It does not — that file asserts the band tokens at the 3:1 non-text threshold
  against `color-bg` and `color-panel` only, and its 4.5:1-against-white loop covers the three
  accent tokens. `tests/unit/phase12-spec.test.ts` now reads this bullet and computes the number.)
  No new hex anywhere — `tests/unit/colour-literals.test.ts` would fail.

**Placement.** `app/layout.tsx`: `<body>` becomes
`<body className="min-h-dvh antialiased"><InstanceBanner />{children}</body>`. That is every page
that has a root layout: `/login`, the whole `(app)` group, `/cases/*`, `/report`,
`app/not-found.tsx`, `app/forbidden.tsx`, `app/error.tsx`.

**The two documented exceptions**, which the spec accepts and the builder does not chase:

- `app/global-error.tsx` replaces the whole document (its own `<html>`/`<body>`) and therefore
  never renders the root layout. It shows a crash message and no patient data.
- `/manifest.webmanifest`, `/_not-found` and `/_global-error` are the only prerendered routes
  (`.next/prerender-manifest.json`), so a build-time read of the variable would be baked into
  them. Every real page is dynamically rendered, so the runtime value is correct on all of them.
  `app/not-found.tsx` renders through the root layout on a live request, so it is covered;
  `/_not-found` as a prerendered shell is not, and that is accepted.

**Robots noindex** is already global and stays: `app/layout.tsx:19`
`robots: { index: false, follow: false }` renders `<meta name="robots" content="noindex, nofollow">`
into the head of every page, and `public/robots.txt` is `User-agent: *` / `Disallow: /`. This item
adds no new mechanism; it adds the proof (below) that the tag is on the demo's pages.

### Tests

**Unit — `src/lib/__tests__/instance.test.ts` (new).** Failing assertion to start from:
`expect(instanceLabel({ INSTANCE_LABEL: 'DEMO' })).toBe('DEMO')` — the module does not exist.
Then: unset → `null`; `'  '` → `null`; `'DEMO'` → `'DEMO'`; `'  DEMO '` → `'DEMO'`; a 25-character
label → `null`; `'<script>'` → `null`; `instanceBannerText('DEMO') === 'DEMO: invented patients only'`.

**E2E, production shape — the existing suite proves nothing changed.** Add to
`tests/e2e/shell.spec.ts` (or a new `tests/e2e/instance-banner.spec.ts`), running in the ordinary
config where `INSTANCE_LABEL` is unset:
`await expect(page.locator('[data-instance-banner]')).toHaveCount(0)` on `/login`, `/`,
`/cases/new` and `/report`, at both viewports. Failing assertion to start from: none — this one
passes on day one and is the regression guard. The real proof that nothing changed is that the
198-test suite stays green with the banner component mounted and returning null.

**E2E, demo shape — new config `tests/instance/playwright.instance.config.ts`.** Same project
pair as the main config (mobile 390 × 844, desktop 1280 × 800), `testDir: '.'`,
`testMatch: /instance\.spec\.ts$/`, `outputDir: '../../test-results/instance'`, and a `webServer`
that starts the *same* build with the variable set — cross-platform, so through Playwright's
`env` option and never a shell prefix:

```ts
webServer: {
  command: 'pnpm start',
  url: 'http://localhost:3401/api/health',
  env: { INSTANCE_LABEL: 'DEMO', PORT: '3401' },
  reuseExistingServer: !process.env.CI,
  timeout: 60_000,
},
use: { baseURL: 'http://localhost:3401' },
```

`tests/instance/instance.spec.ts` (new). Failing assertions to start from — every one of these
fails before the component exists:

1. `/login`: `[data-instance-banner]` has count 1 and text `DEMO: invented patients only`; it is
   above the hero (`banner.boundingBox().y + height <= hero.boundingBox().y`); and
   `getByRole('heading', { name: 'ER Navigator' })` still has count 1.
2. Signed in as the navigator on `/`: the banner is present; the board's first row and the tab
   bar are both still visible at 390 × 844 (the banner must not push the shell off screen).
3. `/cases/new`, `/account`, `/dashboard`, `/export` and `/report`: count 1 on each.
4. There is no control that removes it: `banner.locator('button')` has count 0, and after
   `page.reload()` it is still there.
5. `<meta name="robots" content="noindex, nofollow">` is present on `/login` and on `/`.
6. It survives the printer: after `page.emulateMedia({ media: 'print' })` on `/` the banner is
   still visible and `await expect(banner).toHaveCSS('print-color-adjust', 'exact')` — the
   assertion that a browser dropping background graphics still gets the amber ground rather than
   white text on white paper. Added in the Phase 12 review round.

Run it by hand and in the Phase 12 gate, not in CI (it costs a second server); the runbook's
demo section says how.

### Deliberately not done

The audit's D6 close also proposed DEMO on the page `<title>`, the manifest name and the theme
colour. The banner and the print are what stop the accident; a title change would move
`metadata.title`, which `tests/e2e/pwa.spec.ts` and several specs assert, for no safety gain.
Recorded here so the reviewer does not read it as an omission.

## 2. Demo tooling refuses production (D3)

### Contracts

Three refusals, each documented in the header comment of the file that implements it.

**`scripts/demo-reset.sh`** gains a guard block immediately after `set -euo pipefail`. It refuses
unless **either** the app database URL it is about to use contains `localhost` or `127.0.0.1`,
**or** `INSTANCE_LABEL` is set and non-empty in the environment running it. The script already
pins `OWNER` to `postgresql://ernav_owner:devowner@localhost:55450/…`; the guard checks that
string rather than trusting the comment, so an edit that repoints it trips the guard. It also
refuses if `DEV_DB_PORT` has been overridden to the production Postgres port. Exit code 1, and a
message naming which condition failed. No secret is printed: the guard tests the URL with
`case "$OWNER" in *localhost*|*127.0.0.1*)` and never echoes it.

**`tests/demo/playwright.demo.config.ts`** gains, at module scope before `defineConfig`:

```ts
const baseURL = process.env.DEMO_BASE_URL ?? 'http://localhost:3300'
assertDemoTarget(baseURL)
```

**New module `src/lib/demo-guard.ts`** (imported by the demo config and by the seed of item 3, so
there is one rule and one test):

```ts
export const PRODUCTION_HOSTS = ['nav.towardpcc.com'] as const
export class DemoTargetError extends Error {}
/** Throws unless the host is a loopback address or INSTANCE_LABEL is set on this process. */
export function assertDemoTarget(url: string, env?: NodeJS.ProcessEnv): void
```

Rule, in this order: a host in `PRODUCTION_HOSTS` always throws, even with `INSTANCE_LABEL` set;
`localhost`, `127.0.0.1` and `[::1]` pass; anything else passes only when
`instanceLabel(env) !== null`; an unparseable URL throws.

**The seed of item 3** carries the same guard plus one more, described there: it refuses when the
database already holds a case whose creator is not a demo user.

### Tests

**Unit — `src/lib/__tests__/demo-guard.test.ts` (new).** Failing assertion to start from:
`expect(() => assertDemoTarget('https://nav.towardpcc.com', { INSTANCE_LABEL: 'DEMO' })).toThrow(DemoTargetError)`.
Then: `http://localhost:3300` passes with an empty env; `https://demo-nav.towardpcc.com` throws
with an empty env and passes with `INSTANCE_LABEL=DEMO`; `not a url` throws.

**Shell — CI.** Add `bash -n scripts/demo-reset.sh` to the "shell scripts parse" step of
`.github/workflows/ci.yml` (it is not in that list today). Failing assertion to start from: the
step does not mention the file, so a syntax error in the new guard would ship.

**By hand, recorded in the gate report:** `DEV_DB_PORT=5432 bash scripts/demo-reset.sh` exits 1
without touching a database.

## 3. A demo seed for the hosted instance (D7, D4)

### How it is shipped

Follow `worker.js` exactly. Source at **`scripts/demo-seed.ts`**; esbuild bundles it in the
Docker build stage; the runner image carries the bundle beside `worker.js`; it runs with plain
`node` inside the demo app's container, which has no package manager, no TypeScript and no
`node_modules`.

- `package.json`: `"build:demo-seed": "esbuild scripts/demo-seed.ts --bundle --platform=node --target=node24 --format=cjs --outfile=dist/demo-seed.js --log-level=warning"`.
- `Dockerfile`, build stage: `RUN pnpm exec prisma generate && pnpm exec next build && pnpm run build:worker && pnpm run build:demo-seed`.
- `Dockerfile`, runner stage, next to the worker line:
  `COPY --from=build --chown=app:app /repo/dist/demo-seed.js ./demo-seed.js`.
- `.github/workflows/ci.yml`, verify job: `- run: pnpm run build:demo-seed` beside the existing
  `pnpm run build:worker` step, with the same reason in the comment.
- `.gitignore` already ignores `dist/`.

### How it is run

`docker exec` does not run the image's `ENTRYPOINT`, so the entrypoint allowlist does not strip
what is passed on the exec line, and none of these values needs to live in the container's own
environment. The owner URL is the one the `migrate` service uses.

```bash
# On the host, with $OWNER_URL and $DEMO_PW read from the demo app's Coolify environment
# into shell variables and never echoed (docs/RUNBOOK.md, "Demo instance").
APPC=$(sudo docker ps --format '{{.Names}}' | grep '^app-<demo-app-uuid>')
sudo docker exec \
  -e DATABASE_URL="$OWNER_URL" \
  -e INSTANCE_LABEL=DEMO \
  -e DEMO_USER_PASSWORD="$DEMO_PW" \
  "$APPC" node demo-seed.js
```

### Refusals, in this order, each named in the file header

1. `instanceLabel(process.env) === null` → exit 1, `[demo-seed] refusing: INSTANCE_LABEL is not set`.
2. `DEMO_USER_PASSWORD` missing, or shorter than the app's own `NEW_PASSWORD_MIN` → exit 1. Never
   a literal in the repository, never printed, never written to a log line.
3. `DATABASE_URL` missing → exit 1.
4. **Foreign data**: `count(Case where openedBy.username not in DEMO_USERNAMES) > 0` → exit 1,
   `[demo-seed] refusing: the database holds N cases opened by someone who is not a demo user`.
   The count is printed; no MRN and no username is.
5. **Foreign MRNs**, belt and braces: `count(Case where NOT mrn LIKE '999999%') > 0` → exit 1 with
   the same shape of message.

**Recorded deviation (Phase 12 review round, 11 September 2026): six refusals, not five, and the
one that matters is new.** What shipped inserts `APP_URL` as refusal 3 — missing, or a production
host through `assertDemoTarget` — and pushes the rest down one, so the whole-table counts are
refusals 5 and 6 and `DEMO_USERNAMES` is used by refusal 5. The reason is that nothing in this
list was a barrier where the command is actually run: `INSTANCE_LABEL` arrives on the exec line, so
refusal 1 says whatever the operator typed, and `DATABASE_URL`'s hostname inside the compose
project is `db` on production and on the demo alike, so the guard on it never fires there.
`APP_URL` is the container's own (`https://nav.towardpcc.com` versus
`https://demo-nav.towardpcc.com`), `docker exec` inherits it, and it is not passed on the exec
line — so a stray `-e INSTANCE_LABEL=DEMO` against the production container is refused.
`scripts/demo-seed.ts`, `src/lib/demo-guard.ts`, the `Dockerfile` comment and
`docs/RUNBOOK.md` say the same thing; `tests/db/demo-seed.test.ts` proves both halves.

### What it creates

**Four users.** All with `active: true`, all with the one password read from `DEMO_USER_PASSWORD`
hashed at cost 12 through the app's own `hashPassword`, and all with
`mustChangePassword: false` (item 5's flag, explicitly off, so fifteen people at a demo are not
each sent to `/account` on their first tap). Display names are obviously invented. Email addresses
use the reserved `.invalid` TLD (RFC 2606), so Admin → Users has a populated column and the
worker's log line reads "would have emailed" while nothing can ever leave the host.

| username | display name | role | email |
| --- | --- | --- | --- |
| `demo.nav.a` | Demo Navigator A | NAVIGATOR | `demo.nav.a@demo.invalid` |
| `demo.nav.b` | Demo Navigator B | NAVIGATOR | `demo.nav.b@demo.invalid` |
| `demo.charge` | Demo Charge Nurse | SUPERVISOR | `demo.charge@demo.invalid` |
| `demo.lead` | Demo Leadership (read-only) | VIEWER | `demo.lead@demo.invalid` |

Each username satisfies `USERNAME_RE` (3–32, lower-case letters, digits, dot, dash, underscore).
Exported from the module as `DEMO_USERNAMES` and used by refusal 4.

**MRN pattern.** `MRN_RE` is `/^\d+$/`: digits only, no length bound, so the pattern must be
chosen rather than derived. **Decision: a fixed prefix of six 9s and a two-digit ordinal, eight
digits in all — `999999` + `01` … `99`.** So the ten seeded cases are `99999901` to `99999910`.
It is valid under `MRN_RE`, it is not the 7-digit shape the hospital's own sheets use, it reads
as invented at a glance on the board and on paper, and six repeated 9s is not a prefix a real
record number begins with. Exported as:

```ts
export const DEMO_MRN_PREFIX = '999999'
export function demoMrn(n: number): string   // demoMrn(1) === '99999901'
```

`tests/demo/demo.spec.ts` moves its five MRNs (`5100231`–`5100235`, five consecutive plausible
7-digit numbers) onto the same prefix: `99999941`–`99999945`. Same builder, same commit.

**Ten cases**, all times computed from `now` at run time so the elapsed bands are right whenever
the seed is run, all opened by `demo.nav.a` or `demo.nav.b`, all with a stage, at least one
reason and a real-looking journey. `band()` is `ok` < 4 h, `h4` 4–6, `h6` 6–12, `h12` 12–24,
`h24` ≥ 24, so:

| # | MRN | status | registered | shows |
| --- | --- | --- | --- | --- |
| 1 | 99999901 | OPEN | 1 h 20 m ago | band `ok` |
| 2 | 99999902 | OPEN | 2 h 40 m ago | band `ok`, one update |
| 3 | 99999903 | OPEN | 4 h 45 m ago | band `h4`, a consult |
| 4 | 99999904 | OPEN | 8 h 10 m ago | band `h6`, two updates with action tags, a delay reason |
| 5 | 99999905 | OPEN | 15 h 30 m ago | band `h12`, an "Other" reason with its description |
| 6 | 99999906 | OPEN | 28 h ago | band `h24`, three updates, the longest stay |
| 7 | 99999907 | RESOLVED | 2 days ago | ADMITTED to a ward |
| 8 | 99999908 | RESOLVED | 4 days ago | DISCHARGED_HOME |
| 9 | 99999909 | RESOLVED | 7 days ago | TRANSFERRED, **with a referral number** on a reason that requires one |
| 10 | 99999910 | RESOLVED | 10 days ago | REFERRED_UCC |

Six open cases across all five bands, four resolved across ten days, so the board has every
colour, the dashboard's ranges and medians have something (four resolved is above `MIN_N = 3` for
the 30-day range), and the printed report is not empty. No `Alert` rows are seeded: the demo's
worker will fire 4 h, 6 h, 12 h and 24 h on cases 3–6 within one five-minute cycle, which is the
alert story the presenter shows.

**Idempotent.** A second run adds nothing and exits 0: users are `upsert`ed by username with no
change to an existing row's password (so a reset by hand survives), and each case is created only
when no `Case` with that MRN exists. The final line is a count summary
(`[demo-seed] users 4 (0 created), cases 10 (0 created)`) and nothing else.

### Tests

**Database — `tests/db/demo-seed.test.ts` (new)**, calling the module's exported
`runDemoSeed(deps)` rather than the process wrapper. Failing assertion to start from:
`await expect(runDemoSeed({ env: {} })).rejects.toThrow(/INSTANCE_LABEL/)` — the module does not
exist.

**It does not run against the shared `public` schema, and that is not a detail.** Refusals 4 and 5
are whole-table counts, which is the safety property and must not be scoped away — but it means
the happy-path assertions can never pass on the lead's local database. That database permanently
holds the Playwright fixture cases (60 today: 55 `e2e_navigator`, 3 `e2e_supervisor`,
2 `e2e_admin`, none demo-prefixed; `playwright.config.ts` declares a `globalSetup` and no
teardown, and `prisma/seed.ts` never touches `Case`), and the sibling `tests/db` files each create
more, deleting only their own ids in `afterAll`, while vitest runs files in parallel. Refusal 4
would fire before anything is created and tests 1, 2, 3, 4 and 7 below would throw instead of
seeding. (Corrected in the Phase 12 review round; the first draft said "against the lead's local
database like the other `tests/db` files".)

So:

- **`runDemoSeed(deps)` takes the client**: `deps` is `{ env?: NodeJS.ProcessEnv; prisma?: PrismaClient; now?: Date }`,
  defaulting to `process.env`, the shared `src/lib/db` client and `new Date()`. The process
  wrapper passes nothing. This is the only change the isolation asks of the module.
- **The test owns a schema.** `beforeAll` derives `TEST_URL` from `DATABASE_URL` with
  `schema=demo_seed_test`, runs `pnpm exec prisma migrate deploy` and then `pnpm exec tsx prisma/seed.ts`
  against it with `execFileSync` (`prisma/seed.ts` is what puts the stages, reasons, departments,
  ED areas and the `system` user there; give it `ADMIN_USERNAME`/`ADMIN_PASSWORD`/`ADMIN_DISPLAY_NAME`
  as the chain already does), then constructs its own `PrismaClient` on that URL and passes it in.
  `afterAll` does `DROP SCHEMA "demo_seed_test" CASCADE` and disconnects. Two CLI calls cost a few
  seconds once, so the file sets a generous `beforeAll` timeout; the whole-table counts are then
  true counts over a schema nothing else writes to, and the file cannot be disturbed by, or
  disturb, the parallel siblings or the Playwright fixtures.
- The file skips itself with a clear message when `DATABASE_URL` is unset, the way the rest of
  `tests/db` is excluded by `vitest.config.ts`.

Then, with `INSTANCE_LABEL=DEMO` and a `DEMO_USER_PASSWORD`:
1. Creates 4 users and 10 cases; every MRN starts with `DEMO_MRN_PREFIX`.
2. Every band appears exactly as the table above: map the six open cases through `band(elapsedHours(c, now))`
   and assert the set is `{ ok, ok, h4, h6, h12, h24 }`.
3. All four demo users have `mustChangePassword === false`.
4. A second run creates nothing: counts are identical and no user's `passwordHash` changed.
5. Refuses when a case exists whose creator is not a demo user: insert one non-demo user and one
   case of its own into the test schema (the e2e fixtures do not exist there), expect a throw
   naming the count, and assert nothing was created. Run this test after the idempotence test and
   clean the row up, so the schema is back to demo-only rows for anything that follows.
6. Refuses with a blank `DEMO_USER_PASSWORD`.
7. The resolved TRANSFERRED case has a referral number; the `h12` case has an "Other" reason with
   a description.

**Unit — `tests/unit/demo-seed-shipping.test.ts` (new), the dumb grep in the spirit of
`page-guards.test.ts`.** Failing assertions to start from, all three of which fail today:
`Dockerfile` contains `build:demo-seed` and `COPY … /repo/dist/demo-seed.js`; `package.json`
has the `build:demo-seed` script; `ci.yml` runs it. This is the test that stops the bundle
silently falling out of the image.

## 4. "MRN only, no names" on every free-text box (C4)

### Contracts

**New primitive in `src/components/ui/index.tsx`**, beside `Field` and `TimeRow`:

```tsx
export function MrnOnlyHint() {
  return <p data-mrn-hint className="mt-1.5 text-caption text-muted">MRN only, no names.</p>
}
```

Same wording, same classes, same component as the one line that exists today
(`CaseEditor.tsx:1214`), which is replaced by a call to it. Placed directly under each of the five
boxes in `src/components/cases/CaseEditor.tsx`:

| box | where | note |
| --- | --- | --- |
| Working diagnosis | `Field label="Working diagnosis (optional)"`, after the `DictationRow` | always rendered |
| Other-reason description | inside the `otherSelected && other` block, after the `DictationRow` | one per stage whose "Other" chip is on |
| Updates ("What changed?") | the existing line | replaced by the component |
| Resolution note | `Field label="Resolution note (optional)"`, after the `DictationRow` | resolve section, existing cases only |
| Void reason | `Field label="Why is this case voided?"`, after the `Input` | only when the void panel is open |

No other change: no new warning, no name-shaped detection. `phiWarnings` already covers four of
the five through the warnings channel and the audit's "soft warning for a name-shaped word" half
is explicitly out of scope for Phase 12.

`docs/PLAN.md:226` becomes true again; Slice 12C keeps the sentence and dates it.

### Tests

**E2E — `tests/e2e/cases.spec.ts`.** The failing assertion to start from is already in the file:
line 65 is `await expect(page.getByText('MRN only, no names.')).toBeVisible()`, and the moment a
second hint renders on the same screen Playwright's strict mode fails it with a
"resolved to N elements" violation. That is the fail-first proof. Replace it and add the counts:

- `/cases/new` as the navigator: `expect(page.locator('[data-mrn-hint]')).toHaveCount(1)` — the
  working diagnosis only (no updates section, no resolve section, no void panel on a new case).
- An existing OPEN case as the navigator: count 3 (diagnosis, updates, resolution note); select an
  "Other" reason chip and it becomes 4.
- The same case as the supervisor with the void panel open: the count goes up by exactly 1, and
  `expect(page.locator('[data-mrn-hint]').last()).toBeVisible()`.

Both viewports. Every hint has the exact text `MRN only, no names.`.

## 5. First password must be changed (P12)

### Contracts

**Schema, additive.** `model User` gains

```prisma
  /** Phase 12 (P12): set when an Admin creates the account or resets its password; cleared when
      the user sets their own at /account. While true, every signed-in page sends them there. */
  mustChangePassword Boolean @default(false)
```

Migration directory **`prisma/migrations/20260911120000_must_change_password/`**, one statement:
`ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;`. Existing
rows are untouched and read `false`, so the live admin and the seeded `system` account are not
locked out of the board by a deploy. `prisma/sync-app-role.ts` re-grants
`SELECT, INSERT, UPDATE, DELETE ON ALL TABLES` on every deploy, so the new column needs no grant
work.

**Where it is set.**

- `src/lib/admin/users.ts` `createUser`: the `tx.user.create` data gains `mustChangePassword: true`.
- `src/lib/admin/users.ts` `resetUserPassword`: the `tx.user.update` data gains
  `mustChangePassword: true`. Its `user.password` audit row's `after` gains
  `mustChangePassword: true` so the record says the account was left needing a change.
- `src/lib/auth/account.ts` `changePassword`: the `prisma.user.update` data gains
  `mustChangePassword: false`. Its `user.password` audit row's `after` gains
  `mustChangePassword: false`.
- `prisma/seed.ts` `seedFirstAdmin`: **unchanged**, `false` by default. The bootstrap admin's
  password lives in Coolify and P4 is Ahmed's to do; forcing a change from a seed would risk the
  deploy path.
- `scripts/demo-seed.ts`: explicitly `false` (item 3).

**Where it is read.** `AuthUser` gains `mustChangePassword: boolean` and `AUTH_USER_SELECT` gains
`mustChangePassword: true`. That is the only column added to the set allowed to leave the
database; `passwordHash` still never is.

**The redirect rule.** One choke point, `requireUser()` in `src/lib/auth/session.ts`, because
every signed-in page reaches it — directly, or through `requireAction()` / `requireRole()`, which
both call it. A layout is **not** used: `tests/unit/page-guards.test.ts` documents why (Next skips
ancestor layouts on an RSC request whose router state already holds the segment), and the
`(app)` layout would also loop on `/account`.

`requireUser` needs the path, so **`proxy.ts` sets it**: in `withCsp`, beside `x-nonce`,
`headers.set('x-pathname', request.nextUrl.pathname)`. Every request the gate lets through
carries it. `src/lib/auth/__tests__/route-gate.test.ts` gains an assertion that the gate and the
session module agree on the header name, in the same spirit as the cookie-name assertion it
already makes.

The rule, in `requireUser`, after a session is resolved. A page is redirected; an API caller is
refused, because a `fetch` cannot use a 307 to HTML — but it is refused, not waved through:

```
if (user.mustChangePassword) {
  if (opts.as === 'api') throw new UnauthorizedError()
  if (pathname !== '/account') redirect('/account')
}
```

> **Recorded deviation (Slice 12A, 11 September 2026): there is no `x-pathname` header. The
> exemption is an argument, `requireUser({ allowMustChange })`.** The two paragraphs and the block
> above are the design as specified and are kept for the record; what shipped is:
>
> ```ts
> function assertPasswordChanged(user: AuthUser, opts: RequireOptions): void {
>   if (!user.mustChangePassword) return
>   if (opts.as === 'api') throw new UnauthorizedError()
>   if (opts.allowMustChange) return
>   redirect('/account')
> }
> ```
>
> The header loops. A server action POSTs to the page it was invoked from, and Next renders the
> action's redirect destination inside that same request — so while `/account` is rendering, the
> header still says the page the action was called from (`/login` on sign-in). The guard fires
> again, the router is handed a payload whose URL and tree disagree, and the browser refetches
> `/account` for ever. `tests/e2e/auth.spec.ts` walking the real sign-in is the evidence.
>
> So `proxy.ts` sets no `x-pathname` at all — `src/lib/auth/__tests__/route-gate.test.ts:164`
> asserts its *absence*, which is the inverse of the assertion this spec asked for — and the
> exemption is passed by the exactly two callers that together are the render of `/account`: the
> `(app)` layout and `app/(app)/account/page.tsx`. A unit test keeps that list at two.
> `app/login/actions.ts` is the other half of the same fact: it sends an account that must change
> its password straight to `/account`, because a redirect out of the action's destination render
> has the same effect. Everything else below — one exempt path, sign-out untouched, server actions
> covered, API callers refused — is unchanged in substance; only the mechanism differs.

- **Exactly one exempt path, `/account`.** Nothing else. `/login` never calls `requireUser`.
- **Sign-out keeps working** without an exemption: `app/(app)/actions.ts` `logout` calls
  `getSession()`, not `requireUser()`, so it is untouched. So is the change-password action
  (`app/(app)/account/actions.ts` also uses `getSession()`).
- **Server actions are covered by the same rule and that is intended.** A server action POSTs to
  the URL of the page it was invoked from, so `x-pathname` is that page: an admin who must change
  their password cannot create a user, and a navigator cannot save a case. The two actions that
  call `requireUser()` are `app/(app)/admin/actions.ts:41` and `app/cases/actions.ts:32`.
  (Deviation, as above: neither action passes `allowMustChange`, so both are covered by the
  default — the outcome the sentence describes, reached without the header.)
- **API routes are not redirected, they are refused.** `{ as: 'api' }` throws `UnauthorizedError`,
  which all four route handlers already map to a 401 with `cache-control: no-store`
  (`app/api/board/route.ts:21`, `app/api/cases/[id]/summary/route.ts:28`,
  `app/api/export/count/route.ts:20`, `app/api/export.xlsx/route.ts:18`), so no handler changes.
  Answering a `fetch` with a 307 to HTML is the thing `requireUser` was built to avoid — but
  skipping the check is not the alternative. (Corrected in the Phase 12 review round. The first
  draft exempted every `{ as: 'api' }` caller on the ground that they are "reads behind a page
  that has already redirected". Three of the four are: `Board.tsx`, `RowSummaryButton.tsx` and
  `ExportPanel.tsx`'s count poll all use `fetch`. **`/api/export.xlsx` is not** — `ExportPanel.tsx:177`
  links it as a bare `<a href … data-download>`, a real top-level navigation that is bookmarkable
  and in browser history, and `parseExportRange` defaults every missing parameter, so even a bare
  `/api/export.xlsx` returns a seven-day workbook of MRNs. `proxy.ts` lets through anything
  carrying the session cookie, so nothing upstream catches it. A SUPERVISOR, ADMIN or VIEWER still
  on the temporary password an Admin read out across the ward desk could not open `/export` but
  could keep pulling the workbook by URL for ever — the exact indefinitely-shared credential this
  item exists to end.)
- **Missing header** (nothing but a direct unit call can produce that) is treated as "not
  `/account`", so the rule fails closed.

**What `/account` shows.** `app/(app)/account/page.tsx` renders, above the two cards, when
`user.mustChangePassword` is true:

```html
<p role="status" data-must-change class="…">Set your own password before you use the board. The one you were given is temporary.</p>
```

Tokens only, no dismiss control, no query parameter (the flag on the row is the whole truth, so a
hand-typed `/account` shows it too). The existing "Change password" `<h2>` and the form are
unchanged, so `tests/e2e/auth.spec.ts:110` keeps passing.

### Tests

**Unit — `src/lib/auth/__tests__/session.test.ts`.** Failing assertion to start from:
`expect(AUTH_USER_SELECT).toHaveProperty('mustChangePassword', true)`.

**Unit — `src/lib/auth/__tests__/route-gate.test.ts`.** Failing assertion to start from:
`expect(proxySource).toContain("x-pathname")`. (Deviation, as above: the header was never
shipped, so the assertion that stands is its inverse — `route-gate.test.ts:164`
`expect(proxy).not.toContain('x-pathname')` — with the same file's grep over `app/` holding the
`allowMustChange` callers to two.)

**Database — `tests/db/admin.test.ts` and `tests/db/auth.test.ts`.** Failing assertions to start
from:
- `createUser` → the row has `mustChangePassword === true`.
- `resetUserPassword` → the row has `mustChangePassword === true`, and the `user.password` audit
  row's `after.mustChangePassword` is `true`.
- `changePassword` → the row has `mustChangePassword === false` afterwards, and the audit row says
  so.
- An existing row created before the migration (insert with the column defaulted) reads `false`.

**E2E — `tests/e2e/auth.spec.ts`, at both viewports.** Failing assertion to start from:
`await expect(page).toHaveURL(/\/account$/)` after signing in as a user whose flag is true — today
the board renders. The whole journey, using the admin UI so the flag is set the way it will be in
life:

1. `e2e_admin` creates a user in Admin → Users and reads the one-shot temporary password.
2. That user signs in and lands on `/account`, not `/`. `[data-must-change]` is visible.
3. Navigating to `/`, `/dashboard`, `/cases/new` and `/export` each redirect back to `/account`.
4. Sign out works from `/account` (the menu's sign-out reaches `/login`).
5. Signing back in still lands on `/account`.
6. Changing the password succeeds; the user is then on `/account` signed in with the new session,
   `[data-must-change]` is gone, and `/` now renders the board with its `ER board` heading.
7. `e2e_admin` presses Reset password on that user; the user's next sign-in lands on `/account`
   again.
8. **The API is refused too, not only the pages.** While the flag is still set, that user's
   context requests `/api/export.xlsx?from=…&to=…&status=all&format=qch` and a bare
   `/api/export.xlsx`, and both answer 401 with no workbook body; `/api/board` answers 401.
   Failing assertion to start from: `expect(response.status()).toBe(401)` — today, and under the
   first draft of this item, it is 200 with the whole MRN workbook. Added in the Phase 12 review
   round; use a SUPERVISOR-role account, since `export.xlsx` is a SUPERVISOR/ADMIN/VIEWER action.

**Regression:** every *seeded fixture* account has the column defaulted to `false`
(`tests/e2e/fixtures/seed-users.ts` upserts a `passwordHash` directly), so every suite that signs
in as `e2e_navigator`, `e2e_supervisor`, `e2e_admin` or `e2e_viewer` is untouched. **Two files
mint an account at run time through Admin → Users instead, and both must be updated in this same
commit** — they go through `createUser`, which this item changes. (Corrected in the Phase 12
review round: the first draft said the existing suite stays green *unchanged*, which is false for
these two.)

- **`tests/e2e/admin.spec.ts`**, "an admin creates a user, that user signs in, and deactivating
  them locks them out". Line 92 is `await expect(their).toHaveURL('/')` right after the new
  account signs in with its one-shot temporary password; under this item it lands on `/account`.
  Change that assertion to `/account`, assert `[data-must-change]` is visible there, and leave the
  deactivation lock-out steps that follow (`:96-110`) as they are — `their.goto('/')` already
  expects `/login` once the account is deactivated, and that is unaffected. This is a CI file: it
  runs in the desktop project on every push, so leaving it is a red gate, not a latent problem.
- **`tests/demo/demo.spec.ts`**, the Phase 11 demo kit. Its `signIn` helper (`:79-86`) ends with
  `await expect(page).toHaveURL('/')`, and all four staff accounts — Nadia, Omar, Sara, Huda — are
  created through the Admin UI at run time (`:398-411`) and signed in with the temporary password.
  Only Nadia ever changes hers, and only after her first sign-in has already asserted `/`. The
  file is `mode: 'serial'`, so test 2 fails and tests 3–7 skip: the whole kit collapses. Give
  `signIn` a third argument, `expect: '/' | '/account'` defaulting to `'/'`, pass `'/account'` for
  each first sign-in with a temporary password, and have Omar, Sara and Huda change their password
  at `/account` the way Nadia already does before the script continues. Same builder, same commit
  as the MRN-prefix move of item 3. The kit is not in CI, but Slice 12C item 3 grounds
  `docs/guide/demo-script.md` in this file's sequence, so a kit that cannot run is a document that
  cannot be written.

## 6. An alert email that fails twice is not lost silently (C1)

### What the code does today

`cycle.ts:182-186`: `sendWithOneRetry` returns `null` after two failures, the summary's
`emailsFailed` is incremented, and the loop continues. The `Alert` row is already committed by
`store.fire()` inside its transaction, and `firedThresholds()` feeds `thresholdsDue()`, which
skips any threshold that already has a row — so the next cycle does nothing for it, for ever.
`worker/alerts.ts:157-166` touches the heartbeat and GETs the Kuma push URL unconditionally,
because the failure never throws. Admin → Alerts renders `emailSentAt` as "–", which is the only
trace and is indistinguishable from "not due for email".

### Contracts

**Schema, additive.** `model Alert` gains

```prisma
  /** Phase 12 (C1): how many send attempts this alert's email has cost, and when the last one
      failed. The unique index on (caseId, thresholdHours) is unchanged: a retry never inserts. */
  emailAttempts Int       @default(0)
  emailFailedAt DateTime?
```

Migration directory **`prisma/migrations/20260911120500_alert_email_attempts/`**:
`ALTER TABLE "Alert" ADD COLUMN "emailAttempts" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "emailFailedAt" TIMESTAMP(3);`
The app role already holds `UPDATE` on `Alert` (only `DELETE` is revoked), and the privilege guard
in CI asserts exactly that, so no privilege change and no change to the guard.

**New audit action** `'alert.email.failed'` in `src/lib/audit.ts`'s `AuditAction` union, and in
the comment on `model AuditLog.action` in the schema. Entity `'Alert'`, `entityId` the alert id,
`after: { caseId, thresholdHours, attempts }`. MRN-free: the case is named by id, not by MRN. The
actor is the system user, exactly as `alert.fire` is. Written by the store inside the same call
that increments the counter.

**`AlertStore` gains two methods** (`src/lib/alerts/cycle.ts` type, `src/lib/alerts/store.ts`
implementation):

```ts
/** Alerts that are due an email, have not had one, and have not exhausted their attempts. */
pendingEmails(now: Date): Promise<PendingEmail[]>
/** +1 attempt, stamp emailFailedAt, write the alert.email.failed audit row. One transaction. */
markEmailFailed(alertId: string, at: Date): Promise<void>
```

`PendingEmail` is `{ alertId, caseId, thresholdHours, attempts }` plus the `AlertCase` fields the
email template needs (`mrn`, `primaryReason`, `departments`, and the clock fields for
`elapsedHours`). `pendingEmails` selects `Alert` rows where `emailSentAt IS NULL`,
`thresholdHours >= EMAIL_THRESHOLD_H`, `emailAttempts < EMAIL_MAX_ATTEMPTS`, and **the case is
still `OPEN`** — a patient who has left is not escalated, which is the same rule
`thresholdsDue()` states. Ordered by `firedAt` ascending, capped at 50 per cycle.

**`EMAIL_MAX_ATTEMPTS = 10`** in `src/lib/alerts/rules.ts`, beside `EMAIL_THRESHOLD_H`. Ten
attempts, one per cycle, is roughly fifty minutes of a broken mail server for an alert at the head
of the queue before the worker stops trying and leaves the row visibly failed — longer for one
behind a large backlog, because the budget below can push it into a later cycle. Beyond ten the
alert is not retried and the cycle logs the count once, at warn.

**`RETRY_PASS_BUDGET_MS = 60_000`**, beside it. The retry pass stops when it has spent that much
wall-clock time and leaves the rest of the queue for the next cycle. It is the second bound, and
the load-bearing one: the count cap alone does not bound time. `CycleDeps` gains
`clock?: () => number`, defaulting to `Date.now`, read only by this budget — the same shape as the
injected `sleep` the file already carries, so the unit test can advance time without waiting.

**The cycle** (`runAlertCycle`) gains a **retry pass that runs first**, before the firing loop, so
a backlog is cleared before new work is made:

```
if (mailer) {
  const deadline = clock() + RETRY_PASS_BUDGET_MS      // clock: () => number, defaults to Date.now
  for (const pending of await store.pendingEmails(now)) {
    if (clock() >= deadline) { summary.emailsDeferred += 1; continue }       // next cycle takes it
    const to = await recipientAddresses(); if (to.length === 0) break
    // retryDelayMs: 0 — the next cycle IS the retry, five minutes from now. Paying the 30 s
    // in-pass sleep here would multiply the backlog by half a minute a head.
    const sent = await sendWithOneRetry(mailer, message, logger, sleep, 0)
    if (sent) { await store.markEmailSent(pending.alertId, now); summary.emailsRetried += 1 }
    else      { await store.markEmailFailed(pending.alertId, now); summary.emailsFailed += 1 }
  }
}
```

**Why the two bounds, and not just the cap of 50.** (Added in the Phase 12 review round; the first
draft had the pass call `sendWithOneRetry` with its ordinary delay and bounded it only by count.)
`sendWithOneRetry` does `await sleep(EMAIL_RETRY_DELAY_MS)` — 30 s — between its two attempts,
unconditionally, and `worker/alerts.ts` injects neither `sleep` nor `retryDelayMs`, so production
pays the real 30 s. With the mail server down, a pass over a backlog costs at least 30 s a head
plus the SMTP timeouts `smtp.ts:53-55` bounds (10 s connect, 10 s greeting), so about 50 s each.
`heartbeat(config.heartbeatFile)` and the Kuma push run only after `runAlertCycle` resolves, and
`if (running || stopping) return` drops every intervening five-minute tick, so a slow pass is
silent as well as long. Eighteen pending alerts would then breach the 900 s the compose
healthcheck allows (`docker-compose.production.yml:162`) and the cap of 50 would allow 1500–2500 s
— the worker reported unhealthy and Kuma paging, for a locked mailbox, which is precisely the page
this item is written to avoid. `smtp.ts`'s own final-review note names the hazard for the firing
loop; what this item adds is a *persistent* backlog replayed at the top of every cycle, so one bad
hour would re-stall the worker on every tick. With a single attempt per alert per cycle and a
60 s wall-clock budget, the pass is a fifth of the five-minute tick and a fifteenth of the
heartbeat window whatever the backlog, and `tests/unit/phase12-spec.test.ts` checks that
arithmetic against the compose file and `worker/alerts.ts` rather than against this paragraph.

and the **first-attempt failure path changes** from "increment a counter and continue" to
`await store.markEmailFailed(outcome.alertId, now)` before incrementing `emailsFailed`.

**Blank SMTP is untouched.** When `mailer` is `null` the retry pass does not run at all: nothing
is attempted, nothing is counted as failed, no audit row is written, and the existing
"SMTP_HOST is empty; would have emailed …" info line is the whole behaviour. This is the one rule
the demo instance depends on (see "Blank SMTP" below).

**`CycleSummary`** gains `emailsRetried: number`, `emailsPending: number` (how many
`pendingEmails` returned) and `emailsDeferred: number` (how many the budget left for the next
cycle). All three appear in the worker's `[alerts] cycle done` line, so a backlog that is being
worked through is visible in the log rather than inferred from a slow cycle.

**Admin → Alerts** (`src/lib/alerts/service.ts` `AlertRow`, `src/components/admin/AlertsPanel.tsx`):
`AlertRow` gains `emailAttempts: number` and `emailFailedAt: string | null`. The "Emailed" cell,
today `{row.emailSentAt ? fmtStamp(row.emailSentAt) : '–'}`, becomes: the timestamp when sent;
`Failed ×{n}` in `text-band-h6` when not sent and `emailAttempts > 0`; `–` otherwise. Tokens only.

**The heartbeat and the Kuma push are not changed**, and the two bounds above are what keeps that
honest. The audit offered "let the heartbeat go stale" as the cheap alternative; this item builds
the durable trace and the retry instead, because marking the worker "down" for a locked mailbox
pages for the wrong thing. That argument only holds while a cycle cannot outrun the healthcheck:
`heartbeat()` and the Kuma push run after `runAlertCycle` resolves, so an unbounded retry pass
would have produced exactly the page it claims to avoid, naming the wrong cause. With one attempt
per alert per cycle and `RETRY_PASS_BUDGET_MS`, a cycle stays a fifth of the tick. Recorded so the
reviewer does not read it as an omission. (The reasoning, not the decision, was corrected in the
Phase 12 review round.)

### Tests

**Unit — `src/lib/alerts/__tests__/cycle.test.ts`**, the existing file, with the existing fake
mailer and injected clock and sleep. Failing assertions to start from:

1. A mailer that throws twice: `store.markEmailFailed` was called once with the alert id, and the
   summary reads `emailsFailed: 1` — today no such method is called.
2. The **next** cycle, with `pendingEmails` returning that alert and a mailer that now succeeds:
   `emailsRetried: 1`, `markEmailSent` called, `markEmailFailed` not called. This is the assertion
   C1 exists for; it fails today because there is no second pass.
3. A pending alert whose case has been resolved is not returned by the store's query (asserted in
   the database test) and, if handed to the cycle anyway, is still emailed — the store owns that
   rule, and the test says so, so the two do not both claim it.
4. `emailAttempts >= EMAIL_MAX_ATTEMPTS` is excluded (store-level; the cycle test asserts the
   constant is exported and used).
5. **Blank SMTP**: `mailer: null` with two pending alerts → `pendingEmails` is not called,
   `markEmailFailed` is not called, `emailsFailed` is 0, and the existing `emailsLogged` behaviour
   for a newly fired 6 h alert is unchanged.
6. The unique-index behaviour is unchanged: a `duplicate` outcome is still counted and skipped and
   never emailed.
7. **The pass pays no 30 s sleep** (added in the Phase 12 review round): with three pending alerts
   and a mailer that always throws, the injected `sleep` is never called with
   `EMAIL_RETRY_DELAY_MS` — the fail-first assertion is
   `expect(sleeps).not.toContain(EMAIL_RETRY_DELAY_MS)`, which fails today because the pass would
   hand the helper its default delay.
8. **The budget stops the pass** (same): with an injected clock that jumps past
   `RETRY_PASS_BUDGET_MS` after the second send, twenty pending alerts produce two attempts, the
   rest are counted in `emailsDeferred`, no further `markEmailFailed` is called, and the summary
   still adds up. The next cycle picks the remainder up in `firedAt` order.

**Database — `tests/db/` (a new `alerts.test.ts`, or the existing coverage extended).** Failing
assertion to start from: `prismaAlertStore(...).pendingEmails(now)` does not exist. Then: a fired
6 h alert with `emailSentAt` null on an OPEN case is returned; the same on a RESOLVED case is not;
one at 4 h is not (below `EMAIL_THRESHOLD_H`); one with `emailAttempts = 10` is not;
`markEmailFailed` increments the counter, stamps `emailFailedAt` and writes exactly one
`alert.email.failed` audit row with `after.attempts`; two calls give `emailAttempts = 2` and two
audit rows; no `Alert` row is ever inserted by a retry (count unchanged).

**E2E — `tests/e2e/admin.spec.ts`.** Failing assertion to start from:
`await expect(row.getByText('Failed ×2')).toBeVisible()` on `/admin/alerts` for a fixture alert
seeded with `emailAttempts: 2, emailSentAt: null` (`tests/e2e/fixtures/admin-cases.ts` already
seeds a fired alert; give it the two new fields). Both viewports.

## 7. Export and print leave an audit row (C2)

### Contracts

**Two new audit actions**, named for the two policy actions they record so the audit log and the
permission matrix use one vocabulary — and dotted, like every action already in the union:

```ts
  /** Phase 12 (C2): a workbook was downloaded. after: { format, from, to, status, filter, cases } */
  | 'export.xlsx'
  /** Phase 12 (C2): the printable report was rendered. after: { from, to, status, filter } */
  | 'report.print'
```

Added to `AuditAction` in `src/lib/audit.ts` and to the `action` comment on `model AuditLog` in
the schema.

**Entities.** `entity: 'Export'` and `entity: 'Report'`, `entityId: null`. Neither is a row in a
table; the `@@index([entity, entityId])` still works and Admin → Audit renders them like any
other row.

**Where they are written.**

- `src/lib/export/service.ts` `exportWorkbookResponse`, on the **successful** path only, replacing
  the `console.info` at :81-83 (keep the console line as well — it is what an operator greps in
  container logs). The row is written after the rows are loaded and before the response is built,
  with `audit()` on the plain client (not in a transaction: there is no mutation to bind it to).
  `after` is `{ format: range.format, from: range.from, to: range.to, status: range.status, filter: filterQuery, cases: cases.length }`,
  where `filterQuery` is `caseFilterQuery(range.filter) || null` — the same serialisation the URL
  carries — plus `filterDescription: filterLine ?? null`, the words the workbook prints.
- `app/report/page.tsx`, after `requireAction('report.print')` and after the range is parsed, with
  `after` `{ from, to, status, filter: filterQuery, filterDescription }`. The report page is
  `force-dynamic`, so one row per render — which is the fact C2 asks for: who opened a page of
  MRNs, over what range.
- The **refusal** paths are unchanged: `assertCan` already writes `auth.forbidden` with the format.
- `exportCountResponse` writes **no** row. It is polled as the nurse moves the dates and would
  bury the log; the count is not the data.

**MRN-free.** `describeFilter` composes stage, reason, area, department, CTAS, payer and
disposition names — no MRN, no free text, no patient identifier. Asserted by a test rather than
by reading.

`src/lib/export/service.ts`'s header comment (":10-12", "An export is a read, so there is no
audit row") is rewritten to state the new decision and why it changed.

### Tests

**Unit — `tests/unit/phi-guard.test.ts` or a new assertion beside it.** Failing assertion to start
from: for a filter covering every dimension, the audit `after` payload built by the export path
contains no `\d{6,}` run. (The existing PHI guard reads the schema; this is the same idea applied
to the one new payload.)

**Database — `tests/db/export.test.ts`.** Failing assertions to start from, both of which fail
today because the row does not exist:
1. A SUPERVISOR downloading the workbook produces exactly one `export.xlsx` audit row whose
   `actorId` is the supervisor and whose `after` carries the format, the range, the status and the
   row count.
2. A NAVIGATOR refused produces an `auth.forbidden` row and **no** `export.xlsx` row.
3. Polling the count endpoint produces no row.
4. A filtered export's row carries both `filter` (the query serialisation) and
   `filterDescription` (the words), and neither contains a digit run of six or more.

**Database — the report.** The report page cannot be driven from `tests/db`; assert it in e2e
instead, and unit-test the payload builder if the builder is extracted.

**E2E — `tests/e2e/export.spec.ts`.** Failing assertion to start from: after the supervisor opens
`/report?from=…&to=…`, Admin → Audit (as `e2e_admin`) shows a `report.print` row for that actor —
today there is none. Both viewports; the audit screen already filters by action.

### Left to Ahmed

Whether VIEWER should keep `export.xlsx` at all (the audit's C2 second half) is a change to the
locked permission matrix and is **not** made here. Recorded in Slice 12C's Phase 12 plan section
as an open decision.

## 8. Login rate limit per instance (P3)

### Contracts

**Environment variable** `LOGIN_RATE_LIMIT_PER_MINUTE`, integer. Unset in production, where the
limit stays exactly 5. Added to the `KEEP` allowlist in `docker/entrypoint.sh` and to the `app`
service in `docker-compose.production.yml` as `LOGIN_RATE_LIMIT_PER_MINUTE: ${LOGIN_RATE_LIMIT_PER_MINUTE:-}`.
Not on the worker.

**`src/lib/auth/rate-limit.ts`**:

```ts
export const DEFAULT_LOGIN_RATE_LIMIT = 5
/** The configured limit, or the default when unset, blank, not an integer, < 1 or > 1000. */
export function loginRateLimitFrom(env: NodeJS.ProcessEnv = process.env): number
export const LOGIN_RATE_LIMIT = loginRateLimitFrom()
export const LOGIN_RATE_WINDOW_MS = 60_000
export const loginRateLimiter = new SlidingWindowLimiter(LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS)
```

`LOGIN_RATE_LIMIT` keeps its name and its type, so `app/login/actions.ts` and every existing
import and test are untouched. The window stays 60 s: only the count is configurable. A bad value
never throws — the login page must not fail to render because someone typed `five`.

The module's header comment gains a paragraph: what the variable is for (fifteen staff behind one
hospital NAT address at a demo), that raising it raises the brute-force ceiling in the same
proportion, and that the 10-failure / 15-minute account lockout is the control that does not move.
The demo instance sets `LOGIN_RATE_LIMIT_PER_MINUTE=60`; production leaves it unset.

### Tests

**Unit — `src/lib/auth/__tests__/rate-limit.test.ts`**, the existing file. Failing assertion to
start from: `expect(loginRateLimitFrom({})).toBe(5)` — the function does not exist. Then:
`{ LOGIN_RATE_LIMIT_PER_MINUTE: '60' }` → 60; `''`, `'five'`, `'0'`, `'-3'`, `'1.5'` and `'99999'`
each → 5; a limiter built at 60 admits 60 attempts in one window and refuses the 61st, with the
injected clock the file already uses.

**Unit — the allowlist.** `tests/unit/` gains (or extends) a grep test asserting that every
variable the app reads at runtime is on `docker/entrypoint.sh`'s `KEEP` list:
`INSTANCE_LABEL`, `LOGIN_RATE_LIMIT_PER_MINUTE` and the existing `REPORT_HEADER`. Failing
assertion to start from: `expect(keepList).toContain('INSTANCE_LABEL')`. This is the test that
stops the demo silently behaving like production because a variable was stripped at start-up.

## 9. Patient files out of git (P16)

### Contracts

Appended to `.gitignore`, with the comment:

```gitignore
# Patient data must never be committed (readiness audit P16). Extensions, not paths, so a
# spreadsheet dropped anywhere in the tree is ignored. `*.xlsx` also matches DIRECTORY names,
# and git will not descend into an ignored directory, so the export route's directory has to be
# un-ignored itself before its contents can be — both lines, directory first, and in this order.
*.xlsx
*.xls
*.csv
!app/api/export.xlsx/
!app/api/export.xlsx/**
```

The path is `app/api/export.xlsx/`, **not** `src/app/api/export.xlsx/`: this repository has no
`src/app`, and the audit's first proposal would have left the route directory silently ignored.
Nothing tracked today matches any of the three extensions (`git ls-files` over
`\.(xlsx|xls|csv)$` is empty), so no `git rm --cached` is needed and no history changes.

Only the three spreadsheet extensions. `.pptx`, `.docx`, `.pdf`, `.sql.gz` and `.dump` from the
audit's list are **not** added: `design/` and `docs/` may legitimately want a PDF or a deck, and
the dumps live on the host and in the bucket, never in this tree. Recorded so the reviewer does
not read it as an omission.

### Tests

**Unit — `tests/unit/gitignore.test.ts` (new).** Runs `git check-ignore -q <path>` per case with
`execFileSync` from the repository root (exit 0 = ignored, exit 1 = not, anything else = fail the
test), and skips the whole file with a clear message if git is not on the PATH. Failing assertions
to start from, all of which fail today:

| path | expected |
| --- | --- |
| `patients.xlsx` | ignored |
| `data/import/august-2026.xlsx` | ignored |
| `import/ward-list.csv` | ignored |
| `docs/old-sheet.xls` | ignored |
| `app/api/export.xlsx/route.ts` | **not** ignored |
| `app/api/export.xlsx` | **not** ignored |
| `src/lib/export/qch.ts` | **not** ignored |
| `app/layout.tsx` | **not** ignored |
| `prisma/migrations/20260908190000_init/migration.sql` | **not** ignored |

The last four are the regression half: they are what makes the test refuse the audit's original
proposal.

## 10. Dependabot (P6, P19)

### Contracts

Read all four with `gh pr view` / `gh pr diff` first. **Never close a pull request and never
comment on one** — a merged-equivalent change on `main` closes it by itself.

**Apply locally, in one commit** to `.github/workflows/ci.yml` (both jobs use each action):

| PR | change | why it is safe |
| --- | --- | --- |
| #1 | `pnpm/action-setup@v4` → `@v6` | CI-only; the version comes from `packageManager` in `package.json`, which is unchanged |
| #3 | `actions/setup-node@v5` → `@v7` | CI-only; `node-version-file: .nvmrc` (24) is unchanged |
| #4 | `actions/checkout@v5` → `@v7` | CI-only |

`actions/cache@v4` and `actions/upload-artifact@v4` have no open PR and are not touched.

**PR #2 (`node:24-alpine` → `node:26-alpine` in the Dockerfile) is left untouched.** It is the one
that breaks the build: `package.json` pins `engines.node ">=24 <25"` and `.npmrc` sets
`engine-strict=true`, so `pnpm install --frozen-lockfile` aborts in the `deps` stage and every
downstream stage fails; CI never builds the Dockerfile (`ci.yml` uses `.nvmrc` = 24), so its green
check is meaningless. The changelog line records exactly that, in one sentence, so the next person
does not merge it in a hurry.

`.github/dependabot.yml` is **not** changed. The audit suggested an ignore rule for docker `node`
semver-major updates; that would suppress the PR rather than leave it visibly refused, and
suppressing it is Ahmed's call, not a code change. Recorded in the Phase 12 plan section as an
open decision.

### Tests

The chain is the test: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`,
`pnpm run build:worker`, `pnpm run build:demo-seed` and the Playwright suite all run under the new
action versions on the pull request that carries this phase, and the four PRs are re-listed with
`gh pr list` in the gate report to show which closed themselves. There is no unit test for a CI
file; the fail-first here is the CI run itself.

---

# Contracts that stay

- MRN only. No patient name, national ID or date of birth reaches any new surface, any new audit
  payload or any new log line. The banner text, the hint, the two new audit rows and the demo
  seed's summary are all MRN-free by construction, and three tests say so.
- `CaseUpdate` and `AuditLog` stay append-only in code and at the database role. The privilege
  guard in CI keeps asserting `f|f|f|f|f|f|f|f`.
- The `Alert` unique index on `(caseId, thresholdHours)` is unchanged, and a retry never inserts a
  row.
- The permission matrix in `src/lib/authz/policy.ts` is unchanged: no action added, no role moved.
  `export.xlsx` and `report.print` reappear as audit action names, deliberately spelled the same.
- Every selector the suites already use: `a[data-mrn][data-band]` one per board row,
  `[data-summary-for]`, `[data-login-hero]`, `[data-login-card]`, `[data-handover-mark]`, the
  board's `/?f=` and `/?q=` serialisation, the dashboard's `section > h3` order, and every
  heading name and `aria-label` the specs count. The banner adds a `<div>`, never a heading.
- `metadata.title` on every page, the manifest name, the theme colour and the report header string
  are untouched by 12A (the demo's header comes from `REPORT_HEADER`, which already exists).
- No new runtime dependency. `esbuild`, Prisma, zod, Playwright and Vitest are all already here.
- `docker/entrypoint.sh` keeps stripping everything not on `KEEP`; two names are added to that one
  line and a test now asserts they are there.
- Production behaviour with `INSTANCE_LABEL` unset and `LOGIN_RATE_LIMIT_PER_MINUTE` unset is
  byte-identical to today, and the existing 198-test Playwright suite at both viewports is the
  proof.

## New environment variables, in one place

| Name | Default | Read by | On the entrypoint allowlist |
| --- | --- | --- | --- |
| `INSTANCE_LABEL` | unset (production) | `src/lib/instance.ts`, the banner, the demo guard, the demo seed | yes (new) |
| `LOGIN_RATE_LIMIT_PER_MINUTE` | 5 | `src/lib/auth/rate-limit.ts` | yes (new) |
| `DEMO_USER_PASSWORD` | unset | `scripts/demo-seed.ts` only, passed on the `docker exec` line | **no**, and deliberately: it never lives in the app process |

`REPORT_HEADER` already exists and is already on the allowlist; the demo sets it to
`DEMO. Qatif Central Hospital, Emergency Department. ER Navigator`. It is missing from the
RUNBOOK's environment table (P14) — Slice 12C adds the row.

## Blank SMTP: verified, and what it means

Read from the code, not assumed. `readSmtpConfig` (`src/lib/alerts/smtp.ts:26-37`) returns `null`
the moment `SMTP_HOST` is empty or unset. `worker/alerts.ts:134` therefore builds `mailer = null`
and its start-up line at `:140` reads `email: 'log only (SMTP_HOST empty)'`; `runAlertCycle` takes the
`if (!mailer)` branch at `cycle.ts:173-180`, counts the alert in `emailsLogged` and logs
`SMTP_HOST is empty; would have emailed …`. `node worker.js --test <address>` refuses outright
(`alerts.ts:88-90`). An empty `ALERT_PUSH_URL` gives `pushUrl: null` and `pushMonitor: 'none'`.

**So a demo instance with all five `SMTP_*` blank and `ALERT_PUSH_URL` blank is log-only, records
every Alert row, and sends nothing. 12A changes nothing to make that true**, and item 6 is written
so it stays true: the retry pass is skipped entirely when `mailer` is `null`, so blank SMTP
produces no failed attempts, no `emailFailedAt` and no `alert.email.failed` rows.

One consequence worth saying out loud in the demo script: on the demo the 6 h+ alerts appear on
Admin → Alerts with "Emailed: –", and that is correct, not a fault.

---

# Slice 12C — documents only, no code

No file under `app/`, `src/`, `prisma/`, `scripts/`, `worker/`, `tests/` or the Docker and compose
files is touched. Dates are written as "corrected 11 September 2026" so the next reader knows when
the statement was last checked.

## 1. Stale statements (P24, X1–X5)

- `docs/RUNBOOK.md:11`, the Repository row, says the branch is `main`, **private**. It is public
  until Ahmed flips it (P7). Correct the row and add the one-line note that going private is
  Ahmed's step and that the deploy key and the push webhook survive it (X9).
- `docs/RUNBOOK.md:103-113`, the environment table, has no `REPORT_HEADER` row (P14). Add it, with
  its default, that it is on the entrypoint allowlist, and that it is an environment variable and
  not a settings row. Add rows for `INSTANCE_LABEL` and `LOGIN_RATE_LIMIT_PER_MINUTE` in the same
  pass, and a line saying `DEMO_USER_PASSWORD` is passed on a `docker exec` line and is not an
  application variable.
- `docs/PLAN.md:393` (Section 9 item 3) says alerts stay log-only until DKIM passes and names DKIM
  on `towardpcc.com`. Both are now wrong: the worker is in send mode, and the sending mailbox is on
  the secondary domain, which publishes its own SPF, DKIM selector and DMARC. `towardpcc.com`'s SPF
  `-all` and DMARC `p=reject` stay exactly as they are and are not this app's to touch. Correct the
  paragraph; the one thing still open is the test send itself (P8), which is Ahmed's.
- `docs/PLAN.md` Section 0, the "Still with Ahmed" bullet, lists the first admin sign-in, the SMTP
  entry, the Kuma monitors and the Cloudflare TLS settings as outstanding. All four are done
  (X1–X4: three `auth.login` rows, all five `SMTP_*` set, both monitors live with the push URL in
  Coolify, TLS 1.0/1.1 refused and 1.2/1.3 serving). Rewrite the bullet to what is genuinely still
  with Ahmed: the admin **password change** (P4), the hospital authorisation (P1), the repository
  flip (P7), the SMTP test send (P8), recipients (P9), the roster (P10), the reference lists (P13)
  and the cutover (P23). Also correct `PLAN.md:377` (the push monitor "waits for Ahmed" — it is
  live), `PLAN.md:395` (the header "held in a settings row" — there is no `Setting` model),
  `PLAN.md:62` (the mark is a placeholder — X5, the Envato cross is in), `PLAN.md:94` (Dependabot
  keeps npm current — the npm updater has never opened a PR; A1) and `PLAN.md:35,95,127` plus
  `RUNBOOK.md:150,152` (the laptop mirror exists — it has never worked; P15).
- `docs/PLAN.md:226` claims every free-text box carries the "MRN only, no names" hint. **Keep the
  sentence** — Slice 12A item 4 makes it true again — and add the date it became true.

## 2. `docs/guide/nurse-quick-guide.md` (P21)

One printable page for a navigator, plain words, no screenshots, no jargon, nothing an operator
would need SSH for. In this order: signing in on your own phone (and adding it to the home
screen); **change your password the first time** (12A item 5 now sends you there); opening a case
— MRN only, never a name, and the real registration time; the chips (stage, reason, ED area,
CTAS); adding updates and delay reasons as the shift moves; resolving a case; printing the
handover sheet at shift change; the phone tips (the sticky strip on a long case page, "+ New
case", the board's search); what the elapsed colours mean (under 4 h, 4 h, 6 h, 12 h, 24 h and
what each one is asking of you); signing out on a shared computer; what to do when the site is
down (WhatsApp stays the fallback); and who to contact — a named first line for password resets, a
named second line for wrong data or an outage. The contact names are placeholders Ahmed fills
(P22).

## 3. `docs/guide/demo-script.md` (D10)

A 15-minute presenter script for the hosted demo, in the order of `tests/demo/demo.spec.ts` —
which is the sequence the app was actually walked through in Phase 11 — with a hands-on handoff
and a hard finish on the dashboard and the report. Shape: 2 minutes on the WhatsApp problem and
what this replaces; 2 minutes signing in on a phone; 3 minutes a navigator opening a case
(MRN only, the real registration time, chips, an update); 2 minutes the board (bands, counts, the
filter, the handover sheet in print preview); 2 minutes working a case to Resolve; 2 minutes the
charge nurse reviewing and pulling the workbook; 2 minutes leadership on the dashboard and the
printed report. Then the handoff: everyone signs in as one of the four demo accounts and opens a
case themselves, while usernames and work emails are collected for P10. Lines the presenter must
say out loud: every patient here is invented, the banner says so; alert emails are only logged on
the demo; nothing typed here reaches the real system. A prompt list of the questions to expect and
the honest answers (who sees what, what happens when the site is down, how long data is kept —
"being agreed", C10).

## 4. `docs/RUNBOOK.md`, a "Demo instance" section

Written from this spec, before 12B provisions anything; 12B corrects it afterwards with the real
uuids and record ids. It states: the application name `er-navigator-demo` in a new Coolify project
`demo`; the subdomain `demo-nav.towardpcc.com`, proxied; the same repository, branch and compose
file as production; its own database volume and its own secrets, none shared; what is blank there
(all five `SMTP_*`, `ALERT_PUSH_URL`) and what that means (alerts recorded and logged, nothing
sent, no external monitor); `INSTANCE_LABEL=DEMO`, `LOGIN_RATE_LIMIT_PER_MINUTE=60`, the DEMO
report header; the seed command of 12A item 3 verbatim, with the note that the values are read
into shell variables and never echoed; how to reset it between sessions (re-run the seed after
clearing, or redeploy with a fresh volume); how to delete it (the Coolify application, its volume,
and the Cloudflare record); and the two demo-day rules from C11 — auto-deploy off on the demo
application, and no pushes to `main` from the start of the session until it ends. It also says
plainly that `scripts/backup.sh` selects the production database by name and does **not** back the
demo up, which is correct and intended.

## 5. `docs/PLAN.md`

A `### Phase 12` section in Section 5 in the shape of Phase 11's — what Ahmed asked, how the
audit answered it, the three slices, and the recipe as run — and a
`**Delivered in Phase 12**` block in Section 0, left with its bullets to be completed at the gate.
The Phase 12 section also carries the three decisions this phase deliberately leaves open:
whether VIEWER keeps `export.xlsx`, whether `.github/dependabot.yml` gains an ignore rule for
docker `node` major bumps, and the retention period (C10, part of the P1 conversation).

---

# Slice 12B — infrastructure, after the code is live

Not built from this spec — it is a runbook procedure, executed once — but the values it must use
are fixed here so 12A, 12C and 12B agree.

| Setting | Value |
| --- | --- |
| Subdomain | `demo-nav.towardpcc.com`, Cloudflare A record to the host, **proxied** (the OCI security list accepts 80/443 from Cloudflare only). Created with the DNS-edit token read from `C:\Users\ahmed\Documents\ORACLE MCP\infra\secrets.env` by `grep -m1 '^KEY=' … | cut -d= -f2-`, never by sourcing the file |
| Coolify project | new project `demo` |
| Application | `er-navigator-demo`, from `git@github.com:ahmedsk2/er-navigator.git`, branch `main`, private key `er-navigator-deploy` (`l48u5xcuzddx3vr1hb4zsqlb`) |
| Build | `dockercompose`, `/docker-compose.production.yml`, base directory `/` |
| Domain binding | `docker_compose_domains` PATCHed as an **array** with the `app` service on `https://demo-nav.towardpcc.com:3000` |
| Environment | every key by **name** from the production list (RUNBOOK "Environment variables"), with **new random values for every secret** (`openssl rand -hex 24` on the host), set twice (`is_preview` false and true), never printed |
| Blank there | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `ALERT_PUSH_URL` |
| Set there | `APP_URL=https://demo-nav.towardpcc.com`, `INSTANCE_LABEL=DEMO`, `LOGIN_RATE_LIMIT_PER_MINUTE=60`, `REPORT_HEADER=DEMO. Qatif Central Hospital, Emergency Department. ER Navigator`, `ADMIN_USERNAME`, `ADMIN_DISPLAY_NAME`, a random `ADMIN_PASSWORD`, a random `DEMO_USER_PASSWORD` |
| Verify | build fingerprint on `/api/health`, `/api/ready` returns ready, the banner reads `DEMO: invented patients only`, `<meta name="robots" content="noindex, nofollow">` present |
| Seed | the `docker exec … node demo-seed.js` command of 12A item 3, inside the demo app container |
| Sign-in check | **curl only**, never a browser sign-in |
| Production untouched | its fingerprint, its four containers and its environment unchanged — compare the environment by sha256 of the sorted key list, never by value |

Ahmed reads the demo admin password and `DEMO_USER_PASSWORD` from the demo application's Coolify
environment page himself. No password is printed into a session, a log or this repository.

---

# The gate

The five-line report, plus: the chain green (`typecheck`, `lint`, `test`, `build`,
`build:worker`, `build:demo-seed`, Playwright at both viewports, and the instance config run by
hand); the count of new unit, database and e2e tests with the assertion each started from;
`design/screens/phase12-*` captures of the banner at both viewports, the `/account` must-change
notice, the five MRN hints on a worked case, and Admin → Alerts showing a failed email; the four
Dependabot PRs re-listed showing which closed themselves; `git check-ignore` output for the nine
paths of item 9; and the confirmation that production's fingerprint and environment key set are
unchanged.

Then Slice 12B, then the demo, then `docs/CHANGELOG.md` and the `Delivered in Phase 12` block.
