import { randomBytes } from 'node:crypto'
import type { Role, User } from '@prisma/client'
import ExcelJS from 'exceljs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuditContext } from '@/src/lib/audit'
import type { AuthUser } from '@/src/lib/auth/session'
import { loadReference } from '@/src/lib/cases/reference'
import { addCaseUpdate, createCase, resolveCase, reviewCase, voidCase } from '@/src/lib/cases/service'
import type { CaseDraft, ReferenceData } from '@/src/lib/cases/types'
import { prisma } from '@/src/lib/db'
import { ADAA_HEADER } from '@/src/lib/export/adaa'
import { fmtFormDate } from '@/src/lib/export/format'
import { countCasesForExport, loadCasesForExport } from '@/src/lib/export/load'
import { QCH_COLUMNS, QCH_GROUP_HEADER, QCH_HEADER } from '@/src/lib/export/qch'
import { addDays, riyadhDateKey, riyadhDayStart, type ExportRange } from '@/src/lib/export/range'
import { exportCountResponse, exportWorkbookResponse } from '@/src/lib/export/service'
import { XLSX_CONTENT_TYPE } from '@/src/lib/export/workbook'

/**
 * `/api/export.xlsx` and `/api/export/count` against a real Postgres, through the same service
 * functions the route handlers call — everything below `requireUser()`, which is the only part of
 * a route handler that needs a live Next request.
 *
 * Two things are proved here that no unit test can: a NAVIGATOR is refused with an actual
 * `auth.forbidden` row in the audit table, and a SUPERVISOR gets bytes that exceljs can read back
 * as a workbook with the five expected sheets and the right number of case rows.
 *
 * The fixture registers its cases on two Riyadh days about three hundred days ago. Every other
 * suite writes cases a few hours old, so this file's range can never accidentally sweep one up
 * even though they share a database — the row counts below are exact, not lower bounds.
 */
const HOUR = 36e5
const users: string[] = []
const cases: string[] = []
let reference: ReferenceData

/** Every MRN this file writes shares a prefix, so it can ignore every other suite's rows. */
const MRN_PREFIX = '95'
let nextMrn = 0

/** Two Riyadh calendar days, far enough back that nothing else in the suite registers there. */
const DAY_ONE = riyadhDateKey(new Date(Date.now() - 300 * 864e5))
const DAY_TWO = addDays(DAY_ONE, 1)
const DAY_BEFORE = addDays(DAY_ONE, -1)

/** An instant `hours` into that Riyadh calendar day. */
const at = (day: string, hours: number): Date => new Date(riyadhDayStart(day).getTime() + hours * HOUR)

const RANGE: ExportRange = { from: DAY_ONE, to: DAY_TWO, status: 'all', format: 'navigator' }

async function makeUser(role: Role): Promise<AuthUser> {
  const user: User = await prisma.user.create({
    data: {
      username: `p5test_${randomBytes(6).toString('hex')}`,
      passwordHash: 'not-a-real-hash',
      displayName: `Phase 5 ${role}`,
      role,
    },
  })
  users.push(user.id)
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active,
    lastShift: user.lastShift,
  }
}

const ctxFor = (id: string): AuditContext => ({ actorId: id, ip: '10.0.0.5', userAgent: 'vitest' })

function reasonNamed(code: string, name: string): string {
  const stage = reference.stages.find((s) => s.code === code)
  if (!stage) throw new Error(`the seed has no "${code}" stage`)
  const reason = stage.reasons.find((r) => r.name === name)
  if (!reason) throw new Error(`the seed has no "${name}" reason under "${code}"`)
  return reason.id
}

const departmentNamed = (name: string): string => {
  const found = reference.departments.find((d) => d.name === name)
  if (!found) throw new Error(`the seed has no "${name}" department`)
  return found.id
}

function nextTestMrn(): string {
  nextMrn += 1
  return `${MRN_PREFIX}${String(nextMrn).padStart(5, '0')}`
}

