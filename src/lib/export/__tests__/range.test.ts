import { describe, expect, it } from 'vitest'
import {
  addDays,
  defaultExportRange,
  exportFilename,
  exportRangeQuery,
  parseDateKey,
  parseExportFormat,
  parseExportRange,
  parseExportStatus,
  reportQuery,
  riyadhDateKey,
  riyadhDayBounds,
  riyadhDayStart,
  riyadhWeekday,
  type ExportRange,
} from '../range'
import { EMPTY_FILTER } from '@/src/lib/domain/case-filter'

/**
 * Asia/Riyadh is UTC+3 with no DST, so midnight local is 21:00 UTC the previous day. Every
 * expectation below is that arithmetic done by hand — the point of the module is that the server
 * (which runs in UTC) filters on the nurse's calendar day, not on its own.
 */
describe('riyadhDateKey', () => {
  it('uses the Riyadh calendar day, not the UTC one', () => {
    expect(riyadhDateKey(new Date('2026-09-08T12:00:00Z'))).toBe('2026-09-08')
    // 22:30 UTC is 01:30 the next morning in Riyadh.
    expect(riyadhDateKey(new Date('2026-09-08T22:30:00Z'))).toBe('2026-09-09')
    // 20:59:59 UTC is still 23:59 the same evening.
    expect(riyadhDateKey(new Date('2026-09-08T20:59:59Z'))).toBe('2026-09-08')
  })
})

describe('riyadhWeekday', () => {
  it('names the Riyadh weekday', () => {
    expect(riyadhWeekday(new Date('2026-09-08T12:00:00Z'))).toBe('Tue')
    // 21:30 UTC on Tuesday is already Wednesday in Riyadh.
    expect(riyadhWeekday(new Date('2026-09-08T21:30:00Z'))).toBe('Wed')
  })
})

describe('riyadhDayStart', () => {
  it('is 21:00 UTC on the previous day', () => {
    expect(riyadhDayStart('2026-09-08').toISOString()).toBe('2026-09-07T21:00:00.000Z')
  })

  it('rejects anything that is not a date', () => {
    expect(() => riyadhDayStart('08/09/2026')).toThrow()
  })
})

