'use client'

/**
 * The header's overflow menu, not a sidebar (spec: phase3-board.md). It holds what Phase 1 put in
 * the header bar — the signed-in name, which still taps through to `/account`, and Log out — plus
 * "Print handover", which is just `window.print()` against the board's print stylesheet.
 */
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { logout } from '@/app/(app)/actions'

const ITEM =
  'flex min-h-11 w-full items-center px-4 text-left text-body text-ink hover:bg-accent-soft focus:bg-accent-soft focus:outline-none'

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
        className="flex min-h-11 min-w-11 items-center justify-center rounded-button border border-line text-[20px] leading-none text-ink"
      >
        <span aria-hidden>⋯</span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Menu"
          className="absolute right-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-card border border-line bg-panel py-1 shadow-float"
        >
          <Link role="menuitem" href="/account" className={ITEM} onClick={() => setOpen(false)}>
            <span className="truncate">
              {displayName} · {roleLabel}
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
            Print handover
          </button>
          <form action={logout}>
            <button type="submit" role="menuitem" className={ITEM}>
              Log out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  )
}
