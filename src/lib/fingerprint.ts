import { createHash } from 'node:crypto'

/**
 * `x-build-fingerprint` = sha256(SOURCE_COMMIT)[0:16], so a deploy can be verified by commit
 * rather than by image tag (Coolify sets SOURCE_COMMIT at build time). Served by both probes,
 * /api/health and /api/ready, so the runbook's "verify by fingerprint" works on either.
 */
export function buildFingerprint(env: NodeJS.ProcessEnv = process.env): string {
  return createHash('sha256').update(env.SOURCE_COMMIT ?? 'unknown').digest('hex').slice(0, 16)
}
