/**
 * The .xlsx itself, written with exceljs's STREAMING workbook writer.
 *
 * The whole file is never held in memory: `WorkbookWriter` zips each worksheet to a Node stream as
 * its rows are committed, and that stream is handed to the Response as a web `ReadableStream`, so
 * a year of cases costs a few kilobytes of buffer rather than a workbook-sized Buffer on the heap.
 * The rows themselves are already plain strings, or numbers for the hour columns
 * (src/lib/export/rows.ts), and arrive one case list
 * at a time from a single Prisma read.
 *
 * Formatting, per the Phase 5 spec: a bold, frozen header row; column widths from the longest of
 * the header and a sample of the first rows, clamped so one long resolution note cannot push a
 * column off the screen.
 */
import { PassThrough, Readable } from 'node:stream'
import ExcelJS from 'exceljs'
import type { Cell, Sheet, SummaryRow } from './rows'

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** How many data rows a width may look at. Enough to be representative, bounded for a big export. */
export const WIDTH_SAMPLE_ROWS = 50

/**
 * 10, not 9: exceljs treats a width of exactly 9 as "not a custom width" and drops the `<col>`
 * entry, so a column clamped to 9 would silently come back as the sheet default.
 */
const MIN_WIDTH = 10
const MAX_WIDTH = 46
const PADDING = 2

export function columnWidth(header: string, sample: ReadonlyArray<Cell>): number {
  const longest = sample.reduce<number>((max, value) => Math.max(max, String(value).length), header.length)
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, longest + PADDING))
}

function widthsFor(sheet: Sheet): number[] {
  const sample = sheet.rows.slice(0, WIDTH_SAMPLE_ROWS)
  return sheet.header.map((header, i) => {
    // A grouped sheet keeps the column's own name on the second row, so the longer of the two
    // header cells is what the column has to hold.
    const group = sheet.groupHeader?.[i] ?? ''
    const longest = group.length > header.length ? group : header
    return columnWidth(longest, sample.map((row) => row[i] ?? ''))
  })
}

/**
 * A frozen header block is the one view every tabular sheet gets: scroll the cases, keep the
 * column names. Built fresh per worksheet — exceljs normalises the view object in place, so a
 * shared literal would be handed to the second sheet already mutated.
 */
const frozenHeader = (rows: number) => ({ views: [{ state: 'frozen' as const, ySplit: rows }] })

/**
 * A sheet of labels and small tables rather than one table: the ER Navigator Summary, and the
 * Adaa `KPI summary` and `Read me` sheets. Column widths are declared rather than measured,
 * because there is no one column to measure.
 */
export type FreeSheet = { name: string; widths: number[]; rows: ReadonlyArray<SummaryRow> }

/** One worksheet of a workbook, in the order it is written. */
export type WorkbookPart = { kind: 'free'; sheet: FreeSheet } | { kind: 'table'; sheet: Sheet }

export const freePart = (sheet: FreeSheet): WorkbookPart => ({ kind: 'free', sheet })
export const tablePart = (sheet: Sheet): WorkbookPart => ({ kind: 'table', sheet })

/**
 * Every numeric cell in these workbooks is an hours figure (`fmtHours2`): shown to two decimals,
 * exactly as the text cells used to read, but kept a number so Excel can sum, average and chart
 * the column (Ahmed, 10 September).
 */
function formatNumbers(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    if (typeof cell.value === 'number') cell.numFmt = '0.00'
  })
}

function writeFree(workbook: ExcelJS.stream.xlsx.WorkbookWriter, sheet: FreeSheet): void {
  const worksheet = workbook.addWorksheet(sheet.name)
  worksheet.columns = sheet.widths.map((width) => ({ width }))
  for (const row of sheet.rows) {
    const written = worksheet.addRow([...row.cells])
    formatNumbers(written)
    if (row.bold) written.font = { bold: true }
    row.fills?.forEach((argb, index) => {
      if (argb) written.getCell(index + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
    })
    written.commit()
  }
  worksheet.commit()
}

function writeSheet(workbook: ExcelJS.stream.xlsx.WorkbookWriter, sheet: Sheet): void {
  const headerRows = sheet.groupHeader ? 2 : 1
  const worksheet = workbook.addWorksheet(sheet.name, frozenHeader(headerRows))
  worksheet.columns = widthsFor(sheet).map((width) => ({ width }))
  for (const cells of sheet.groupHeader ? [sheet.groupHeader, sheet.header] : [sheet.header]) {
    const header = worksheet.addRow(cells)
    header.font = { bold: true }
    header.commit()
  }
  for (const row of sheet.rows) {
    const written = worksheet.addRow(row)
    formatNumbers(written)
    written.commit()
  }
  worksheet.commit()
}

/**
 * Start writing and hand back the body. The build runs alongside the response: a failure destroys
 * the stream, which the client sees as a truncated download rather than a half-valid workbook.
 */
export function workbookStreamOf(parts: ReadonlyArray<WorkbookPart>): ReadableStream<Uint8Array> {
  const out = new PassThrough()
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true })

  void (async () => {
    try {
      for (const part of parts) {
        if (part.kind === 'free') writeFree(workbook, part.sheet)
        else writeSheet(workbook, part.sheet)
      }
      await workbook.commit()
    } catch (cause) {
      console.error('[export] failed while writing the workbook', cause)
      out.destroy(cause instanceof Error ? cause : new Error(String(cause)))
    }
  })()

  return Readable.toWeb(out) as ReadableStream<Uint8Array>
}

export function xlsxResponseOf(parts: ReadonlyArray<WorkbookPart>, filename: string): Response {
  return new Response(workbookStreamOf(parts), {
    headers: {
      'content-type': XLSX_CONTENT_TYPE,
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  })
}

