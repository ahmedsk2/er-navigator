'use client'

/**
 * The prototype's UI atoms (`Chips`, `TimeRow`, `Chain`, `Field`, `ConfirmButton` and the `.chip`
 * / `.field` / `.input` / `.btn` / `.section` CSS in `docs/reference/ERNavigatorTracker.jsx`),
 * rebuilt on the Phase 0.3 tokens in `app/globals.css`. Same behaviour, same sizes: 44 px tap
 * targets, 16 px inputs so iOS does not zoom, full-bleed sections with hairlines.
 */
import { useEffect, useId, useState, type ReactNode } from 'react'
import { fromLocalInput, toLocalInput } from '@/src/lib/cases/local-time'
import { useHydrated } from './hydrated'

// --- section ----------------------------------------------------------------------------------

export function Section({
  title,
  children,
  tone = 'plain',
  id,
}: {
  title?: string
  children: ReactNode
  tone?: 'plain' | 'warn'
  id?: string
}) {
  return (
    <section
      id={id}
      className={`mb-2.5 border-y border-line bg-panel p-4 ${tone === 'warn' ? 'border-l-4 border-l-band-h4' : ''}`}
    >
      {title ? (
        <h2 className={`mb-2.5 text-section ${tone === 'warn' ? 'text-band-h4-ink' : ''}`}>{title}</h2>
      ) : null}
      {children}
    </section>
  )
}

/** A label + control pair. The label wraps the control, so screen readers and Playwright agree. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3.5 block">
      <span className="mb-1 block text-label font-medium text-muted">{label}</span>
      {children}
    </label>
  )
}

/** Same look, for a group of controls (chips) that must not be wrapped in a <label>. */
export function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3.5 block">
      <span className="mb-1 block text-label font-medium text-muted">{label}</span>
      {children}
    </div>
  )
}

// --- inputs -----------------------------------------------------------------------------------

const INPUT_CLASS =
  'w-full min-h-11 rounded-field border border-line bg-panel px-3 py-2.5 text-input text-ink outline-none ' +
  'focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:bg-bg disabled:text-muted'

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props
  return <input {...rest} className={`${INPUT_CLASS} ${className}`} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', ...rest } = props
  return <select {...rest} className={`${INPUT_CLASS} ${className}`} />
}

// --- buttons ----------------------------------------------------------------------------------

const BUTTON_BASE =
  'min-h-11 rounded-button px-4 text-body font-semibold disabled:opacity-60 disabled:cursor-not-allowed'
const BUTTON_TONE = {
  main: 'bg-accent text-white',
  quiet: 'border border-line bg-panel text-ink',
  danger: 'border border-danger bg-panel text-danger',
} as const

export function Button({
  tone = 'quiet',
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof BUTTON_TONE }) {
  return <button type="button" {...rest} className={`${BUTTON_BASE} ${BUTTON_TONE[tone]} ${className}`} />
}

/**
 * Two taps, the prototype's guard on a destructive action: the first arms the button for three
 * seconds, the second commits. Nothing is ever deleted here — voiding is what this arms.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
  className = '',
}: {
  label: string
  confirmLabel: string
  onConfirm: () => void
  disabled?: boolean
  className?: string
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])
  return (
    <Button
      tone="danger"
      disabled={disabled}
      className={className}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
    >
      {armed ? confirmLabel : label}
    </Button>
  )
}

// --- chips ------------------------------------------------------------------------------------

const CHIP_BASE =
  'mr-1.5 mb-2 inline-flex min-h-11 items-center rounded-chip border px-3 py-2 text-left text-[14px] leading-tight ' +
  'disabled:opacity-60 motion-safe:transition-colors'

export function Chips<T extends string>({
  options,
  value,
  onChange,
  primary,
  onPrimary,
  labelOf = (v) => v,
  disabled = false,
  groupLabel,
}: {
  options: readonly T[]
  value: readonly T[]
  onChange: (next: T[]) => void
  primary?: string | null
  onPrimary?: (value: T) => void
  labelOf?: (value: T) => string
  disabled?: boolean
  groupLabel: string
}) {
  return (
    <div role="group" aria-label={groupLabel}>
      {options.map((option) => {
        const on = value.includes(option)
        return (
          <button
            key={option}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            className={`${CHIP_BASE} ${
              on ? 'border-accent bg-accent text-white' : 'border-line bg-panel text-ink'
            } ${primary === option ? 'ring-3 ring-accent-soft' : ''}`}
            onClick={() => onChange(on ? value.filter((v) => v !== option) : [...value, option])}
            onDoubleClick={() => {
              if (on) onPrimary?.(option)
            }}
          >
            {labelOf(option)}
          </button>
        )
      })}
    </div>
  )
}

/** A plain action chip (the registration quick-adjusts): no pressed state, same size. */
export function ActionChip({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${CHIP_BASE} border-line bg-panel text-ink`}
    >
      {children}
    </button>
  )
}

// --- times ------------------------------------------------------------------------------------

/**
 * A datetime-local input that is empty until the component hydrates, because only the browser
 * knows its own zone (see `useHydrated`).
 */
export function LocalTimeInput({
  value,
  onChange,
  disabled,
  max,
  id,
  className = '',
}: {
  value: string | null
  onChange: (next: string | null) => void
  disabled?: boolean
  max?: string
  id?: string
  className?: string
}) {
  const hydrated = useHydrated()
  return (
    <Input
      id={id}
      type="datetime-local"
      className={className}
      disabled={disabled}
      value={hydrated ? toLocalInput(value) : ''}
      max={hydrated ? max : undefined}
      onChange={(e) => onChange(fromLocalInput(e.target.value))}
    />
  )
}

/** One labelled timestamp with a Now button — the prototype's `TimeRow`. */
export function TimeRow({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: string | null
  onChange: (next: string | null) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="mb-2 flex items-center gap-2">
      <label htmlFor={id} className="min-w-0 flex-1 text-body text-ink-2">
        {label}
      </label>
      {/* A wrapper, not a width class on the input: the shared input style is `w-full`, and
          overriding it from a className string would depend on Tailwind's utility order. */}
      <div className="w-[178px] shrink-0">
        <LocalTimeInput id={id} value={value} onChange={onChange} disabled={disabled} />
      </div>
      <Button
        aria-label={`Now — ${label}`}
        disabled={disabled}
        className="shrink-0 px-2.5 text-caption font-semibold"
        onClick={() => onChange(new Date().toISOString())}
      >
        Now
      </Button>
    </div>
  )
}

/** A chain of TimeRows over one record — the prototype's `Chain`. */
export function Chain<K extends string>({
  steps,
  value,
  onChange,
  disabled,
}: {
  steps: ReadonlyArray<readonly [K, string]>
  value: Partial<Record<K, string | null>>
  onChange: (next: Partial<Record<K, string | null>>) => void
  disabled?: boolean
}) {
  return (
    <div>
      {steps.map(([key, label]) => (
        <TimeRow
          key={key}
          label={label}
          value={value[key] ?? null}
          onChange={(next) => onChange({ ...value, [key]: next })}
          disabled={disabled}
        />
      ))}
    </div>
  )
}
