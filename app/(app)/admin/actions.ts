'use server'

/**
 * The admin mutations as server actions: session, service, revalidate, plain result. Exactly the
 * shape `app/cases/actions.ts` uses, and for the same reason — the permission check lives in the
 * service (`assertCan`), so one `auth.forbidden` audit row is written per refusal and the
 * database-backed tests can drive the real check without a Next request.
 *
 * Nothing here deletes anything. Users are deactivated, list entries are deactivated, queued
 * descriptions are promoted or dismissed, alerts are acknowledged (locked plan section 9).
 */
import { revalidatePath } from 'next/cache'
import { acknowledgeAlert as acknowledgeAlertService } from '@/src/lib/alerts/service'
import {
  addListItem as addListItemService,
  moveListItem as moveListItemService,
  renameListItem as renameListItemService,
  setListItemActive as setListItemActiveService,
  type ListResult,
} from '@/src/lib/admin/lists'
import {
  dismissOther as dismissOtherService,
  promoteOther as promoteOtherService,
  type DismissResult,
  type PromoteResult,
} from '@/src/lib/admin/other'
import { fail, FORBIDDEN, type AdminFailure } from '@/src/lib/admin/types'
import {
  createUser as createUserService,
  resetUserPassword as resetUserPasswordService,
  setUserActive as setUserActiveService,
  setUserEmail as setUserEmailService,
  setUserRole as setUserRoleService,
  type CreateUserResult,
  type ResetPasswordResult,
  type UpdateUserResult,
} from '@/src/lib/admin/users'
import { auditContext, isForbiddenError, requireUser, type AuthUser } from '@/src/lib/auth/session'

async function actor(): Promise<{ user: AuthUser; ctx: Awaited<ReturnType<typeof auditContext>> }> {
  const user = await requireUser()
  return { user, ctx: await auditContext(user.id) }
}

/** ForbiddenError has already been audited by `assertCan`; anything else is a real fault. */
async function guard<T>(work: () => Promise<T>): Promise<T | AdminFailure> {
  try {
    return await work()
  } catch (error) {
    if (isForbiddenError(error)) return FORBIDDEN
    throw error
  }
}

// --- users -------------------------------------------------------------------------------------

export async function createUser(input: unknown): Promise<CreateUserResult> {
  const { user, ctx } = await actor()
  const result = await guard(() => createUserService(user, input, ctx))
  if (result.ok) revalidatePath('/admin/users')
  return result
}

export async function setUserActive(userId: string, active: boolean): Promise<UpdateUserResult> {
  const { user, ctx } = await actor()
  const result = await guard(() => setUserActiveService(user, userId, active, ctx))
  if (result.ok) revalidatePath('/admin/users')
  return result
}

export async function setUserRole(userId: string, role: string): Promise<UpdateUserResult> {
  const { user, ctx } = await actor()
  const result = await guard(() => setUserRoleService(user, userId, role, ctx))
  if (result.ok) revalidatePath('/admin/users')
  return result
}

/** Set or clear the work address the alerts worker mails. An empty string clears it. */
export async function setUserEmail(userId: string, email: string): Promise<UpdateUserResult> {
  const { user, ctx } = await actor()
  const result = await guard(() => setUserEmailService(user, userId, email, ctx))
  if (result.ok) revalidatePath('/admin/users')
  return result
}

export async function resetUserPassword(userId: string): Promise<ResetPasswordResult> {
  const { user, ctx } = await actor()
  const result = await guard(() => resetUserPasswordService(user, userId, ctx))
  if (result.ok) revalidatePath('/admin/users')
  return result
}

// --- reference lists ---------------------------------------------------------------------------

function revalidateLists(): void {
  revalidatePath('/admin/lists')
  // The case editor's chips come from these rows.
  revalidatePath('/cases/new')
}

export async function addListItem(input: unknown): Promise<ListResult> {
  const { user, ctx } = await actor()
  const result = await guard(() => addListItemService(user, input, ctx))
  if (result.ok) revalidateLists()
  return result
}

export async function renameListItem(input: unknown): Promise<ListResult> {
  const { user, ctx } = await actor()
  const result = await guard(() => renameListItemService(user, input, ctx))
  if (result.ok) revalidateLists()
  return result
}

export async function setListItemActive(input: unknown): Promise<ListResult> {
  const { user, ctx } = await actor()
  const result = await guard(() => setListItemActiveService(user, input, ctx))
  if (result.ok) revalidateLists()
  return result
}

export async function moveListItem(input: unknown): Promise<ListResult> {
  const { user, ctx } = await actor()
  const result = await guard(() => moveListItemService(user, input, ctx))
  if (result.ok) revalidateLists()
  return result
}

// --- the "Other" review queue -------------------------------------------------------------------

export async function promoteOther(input: unknown): Promise<PromoteResult> {
  const { user, ctx } = await actor()
  const result = await guard(() => promoteOtherService(user, input, ctx))
  if (result.ok) {
    revalidatePath('/admin/other')
    revalidatePath('/admin/lists')
    revalidatePath(`/cases/${result.caseId}`)
    revalidatePath('/dashboard')
  }
  return result
}

export async function dismissOther(reviewId: string): Promise<DismissResult> {
  const { user, ctx } = await actor()
  const result = await guard(() => dismissOtherService(user, reviewId, ctx))
  if (result.ok) revalidatePath('/admin/other')
  return result
}

// --- alerts --------------------------------------------------------------------------------------

export type AcknowledgeActionResult = { ok: true } | AdminFailure

export async function acknowledgeAlert(alertId: string): Promise<AcknowledgeActionResult> {
  const { user, ctx } = await actor()
  const result = await guard(() => acknowledgeAlertService(user, alertId, ctx))
  if (result.ok) {
    revalidatePath('/admin/alerts')
    return { ok: true }
  }
  if (result.error === 'forbidden') return FORBIDDEN
  return fail('missing', 'That alert no longer exists.')
}
