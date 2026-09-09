/**
 * The one nodemailer-shaped `Mailer`. Kept apart from `email.ts` so the template and the cycle
 * can be unit tested without loading a transport.
 *
 * The `navigator@towardpcc.com` mailbox's own settings, as a mail client would hold them: host,
 * port 465 with TLS or 587 with STARTTLS, username = the full address, password. No relay.
 * `SMTP_FROM` is the From line. When `SMTP_HOST` is empty `alertMailer()` returns null and the
 * worker logs the message instead of sending it (spec).
 */
import nodemailer from 'nodemailer'
import type { Mailer, MailResult, OutgoingMessage } from './email'

export type SmtpConfig = {
  host: string
  port: number
  user: string
  password: string
  from: string
}

/** Port 465 is implicit TLS; everything else (587 in practice) upgrades with STARTTLS. */
export function isImplicitTls(port: number): boolean {
  return port === 465
}

export function readSmtpConfig(env: NodeJS.ProcessEnv): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim()
  if (!host) return null
  const port = Number(env.SMTP_PORT ?? 587)
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    user: env.SMTP_USER?.trim() ?? '',
    password: env.SMTP_PASSWORD ?? '',
    from: env.SMTP_FROM?.trim() || 'ER Navigator <no-reply@towardpcc.com>',
  }
}

export function smtpMailer(config: SmtpConfig): Mailer {
  const implicitTls = isImplicitTls(config.port)
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: implicitTls,
    // Security audit SPC-WEB-008: on 587 insist on STARTTLS rather than falling back to
    // cleartext if a network attacker strips the capability; never below TLS 1.2 either way.
    requireTLS: !implicitTls,
    tls: { minVersion: 'TLSv1.2' },
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
  })

  return {
    async send(message: OutgoingMessage): Promise<MailResult> {
      const info = await transport.sendMail({
        from: config.from,
        to: message.to.join(', '),
        subject: message.subject,
        text: message.text,
        html: message.html,
      })
      return {
        accepted: (info.accepted ?? []).map(String),
        rejected: (info.rejected ?? []).map(String),
        response: info.response ?? '',
        messageId: info.messageId ?? '',
      }
    },
  }
}
