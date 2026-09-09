import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The transport options are the one place the mailbox's TLS posture is decided (security audit
 * SPC-WEB-008). nodemailer is mocked so no socket is opened; the assertions are on what would
 * have been.
 */
type TransportOptions = {
  host: string
  port: number
  secure: boolean
  requireTLS: boolean
  tls: { minVersion: string }
  auth?: { user: string; pass: string }
}

const createTransport = vi.hoisted(() =>
  vi.fn<(options: TransportOptions) => { sendMail: () => void }>().mockImplementation(() => ({ sendMail: () => {} })),
)
vi.mock('nodemailer', () => ({ default: { createTransport } }))

import { isImplicitTls, readSmtpConfig, smtpMailer } from '../smtp'

const BASE = {
  host: 'mail.example.com',
  user: 'navigator@towardpcc.com',
  password: 'x',
  from: 'ER Navigator <navigator@towardpcc.com>',
}

/** `readSmtpConfig` takes `NodeJS.ProcessEnv`, whose `NODE_ENV` is required under this tsconfig. */
const env = (vars: Record<string, string>): NodeJS.ProcessEnv => ({ NODE_ENV: 'test', ...vars })

function lastOptions(): TransportOptions {
  const call = createTransport.mock.calls.at(-1)
  if (!call) throw new Error('createTransport was not called')
  return call[0]
}

describe('smtpMailer transport options', () => {
  beforeEach(() => createTransport.mockClear())

  it('uses implicit TLS on 465 and never below TLS 1.2', () => {
    smtpMailer({ ...BASE, port: 465 })
    expect(createTransport).toHaveBeenCalledTimes(1)
    const opts = lastOptions()
    expect(opts.secure).toBe(true)
    expect(opts.requireTLS).toBe(false)
    expect(opts.tls).toEqual({ minVersion: 'TLSv1.2' })
    expect(opts.auth).toEqual({ user: BASE.user, pass: BASE.password })
  })

  it('insists on STARTTLS on 587 instead of falling back to cleartext', () => {
    smtpMailer({ ...BASE, port: 587 })
    const opts = lastOptions()
    expect(opts.secure).toBe(false)
    expect(opts.requireTLS).toBe(true)
    expect(opts.tls).toEqual({ minVersion: 'TLSv1.2' })
  })

  it('sends no auth block when there is no username', () => {
    smtpMailer({ ...BASE, user: '', port: 587 })
    expect(lastOptions().auth).toBeUndefined()
  })
})

describe('readSmtpConfig', () => {
  it('is null without a host, so the worker logs instead of sending', () => {
    expect(readSmtpConfig(env({}))).toBeNull()
    expect(readSmtpConfig(env({ SMTP_HOST: '  ' }))).toBeNull()
  })

  it('defaults the port to 587 and the From line to the app sender', () => {
    const config = readSmtpConfig(env({ SMTP_HOST: 'mail.example.com', SMTP_USER: 'u', SMTP_PASSWORD: 'p' }))
    expect(config).toEqual({
      host: 'mail.example.com',
      port: 587,
      user: 'u',
      password: 'p',
      from: 'ER Navigator <no-reply@towardpcc.com>',
    })
    expect(readSmtpConfig(env({ SMTP_HOST: 'h', SMTP_PORT: 'nonsense' }))?.port).toBe(587)
    expect(readSmtpConfig(env({ SMTP_HOST: 'h', SMTP_PORT: '465' }))?.port).toBe(465)
  })

  it('treats only 465 as implicit TLS', () => {
    expect(isImplicitTls(465)).toBe(true)
    expect(isImplicitTls(587)).toBe(false)
    expect(isImplicitTls(25)).toBe(false)
  })
})
