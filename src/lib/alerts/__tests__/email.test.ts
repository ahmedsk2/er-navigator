import { describe, expect, it } from 'vitest'
import { buildAlertEmail, caseLink, parseRecipientMap } from '../email'

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

describe('parseRecipientMap', () => {
  it('is empty when the variable is unset', () => {
    expect(parseRecipientMap(undefined).size).toBe(0)
    expect(parseRecipientMap('').size).toBe(0)
  })

  it('reads username=address pairs separated by commas, semicolons or spaces', () => {
    const map = parseRecipientMap('sami=sami@example.org, ahmed=ahmed@example.org;  nadia=n@x.io')
    expect(map.get('sami')).toBe('sami@example.org')
    expect(map.get('ahmed')).toBe('ahmed@example.org')
    expect(map.get('nadia')).toBe('n@x.io')
  })

  it('drops entries that are not a username and an address', () => {
    const map = parseRecipientMap('sami, =nothing@x.io, broken=notanaddress, ok=ok@x.io')
    expect([...map.keys()]).toEqual(['ok'])
  })
})
