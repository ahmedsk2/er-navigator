import { THRESHOLDS_H } from '@/src/lib/domain/taxonomy'

const bands = [
  ['ok', 'bg-band-ok', '< 4h'],
  ['h4', 'bg-band-h4', '≥ 4h'],
  ['h6', 'bg-band-h6', '≥ 6h'],
  ['h12', 'bg-band-h12', '≥ 12h'],
  ['h24', 'bg-band-h24', '≥ 24h'],
] as const

// Phase 0 holding page. Replaced by the login gate in Phase 1 (plan §5.1).
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-10 pb-16">
      <p className="text-sm text-muted">Qatif Central Hospital · Emergency Department</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">ER Navigator</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        Replaces the WhatsApp group for patients whose ED stay is running long. One board, one clock
        per patient, and a record leadership can act on.
      </p>

      <section className="mt-8 rounded-xl border border-line bg-panel p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Elapsed-time bands</h2>
          <span className="num text-xs text-muted">thresholds {THRESHOLDS_H.join(' / ')}h</span>
        </div>
        <ul className="mt-3 divide-y divide-line">
          {bands.map(([key, cls, label]) => (
            <li key={key} className="flex items-center gap-3 py-2">
              <span className={`h-6 w-1.5 rounded-r ${cls}`} aria-hidden />
              <span className="num text-sm font-semibold">{label}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-8 text-xs text-muted">
        Phase 0 scaffold deployed. Build progress: <code>docs/PLAN.md</code> in the repository.
      </p>
    </main>
  )
}
