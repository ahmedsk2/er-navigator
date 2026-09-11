'use client'

/**
 * Admin → Users. A list first (username, name, role, active, last login) and one small form to
 * add someone; every row's controls act immediately and the router refreshes the list.
 *
 * A temporary password is shown once, in a panel that stays until it is dismissed, because it
 * cannot be recovered: it exists only as a bcrypt hash the moment the action returns. The rules
 * that matter (no self-deactivation, no self-demotion, no touching the system account, sessions
 * deleted) are enforced in `src/lib/admin/users.ts`; here they only shape what is offered.
 *
 * The Email column is the alerts directory (Phase 7): a supervisor or admin with an address here
 * gets the 6 h+ threshold mail. Emptying the box and pressing Save takes them off the list.
 *
 * On a phone (below `md`) the list is a column of cards, one per account, with every control of
 * its row on screen (Phase 11); from `md` it is the table.
 */
import type { Role } from '@prisma/client'
import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'
import {
  createUser as createUserAction,
  resetUserPassword as resetUserPasswordAction,
  setUserActive as setUserActiveAction,
  setUserEmail as setUserEmailAction,
  setUserRole as setUserRoleAction,
} from '@/app/(app)/admin/actions'
import { Button, Field, Input, Select, UNREACHABLE_MESSAGE } from '@/src/components/ui'
import { ROLE_LABELS, ROLES, type UserRow } from '@/src/lib/admin/user-view'
import { fmtStamp } from '@/src/lib/cases/local-time'

type Secret = { username: string; password: string; reason: 'created' | 'reset' }

/** A cell's own heading on the phone's card, in the look of every label over a control (`Field`). */
const PHONE_HEADING = 'mb-1 block text-label font-medium text-muted md:hidden'

