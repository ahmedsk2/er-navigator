/**
 * The tab bar has four destinations from Phase 3 on, but only the board exists yet. Rather than
 * three dead tabs, each one is a real route that says which phase builds it.
 */
export function Placeholder({ title, phase, children }: { title: string; phase: string; children: string }) {
  return (
    <div className="px-4 pt-4 pb-6">
      <h2 className="text-title">{title}</h2>
      <p className="mt-1 text-caption text-muted">{phase}</p>
      <p className="mt-4 text-body text-ink-2">{children}</p>
    </div>
  )
}
