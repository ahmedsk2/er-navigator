/**
 * Optimistic-locking conflict payload (locked plan section 4). When `UPDATE ... WHERE version = ?`
 * touches no row, the case moved under the editor's feet. The plan asks for the current record
 * plus "the display name and time of the last editor", which is exactly the newest AuditLog row
 * for that case, so this module reads it and turns it into the message the UI shows.
 *
 * Never a merge: the client is told who changed it and offered a Reload, nothing else.
 *
 * Pure on purpose — the editor is a client component and imports `conflictMessage`, so nothing
 * here may reach for Prisma. The query that finds the row lives in `service.ts`.
 */
import type { ConflictInfo } from '@/src/lib/domain/validation'

/** Used when the newest audit row has no actor, or when a case has no audit row at all. */
export const UNKNOWN_EDITOR = 'another user'

export type LatestCaseAudit = { at: Date; actor: { displayName: string } | null } | null

/** Pure half: the audit row (or its absence) plus the case's own updatedAt as a fallback time. */
export function conflictInfoFrom(row: LatestCaseAudit, fallbackAt: Date): ConflictInfo {
  const name = row?.actor?.displayName?.trim()
  return { changedBy: name || UNKNOWN_EDITOR, changedAt: row?.at ?? fallbackAt }
}

export function conflictMessage(changedBy: string, changedAt: string): string {
  return `This case was changed by ${changedBy} at ${changedAt}. Reload to continue.`
}
