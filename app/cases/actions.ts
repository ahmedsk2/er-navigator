'use server'

/**
 * The six case mutations as server actions. Each one is the same four steps: resolve the session,
 * hand the actor to the service (which checks the permission matrix, validates, writes in one
 * transaction and audits), revalidate what changed, return a plain result.
 *
 * The permission check lives in `src/lib/cases/service.ts` rather than in a `requireAction()` call
 * here, so that exactly one `auth.forbidden` audit row is written per refusal and so the
 * database-backed tests can drive the real check without a Next request. A refusal reaches the
 * client as `{ ok: false, error: 'forbidden' }`; validation errors are never thrown.
 */
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auditContext, isForbiddenError, requireUser, type AuthUser } from '@/src/lib/auth/session'
import * as service from '@/src/lib/cases/service'
import type {
  ActionFailure,
  AddUpdateResult,
  CreateCaseResult,
  ReopenCaseResult,
  ResolveCaseResult,
  SaveCaseResult,
  VoidCaseResult,
} from '@/src/lib/cases/types'

const FORBIDDEN: ActionFailure = { ok: false, error: 'forbidden' }

async function currentActor(): Promise<{ user: AuthUser; ctx: Awaited<ReturnType<typeof auditContext>> }> {
  const user = await requireUser()
  return { user, ctx: await auditContext(user.id) }
}

/** ForbiddenError is already audited by `assertCan`; anything else is a real fault. */
function asFailure(error: unknown): ActionFailure {
  if (isForbiddenError(error)) return FORBIDDEN
  throw error
}

function revalidateCase(id: string): void {
  revalidatePath(`/cases/${id}`)
  revalidatePath('/')
}

export async function createCase(input: unknown): Promise<CreateCaseResult> {
  const { user, ctx } = await currentActor()
  let result: CreateCaseResult
  try {
    result = await service.createCase(user, input, ctx)
  } catch (error) {
    return asFailure(error)
  }
  if (!result.ok) return result
  revalidatePath('/')
  redirect(`/cases/${result.id}`)
}

export async function saveCase(id: string, input: unknown): Promise<SaveCaseResult> {
  const { user, ctx } = await currentActor()
  let result: SaveCaseResult
  try {
    result = await service.saveCase(user, id, input, ctx)
  } catch (error) {
    return asFailure(error)
  }
  if (result.ok) revalidateCase(id)
  return result
}

export async function addCaseUpdate(id: string, text: string): Promise<AddUpdateResult> {
  const { user, ctx } = await currentActor()
  let result: AddUpdateResult
  try {
    result = await service.addCaseUpdate(user, id, text, ctx)
  } catch (error) {
    return asFailure(error)
  }
  if (result.ok) revalidateCase(id)
  return result
}

export async function resolveCase(id: string, input: unknown): Promise<ResolveCaseResult> {
  const { user, ctx } = await currentActor()
  let result: ResolveCaseResult
  try {
    result = await service.resolveCase(user, id, input, ctx)
  } catch (error) {
    return asFailure(error)
  }
  if (result.ok) revalidateCase(id)
  return result
}

export async function reopenCase(id: string, version: number): Promise<ReopenCaseResult> {
  const { user, ctx } = await currentActor()
  let result: ReopenCaseResult
  try {
    result = await service.reopenCase(user, id, version, ctx)
  } catch (error) {
    return asFailure(error)
  }
  if (result.ok) revalidateCase(id)
  return result
}

export async function voidCase(id: string, input: unknown): Promise<VoidCaseResult> {
  const { user, ctx } = await currentActor()
  let result: VoidCaseResult
  try {
    result = await service.voidCase(user, id, input, ctx)
  } catch (error) {
    return asFailure(error)
  }
  if (result.ok) revalidateCase(id)
  return result
}
