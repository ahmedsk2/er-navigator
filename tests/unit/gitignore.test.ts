import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Phase 12 item 9 (readiness audit P16). A ward list or an import sheet dropped into the tree is
 * the realistic way a patient name reaches a public repository, and `.gitignore` listed no data
 * extension at all.
 *
 * Extensions, not paths, so a spreadsheet anywhere is ignored — which has one sharp edge:
 * `*.xlsx` matches DIRECTORY names too, and git will not descend into an ignored directory. The
 * export route lives at `app/api/export.xlsx/`, so the directory has to be un-ignored before its
 * contents can be. The last five rows below are the half that refuses the audit's first proposal,
 * which would have left that route silently untracked.
 */
const ROOT = path.resolve(__dirname, '../..')

/** exit 0 = ignored, exit 1 = not ignored, anything else = git itself failed. */
function isIgnored(p: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', p], { cwd: ROOT, stdio: 'pipe' })
    return true
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 1) return false
    throw new Error(`git check-ignore failed for ${p}: exit ${String(status)}`)
  }
}

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

const describeGit = gitAvailable() ? describe : describe.skip

describeGit('.gitignore keeps patient spreadsheets out and source in', () => {
  const IGNORED = [
    'patients.xlsx',
    'data/import/august-2026.xlsx',
    'import/ward-list.csv',
    'docs/old-sheet.xls',
  ]
  const TRACKABLE = [
    'app/api/export.xlsx/route.ts',
    'app/api/export.xlsx',
    'src/lib/export/qch.ts',
    'app/layout.tsx',
    'prisma/migrations/20260908190000_init/migration.sql',
  ]

  for (const p of IGNORED) {
    it(`ignores ${p}`, () => {
      expect(isIgnored(p)).toBe(true)
    })
  }

  for (const p of TRACKABLE) {
    it(`does not ignore ${p}`, () => {
      expect(isIgnored(p)).toBe(false)
    })
  }

  it('has nothing of those three extensions tracked today, so no history is touched', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((f) => /\.(xlsx|xls|csv)$/i.test(f))
    expect(tracked).toEqual([])
  })
})
