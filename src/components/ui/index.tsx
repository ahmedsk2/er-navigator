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

/**
 * What every action runner says when the call itself threw rather than answering (Phase 7, C11):
 * a dropped ward wifi, a 502 during the stop-then-start deploy window, a Prisma transaction
 * timeout. It must say that nothing was saved, because a failed save is otherwise
 * indistinguishable from a successful one — the button simply re-enables.
 */
export const UNREACHABLE_MESSAGE =
  'Could not reach the server. Nothing was saved. Check the connection and try again.'

// --- section ----------------------------------------------------------------------------------

/**
 * A section of the case editor. A card since Phase 9, for the same reason the dashboard's
 * sections became cards: an editor that is fourteen strips between hairlines reads as one form,
 * and the nurse's question is which block she is in. `icon` goes inside the heading and is
 * `aria-hidden`, so every section title is still selected by its exact name.
 *
 * An `id` makes the section a place the case page's strip jumps to (Phase 11): focusable from a
 * script, so the keyboard lands where the eye does, but never a Tab stop; and a top scroll margin
 * the height of the strip and a little more, so a jump stops below the strip rather than under it.
 * From `lg` the strip does not stick, and the margin is only breathing room.
 */
export function Section({
  title,
  children,
  tone = 'plain',
  id,
  icon,
}: {
  title?: string
  children: ReactNode
  tone?: 'plain' | 'warn'
  id?: string
  icon?: ReactNode
}) {
  return (
    <section
      id={id}
      tabIndex={id ? -1 : undefined}
      className={`mx-4 mb-2.5 rounded-card border bg-panel p-4 shadow-card ${
        tone === 'warn' ? 'border-band-h4 border-l-4 border-l-band-h4' : 'border-line'
      } ${id ? 'scroll-mt-18 focus:outline-none lg:scroll-mt-4' : ''}`}
    >
      {title ? (
        <h2 className={`mb-2.5 flex items-center gap-2 text-section ${tone === 'warn' ? 'text-band-h4-ink' : ''}`}>
          {icon ? <span className={tone === 'warn' ? 'text-band-h4-ink' : 'text-accent'}>{icon}</span> : null}
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  )
}

/**
 * A label + control pair. The label wraps the control, so screen readers and Playwright agree.
 *
 * `htmlFor` is for a control that shares its row with a button (Phase 10: the microphone beside
 * the working diagnosis and the resolution note). A <label> may hold one control, and wrapping
 * the button too made it part of the input's name — "Working diagnosis (optional) Dictate". With
 * `htmlFor` the label names the control by its id and the row sits beside the label, not inside
 * it; the look is the same.
 *
 * Every `<select>` takes `htmlFor` too (Phase 11, finding 4): a wrapping label's text is its
 * caption followed by every option, so the select could not be found by its label alone, and the
 * aria-labels that stood in for the label on some of them are gone with it.
 */
export function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  if (htmlFor) {
    return (
      <div className="mb-3.5 block">
        <label htmlFor={htmlFor} className="mb-1 block text-label font-medium text-muted">
          {label}
        </label>
        {children}
      </div>
    )
  }
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

/**
 * The two button fills, exported because the export page's downloads are <a> elements — a link
 * that starts a download cannot be a <button> — and a second copy of these strings is how the
 * primitive drifts (Phase 9).
 */
export const BUTTON_MAIN = 'bg-accent text-white'
export const BUTTON_QUIET = 'border border-line bg-panel text-ink'

const BUTTON_TONE = {
  main: BUTTON_MAIN,
  quiet: BUTTON_QUIET,
  danger: 'border border-danger bg-panel text-danger',
} as const

/**
 * `ComponentPropsWithRef`, not `ButtonHTMLAttributes`: React 19 passes `ref` as an ordinary prop
 * to a function component, and the summary sheet needs one so that closing the dialog can put
 * focus back on the button that opened it (Phase 10).
 */
export function Button({
  tone = 'quiet',
  className = '',
  ...rest
}: React.ComponentPropsWithRef<'button'> & { tone?: keyof typeof BUTTON_TONE }) {
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

/**
 * `retiredOf` marks an option an Admin has deactivated that the record already carries (Phase 7,
 * C4/C10). Such a chip is greyed, labelled "(retired)" and deselect-only: tapping it clears the
 * stale selection, and once it is off it can never be turned back on.
 */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  primary,
  onPrimary,
  labelOf = (v) => v,
  retiredOf,
  disabled = false,
  groupLabel,
}: {
  options: readonly T[]
  value: readonly T[]
  onChange: (next: T[]) => void
  primary?: string | null
  onPrimary?: (value: T) => void
  labelOf?: (value: T) => string
  retiredOf?: (value: T) => boolean
  disabled?: boolean
  groupLabel: string
}) {
  return (
    <div role="group" aria-label={groupLabel}>
      {options.map((option) => {
        const on = value.includes(option)
        const retired = retiredOf?.(option) ?? false
        const spent = retired && !on
        return (
          <button
            key={option}
            type="button"
            disabled={disabled || spent}
            aria-pressed={on}
            /* Phase 9: the pressed chip is the soft tint the templates use for a status, not a
               block of accent — a form with nine selected chips was nine teal rectangles. The
               ring that marks the primary reason still reads against it because it is the
               accent border, not the soft fill. */
            className={`${CHIP_BASE} ${
              retired
                ? `border-line bg-bg text-muted ${spent ? 'opacity-60' : ''}`
                : on
                  ? 'border-accent bg-accent-soft font-semibold text-accent-ink'
                  : 'border-line bg-panel text-ink-2'
            } ${primary === option ? 'ring-3 ring-accent' : ''}`}
            onClick={() => {
              if (spent) return
              onChange(on ? value.filter((v) => v !== option) : [...value, option])
            }}
            onDoubleClick={() => {
              if (on && !retired) onPrimary?.(option)
            }}
          >
            {retired ? `${labelOf(option)} (retired)` : labelOf(option)}
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

/**
 * One labelled timestamp with a Now button — the prototype's `TimeRow`.
 *
 * Phase 11, finding 1: the prototype's row put a 178 px box beside its label, and Chromium draws a
 * datetime-local value in about 176 px of its own plus the picker, so it had 132 and cut the day
 * off the front — "0/2026 10:44 PM", on every time of the case page. Below `sm` the label now takes
 * its own line, in the look every other label above a control has (`Field`), and the box fills the
 * line under it beside Now; from `sm` the three share one row again with a box that holds the
 * whole value. `step` is the journey's milestone number: it rides on the label's line, so the box
 * keeps the full width on a phone rather than giving 24 px of it to a number column.
 */
export function TimeRow({
  label,
  value,
  onChange,
  disabled,
  step,
}: {
  label: string
  value: string | null
  onChange: (next: string | null) => void
  disabled?: boolean
  step?: number
}) {
  const id = useId()
  return (
    <div className="mb-3 sm:mb-2 sm:flex sm:items-center sm:gap-2">
      <div className="mb-1 flex items-baseline gap-2 sm:mb-0 sm:min-w-0 sm:flex-1 sm:items-center">
        {step === undefined ? null : (
          <span className="num w-4 shrink-0 text-caption text-muted" aria-hidden>
            {step}
          </span>
        )}
        <label
          htmlFor={id}
          className="min-w-0 flex-1 text-label font-medium text-muted sm:text-body sm:font-normal sm:text-ink-2"
        >
          {label}
        </label>
      </div>
      <div className="flex items-center gap-2">
        {/* A wrapper, not a width class on the input: the shared input style is `w-full`, and
            overriding it from a className string would depend on Tailwind's utility order. From
            `sm` it is 240 px: the 176 px value, the 20 px picker and the input's own 26 px of
            padding and border, with room to spare. */}
        <div className="min-w-0 flex-1 sm:w-60 sm:flex-none">
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
