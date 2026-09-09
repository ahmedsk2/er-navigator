/**
 * What every admin mutation answers with. Plain JSON, because each one crosses the server-action
 * boundary, and one shape for all of them so the screens can render a refusal the same way.
 *
 * `forbidden` is written by `assertCan()` as an `auth.forbidden` audit row before it throws; the
 * server actions turn that throw into this failure. Everything else is a rule this app states in
 * words, so each failure carries the sentence the screen shows.
 */
export type AdminErrorCode =
  | 'forbidden'
  | 'validation'
  | 'duplicate'
  | 'missing'
  | 'self'
  | 'system'
  | 'nothing'

export type AdminFailure = { ok: false; error: AdminErrorCode; message: string }

export function fail(error: AdminErrorCode, message: string): AdminFailure {
  return { ok: false, error, message }
}

export const FORBIDDEN: AdminFailure = {
  ok: false,
  error: 'forbidden',
  message: 'Your role cannot do that.',
}
