import { THRESHOLDS_H } from '@/src/lib/domain/taxonomy'

const bands = [
  ['none', 'bg-band-none', 'no data'],
  ['ok', 'bg-band-ok', 'under 4h'],
  ['h4', 'bg-band-h4', '4h and over'],
  ['h6', 'bg-band-h6', '6h and over'],
  ['h12', 'bg-band-h12', '12h and over'],
  ['h24', 'bg-band-h24', '24h and over'],
] as const

// The board itself lands in Phase 3. Until then this is the signed-in home: the band legend
// (kept from the Phase 0 holding page) and a note about what is coming.
export default function Home() {
  return (
    <>
      <p className="text-body text-ink-2">
        The board arrives in Phase 3. Until then this page confirms your account, your role and
        the elapsed-time bands every case will be coloured by.
      </p>

      <section className="mt-6 rounded-card border border-line bg-panel p-4 shadow-panel">
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
        Phase 1 deployed: sign-in, sessions and the role gate. Build progress: <code>docs/PLAN.md</code>{' '}
        in the repository.
      </p>
    </>
  )
}
