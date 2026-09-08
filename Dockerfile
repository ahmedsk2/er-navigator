# syntax=docker/dockerfile:1
# Production image for ER Navigator. Builds natively on the OCI ARM64 host (all bases are
# multi-arch). Base images pinned by digest; Dependabot bumps them as reviewed PRs.
# node:24-alpine digest captured 2026-09-08 (the digest towardpcc already ships on this host).
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS base
RUN corepack enable
WORKDIR /repo

# ---- deps: install from the lockfile, lifecycle scripts disabled (.npmrc) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# ---- build: prisma generate + next build (standalone) ----
FROM deps AS build
SHELL ["/bin/ash", "-o", "pipefail", "-c"]
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm exec prisma generate && pnpm exec next build

# ---- migrate: one-shot container applying migrations + seed as the OWNER role ----
# A separate target so the owner connection string never enters the app container.
FROM deps AS migrate
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY src ./src
COPY scripts/migrate-and-seed.sh ./scripts/migrate-and-seed.sh
RUN pnpm exec prisma generate
ENV NODE_ENV=production
CMD ["sh", "scripts/migrate-and-seed.sh"]

# ---- runner: standalone server, non-root, no package manager in the image ----
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# hadolint ignore=DL3017
RUN apk upgrade --no-cache \
  && apk add --no-cache dumb-init \
  && addgroup -S -g 101 app && adduser -S -u 100 app -G app \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
     /usr/local/lib/node_modules/corepack /usr/local/bin/corepack
WORKDIR /app
COPY --from=build --chown=app:app /repo/.next/standalone ./
COPY --from=build --chown=app:app /repo/.next/static ./.next/static
COPY --from=build --chown=app:app /repo/public ./public
USER 100
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:3000/api/health"]
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