function draft(over: Partial<CaseDraft> = {}): CaseDraft {
  return {
    mrn: nextTestMrn(),
    registrationAt: at(DAY_ONE, 10).toISOString(),
    shift: 'MORNING',
    ctas: null,
    areaId: null,
    stages: [],
    reasons: [{ reasonId: reasonNamed('adm', 'No bed available on accepting ward'), otherText: null }],
    primaryReasonId: reasonNamed('adm', 'No bed available on accepting ward'),
    consults: [],
    investigations: [],
    roomType: null,
    triageAt: null,
    roomAt: null,
    physicianAt: null,
    decisionAt: null,
    departedAt: null,
    admOrderAt: null,
    bedRequestedAt: null,
    bedAssignedAt: null,
    handoverAt: null,
    transferRequestedAt: null,
    transferAcceptedAt: null,
    transportArrivedAt: null,
    referralTrackingNo: '',
    transferFacility: '',
    medAdminInformedAt: null,
    painkillerPrescribed: null,
    pethidinePrescribed: null,
    pethidineDoseMg: null,
    painkillerAt: null,
    sickleCellTreatment: null,
    instructionsGiven: null,
    familyEngagement: null,
    caseMgmtReferral: null,
    caseMgmtCriteria: null,
    caseMgmtAction: null,
    caseMgmtCalledAt: null,
    caseMgmtRepliedAt: null,
    disposition: null,
    wardId: null,
    isolation: false,
    resolutionNote: '',
    version: 1,
    ...over,
  }
}

async function openCase(actor: AuthUser, over: Partial<CaseDraft> = {}): Promise<{ id: string; input: CaseDraft }> {
  const input = draft(over)
  const result = await createCase(actor, input, ctxFor(actor.id))
  if (!result.ok) throw new Error(`expected the case to open, got ${JSON.stringify(result)}`)
  cases.push(result.id)
  return { id: result.id, input }
}

/** The MRNs the export must contain, filled in by the fixture below. */
const seeded: { open1: string; open2: string; resolved: string; voided: string; before: string } = {
  open1: '',
  open2: '',
  resolved: '',
  voided: '',
  before: '',
}

let supervisor: AuthUser
let navigator: AuthUser

