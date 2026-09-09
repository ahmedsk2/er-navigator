/**
 * The alert message and the port the worker sends it through.
 *
 * The template is pure (subject, text, minimal HTML) so it can be asserted without a mail
 * server, and `Mailer` is the seam the unit tests replace with a fake. `smtp.ts` holds the one
 * nodemailer-shaped implementation. Who receives it is not decided here: the recipients are the
 * active SUPERVISOR and ADMIN rows with an `email`, read by `store.ts` on every cycle.
 *
 * No PHI beyond the MRN: the message carries the MRN, the waiting time, the primary reason, the
 * consulted departments and a link. Nothing else about the patient exists to leak.
 */
import { fmtHours } from '@/src/lib/domain/time'

export type OutgoingMessage = {
  to: string[]
  subject: string
  text: string
  html: string
}

/** What a transport tells us it did. `response` is the SMTP server's own line. */
export type MailResult = {
  accepted: string[]
  rejected: string[]
  response: string
  messageId: string
}

export type Mailer = {
  send(message: OutgoingMessage): Promise<MailResult>
}

export type AlertEmailInput = {
  mrn: string
  caseId: string
  thresholdHours: number
  /** Elapsed stay at the moment the alert fired; null when it cannot be computed. */
  elapsedHours: number | null
  primaryReason: string | null
  departments: ReadonlyArray<string>
  appUrl: string
}

export type AlertEmailBody = { subject: string; text: string; html: string }

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** `${APP_URL}/cases/{id}`, with any trailing slash on APP_URL removed. */
export function caseLink(appUrl: string, caseId: string): string {
  return `${appUrl.replace(/\/+$/, '')}/cases/${caseId}`
}

export function buildAlertEmail(input: AlertEmailInput): AlertEmailBody {
  const link = caseLink(input.appUrl, input.caseId)
  const rows: Array<[string, string]> = [
    ['MRN', input.mrn],
    ['Waiting', fmtHours(input.elapsedHours)],
    ['Primary reason', input.primaryReason ?? 'Not recorded'],
    ['Departments', input.departments.length > 0 ? input.departments.join(', ') : 'None recorded'],
  ]

  const subject = `ER Navigator: MRN ${input.mrn} past ${input.thresholdHours}h`
  const text = [
    `MRN ${input.mrn} has been in the Emergency Department past the ${input.thresholdHours} hour threshold.`,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    `Open the case: ${link}`,
    '',
    'This is an automatic message from ER Navigator. Do not reply.',
  ].join('\n')

  const html = [
    `<p>MRN <strong>${escapeHtml(input.mrn)}</strong> has been in the Emergency Department past the ${input.thresholdHours} hour threshold.</p>`,
    '<ul>',
    ...rows.map(([label, value]) => `<li>${escapeHtml(label)}: ${escapeHtml(value)}</li>`),
    '</ul>',
    `<p><a href="${escapeHtml(link)}">Open the case</a></p>`,
    '<p>This is an automatic message from ER Navigator. Do not reply.</p>',
  ].join('\n')

  return { subject, text, html }
}
