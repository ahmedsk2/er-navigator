import { THRESHOLDS_H } from '@/src/lib/domain/taxonomy'

const bands = [
  ['none', 'bg-band-none', 'no data'],
  ['ok', 'bg-band-ok', 'under 4h'],
  ['h4', 'bg-band-h4', '4h and over'],
  ['h6', 'bg-band-h6', '6h and over'],
  ['h12', 'bg-band-h12', '12h and over'],
  ['h24', 'bg-band-h24', '24h and over'],
] as const

// Phase 0 holding page. Replaced by the login gate in Phase 1 (plan section 5.1).
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-10 pb-16">
      <p className="text-label font-medium text-muted">Qatif Central Hospital · Emergency Department</p>
      <h1 className="mt-1 text-title tracking-tight">ER Navigator</h1>
      <p className="mt-3 text-body text-ink-2">
        Replaces the WhatsApp group for patients whose ED stay is running long. One board, one clock
        per patient, and a record leadership can act on.
      </p>

      <section className="mt-8 rounded-card border border-line bg-panel p-4 shadow-panel">
        <div className="flex items-baseline justify-between">
          <h2 className="text-section">Elapsed-time bands</h2>
          <span className="num text-caption text-muted">thresholds {THRESHOLDS_H.join(' / ')} h</span>
        </div>
        <ul className="mt-3 divide-y divide-line-soft">
          {bands.map(([key, cls, label]) => (
            <li key={key} className="flex min-h-11 items-center gap-3 py-2">
              <span className={`h-6 w-1.5 rounded-r ${cls}`} aria-hidden />
              <span className="num text-body font-semibold">{label}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-8 text-caption text-muted">
        Phase 0 scaffold deployed. Build progress: <code>docs/PLAN.md</code> in the repository.
      </p>
    </main>
  )
}
