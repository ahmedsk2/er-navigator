# ER Navigator

Mobile-first web app that replaces a WhatsApp group used by ER Navigator nurses at Qatif Central Hospital to track patients whose emergency-department stay is running long. One board, one clock per patient, an auditable record, and a dashboard leadership can act on.

- Live: https://nav.towardpcc.com
- Plan: [docs/PLAN.md](docs/PLAN.md). Operations: [docs/RUNBOOK.md](docs/RUNBOOK.md). Design assets: [docs/DESIGN-ASSETS.md](docs/DESIGN-ASSETS.md).
- Locked inputs: [docs/reference/](docs/reference/).

## Stack

Next.js 16 (App Router, TypeScript strict), Tailwind CSS 4, Prisma 7 on PostgreSQL 16, opaque database-backed sessions (no auth library), Recharts, exceljs, Vitest, Playwright. Runs as a Coolify application (Docker Compose) behind Traefik on an Oracle Cloud ARM64 host.

## Local development

```bash
pnpm install
cp .env.example .env            # set DATABASE_URL to a local Postgres 16
pnpm exec prisma migrate deploy
pnpm db:seed
pnpm dev
```

Checks: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build`, `pnpm test:e2e` (needs a running app).

## Production image

```bash
docker compose -f docker-compose.production.yml build
```

The compose file is what Coolify deploys. It runs `db`, a one-shot `migrate` service (migrations and seed as the owner role), and `app` (runtime as the limited app role).

## Data rules

No patient name, national ID or date of birth is stored, ever. Only the MRN. A test fails the build if such a column appears on the `Case` model.
