/**
 * What the Users screen needs and a client component may import: the role list, its labels, the
 * username rule and the row shape.
 *
 * Separate from `users.ts` on purpose — that file reaches for Prisma and bcrypt, and importing a
 * *value* from it inside a `'use client'` component would drag the database client into the
 * browser bundle (Next.js fails the build for it, correctly).
 */
import type { Role } from '@prisma/client'

export const ROLES: ReadonlyArray<Role> = ['NAVIGATOR', 'SUPERVISOR', 'ADMIN', 'VIEWER']

// No all-caps labels (design/tokens.md), so the enum is rendered in sentence case.
export const ROLE_LABELS: Record<Role, string> = {
  NAVIGATOR: 'Navigator',
  SUPERVISOR: 'Supervisor',
  ADMIN: 'Admin',
  VIEWER: 'Viewer',
}

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/

export type UserRow = {
  id: string
  username: string
  displayName: string
  role: Role
  active: boolean
  lastLoginAt: string | null
  createdAt: string
  /** The `system` account: listed for honesty, never editable. */
  isSystem: boolean
}
