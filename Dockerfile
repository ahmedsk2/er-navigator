# syntax=docker/dockerfile:1
# Production image for ER Navigator. Builds natively on the OCI ARM64 host (all bases are
# multi-arch). Base images pinned by digest; Dependabot bumps them as reviewed PRs.
# node:24-alpine digest captured 2026-09-08 (the digest towardpcc already ships on this host).
#
# NODE STAYS ON 24 (Phase 12 item 10, readiness audit P6/P19). Dependabot PR #2 moves both stages
# to node:26-alpine and it does not build: package.json pins engines.node ">=24 <25" and .npmrc
# sets engine-strict=true, so `pnpm install --frozen-lockfile` aborts in the deps stage and every
# stage after it fails. CI never builds this file (ci.yml runs on .nvmrc = 24), so that PR's green
# check means nothing. Moving to 26 is a deliberate change to engines, .nvmrc and this line at
# once, not a bump to merge in a hurry.
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS base
RUN corepack enable
WORKDIR /repo

# ---- deps: install from the lockfile, lifecycle scripts disabled (.npmrc) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# ---- build: prisma generate + next build (standalone output is opted into here only) ----
# The alerts worker (Phase 6) is bundled here too: esbuild inlines the Prisma client, the pg
# driver and nodemailer into one plain-Node file, so the runner image needs no TypeScript, no
# package manager and no node_modules of its own to run it.
FROM deps AS build
SHELL ["/bin/ash", "-o", "pipefail", "-c"]
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT_STANDALONE=1
RUN pnpm exec prisma generate && pnpm exec next build && pnpm run build:worker && pnpm run build:demo-seed

# ---- migrate: one-shot container applying migrations, role sync and seed as the OWNER ----
# A separate target so the owner connection string is never part of the app image's command.
FROM deps AS migrate
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY src ./src
COPY scripts/migrate-and-seed.sh ./scripts/migrate-and-seed.sh
RUN pnpm exec prisma generate
ENV NODE_ENV=production
CMD ["sh", "scripts/migrate-and-seed.sh"]

# ---- runner: standalone server, non-root, no package manager, env allowlist ----
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# hadolint ignore=DL3017
RUN apk upgrade --no-cache \
  && apk add --no-cache dumb-init tzdata \
  && addgroup -S -g 101 app && adduser -S -u 100 app -G app \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
     /usr/local/lib/node_modules/corepack /usr/local/bin/corepack
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/entrypoint
WORKDIR /app
COPY --from=build --chown=app:app /repo/.next/standalone ./
COPY --from=build --chown=app:app /repo/.next/static ./.next/static
COPY --from=build --chown=app:app /repo/public ./public
# The `worker` service in docker-compose.production.yml runs this same image as `node worker.js`.
COPY --from=build --chown=app:app /repo/dist/worker.js ./worker.js
# The demo seed (Phase 12 item 3): never run by a service, only by `docker exec ... node
# demo-seed.js` on a demo instance. Carrying it in the production image costs one file and can do
# nothing there — not because INSTANCE_LABEL is unset (that arrives on the exec line, so it says
# whatever the operator typed), but because the seed reads the container's own APP_URL and refuses
# a production host whatever else it is given. Corrected in the Phase 12 review round.
COPY --from=build --chown=app:app /repo/dist/demo-seed.js ./demo-seed.js
USER 100
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --start-interval=2s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:3000/api/health"]
ENTRYPOINT ["/usr/local/bin/entrypoint"]
CMD ["node", "server.js"]
