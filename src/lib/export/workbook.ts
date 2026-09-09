/**
 * The .xlsx itself, written with exceljs's STREAMING workbook writer.
 *
 * The whole file is never held in memory: `WorkbookWriter` zips each worksheet to a Node stream as
 * its rows are committed, and that stream is handed to the Response as a web `ReadableStream`, so
 * a year of cases costs a few kilobytes of buffer rather than a workbook-sized Buffer on the heap.
 * The rows themselves are already plain strings (src/lib/export/rows.ts) and arrive one case list
 * at a time from a single Prisma read.
 *
 * Formatting, per the Phase 5 spec: a bold, frozen header row; column widths from the longest of
 * the header and a sample of the first rows, clamped so one long resolution note cannot push a
 * column off the screen.
 */
import { PassThrough, Readable } from 'node:stream'
import ExcelJS from 'exceljs'
import type { Sheet, SummaryRow } from './rows'

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

export function columnWidth(header: string, sample: ReadonlyArray<string>): number {
  const longest = sample.reduce((max, value) => Math.max(max, value.length), header.length)
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, longest + PADDING))
}

function widthsFor(sheet: Sheet): number[] {
  const sample = sheet.rows.slice(0, WIDTH_SAMPLE_ROWS)
  return sheet.header.map((header, i) => columnWidth(header, sample.map((row) => row[i] ?? '')))
}

/**
 * A frozen header row is the one view every sheet gets: scroll the cases, keep the column names.
 * Built fresh per worksheet — exceljs normalises the view object in place, so a shared literal
 * would be handed to the second sheet already mutated.
 */
const frozenHeader = () => ({ views: [{ state: 'frozen' as const, ySplit: 1 }] })

function writeSummary(workbook: ExcelJS.stream.xlsx.WorkbookWriter, rows: SummaryRow[]): void {
  const sheet = workbook.addWorksheet('Summary')
  sheet.columns = [{ width: 30 }, { width: 26 }, { width: 14 }]
  for (const row of rows) {
    const written = sheet.addRow(row.cells)
    if (row.bold) written.font = { bold: true }
    written.commit()
  }
  sheet.commit()
}

function writeSheet(workbook: ExcelJS.stream.xlsx.WorkbookWriter, sheet: Sheet): void {
  const worksheet = workbook.addWorksheet(sheet.name, frozenHeader())
  worksheet.columns = widthsFor(sheet).map((width) => ({ width }))
  const header = worksheet.addRow(sheet.header)
  header.font = { bold: true }
  header.commit()
  for (const row of sheet.rows) worksheet.addRow(row).commit()
  worksheet.commit()
}

/**
 * Start writing and hand back the body. The build runs alongside the response: a failure destroys
 * the stream, which the client sees as a truncated download rather than a half-valid workbook.
 */
export function workbookStream(summary: SummaryRow[], sheets: ReadonlyArray<Sheet>): ReadableStream<Uint8Array> {
  const out = new PassThrough()
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true })

  void (async () => {
    try {
      writeSummary(workbook, summary)
      for (const sheet of sheets) writeSheet(workbook, sheet)
      await workbook.commit()
    } catch (cause) {
      console.error('[export] failed while writing the workbook', cause)
      out.destroy(cause instanceof Error ? cause : new Error(String(cause)))
    }
  })()

  return Readable.toWeb(out) as ReadableStream<Uint8Array>
}

export function xlsxResponse(
  summary: SummaryRow[],
  sheets: ReadonlyArray<Sheet>,
  filename: string,
): Response {
  return new Response(workbookStream(summary, sheets), {
    headers: {
      'content-type': XLSX_CONTENT_TYPE,
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  })
}
