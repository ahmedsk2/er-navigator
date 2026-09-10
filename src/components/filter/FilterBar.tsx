'use client'

/**
 * The filter bar (Phase 10, Ahmed's request 4) — one component on all three pages that show
 * cases: the board, the dashboard and the export page.
 *
 * A filter is a navigation, not client state. The panel edits a DRAFT and nothing happens until
 * "Apply", which pushes the page's own URL with `caseFilterQuery` appended — so a filtered board
 * is a link a charge nurse can send, a filtered dashboard is a screenshot with its own address,
 * and the export's count and workbook are already narrowed by the time the file is written. That
 * is also why the bar takes `basePath` and `baseQuery` rather than a callback: two of the three
 * pages render it from a server component, which cannot hand a function across the boundary.
 *
 * The panel is a bottom sheet on the phone and a popover under the button on a laptop, the shape
 * the rest of the app uses for the same job (the overflow menu, the install prompt). Escape and a
 * tap outside close it; focus moves into it on open and back to the button on close.
 */
import { useRouter } from 'next/navigation'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Funnel, X } from '@/src/components/icons'
import { Button } from '@/src/components/ui'
import {
  EMPTY_FILTER,
  FILTER_LABELS,
  caseFilterQuery,
  filterChips,
  isEmptyFilter,
  withoutFilterValue,
  type CaseFilter,
  type FilterDimension,
  type FilterOptions,
} from '@/src/lib/domain/case-filter'
import { DISPOSITION_LABELS, PAYER_LABELS, PAYERS } from '@/src/lib/domain/taxonomy'

const CTAS_LEVELS = [1, 2, 3, 4, 5] as const
const DISPOSITIONS = Object.keys(DISPOSITION_LABELS) as Array<keyof typeof DISPOSITION_LABELS>

/** One option chip inside the panel. Same size and tone as the editor's chips (Phase 9). */
function OptionChip({
  label,
  on,
  onToggle,
}: {
  label: string
  on: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={`mr-1.5 mb-1.5 inline-flex min-h-11 items-center rounded-chip border px-3 py-2 text-left text-[14px] leading-tight motion-safe:transition-colors ${
        on ? 'border-accent bg-accent-soft font-semibold text-accent-ink' : 'border-line bg-panel text-ink-2'
      }`}
    >
      {label}
    </button>
  )
}

