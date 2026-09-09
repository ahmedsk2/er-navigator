'use client'

/**
 * Admin → Reference lists. Three lists in one screen: departments, wards, and the reasons of the
 * stage picked from the selector (ten stages of reasons at once would be a wall of rows).
 *
 * Every row offers Rename, Deactivate/Reactivate and two arrows. There is no Delete and there
 * never will be: a retired entry is deactivated, so the cases that already carry it still render.
 * Stages themselves are fixed (Phase 6 spec, "Do not": no editing of stages).
 */
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  addListItem as addListItemAction,
  moveListItem as moveListItemAction,
  renameListItem as renameListItemAction,
  setListItemActive as setListItemActiveAction,
} from '@/app/(app)/admin/actions'
import { Button, Field, Input, Select, UNREACHABLE_MESSAGE } from '@/src/components/ui'
import type { ListItem, ListKind, ReferenceLists } from '@/src/lib/admin/lists'

type Editing = { kind: ListKind; id: string; name: string }

export function ListsPanel({ lists }: { lists: ReferenceLists }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [stageId, setStageId] = useState(lists.stages[0]?.id ?? '')
  const [newName, setNewName] = useState<Record<ListKind, string>>({ department: '', ward: '', reason: '' })
  const [newWardCode, setNewWardCode] = useState('')

  const stage = lists.stages.find((s) => s.id === stageId) ?? lists.stages[0]

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

  const onAdd = (kind: ListKind): Promise<void> =>
    run(async () => {
      const result = await addListItemAction({
        kind,
        name: newName[kind],
        stageId: kind === 'reason' ? stageId : null,
        code: kind === 'ward' ? newWardCode : null,
      })
      if (!result.ok) return result.message
      setNewName((prev) => ({ ...prev, [kind]: '' }))
      if (kind === 'ward') setNewWardCode('')
      return null
    })

  const onRename = (): Promise<void> =>
    run(async () => {
      if (!editing) return null
      const result = await renameListItemAction({ kind: editing.kind, id: editing.id, name: editing.name })
      if (!result.ok) return result.message
      setEditing(null)
      return null
    })

  const onToggle = (kind: ListKind, item: ListItem): Promise<void> =>
    run(async () => {
      const result = await setListItemActiveAction({ kind, id: item.id, active: !item.active })
      return result.ok ? null : result.message
    })

  const onMove = (kind: ListKind, item: ListItem, direction: 'up' | 'down'): Promise<void> =>
    run(async () => {
      const result = await moveListItemAction({ kind, id: item.id, direction })
      return result.ok ? null : result.message
    })

  function rows(kind: ListKind, items: ListItem[]) {
    return (
      <ul className="divide-y divide-line-soft border-y border-line-soft">
        {items.map((item, index) => (
          <li key={item.id} data-list-item={item.name} className="flex flex-wrap items-center gap-2 py-2">
            <span className={`flex-1 text-body ${item.active ? '' : 'text-muted line-through'}`}>
              {item.code ? <span className="num mr-2 font-semibold">{item.code}</span> : null}
              {editing && editing.kind === kind && editing.id === item.id ? (
                <Input
                  aria-label={`New name for ${item.name}`}
                  value={editing.name}
                  disabled={busy}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              ) : (
                item.name
              )}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {editing && editing.kind === kind && editing.id === item.id ? (
                <>
                  <Button tone="main" disabled={busy} onClick={() => void onRename()}>
                    Save name
                  </Button>
                  <Button disabled={busy} onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  aria-label={`Rename ${item.name}`}
                  disabled={busy || item.isOther}
                  onClick={() => setEditing({ kind, id: item.id, name: item.name })}
                >
                  Rename
                </Button>
              )}
              <Button
                aria-label={`${item.active ? 'Deactivate' : 'Reactivate'} ${item.name}`}
                disabled={busy || (item.isOther && item.active)}
                onClick={() => void onToggle(kind, item)}
              >
                {item.active ? 'Deactivate' : 'Reactivate'}
              </Button>
              <Button
                aria-label={`Move ${item.name} up`}
                disabled={busy || index === 0}
                className="px-3"
                onClick={() => void onMove(kind, item, 'up')}
              >
                ↑
              </Button>
              <Button
                aria-label={`Move ${item.name} down`}
                disabled={busy || index === items.length - 1}
                className="px-3"
                onClick={() => void onMove(kind, item, 'down')}
              >
                ↓
              </Button>
            </div>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div>
      {message ? (
        <p role="alert" className="mb-2.5 rounded-card border border-danger bg-panel p-3 text-body text-danger">
          {message}
        </p>
      ) : null}

      <div className="grid gap-2.5 lg:grid-cols-2">
        <section className="rounded-card border border-line bg-panel p-4">
          <h3 className="mb-2.5 text-section">Departments</h3>
          {rows('department', lists.departments)}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1">
              <Field label="New department">
                <Input
                  value={newName.department}
                  disabled={busy}
                  onChange={(e) => setNewName((p) => ({ ...p, department: e.target.value }))}
                />
              </Field>
            </div>
            <Button
              tone="main"
              className="mb-3.5"
              disabled={busy || !newName.department}
              onClick={() => void onAdd('department')}
            >
              Add
            </Button>
          </div>
        </section>

        <section className="rounded-card border border-line bg-panel p-4">
          <h3 className="mb-2.5 text-section">Wards</h3>
          {rows('ward', lists.wards)}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="w-[140px]">
              <Field label="Code">
                <Input
                  className="num"
                  value={newWardCode}
                  disabled={busy}
                  onChange={(e) => setNewWardCode(e.target.value)}
                />
              </Field>
            </div>
            <div className="min-w-[200px] flex-1">
              <Field label="New ward">
                <Input
                  value={newName.ward}
                  disabled={busy}
                  onChange={(e) => setNewName((p) => ({ ...p, ward: e.target.value }))}
                />
              </Field>
            </div>
            <Button
              tone="main"
              className="mb-3.5"
              disabled={busy || !newName.ward || !newWardCode}
              onClick={() => void onAdd('ward')}
            >
              Add
            </Button>
          </div>
        </section>
      </div>

      <section className="mt-2.5 rounded-card border border-line bg-panel p-4">
        <h3 className="mb-2.5 text-section">Reasons</h3>
        <Field label="Stage">
          {/* aria-label: see ExportPanel — a wrapping <label> around a <select> otherwise takes
              its accessible name from the option text too. */}
          <Select
            aria-label="Stage"
            value={stageId}
            disabled={busy}
            onChange={(e) => setStageId(e.target.value)}
          >
            {lists.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        {stage ? rows('reason', stage.reasons) : null}
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[260px] flex-1">
            <Field label={`New reason under ${stage?.name ?? 'this stage'}`}>
              <Input
                value={newName.reason}
                disabled={busy}
                onChange={(e) => setNewName((p) => ({ ...p, reason: e.target.value }))}
              />
            </Field>
          </div>
          <Button
            tone="main"
            className="mb-3.5"
            disabled={busy || !newName.reason || !stageId}
            onClick={() => void onAdd('reason')}
          >
            Add
          </Button>
        </div>
        <p className="text-caption text-muted">
          The stages themselves are fixed. Renaming keeps the entry&apos;s identity, so every case
          already tagged with it stays tagged. A deactivated entry disappears from the case
          editor&apos;s chips but never from the cases that already carry it.
        </p>
      </section>
    </div>
  )
}
