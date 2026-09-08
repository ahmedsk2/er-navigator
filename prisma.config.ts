import { defineConfig } from 'prisma/config'

// Prisma 7: the connection string is resolved here, not in schema.prisma. Read directly from
// process.env (not prisma/config's env() helper) so `prisma generate` — which needs no
// database — keeps working in CI and the Docker build with DATABASE_URL unset.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: process.env.DATABASE_URL as string },
})