export function UsersPanel({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [secret, setSecret] = useState<Secret | null>(null)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('NAVIGATOR')
  const roleId = useId()
  /**
   * One draft per row, keyed by user id, so typing in one Email box never touches another. A row
   * with no draft yet shows whatever the server sent; `router.refresh()` after a save replaces
   * that, and the draft is dropped so the two cannot disagree.
   */
  const [emailDrafts, setEmailDrafts] = useState<Record<string, string>>({})

  async function run(work: () => Promise<string | null>): Promise<void> {
    setBusy(true)
    setMessage(null)
    try {
      const problem = await work()
      // The field was cleared above, so only a problem needs writing back.
      if (problem) setMessage(problem)
      else router.refresh()
    } catch {
      // A thrown action, not a refusal: say so rather than re-enabling in silence (Phase 7, C11).
      setMessage(UNREACHABLE_MESSAGE)
    } finally {
      setBusy(false)
    }
  }

  const onCreate = (): Promise<void> =>
    run(async () => {
      const result = await createUserAction({ username, displayName, role, email })
      if (!result.ok) return result.message
      setSecret({ username: result.username, password: result.temporaryPassword, reason: 'created' })
      setUsername('')
      setDisplayName('')
      setEmail('')
      setRole('NAVIGATOR')
      return null
    })

  const onSaveEmail = (row: UserRow): Promise<void> =>
    run(async () => {
      const next = emailDrafts[row.id] ?? row.email ?? ''
      const result = await setUserEmailAction(row.id, next)
      if (!result.ok) return result.message
      // The refresh below re-reads the row; the draft would otherwise shadow it forever.
      setEmailDrafts((all) => {
        const rest = { ...all }
        delete rest[row.id]
        return rest
      })
      return null
    })

  const onSetActive = (row: UserRow, active: boolean): Promise<void> =>
    run(async () => {
      const result = await setUserActiveAction(row.id, active)
      return result.ok ? null : result.message
    })

  const onSetRole = (row: UserRow, next: string): Promise<void> =>
    run(async () => {
      const result = await setUserRoleAction(row.id, next)
      return result.ok ? null : result.message
    })

  const onReset = (row: UserRow): Promise<void> =>
    run(async () => {
      const result = await resetUserPasswordAction(row.id)
      if (!result.ok) return result.message
      setSecret({ username: result.username, password: result.temporaryPassword, reason: 'reset' })
      return null
    })

  return (
    <div>
      {secret ? (
        <div
          data-temporary-password
          role="status"
          className="mb-2.5 rounded-card border border-accent bg-accent-soft p-4"
        >
          <p className="text-section">
            {secret.reason === 'created' ? 'Account created' : 'Password reset'}: {secret.username}
          </p>
          <p className="mt-1 text-body text-ink-2">
            Read this temporary password out now — it is shown once and cannot be recovered. They
            change it at /account after signing in.
          </p>
          <p className="num mt-2 text-clock" data-secret>
            {secret.password}
          </p>
          <Button className="mt-2" onClick={() => setSecret(null)}>
            Done
          </Button>
        </div>
      ) : null}

      {message ? (
        <p role="alert" className="mb-2.5 rounded-card border border-danger bg-panel p-3 text-body text-danger">
          {message}
        </p>
      ) : null}

      <section className="mb-2.5 rounded-card border border-line bg-panel p-4">
        <h3 className="mb-2.5 text-section">Add a user</h3>
        <div className="grid gap-x-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Username">
            <Input
              autoComplete="off"
              value={username}
              disabled={busy}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          <Field label="Display name">
            <Input
              autoComplete="off"
              value={displayName}
              disabled={busy}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>
          <Field label="Email (optional)">
            <Input
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="name@hospital.example"
              value={email}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          {/* A `<label for>`: a label wrapped round a select holds every option in its text
              (Phase 11, finding 4; the aria-label that stood in for it is gone). */}
          <Field label="Role" htmlFor={roleId}>
            <Select
              id={roleId}
              value={role}
              disabled={busy}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button tone="main" disabled={busy || !username || !displayName} onClick={() => void onCreate()}>
          Create user
        </Button>
      </section>

      {/*
        The accounts. From `md` the table it has always been; below it (Phase 11, finding 6) every
        row is a card, because at 390 px the table ran off the right edge with the role, active and
        reset controls out of reach. One markup for both shapes, with the table display switched on
        from `md`: the same row, cells, `data-*` hooks and control names, rather than a second list
        that would put two "Email for …" boxes in the page for every account. On the card the
        column headings are gone, so the cells that need one carry their own, phone only.
      */}
      <div className="md:overflow-x-auto md:rounded-card md:border md:border-line md:bg-panel">
        <table className="block w-full border-collapse text-body md:table">
          <caption className="sr-only">Every account, active first</caption>
          <thead className="hidden md:table-header-group">
            <tr className="border-b border-line text-left text-label text-muted">
              <th scope="col" className="p-3 font-medium">
                Username
              </th>
              <th scope="col" className="p-3 font-medium">
                Display name
              </th>
              <th scope="col" className="p-3 font-medium">
                Email
              </th>
              <th scope="col" className="p-3 font-medium">
                Role
              </th>
              <th scope="col" className="p-3 font-medium">
                Active
              </th>
              <th scope="col" className="p-3 font-medium">
                Last login
              </th>
              <th scope="col" className="p-3 font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="block md:table-row-group">
            {users.map((row) => {
              const self = row.id === currentUserId
              const draft = emailDrafts[row.id] ?? row.email ?? ''
              const emailChanged = draft.trim() !== (row.email ?? '')
              return (
                /* The card: username and active on the first line, the name under them, then the
                   email box across the card, the role beside the last login, and the actions. */
                <tr
                  key={row.id}
                  data-user={row.username}
                  className="mb-2.5 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 rounded-card border border-line bg-panel p-3.5 shadow-card md:mb-0 md:table-row md:rounded-none md:border-0 md:border-b md:border-line-soft md:bg-transparent md:p-0 md:shadow-none md:last:border-b-0"
                >
                  <td className="num col-start-1 row-start-1 font-semibold md:table-cell md:p-3">{row.username}</td>
                  <td className="col-span-2 row-start-2 md:table-cell md:p-3">{row.displayName}</td>
                  <td className="col-span-2 row-start-3 md:table-cell md:p-3" data-email={row.email ?? ''}>
                    <span className={PHONE_HEADING}>Email</span>
                    {row.isSystem ? (
                      <span className="text-ink-2">–</span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="email"
                          inputMode="email"
                          autoComplete="off"
                          aria-label={`Email for ${row.username}`}
                          className="min-w-0 md:min-w-[13rem]"
                          value={draft}
                          disabled={busy}
                          onChange={(e) =>
                            setEmailDrafts((all) => ({ ...all, [row.id]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && emailChanged) void onSaveEmail(row)
                          }}
                        />
                        <Button
                          aria-label={`Save the email for ${row.username}`}
                          disabled={busy || !emailChanged}
                          onClick={() => void onSaveEmail(row)}
                        >
                          Save
                        </Button>
                      </div>
                    )}
                  </td>
                  <td className="col-start-1 row-start-4 md:table-cell md:p-3">
                    <span className={PHONE_HEADING}>Role</span>
                    {row.isSystem || self ? (
                      <span className="text-ink-2">{ROLE_LABELS[row.role]}</span>
                    ) : (
                      <Select
                        aria-label={`Role for ${row.username}`}
                        value={row.role}
                        disabled={busy}
                        onChange={(e) => void onSetRole(row, e.target.value)}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </td>
                  <td
                    className="col-start-2 row-start-1 text-label text-muted md:table-cell md:p-3 md:text-body md:text-ink"
                    data-active={row.active ? 'yes' : 'no'}
                  >
                    <span className="md:hidden">Active: </span>
                    {row.active ? 'Yes' : 'No'}
                  </td>
                  <td className="num col-start-2 row-start-4 text-right text-ink-2 md:table-cell md:p-3 md:text-left">
                    <span className={PHONE_HEADING}>Last login</span>
                    {row.lastLoginAt ? fmtStamp(row.lastLoginAt) : '–'}
                  </td>
                  <td className="col-span-2 row-start-5 md:table-cell md:p-3">
                    {row.isSystem ? (
                      <span className="text-caption text-muted">
                        Automatic account. It never signs in and cannot be changed.
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          disabled={busy || (self && row.active)}
                          onClick={() => void onSetActive(row, !row.active)}
                        >
                          {row.active ? 'Deactivate' : 'Reactivate'}
                        </Button>
                        <Button disabled={busy} onClick={() => void onReset(row)}>
                          Reset password
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2.5 text-caption text-muted">
        Nobody is ever deleted: an account is deactivated, which keeps their name on the cases and
        updates they wrote and ends their sessions immediately. You cannot deactivate or change
        the role of your own account.
      </p>
      <p className="mt-1.5 text-caption text-muted">
        Threshold alerts from 6 hours up are emailed to the active supervisors and administrators
        who have an email address here. Empty the box and press Save to take someone off that
        list; nothing else changes.
      </p>
    </div>
  )
}
