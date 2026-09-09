import { describe, expect, it } from 'vitest'
import { buildAlertEmail, caseLink } from '../email'

const INPUT = {
  mrn: '851557',
  caseId: 'abc123',
  thresholdHours: 12,
  elapsedHours: 12.5,
  primaryReason: 'No bed available on accepting ward',
  departments: ['Internal Medicine', 'ICU'],
  appUrl: 'https://nav.towardpcc.com',
}

describe('buildAlertEmail', () => {
  it('uses the subject the spec dictates', () => {
    expect(buildAlertEmail(INPUT).subject).toBe('ER Navigator: MRN 851557 past 12h')
  })

  it('carries the MRN, the waiting time, the reason, the departments and the link', () => {
    const { text } = buildAlertEmail(INPUT)
    expect(text).toContain('MRN: 851557')
    expect(text).toContain('Waiting: 12h 30m')
    expect(text).toContain('Primary reason: No bed available on accepting ward')
    expect(text).toContain('Departments: Internal Medicine, ICU')
    expect(text).toContain('https://nav.towardpcc.com/cases/abc123')
  })

  it('says so rather than leaving a blank when a field is missing', () => {
    const { text } = buildAlertEmail({
      ...INPUT,
      elapsedHours: null,
      primaryReason: null,
      departments: [],
    })
    expect(text).toContain('Waiting: –')
    expect(text).toContain('Primary reason: Not recorded')
    expect(text).toContain('Departments: None recorded')
  })

  it('escapes the HTML body so a reason with a bracket cannot inject markup', () => {
    const { html } = buildAlertEmail({ ...INPUT, primaryReason: 'Ward said <b>no</b>' })
    expect(html).toContain('Ward said &lt;b&gt;no&lt;/b&gt;')
    expect(html).not.toContain('<b>no</b>')
  })

  it('never carries anything but the MRN to identify the patient', () => {
    const { text, html } = buildAlertEmail(INPUT)
    for (const body of [text, html]) {
      expect(body).not.toMatch(/name|date of birth|national id/i)
    }
  })
})

describe('caseLink', () => {
  it('does not double the slash when APP_URL has a trailing one', () => {
    expect(caseLink('https://nav.towardpcc.com/', 'x1')).toBe('https://nav.towardpcc.com/cases/x1')
    expect(caseLink('https://nav.towardpcc.com', 'x1')).toBe('https://nav.towardpcc.com/cases/x1')
  })
})

/**
 * Phase 7 deleted `parseRecipientMap` and the `ALERT_EMAIL_MAP` variable behind it: recipients
 * are now the active SUPERVISOR and ADMIN users with an `email` (`store.recipients()`), so this
 * module decides only what the message says. This guard keeps the environment directory from
 * quietly coming back.
 */
describe('the recipient directory', () => {
  it('is not this file’s job any more', async () => {
    const exported: Record<string, unknown> = await import('../email')
    expect(Object.keys(exported)).not.toContain('parseRecipientMap')
  })
})
