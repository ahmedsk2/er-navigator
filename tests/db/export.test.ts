import { randomBytes } from 'node:crypto'
import type { Role, User } from '@prisma/client'
import ExcelJS from 'exceljs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuditContext } from '@/src/lib/audit'
import type { AuthUser } from '@/src/lib/auth/session'
import { loadReference } from '@/src/lib/cases/reference'
import { addCaseUpdate, createCase, resolveCase, voidCase } from '@/src/lib/cases/service'
import type { CaseDraft, ReferenceData } from '@/src/lib/cases/types'
import { prisma } from '@/src/lib/db'
import { countCasesForExport, loadCasesForExport } from '@/src/lib/export/load'
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

const RANGE: ExportRange = { from: DAY_ONE, to: DAY_TWO, status: 'all' }

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
  // have rows and the timings can be checked against the sheet.
  const one = await openCase(navigator, {
    registrationAt: at(DAY_ONE, 10).toISOString(),
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
        resultedAt: at(DAY_ONE, 14.5).toISOString(),
      },
    ],
  })
  seeded.open1 = one.input.mrn
  const noted = await addCaseUpdate(navigator, one.id, 'Chased the lab', ctxFor(navigator.id))
  if (!noted.ok) throw new Error(`expected the update to append, got ${JSON.stringify(noted)}`)

  // Day one, 22:00 Riyadh — 19:00 UTC, so a server that filtered on its own calendar day would
  // still catch this one; the case below is the one that proves the boundary.
  const two = await openCase(navigator, { registrationAt: at(DAY_ONE, 22).toISOString(), shift: 'NIGHT' })
  seeded.open2 = two.input.mrn

  // Day two, resolved six hours later.
  const three = await openCase(navigator, { registrationAt: at(DAY_TWO, 8).toISOString(), shift: 'MORNING' })
  seeded.resolved = three.input.mrn
  const resolved = await resolveCase(
    navigator,
    three.id,
    { ...draft(), mrn: three.input.mrn, registrationAt: three.input.registrationAt, disposition: 'DISCHARGED_HOME', departedAt: at(DAY_TWO, 14).toISOString(), version: 1 },
    ctxFor(navigator.id),
  )
  if (!resolved.ok) throw new Error(`expected the case to resolve, got ${JSON.stringify(resolved)}`)

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
    expect(rows[0]?.after).toEqual({ role: 'NAVIGATOR' })
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
    // Resolving a case appends its own update, so the resolved case is on this sheet too.
    expect(texts).toContain('Resolved: Discharged home')
    expect(columnValues(updates, 'By')).toContain(navigator.displayName)
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
    expect(await response.json()).toEqual({ from: DAY_ONE, to: DAY_TWO, status: 'all', count: 3 })
  })
})
