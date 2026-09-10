import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { columnWidth, freePart, tablePart, workbookStreamOf } from '../workbook'

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

/**
 * The writer's own contract for the cells rows.ts produces since 10 September: a number lands as
 * a numeric cell with the "0.00" format (bold and fills composing with it, not replacing it), a
 * null lands as a blank cell with no value at all, and text stays text. Streamed and read back,
 * because none of that is visible from the row arrays.
 */
describe('workbookStreamOf', () => {
  async function readBack(parts: Parameters<typeof workbookStreamOf>[0]): Promise<ExcelJS.Workbook> {
    const bytes = await new Response(workbookStreamOf(parts)).arrayBuffer()
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer)
    return workbook
  }

  it('writes numbers with the 0.00 format, nulls as blank cells and text as text, in both sheet kinds', async () => {
    const workbook = await readBack([
      freePart({
        name: 'Summary',
        widths: [30, 12],
        rows: [
          { cells: ['Median stay, resolved (h)', 6.5], bold: true },
          { cells: ['Evening', 'n<3'] },
          { cells: ['Zero', 0], fills: [null, 'FFE0F2E9'] },
        ],
      }),
      tablePart({
        name: 'Cases',
        header: ['MRN', 'Total ED hours (resolved)'],
        rows: [
          ['100001', 8],
          ['100002', null],
          ['100003', 13.13],
        ],
      }),
    ])

    const cases = workbook.getWorksheet('Cases')!
    expect(cases.getCell('B2').value).toBe(8)
    expect(cases.getCell('B2').numFmt).toBe('0.00')
    expect(cases.getCell('B2').type).toBe(ExcelJS.ValueType.Number)
    // The blank: no value, not an empty string, so a chart skips it and ISBLANK is true.
    expect(cases.getCell('B3').value).toBeNull()
    expect(cases.getCell('B3').type).toBe(ExcelJS.ValueType.Null)
    expect(cases.getCell('B4').value).toBe(13.13)
    expect(cases.getCell('A2').value).toBe('100001')

    const summary = workbook.getWorksheet('Summary')!
    expect(summary.getCell('B1').value).toBe(6.5)
    expect(summary.getCell('B1').numFmt).toBe('0.00')
    expect(summary.getCell('B1').font?.bold).toBe(true)
    expect(summary.getCell('B2').value).toBe('n<3')
    expect(summary.getCell('B2').type).toBe(ExcelJS.ValueType.String)
    expect(summary.getCell('B3').value).toBe(0)
    expect(summary.getCell('B3').numFmt).toBe('0.00')
    expect(summary.getCell('B3').fill).toMatchObject({ type: 'pattern', pattern: 'solid' })
  })
})