/** A two-option segmented control: the two modes, each a real button with a pressed state. */
function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly [string, string]
  value: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div role="group" aria-label={label} className="mb-3 flex gap-2">
      {options.map((option, index) => {
        const on = (index === 1) === value
        return (
          <button
            key={option}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(index === 1)}
            className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-chip border px-3 text-[14px] ${
              on ? 'border-accent bg-accent font-semibold text-white' : 'border-line bg-panel text-ink-2'
            }`}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}

/** A labelled group of option chips, `role="group"` so a screen reader hears what it is choosing. */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="mb-3">
      <span className="mb-1 block text-label font-medium text-muted">{label}</span>
      {children}
    </div>
  )
}

export function FilterBar({
  basePath,
  baseQuery,
  filter,
  options,
  count,
}: {
  /** The page's own path: `/`, `/dashboard`, `/export`. */
  basePath: string
  /** Everything the page carries that is not the filter (`f`, `q`, `r`, the export's range). */
  baseQuery: string
  filter: CaseFilter
  options: FilterOptions
  /** One line under the chips — the board's "{shown} of {total} open cases". */
  count?: string
}) {
  const router = useRouter()
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<CaseFilter>(filter)
  const panel = useRef<HTMLDivElement | null>(null)
  const toggle = useRef<HTMLButtonElement | null>(null)

  const chips = useMemo(() => filterChips(filter, options), [filter, options])
  const active = !isEmptyFilter(filter)

  const hrefFor = (next: CaseFilter): string => {
    const query = [baseQuery, caseFilterQuery(next)].filter(Boolean).join('&')
    return query ? `${basePath}?${query}` : basePath
  }

  const go = (next: CaseFilter): void => {
    setOpen(false)
    router.push(hrefFor(next))
  }

  /**
   * Opening seeds the draft from the filter the page is actually showing, so a nurse who opened
   * the panel, changed her mind and closed it gets the same panel back. Done here rather than in
   * an effect: it is one event, not a synchronisation.
   */
  const openPanel = (): void => {
    setDraft(filter)
    setOpen(true)
  }

  // Escape, and a tap anywhere that is neither the panel nor the button that opened it.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (panel.current?.contains(target) || toggle.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  // Focus follows the panel, and comes back to the button when it closes — the same contract the
  // overflow menu keeps, and the reason a keyboard can use this at all.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open) panel.current?.focus()
    else if (wasOpen.current) toggle.current?.focus()
    wasOpen.current = open
  }, [open])

  const toggleIn = (dimension: FilterDimension, value: string): void =>
    setDraft((current) => {
      const values = (current[dimension] as ReadonlyArray<string | number>).map(String)
      const next = values.includes(value)
        ? values.filter((v) => v !== value)
        : [...values, value]
      return {
        ...current,
        [dimension]: dimension === 'ctas' ? next.map(Number) : next,
      } as CaseFilter
    })

  const chosen = (dimension: FilterDimension, value: string): boolean =>
    (draft[dimension] as ReadonlyArray<string | number>).map(String).includes(value)

  return (
    <div className="no-print relative px-4 pb-2.5 lg:px-0" data-filter-bar>
      <div className="flex flex-wrap items-center gap-2">
        <button
          ref={toggle}
          type="button"
          data-filter-toggle
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => (open ? setOpen(false) : openPanel())}
          className={`inline-flex min-h-11 items-center gap-2 rounded-chip border px-3.5 text-[14px] ${
            active ? 'border-accent bg-accent-soft font-semibold text-accent-ink' : 'border-line bg-panel text-ink-2'
          }`}
        >
          <Funnel size={16} />
          Filter
          {active ? <span className="num">({chips.length})</span> : null}
        </button>

        {/* The active filter, one removable chip per value. A chip is a button, not a link: it
            navigates through the same push everything else here does, so the three pages behave
            identically whether the filter was changed in the panel or by dropping a chip. */}
        {chips.map((chip) => (
          <span
            key={`${chip.dimension}:${chip.value}`}
            data-filter-chip={chip.label}
            className="inline-flex min-h-11 items-center gap-1 rounded-chip border border-line bg-panel px-2.5 text-caption text-ink-2"
          >
            {chip.label}
            <button
              type="button"
              aria-label={`Remove ${chip.label}`}
              onClick={() => go(withoutFilterValue(filter, chip.dimension, chip.value))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-chip text-muted"
            >
              <X size={14} />
            </button>
          </span>
        ))}

        {active ? (
          <button
            type="button"
            data-filter-clear
            onClick={() => go(EMPTY_FILTER)}
            className="inline-flex min-h-11 items-center rounded-chip px-2 text-caption font-semibold text-accent underline"
          >
            Clear filter
          </button>
        ) : null}
      </div>

      {count ? (
        <p className="num mt-1 mb-0 text-caption text-muted" data-filter-count>
          {count}
        </p>
      ) : null}

      {open ? (
        <>
          {/* The phone's sheet covers the rows behind it, so it says so: a dim over the board is
              what makes "tap anywhere to close" a thing a thumb discovers. The laptop's popover
              is small and anchored under its button and needs none. */}
          <div aria-hidden="true" className="fixed inset-0 z-30 bg-ink/30 lg:hidden" />
          <div
            id={panelId}
            ref={panel}
            role="dialog"
            aria-label="Filter cases"
            tabIndex={-1}
            data-filter-panel
            /* A bottom sheet on the phone, a popover under the button on a laptop. Three rows: a
               heading that stays, the groups scrolling between them, and the two actions pinned —
               seven groups of chips are several times taller than a 390 × 844 screen, and a panel
               whose Apply button is a scroll away is a panel nobody applies. */
            className="fixed inset-x-0 bottom-0 z-40 flex max-h-[80vh] flex-col rounded-t-card border border-line bg-panel shadow-card outline-none lg:absolute lg:inset-x-auto lg:top-full lg:bottom-auto lg:left-0 lg:mt-1 lg:max-h-[70vh] lg:w-[520px] lg:rounded-card"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h2 className="text-section">Filter cases</h2>
              <Button aria-label="Close filter" onClick={() => setOpen(false)} className="px-2.5">
                <X size={18} />
              </Button>
            </div>

            <div data-filter-scroll className="min-h-0 flex-1 overflow-y-auto px-4 pt-3">
              <Segmented
                label="Include or exclude the matching cases"
                options={['Include', 'Exclude']}
                value={draft.not}
                onChange={(next) => setDraft((current) => ({ ...current, not: next }))}
              />
              <Segmented
                label="How the selected values must match"
                options={['Among others', 'The lone finding']}
                value={draft.lone}
                onChange={(next) => setDraft((current) => ({ ...current, lone: next }))}
              />

              <Group label={FILTER_LABELS.stage}>
                {options.stages.map((stage) => (
                  <OptionChip
                    key={stage.code}
                    label={stage.name}
                    on={chosen('stage', stage.code)}
                    onToggle={() => toggleIn('stage', stage.code)}
                  />
                ))}
              </Group>

              {/* The reasons under their own stage: forty-eight of them in one heap is a wall, and a
                  nurse looks for "Lab: delay in processing" under Investigations. */}
              <Group label={FILTER_LABELS.reason}>
                {options.stages
                  .filter((stage) => stage.reasons.length > 0)
                  .map((stage) => (
                    <div key={stage.code} className="mb-1.5">
                      <span className="mb-1 block text-caption text-muted">{stage.name}</span>
                      {stage.reasons.map((reason) => (
                        <OptionChip
                          key={reason}
                          label={reason}
                          on={chosen('reason', reason)}
                          onToggle={() => toggleIn('reason', reason)}
                        />
                      ))}
                    </div>
                  ))}
              </Group>

              <Group label={FILTER_LABELS.dept}>
                {options.departments.map((department) => (
                  <OptionChip
                    key={department}
                    label={department}
                    on={chosen('dept', department)}
                    onToggle={() => toggleIn('dept', department)}
                  />
                ))}
              </Group>

              <Group label={FILTER_LABELS.area}>
                {options.areas.map((area) => (
                  <OptionChip
                    key={area.code}
                    label={area.name}
                    on={chosen('area', area.code)}
                    onToggle={() => toggleIn('area', area.code)}
                  />
                ))}
              </Group>

              <Group label={FILTER_LABELS.ctas}>
                {CTAS_LEVELS.map((level) => (
                  <OptionChip
                    key={level}
                    label={`CTAS ${level}`}
                    on={chosen('ctas', String(level))}
                    onToggle={() => toggleIn('ctas', String(level))}
                  />
                ))}
              </Group>

              <Group label={FILTER_LABELS.payer}>
                {PAYERS.map((payer) => (
                  <OptionChip
                    key={payer}
                    label={PAYER_LABELS[payer]}
                    on={chosen('payer', payer)}
                    onToggle={() => toggleIn('payer', payer)}
                  />
                ))}
              </Group>

              <Group label={FILTER_LABELS.dispo}>
                {DISPOSITIONS.map((dispo) => (
                  <OptionChip
                    key={dispo}
                    label={DISPOSITION_LABELS[dispo]}
                    on={chosen('dispo', dispo)}
                    onToggle={() => toggleIn('dispo', dispo)}
                  />
                ))}
              </Group>
            </div>

            <div className="flex gap-2 border-t border-line px-4 py-3">
              <Button tone="main" onClick={() => go(draft)} className="flex-1">
                Apply
              </Button>
              <Button onClick={() => go(EMPTY_FILTER)} className="flex-1">
                Clear
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