beforeAll(async () => {
  reference = await loadReference()
  supervisor = await makeUser('SUPERVISOR')
  navigator = await makeUser('NAVIGATOR')

  // Day one, 10:00 Riyadh: an open case with a consult and a lab, so Consults and Investigations
  // have rows and the timings can be checked against the sheet. Phase 8b hangs its collection
  // fields on this one — the pain block, the case-management referral and its two times — so the
  // Adaa columns I to N and the QCH case-management block have a real row to be read off.
  const one = await openCase(navigator, {
    registrationAt: at(DAY_ONE, 10).toISOString(),
    // The one case with a CTAS, so the Adaa summary has both a level row and a "not recorded" one.
    ctas: 3,
    sickleCellTreatment: 'YES',
    painkillerPrescribed: 'YES',
    painkillerAt: at(DAY_ONE, 10 + 40 / 60).toISOString(), // 10:40 Riyadh: 40 min from the door
    pethidinePrescribed: 'YES',
    pethidineDoseMg: 100,
    caseMgmtReferral: 'COMPLEX_CARE',
    caseMgmtCriteria: 'MEETS',
    caseMgmtAction: 'ENROLLED',
    caseMgmtCalledAt: at(DAY_ONE, 11).toISOString(),
    caseMgmtRepliedAt: at(DAY_ONE, 11.5).toISOString(),
    consults: [
      {
        departmentId: departmentNamed('MROD'),
        consultedAt: at(DAY_ONE, 11).toISOString(),
        seenAt: at(DAY_ONE, 13).toISOString(),
        repliedAt: null,
      },
    ],
    investigations: [
      {
        type: 'LAB',
        orderedAt: at(DAY_ONE, 10.5).toISOString(),
        collectedAt: at(DAY_ONE, 11).toISOString(),
        receivedAt: at(DAY_ONE, 11.5).toISOString(),
        doneAt: null,
        preliminaryAt: null,
        resultedAt: at(DAY_ONE, 14.5).toISOString(),
      },
    ],
  })
  seeded.open1 = one.input.mrn
  // One tagged update and one plain one (decision C): the export's own `updates` select has to ask
  // for `action`, or the Summary's "Actions documented" reports neither.
  const noted = await addCaseUpdate(navigator, one.id, 'Chased the lab', ctxFor(navigator.id))
  if (!noted.ok) throw new Error(`expected the update to append, got ${JSON.stringify(noted)}`)
  const tagged = await addCaseUpdate(navigator, one.id, 'Paged the bed coordinator', ctxFor(navigator.id), 'BED_MANAGEMENT')
  if (!tagged.ok) throw new Error(`expected the tagged update to append, got ${JSON.stringify(tagged)}`)

  // Day one, 22:00 Riyadh — 19:00 UTC, so a server that filtered on its own calendar day would
  // still catch this one; the case below is the one that proves the boundary.
  const two = await openCase(navigator, { registrationAt: at(DAY_ONE, 22).toISOString(), shift: 'NIGHT' })
  seeded.open2 = two.input.mrn

  // Day two, resolved six hours later. Phase 8b: it is the one case with a disposition decision E
  // added, with both discharge answers, and it is marked reviewed afterwards — so the Adaa
  // Discharge Type, the KPI 7 share and the QCH answers, Final Decision and "Reviewed By" all have
  // a row. The review is taken after the resolve, because a later save clears it by design.
  const three = await openCase(navigator, { registrationAt: at(DAY_TWO, 8).toISOString(), shift: 'MORNING' })
  seeded.resolved = three.input.mrn
  const resolved = await resolveCase(
    navigator,
    three.id,
    {
      ...draft(),
      mrn: three.input.mrn,
      registrationAt: three.input.registrationAt,
      disposition: 'DECEASED',
      departedAt: at(DAY_TWO, 14).toISOString(),
      instructionsGiven: 'YES',
      familyEngagement: 'NOT_SURE',
      version: 1,
    },
    ctxFor(navigator.id),
  )
  if (!resolved.ok) throw new Error(`expected the case to resolve, got ${JSON.stringify(resolved)}`)
  const reviewed = await reviewCase(supervisor, three.id, ctxFor(supervisor.id))
  if (!reviewed.ok) throw new Error(`expected the case to be marked reviewed, got ${JSON.stringify(reviewed)}`)

  // Day two, voided: must never appear in any sheet or count.
  const four = await openCase(navigator, { registrationAt: at(DAY_TWO, 9).toISOString() })
  seeded.voided = four.input.mrn
  const voided = await voidCase(
    supervisor,
    four.id,
    { voidReason: 'Opened in error', version: 1 },
    ctxFor(supervisor.id),
  )
  if (!voided.ok) throw new Error(`expected the case to void, got ${JSON.stringify(voided)}`)

  // The day before the window: proves the range is a filter, not a suggestion.
  const five = await openCase(navigator, { registrationAt: at(DAY_BEFORE, 12).toISOString() })
  seeded.before = five.input.mrn
})

afterAll(async () => {
  if (cases.length > 0) {
    const updates = await prisma.caseUpdate.findMany({ where: { caseId: { in: cases } }, select: { id: true } })
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...cases, ...updates.map((u) => u.id)] } } })
    await prisma.otherReview.deleteMany({ where: { caseId: { in: cases } } })
    await prisma.caseUpdate.deleteMany({ where: { caseId: { in: cases } } })
    await prisma.caseReason.deleteMany({ where: { caseId: { in: cases } } })
    await prisma.caseConsult.deleteMany({ where: { caseId: { in: cases } } })
    await prisma.caseInvestigation.deleteMany({ where: { caseId: { in: cases } } })
    await prisma.case.deleteMany({ where: { id: { in: cases } } })
  }
  if (users.length > 0) {
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: users } }, { entityId: { in: users } }] } })
    await prisma.user.deleteMany({ where: { id: { in: users } } })
  }
  await prisma.$disconnect()
})

async function workbookOf(response: Response): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  // exceljs declares its own `Buffer` interface, which Node's does not structurally satisfy.
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as unknown as ExcelJS.Buffer)
  return workbook
}

/** One row of a sheet as `width` strings, padded: exceljs stops at the last non-empty cell. */
function rowCells(sheet: ExcelJS.Worksheet, number: number, width: number): string[] {
  const raw = sheet.getRow(number).values as ExcelJS.CellValue[]
  return Array.from({ length: width }, (_, i) => String(raw[i + 1] ?? ''))
}

