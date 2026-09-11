'use client'

/**
 * The header's overflow menu, not a sidebar (spec: phase3-board.md). It holds what Phase 1 put in
 * the header bar — the signed-in name, which still taps through to `/account`, and Log out — plus
 * "Print handover", which is just `window.print()` against the board's print stylesheet.
 *
 * Phase 9 changed only what the trigger looks like: the user's initials in a circle instead of
 * "⋯", because the coloured header needed something of the person in it and the initials are the
 * one thing a nurse recognises at arm's length. They are `aria-hidden`; the button's accessible
 * name is still "Menu", and every item keeps its exact name.
 *
 * Phase 11 (finding 5): the account row says what it is. A new user is told to change the
 * temporary password "at /account", and the only way there was a row showing their own name; a
 * second line under the name and role now reads "Account and password".
 */
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { logout } from '@/app/(app)/actions'
import { LogOut, Printer, User } from '@/src/components/icons'
import { initialsOf } from './initials'

const ITEM =
  'flex min-h-11 w-full items-center gap-2.5 px-4 text-left text-body text-ink hover:bg-accent-soft focus:bg-accent-soft focus:outline-none'

export function OverflowMenu({ displayName, roleLabel }: { displayName: string; roleLabel: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  // A tap anywhere else, or Escape, closes it — the phone has no other way out of a popover.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent | TouchEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-chip"
      >
        <span
          aria-hidden
          className="grid size-9 place-items-center rounded-chip bg-white/20 text-label font-semibold text-white"
        >
          {initialsOf(displayName)}
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Menu"
          className="absolute right-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-card border border-line bg-panel py-1 shadow-float"
        >
          <Link role="menuitem" href="/account" className={`${ITEM} py-2`} onClick={() => setOpen(false)}>
            <User size={18} className="shrink-0 text-muted" />
            <span className="min-w-0">
              <span className="block truncate">
                {displayName} · {roleLabel}
              </span>
              <span className="block text-caption text-muted">Account and password</span>
            </span>
          </Link>
          <button
            type="button"
            role="menuitem"
            className={ITEM}
            onClick={() => {
              setOpen(false)
              window.print()
            }}
          >
            <Printer size={18} className="shrink-0 text-muted" />
            Print handover
          </button>
          <form action={logout}>
            <button type="submit" role="menuitem" className={ITEM}>
              <LogOut size={18} className="shrink-0 text-muted" />
              Log out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  )
}
