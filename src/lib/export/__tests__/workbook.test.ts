import { describe, expect, it } from 'vitest'
import { columnWidth } from '../workbook'

/**
 * The workbook itself is asserted end to end in tests/db/export.test.ts, where a real response is
 * parsed back with exceljs. This covers the one rule that is easy to get subtly wrong and
 * invisible in the file: a width of exactly 9 is what exceljs calls "not custom", so it is never
 * written and the column silently reverts to the sheet default.
 */
describe('columnWidth', () => {
  it('never returns the width exceljs would drop', () => {
    expect(columnWidth('MRN', ['100001'])).toBeGreaterThan(9)
    expect(columnWidth('', [])).toBeGreaterThan(9)
  })

  it('sizes to the longest of the header and the sample, plus padding', () => {
    expect(columnWidth('Receiving facility', [])).toBe('Receiving facility'.length + 2)
    expect(columnWidth('Note', ['Admitted after a long wait'])).toBe('Admitted after a long wait'.length + 2)
  })

  it('clamps a very long value so one note cannot push the sheet off the screen', () => {
    expect(columnWidth('Note', ['x'.repeat(400)])).toBe(46)
  })
})