/** The values of one column, by its 1-based position, below `headerRows` header rows. */
function columnAt(sheet: ExcelJS.Worksheet, column: number, headerRows: number): string[] {
  const out: string[] = []
  sheet.eachRow((row, number) => {
    if (number > headerRows) out.push(String(row.getCell(column).value ?? ''))
  })
  return out
}

/** The values of one column of a sheet, header excluded. */
function columnValues(sheet: ExcelJS.Worksheet, header: string): string[] {
  const headers = (sheet.getRow(1).values as ExcelJS.CellValue[]).map((v) => String(v ?? ''))
  const index = headers.indexOf(header)
  if (index < 0) throw new Error(`no "${header}" column on ${sheet.name}`)
  const out: string[] = []
  sheet.eachRow((row, number) => {
    if (number > 1) out.push(String(row.getCell(index).value ?? ''))
  })
  return out
}

describe('the fixture', () => {
  it('loads exactly the three cases registered inside the window', async () => {
    const loaded = await loadCasesForExport(RANGE)
    const mine = loaded.filter((c) => c.mrn.startsWith(MRN_PREFIX)).map((c) => c.mrn).sort()
    expect(mine).toEqual([seeded.open1, seeded.open2, seeded.resolved].sort())
    expect(mine).not.toContain(seeded.voided)
    expect(mine).not.toContain(seeded.before)
  })

  it('counts what it loads, for each status filter', async () => {
    expect(await countCasesForExport(RANGE)).toBe(3)
    expect(await countCasesForExport({ ...RANGE, status: 'open' })).toBe(2)
    expect(await countCasesForExport({ ...RANGE, status: 'resolved' })).toBe(1)
  })
})

describe('GET /api/export.xlsx as a NAVIGATOR', () => {
  it('is 403 and writes an auth.forbidden audit row', async () => {
    const before = await prisma.auditLog.count({
      where: { action: 'auth.forbidden', actorId: navigator.id, entityId: 'export.xlsx' },
    })

    const response = await exportWorkbookResponse(navigator, RANGE, ctxFor(navigator.id), new Date())
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'forbidden' })

    const rows = await prisma.auditLog.findMany({
      where: { action: 'auth.forbidden', actorId: navigator.id, entityId: 'export.xlsx' },
      select: { entity: true, after: true },
    })
    expect(rows).toHaveLength(before + 1)
    expect(rows[0]?.entity).toBe('Action')
    // Phase 8: the row says which workbook was attempted, not only who attempted one.
    expect(rows[0]?.after).toEqual({ role: 'NAVIGATOR', format: 'navigator' })
  })

  it('is refused the count as well, so the number is not readable either', async () => {
    const response = await exportCountResponse(navigator, RANGE, ctxFor(navigator.id))
    expect(response.status).toBe(403)
  })
})

