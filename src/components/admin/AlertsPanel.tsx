'use client'

/**
 * Admin → Alerts: what the worker recorded, whether it emailed, and who acknowledged it.
 *
 * The threshold carries the board's own colour band, so a 24 h row reads as a 24 h row here too.
 * Nothing is ever deleted: acknowledging is the only state an alert has.
 */
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { acknowledgeAlert as acknowledgeAlertAction } from '@/app/(app)/admin/actions'
import { Button, UNREACHABLE_MESSAGE } from '@/src/components/ui'
import type { AlertRow } from '@/src/lib/alerts/service'
import { fmtStamp } from '@/src/lib/cases/local-time'
import { band, type Band } from '@/src/lib/domain/time'

const BAND_TEXT: Record<Band, string> = {
  none: 'text-band-none',
  ok: 'text-band-ok',
  h4: 'text-band-h4-ink',
  h6: 'text-band-h6',
  h12: 'text-band-h12',
  h24: 'text-band-h24',
}

export function AlertsPanel({ alerts, canAcknowledge }: { alerts: AlertRow[]; canAcknowledge: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const onAcknowledge = async (row: AlertRow): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await acknowledgeAlertAction(row.id)
      if (result.ok) router.refresh()
      else setMessage(result.message)
    } catch {
      // A thrown action, not a refusal: say so rather than re-enabling in silence (Phase 7, C11).
      setMessage(UNREACHABLE_MESSAGE)
    } finally {
      setBusy(false)
    }
  }

  const unacknowledged = alerts.filter((a) => a.acknowledgedAt === null).length

  return (
    <div>
      <p className="mb-2.5 text-body text-ink-2" data-alert-count>
        {unacknowledged} unacknowledged of {alerts.length} recorded
      </p>

      {message ? (
        <p role="alert" className="mb-2.5 rounded-card border border-danger bg-panel p-3 text-body text-danger">
          {message}
        </p>
      ) : null}

      {alerts.length === 0 ? (
        <p className="rounded-card border border-line bg-panel p-4 text-body text-muted">
          Nothing recorded yet. The worker checks every open case every few minutes and records a
          row the first time a case passes 4, 6, 12 or 24 hours.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-panel">
          <table className="w-full border-collapse text-body">
            <caption className="sr-only">Fired threshold alerts, newest first</caption>
            <thead>
              <tr className="border-b border-line text-left text-label text-muted">
                <th scope="col" className="p-3 font-medium">
                  MRN
                </th>
                <th scope="col" className="p-3 font-medium">
                  Threshold
                </th>
                <th scope="col" className="p-3 font-medium">
                  Fired at
                </th>
                <th scope="col" className="p-3 font-medium">
                  Email sent
                </th>
                <th scope="col" className="p-3 font-medium">
                  Acknowledged
                </th>
                <th scope="col" className="p-3 font-medium">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((row) => (
                <tr key={row.id} data-alert={row.id} className="border-b border-line-soft last:border-b-0">
                  <td className="p-3">
                    <Link href={`/cases/${row.caseId}`} className="num font-semibold text-accent-ink">
                      {row.mrn}
                    </Link>
                  </td>
                  <td className={`num p-3 font-semibold ${BAND_TEXT[band(row.thresholdHours)]}`}>
                    {row.thresholdHours}h
                  </td>
                  <td className="num p-3 text-ink-2">{fmtStamp(row.firedAt)}</td>
                  <td className="num p-3 text-ink-2">
                    {row.emailSentAt ? fmtStamp(row.emailSentAt) : '–'}
                  </td>
                  <td className="p-3 text-ink-2" data-acknowledged={row.acknowledgedAt ? 'yes' : 'no'}>
                    {row.acknowledgedAt ? (
                      <>
                        {row.acknowledgedBy ?? 'Someone'} ·{' '}
                        <span className="num">{fmtStamp(row.acknowledgedAt)}</span>
                      </>
                    ) : (
                      '–'
                    )}
                  </td>
                  <td className="p-3">
                    {row.acknowledgedAt || !canAcknowledge ? null : (
                      <Button
                        aria-label={`Acknowledge the ${row.thresholdHours}h alert for MRN ${row.mrn}`}
                        disabled={busy}
                        onClick={() => void onAcknowledge(row)}
                      >
                        Acknowledge
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2.5 text-caption text-muted">
        Alerts never fill in &quot;medical admin informed&quot;. That stays a human confirmation on
        the case.
      </p>
    </div>
  )
}