describe('addDays', () => {
  it('walks the calendar, including over a month end', () => {
    expect(addDays('2026-09-08', 1)).toBe('2026-09-09')
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('riyadhDayBounds', () => {
  const bounds = riyadhDayBounds('2026-09-01', '2026-09-08')

  it('is half-open: the whole of `to` is inside, the next day is not', () => {
    expect(bounds.gte.toISOString()).toBe('2026-08-31T21:00:00.000Z')
    expect(bounds.lt.toISOString()).toBe('2026-09-08T21:00:00.000Z')
  })

  it('keeps a case registered at 23:59 Riyadh on the last day', () => {
    const lastMinute = new Date('2026-09-08T20:59:00Z') // 23:59 Riyadh
    expect(lastMinute >= bounds.gte && lastMinute < bounds.lt).toBe(true)
  })

  it('drops a case registered at 00:00 Riyadh the day after', () => {
    const nextMidnight = new Date('2026-09-08T21:00:00Z')
    expect(nextMidnight < bounds.lt).toBe(false)
  })

  it('keeps a case registered at 00:00 Riyadh on the first day', () => {
    expect(new Date('2026-08-31T21:00:00Z') >= bounds.gte).toBe(true)
    expect(new Date('2026-08-31T20:59:00Z') >= bounds.gte).toBe(false)
  })
})

describe('parseDateKey', () => {
  it('accepts a real date and rejects everything else', () => {
    expect(parseDateKey('2026-09-08')).toBe('2026-09-08')
    expect(parseDateKey(['2026-09-08', '2026-01-01'])).toBe('2026-09-08')
    expect(parseDateKey('2026-02-31')).toBeNull()
    expect(parseDateKey('2026-13-01')).toBeNull()
    expect(parseDateKey('08/09/2026')).toBeNull()
    expect(parseDateKey(undefined)).toBeNull()
  })
})

describe('parseExportStatus', () => {
  it('falls back to all', () => {
    expect(parseExportStatus('open')).toBe('open')
    expect(parseExportStatus('resolved')).toBe('resolved')
    expect(parseExportStatus('VOIDED')).toBe('all')
    expect(parseExportStatus(undefined)).toBe('all')
  })
})

describe('defaultExportRange', () => {
  it('is the prototype default: seven days back to today, all statuses', () => {
    expect(defaultExportRange(new Date('2026-09-08T12:00:00Z'))).toEqual({
      from: '2026-09-01',
      to: '2026-09-08',
      status: 'all',
      format: 'navigator',
    })
  })
})

describe('parseExportFormat', () => {
  it('reads the three formats and nothing else', () => {
    expect(parseExportFormat('navigator')).toBe('navigator')
    expect(parseExportFormat('adaa')).toBe('adaa')
    expect(parseExportFormat('qch')).toBe('qch')
  })

  it('falls back to the ER Navigator workbook for anything else', () => {
    expect(parseExportFormat('ADAA')).toBe('navigator')
    expect(parseExportFormat('csv')).toBe('navigator')
    expect(parseExportFormat(undefined)).toBe('navigator')
    expect(parseExportFormat(null)).toBe('navigator')
  })
})

describe('parseExportRange', () => {
  const now = new Date('2026-09-08T12:00:00Z')

  it('leaves the filter off entirely when the query string names none', () => {
    // Phase 10: `filter` is absent, not an empty object, so a range with no filter is exactly the
    // value it was before this phase — which is what keeps the two query strings byte-identical.
    expect(parseExportRange({ from: '2026-08-01', to: '2026-08-31' }, now).filter).toBeUndefined()
    expect(parseExportRange({ from: '2026-08-01', not: '1', lone: '1' }, now).filter).toBeUndefined()
  })

  it('reads the case filter beside the range', () => {
    expect(
      parseExportRange({ from: '2026-08-01', to: '2026-08-31', stage: ['adm'], ctas: '3' }, now).filter,
    ).toEqual({ ...EMPTY_FILTER, stage: ['adm'], ctas: [3] })
  })

  it('reads a good query string', () => {
    expect(
      parseExportRange({ from: '2026-08-01', to: '2026-08-31', status: 'open', format: 'adaa' }, now),
    ).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
      status: 'open',
      format: 'adaa',
    })
  })

  it('falls back per field, so a stale bookmark still renders', () => {
    expect(parseExportRange({ from: 'yesterday' }, now)).toEqual({
      from: '2026-09-01',
      to: '2026-09-08',
      status: 'all',
      format: 'navigator',
    })
  })
})

describe('exportRangeQuery', () => {
  const range: ExportRange = { from: '2026-09-01', to: '2026-09-08', status: 'all', format: 'qch' }

  it('carries the format, so the download link is the whole request', () => {
    expect(exportRangeQuery(range)).toBe('from=2026-09-01&to=2026-09-08&status=all&format=qch')
  })

  it('leaves it out of the report link, which has no formats', () => {
    expect(reportQuery(range)).toBe('from=2026-09-01&to=2026-09-08&status=all')
  })

  /**
   * Phase 10. The case filter is appended after the range, and an empty one adds nothing — the
   * two strings above are exactly what they were, filter or no filter in the type.
   */
  it('appends nothing for an empty filter', () => {
    const empty: ExportRange = { ...range, filter: EMPTY_FILTER }
    expect(exportRangeQuery(empty)).toBe('from=2026-09-01&to=2026-09-08&status=all&format=qch')
    expect(reportQuery(empty)).toBe('from=2026-09-01&to=2026-09-08&status=all')
  })

  it('appends the filter to both links when one is set', () => {
    const filtered: ExportRange = {
      ...range,
      filter: { ...EMPTY_FILTER, stage: ['adm'], ctas: [2, 3], lone: true },
    }
    expect(exportRangeQuery(filtered)).toBe(
      'from=2026-09-01&to=2026-09-08&status=all&format=qch&stage=adm&ctas=2&ctas=3&lone=1',
    )
    expect(reportQuery(filtered)).toBe(
      'from=2026-09-01&to=2026-09-08&status=all&stage=adm&ctas=2&ctas=3&lone=1',
    )
  })

  it('round-trips through parseExportRange, so a pasted link is the same request', () => {
    const now = new Date('2026-09-08T12:00:00Z')
    const filtered: ExportRange = {
      ...range,
      filter: { ...EMPTY_FILTER, stage: ['adm'], payer: ['INSURED'], not: true },
    }
    expect(parseExportRange(new URLSearchParams(exportRangeQuery(filtered)), now)).toEqual(filtered)
  })
})

describe('exportFilename', () => {
  const range: ExportRange = { from: '2026-09-01', to: '2026-09-08', status: 'all', format: 'navigator' }

  it('is the prototype filename for the ER Navigator workbook', () => {
    expect(exportFilename(range)).toBe('ER_Navigator_2026-09-01_to_2026-09-08.xlsx')
  })

  it('gives each new format its own stem, so three downloads of one range coexist', () => {
    expect(exportFilename({ ...range, format: 'adaa' })).toBe(
      'adaa-ed-kpis_2026-09-01_to_2026-09-08.xlsx',
    )
    expect(exportFilename({ ...range, format: 'qch' })).toBe(
      'qch-navigator-sheet_2026-09-01_to_2026-09-08.xlsx',
    )
  })

  /**
   * Phase 10. The name is all the receiving side sees before it opens the file, so a filtered
   * workbook says so in it. An empty filter is no filter, and keeps the name it always had.
   */
  it('marks a filtered workbook in its name, whatever the format, and only a filtered one', () => {
    const filter = { ...EMPTY_FILTER, payer: ['INSURED' as const] }
    expect(exportFilename({ ...range, filter })).toBe('ER_Navigator_2026-09-01_to_2026-09-08_filtered.xlsx')
    expect(exportFilename({ ...range, format: 'adaa', filter })).toBe(
      'adaa-ed-kpis_2026-09-01_to_2026-09-08_filtered.xlsx',
    )
    expect(exportFilename({ ...range, format: 'qch', filter })).toBe(
      'qch-navigator-sheet_2026-09-01_to_2026-09-08_filtered.xlsx',
    )
    expect(exportFilename({ ...range, filter: EMPTY_FILTER })).toBe('ER_Navigator_2026-09-01_to_2026-09-08.xlsx')
  })
})