describe('GET /api/export.xlsx as a SUPERVISOR', () => {
  it('is a downloadable xlsx named for the range', async () => {
    const response = await exportWorkbookResponse(supervisor, RANGE, ctxFor(supervisor.id), new Date())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(XLSX_CONTENT_TYPE)
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="ER_Navigator_${DAY_ONE}_to_${DAY_TWO}.xlsx"`,
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('parses back as a workbook with the five sheets, in order', async () => {
    const workbook = await workbookOf(
      await exportWorkbookResponse(supervisor, RANGE, ctxFor(supervisor.id), new Date()),
    )
    expect(workbook.worksheets.map((w) => w.name)).toEqual([
      'Summary',
      'Cases',
      'Consults',
      'Investigations',
      'Updates',
    ])
  })

  it('writes one Cases row per case in range, and never the voided one', async () => {
    const workbook = await workbookOf(
      await exportWorkbookResponse(supervisor, RANGE, ctxFor(supervisor.id), new Date()),
    )
    const sheet = workbook.getWorksheet('Cases')!
    const mrns = columnValues(sheet, 'MRN')
    expect(mrns).toHaveLength(3)
    expect(mrns.sort()).toEqual([seeded.open1, seeded.open2, seeded.resolved].sort())
    expect(mrns).not.toContain(seeded.voided)
    expect(mrns).not.toContain(seeded.before)
  })

  it('narrows to the open cases when the status filter says so', async () => {
    const workbook = await workbookOf(
      await exportWorkbookResponse(supervisor, { ...RANGE, status: 'open' }, ctxFor(supervisor.id), new Date()),
    )
    expect(columnValues(workbook.getWorksheet('Cases')!, 'MRN').sort()).toEqual(
      [seeded.open1, seeded.open2].sort(),
    )
  })

  it('gives every sheet a bold, frozen header row', async () => {
    const workbook = await workbookOf(
      await exportWorkbookResponse(supervisor, RANGE, ctxFor(supervisor.id), new Date()),
    )
    for (const name of ['Cases', 'Consults', 'Investigations', 'Updates']) {
      const sheet = workbook.getWorksheet(name)!
      expect(sheet.getRow(1).font?.bold, `${name} header is bold`).toBe(true)
      expect(sheet.views[0]?.state, `${name} header is frozen`).toBe('frozen')
      expect(sheet.getColumn(1).width, `${name} has a width`).toBeGreaterThan(0)
    }
  })

  it('writes the consults, the investigation turnaround and the appended update', async () => {
    const workbook = await workbookOf(
      await exportWorkbookResponse(supervisor, RANGE, ctxFor(supervisor.id), new Date()),
    )

    const consults = workbook.getWorksheet('Consults')!
    expect(columnValues(consults, 'MRN')).toEqual([seeded.open1])
    expect(columnValues(consults, 'Consult to seen (h)')).toEqual(['2.00'])
    // No reply was entered, so the cell is blank rather than a zero.
    expect(columnValues(consults, 'Consult to reply (h)')).toEqual([''])

    const investigations = workbook.getWorksheet('Investigations')!
    expect(columnValues(investigations, 'Test')).toEqual(['Lab'])
    expect(columnValues(investigations, 'Order to result (h)')).toEqual(['4.00'])
    expect(columnValues(investigations, 'Scan done')).toEqual([''])

    const updates = workbook.getWorksheet('Updates')!
    const texts = columnValues(updates, 'Update')
    expect(texts).toContain('Chased the lab')
    expect(texts).toContain('Paged the bed coordinator')
    // Resolving a case appends its own update, so the resolved case is on this sheet too.
    expect(texts).toContain('Resolved: Deceased')
    expect(columnValues(updates, 'By')).toContain(navigator.displayName)
  })

  /**
   * Phase 8b. The export's `updates` select overrides the dashboard's, and `toCaseForStats` reads
   * a row that did not ask for `action` as having no opinion on tagging at all — so without
   * `action: true` on that override every case here would be "no action documented". The Summary
   * sheet is the navigator workbook's own `dashboard()` call, which is where that shows.
   */
  it('carries the update action tags through the export read', async () => {
    const loaded = (await loadCasesForExport(RANGE)).filter((c) => c.mrn.startsWith(MRN_PREFIX))
    const one = loaded.find((c) => c.mrn === seeded.open1)!
    expect(one.updateActions).toEqual(['BED_MANAGEMENT'])
    expect(one.untaggedUpdatesCount).toBe(1) // "Chased the lab", written with no category
    // The resolved case's only update is the one the resolve appended, and it carries no tag.
    expect(loaded.find((c) => c.mrn === seeded.resolved)!.updateActions).toEqual([])
  })

  it('carries every Phase 8b collection field through the export read', async () => {
    const loaded = await loadCasesForExport(RANGE)
    const one = loaded.find((c) => c.mrn === seeded.open1)!
    expect(one).toMatchObject({
      sickleCellTreatment: 'YES',
      painkillerPrescribed: 'YES',
      pethidinePrescribed: 'YES',
      pethidineDoseMg: 100,
      caseMgmtReferral: 'COMPLEX_CARE',
      caseMgmtCriteria: 'MEETS',
      caseMgmtAction: 'ENROLLED',
    })
    expect(one.painkillerAt).toEqual(at(DAY_ONE, 10 + 40 / 60))
    expect(one.caseMgmtCalledAt).toEqual(at(DAY_ONE, 11))
    expect(one.caseMgmtRepliedAt).toEqual(at(DAY_ONE, 11.5))
    const three = loaded.find((c) => c.mrn === seeded.resolved)!
    expect(three).toMatchObject({
      disposition: 'DECEASED',
      instructionsGiven: 'YES',
      familyEngagement: 'NOT_SURE',
      reviewedByName: supervisor.displayName,
    })
    expect(three.reviewedAt).toBeInstanceOf(Date)
  })

  it('summarises the range and the status filter on the Summary sheet', async () => {
    const workbook = await workbookOf(
      await exportWorkbookResponse(supervisor, RANGE, ctxFor(supervisor.id), new Date()),
    )
    const summary = workbook.getWorksheet('Summary')!
    const labels = new Map<string, string>()
    summary.eachRow((row) => {
      const key = String(row.getCell(1).value ?? '')
      if (key) labels.set(key, String(row.getCell(2).value ?? ''))
    })
    expect(labels.get('Range (registration date)')).toBe(`${DAY_ONE} to ${DAY_TWO}`)
    expect(labels.get('Status filter')).toBe('All')
    expect(labels.get('Cases in range')).toBe('3')
    expect(labels.get('Resolved')).toBe('1')
  })

  it('gets the same count the page shows', async () => {
    const response = await exportCountResponse(supervisor, RANGE, ctxFor(supervisor.id))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      from: DAY_ONE,
      to: DAY_TWO,
      status: 'all',
      format: 'navigator',
      count: 3,
    })
  })
})

/**
 * The two Phase 8 formats over the same three cases, through the same handler: the file the
 * receiving side actually gets, parsed back with exceljs. The header rows are asserted against
 * the modules' own constants, so this proves the workbook carries them; that they are the
 * official form's and the August sheet's is asserted in the unit tests beside those modules.
 */
describe('the three formats', () => {
  const ADAA: ExportRange = { ...RANGE, format: 'adaa' }
  const QCH: ExportRange = { ...RANGE, format: 'qch' }

  it('names each file for its format', async () => {
    const nameOf = async (range: ExportRange): Promise<string | null> =>
      (await exportWorkbookResponse(supervisor, range, ctxFor(supervisor.id), new Date())).headers.get(
        'content-disposition',
      )
    expect(await nameOf(RANGE)).toBe(`attachment; filename="ER_Navigator_${DAY_ONE}_to_${DAY_TWO}.xlsx"`)
    expect(await nameOf(ADAA)).toBe(`attachment; filename="adaa-ed-kpis_${DAY_ONE}_to_${DAY_TWO}.xlsx"`)
    expect(await nameOf(QCH)).toBe(`attachment; filename="qch-navigator-sheet_${DAY_ONE}_to_${DAY_TWO}.xlsx"`)
  })

  it('counts the same cases whichever format is asked for', async () => {
    expect(await countCasesForExport(ADAA)).toBe(3)
    expect(await countCasesForExport(QCH)).toBe(3)
  })

  it('writes the Adaa form’s three sheets, its twenty columns and one row per case', async () => {
    const workbook = await workbookOf(
      await exportWorkbookResponse(supervisor, ADAA, ctxFor(supervisor.id), new Date()),
    )
    expect(workbook.worksheets.map((w) => w.name)).toEqual(['ED KPIs manual', 'KPI summary', 'Read me'])

    const manual = workbook.getWorksheet('ED KPIs manual')!
    expect(rowCells(manual, 1, ADAA_HEADER.length)).toEqual(ADAA_HEADER)
    expect(manual.getRow(1).font?.bold).toBe(true)

    const mrns = columnValues(manual, 'Patient ID / Mandatory')
    expect(mrns.sort()).toEqual([seeded.open1, seeded.open2, seeded.resolved].sort())
    expect(mrns).not.toContain(seeded.voided)

    // Two values, hand-checked: the 10:00 Riyadh case on day one, as the form writes it.
    expect(columnValues(manual, 'Date / (DD-MMM-YYYY)')).toContain(fmtFormDate(at(DAY_ONE, 10)))
    expect(columnValues(manual, 'Registration Time / (hh:mm)')).toContain('10:00')
  })

  /** Phase 8b: columns I to N and the two discharge types decision E added, off the real rows. */
  it('writes the pain block and Deceased into the manual sheet', async () => {
    const workbook = await workbookOf(
      await exportWorkbookResponse(supervisor, ADAA, ctxFor(supervisor.id), new Date()),
    )
    const manual = workbook.getWorksheet('ED KPIs manual')!
    const row = (header: string) => {
      const mrns = columnValues(manual, 'Patient ID / Mandatory')
      return columnValues(manual, header)[mrns.indexOf(seeded.open1)]
    }
    expect(row('Was the treatment identified for Sicklecell condition?')).toBe('Yes')
    expect(row('Was a Pain Killer Prescribed?')).toBe('Yes')
    expect(row('Calendar Days later for Pain of pain killer administration /')).toBe('') // the same day
    expect(row('Was Pethidine Prescribed?')).toBe('Yes')
    expect(row('Prescribed Dose')).toBe('100')
    expect(row('Time of Pain Killer Administration / (hh:mm)')).toBe('10:40')
    // The two cases that recorded nothing keep every one of those cells blank.
    expect(columnValues(manual, 'Was a Pain Killer Prescribed?').filter((v) => v === '')).toHaveLength(2)
    // Decision E's dispositions reach the form's Discharge Type column.
    expect(columnValues(manual, 'Discharge Type / (leave blank if no discharge)')).toContain('Deceased')
  })

  /**
   * Two blocks on this sheet label their rows "CTAS 3" / "Total": the ED statistics table and, as
   * of Phase 8b, the Pain Killer Statistics table under the admission block. Every lookup here
   * names the heading it counts from, or the second block silently answers for the first.
   */
  const SUMMARY_HEADINGS = [
    'ED statistics, tracked cases',
    'Admission to unit (admission order to leaving the ED)',
    'Pain Killer Statistics (KPI 8)',
    'Benchmark colours',
  ]

  function summaryBlock(sheet: ExcelJS.Worksheet, heading: string): Map<string, string[]> {
    const rows: string[][] = []
    sheet.eachRow((row) => rows.push((row.values as ExcelJS.CellValue[]).slice(1).map((v) => String(v ?? ''))))
    const start = rows.findIndex((r) => r[0] === heading)
    expect(start, `the "${heading}" block is on the sheet`).toBeGreaterThanOrEqual(0)
    const out = new Map<string, string[]>()
    for (const row of rows.slice(start + 1)) {
      if (SUMMARY_HEADINGS.includes(row[0] ?? '')) break // the next block begins
      if (row[0]) out.set(row[0], row)
    }
    return out
  }

  it('summarises the same three cases per CTAS, with a row for the ones that have none', async () => {
    const workbook = await workbookOf(
      await exportWorkbookResponse(supervisor, ADAA, ctxFor(supervisor.id), new Date()),
    )
    const stats = summaryBlock(workbook.getWorksheet('KPI summary')!, 'ED statistics, tracked cases')
    expect(stats.get('CTAS 3')?.[1]).toBe('1')
    expect(stats.get('CTAS not recorded')?.[1]).toBe('2')
    expect(stats.get('Total')?.[1]).toBe('3')
  })

  it('adds the KPI 7 share, the KPI 8 total and the Pain Killer Statistics block', async () => {
    const workbook = await workbookOf(
      await exportWorkbookResponse(supervisor, ADAA, ctxFor(supervisor.id), new Date()),
    )
    const sheet = workbook.getWorksheet('KPI summary')!
    const total = summaryBlock(sheet, 'ED statistics, tracked cases').get('Total')!
    // One Deceased among the three tracked cases, open ones included: the form's own denominator.
    expect(total[14]).toBe('33.3%')
    // One painkiller, 40 minutes after the door.
    expect(total[15]).toBe('40')

    const pain = summaryBlock(sheet, 'Pain Killer Statistics (KPI 8)').get('Total')!
    // CTAS, 1 painkiller prescribed, the four bands, 1 pethidine, the three doses, the minutes.
    expect(pain).toEqual(['Total', '1', '0', '1', '0', '0', '1', '0', '1', '0', '40'])
  })

  it('says on the Read me which range it covers and how many rows lack a CTAS', async () => {
    const workbook = await workbookOf(
      await exportWorkbookResponse(supervisor, ADAA, ctxFor(supervisor.id), new Date()),
    )
    const lines: string[] = []
    workbook.getWorksheet('Read me')!.eachRow((row) => {
      lines.push(
        (row.values as ExcelJS.CellValue[])
          .slice(1)
          .map((v) => String(v ?? ''))
          .join(' '),
      )
    })
    const text = lines.join('\n')
    expect(text).toContain(`${DAY_ONE} to ${DAY_TWO}`)
    expect(text).toContain('Rows with no CTAS recorded 2')
    expect(text).toContain('select A2:T4')
    // Phase 8b: the two statements that replaced "KPI 7 is not produced" and "I to N are blank".
    expect(text).toContain('KPI 7 is the Deceased dispositions divided by every tracked case in the range')
    expect(text).toContain('is in no band and in no dose column')
  })

  it('writes the QCH sheet with both header rows and no patient name column', async () => {
    const workbook = await workbookOf(
      await exportWorkbookResponse(supervisor, QCH, ctxFor(supervisor.id), new Date()),
    )
    expect(workbook.worksheets.map((w) => w.name)).toEqual(['Navigator sheet', 'Read me'])

    const sheet = workbook.getWorksheet('Navigator sheet')!
    expect(rowCells(sheet, 1, QCH_COLUMNS.length)).toEqual(QCH_GROUP_HEADER)
    expect(rowCells(sheet, 2, QCH_COLUMNS.length)).toEqual(QCH_HEADER)
    expect(sheet.getRow(2).font?.bold).toBe(true)
    // Both header rows stay on screen while the seventy columns scroll. `ySplit` is only on the
    // frozen variant of the view union, which is what makes this assertion worth making.
    const view = sheet.views[0]
    expect(view?.state).toBe('frozen')
    expect(view?.state === 'frozen' ? view.ySplit : null).toBe(2)

    // Column 2 is the MRN; column 1 is the registration date.
    const mrns = columnAt(sheet, 2, 2)
    expect(mrns.sort()).toEqual([seeded.open1, seeded.open2, seeded.resolved].sort())
    expect(columnAt(sheet, 1, 2)).toContain(fmtFormDate(at(DAY_ONE, 10)))
    // One value, hand-checked: the 10:00 case ordered its lab at 10:30 Riyadh.
    expect(columnAt(sheet, QCH_GROUP_HEADER.indexOf('Lab Order Time') + 1, 2)).toContain('10:30')
  })

  /** Phase 8b: the columns the QCH sheet carried blank until Slice H, off the real rows. */
  it('writes the case-management block, the discharge answers and the review mark', async () => {
    const workbook = await workbookOf(
      await exportWorkbookResponse(supervisor, QCH, ctxFor(supervisor.id), new Date()),
    )
    const sheet = workbook.getWorksheet('Navigator sheet')!
    const mrns = columnAt(sheet, 2, 2)
    const cell = (mrn: string, column: string): string =>
      columnAt(sheet, QCH_GROUP_HEADER.indexOf(column) + 1, 2)[mrns.indexOf(mrn)] ?? ''

    // The open case carries the case-management referral, in the sheet's own words.
    expect(cell(seeded.open1, 'Referral to Case Management')).toBe('Complex care co.')
    expect(cell(seeded.open1, 'Complex care Cordinator comment')).toBe('Meeting criteria')
    expect(cell(seeded.open1, 'Complex care Coordinator Action')).toBe('enrolled')
    expect(cell(seeded.open1, 'Time of call case manger')).toBe('11:00')
    expect(cell(seeded.open1, 'Time of case manger replay')).toBe('11:30')
    // Still a staff name, and still blank.
    expect(cell(seeded.open1, 'Case Manager Name')).toBe('')

    // The resolved case carries the two answers, the reviewer, and decision E's disposition.
    expect(cell(seeded.resolved, 'intructions given by doctor')).toBe('Yes')
    expect(cell(seeded.resolved, 'Family Engagement')).toBe('Not sure')
    expect(cell(seeded.resolved, 'Reviewed By')).toBe(supervisor.displayName)
    expect(cell(seeded.resolved, 'Final Decision')).toBe('Deceased')
    expect(cell(seeded.resolved, 'ER-MD Decision')).toBe('Deceased')

    // The case that recorded none of it keeps every one of those columns blank.
    for (const column of ['Referral to Case Management', 'intructions given by doctor', 'Reviewed By']) {
      expect(cell(seeded.open2, column), `${column} is blank on ${seeded.open2}`).toBe('')
    }
  })
})
