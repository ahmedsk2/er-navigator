# Phase 7 spec: hardening and production readiness

Written by the lead (Fable). Locked plan sections 7 and 8 (Phase 7). Most of this phase is review and measurement rather than new code; the lead runs the security review and the restore drill personally.

## Checklist (all must hold for Gate 7)

1. **Routes**: every route except `/login`, `/api/health`, `/api/ready`, the manifest, icons and static assets requires a session (`proxy.ts` plus per-page checks). Test with an unauthenticated crawl of every route in the app tree.
2. **Roles**: every server action and route handler calls `requireAction`; grep for actions without it fails CI (add a test that lists exported server actions and asserts the wrapper is present).
3. **Sessions**: httpOnly, secure, sameSite=lax, 12 h sliding, rotated on login (Phase 1); verify with a Playwright test that reads the cookie attributes.
4. **Input**: zod on every input; Prisma only; the only raw SQL is the readiness probe and the operator role-sync script (grep-based test).
5. **Headers**: CSP tightened: remove `'unsafe-inline'` from `script-src` by using Next's nonce support in `proxy.ts` (per-request nonce, `strict-dynamic`); keep `style-src 'unsafe-inline'` only if Tailwind's runtime needs it (it does not; measure). HSTS, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy already set. Run the `security-pan-check:sec-web` skill against https://nav.towardpcc.com and fix to A.
6. **Code**: run `security-pan-check:sec-code` and `code-cleanup:slop-remover`; `pnpm audit --audit-level=high` clean; Dependabot PRs merged or dismissed with a reason.
7. **Secrets**: `.env.example` complete; no secret in git (gitleaks or the sec-code pass); `ADMIN_PASSWORD` deleted from Coolify after the first login (runbook).
8. **Backups**: timer installed (done 2026-09-09); configure `UPLOAD_CMD` to push dumps to the OCI bucket `coolify-backups` with a host-side credential file (mode 600), then a second restore drill from the bucket copy; record both in the runbook.
9. **Monitoring**: Uptime Kuma HTTP monitor on `/api/ready` expecting `ready` (Ahmed adds it in the Kuma UI or the lead does through its API), a push monitor for the worker heartbeat; OCI alarms already cover the host.
10. **PWA**: `manifest.webmanifest` (name, short name, icons 192/512 maskable, `display: standalone`, theme colour = accent, start URL `/`), an install prompt on the board for mobile browsers, no offline writes (locked plan). Icons generated from a simple mark (the elapsed clock glyph) in the accent colour; no logo from any template.
11. **Performance**: Lighthouse mobile on Board and Case editor ≥ 90 performance and accessibility; fix what it flags (image sizes, unused JS, contrast, labels). Record numbers in the changelog.
12. **Accessibility**: every input has a label; chips are buttons with `aria-pressed`; focus visible; the elapsed clock has an `aria-label` with the full text; colour is never the only signal (bands carry text).
13. **Runbook complete**: start, stop, restore, add a user, rotate secrets, failed migration, PHI scrub, outage log; the "Add a user" section points at Admin → Users.
14. **Final review**: an adversarial review workflow over the whole repo (the Phase 0 pattern: five lenses, two refuters per finding), fixes applied, then the Gate 7 report.

## Deliverables

`docs/CHANGELOG.md` entries per item, screenshots of the install prompt and the Lighthouse summary under `design/screens/phase7-*`, the Gate 7 report in the five-line shape. Gate 7 = production ready.
