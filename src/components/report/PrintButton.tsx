'use client'

/** The report's only interactive element: `window.print()`, the same call the board's menu makes. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print inline-flex min-h-11 items-center rounded-button bg-accent px-4 text-body font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
    >
      Print
    </button>
  )
}
