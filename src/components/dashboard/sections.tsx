/**
 * The Phase 8 dashboard sections: the weekly deck's headline, bands, longest stays, actions,
 * outcomes and documentation checks, and the Adaa and August-sheet panels.
 *
 * Server components, like everything else on this page except the three charts. Not one of them
 * counts anything: every figure arrives on `dashboard().kpi`, already computed by
 * `src/lib/domain/kpi.ts` and already guarded — a median or a share the module refused to give
 * below `MIN_N` arrives as null and renders "n<3". Turning a number into a string is
 * `src/lib/dashboard/panels.ts`, which is unit-tested; this file only lays out.
 *
 * A section with nothing to show renders nothing at all, rather than a table of zeroes: an empty
 * "By ED area" on a hospital that has not started recording areas is noise, and the sections that
 * can be empty say so where they are defined.
 */
import type { ReactNode } from 'react'
import {
  Activity,
  BarChart3,
  Bell,
  Check,
  ClipboardList,
  Clock,
  FileText,
  History,
  LayoutList,
  ListChecks,
  TriangleAlert,
  Users,
} from '@/src/components/icons'
import { AdaaBullets } from '@/src/components/dashboard/charts/AdaaBullets'
import { ArrivalTable } from '@/src/components/dashboard/charts/ArrivalTable'
import { HBar, type HBarColor, type HBarRow } from '@/src/components/dashboard/charts/HBar'
import { StackedBar, type StackRow } from '@/src/components/dashboard/charts/StackedBar'
import { StaySplit } from '@/src/components/dashboard/charts/StaySplit'
import {
  BandLegend,
  BarLinks,
  DashSection,
  DataTable,
  EmptyNote,
  Footnote,
  Median,
  PanelLabel,
  ShareBar,
  Tile,
  type TableRow,
} from '@/src/components/dashboard/parts'
import { UNIT_LABELS, dashboardHref, drillKey, gridKey, investigationLabel, type DrillSection } from '@/src/lib/dashboard/drill'
import {
  BENCHMARK_LABELS,
  BENCHMARK_TEXT,
  adaaBullets,
  adaaRows,
  fmtShare,
  headlineTiles,
} from '@/src/lib/dashboard/panels'
import type { ArrivalGrid, DashboardKpi, Range } from '@/src/lib/domain/aggregates'
import type { CaseFilter } from '@/src/lib/domain/case-filter'
import { NOT_RECORDED, TURNAROUND_BANDS, type IdRow } from '@/src/lib/domain/kpi'
import { DISPOSITION_LABELS } from '@/src/lib/domain/taxonomy'
import { fmtStamp } from '@/src/lib/cases/local-time'
import { fmtHours } from '@/src/lib/domain/time'

/**
 * `filter` is the Phase 10 case filter the page is drawn over, and it rides on every link a
 * section builds. It has to: the drill-down resolves its ids from a `dashboard()` computed over
 * the filtered population, so a link that dropped the filter would open a different case list
 * under the same row's name.
 */
type Props = { kpi: DashboardKpi; range: Range; filter?: CaseFilter }

const href = (range: Range, filter: CaseFilter | undefined, section: DrillSection, name: string | number): string =>
  dashboardHref(range, drillKey(section, name), filter)

export const hbarRows = (
  rows: ReadonlyArray<{ name: string; value: number }>,
  range: Range,
  section: DrillSection,
  filter?: CaseFilter,
): HBarRow[] =>
  rows.map((row) => ({ name: row.name, value: row.value, href: href(range, filter, section, row.name) }))

/** A bar section: the chart, and the same rows as links for keyboard, screen readers and print. */
export function BarSection({
  title,
  rows,
  color,
  unit = 'cases',
  footnote,
  icon,
}: {
  title: string
  rows: HBarRow[]
  color: HBarColor
  unit?: string
  footnote?: ReactNode
  icon?: ReactNode
}) {
  return (
    <DashSection title={title} icon={icon}>
      <HBar rows={rows} color={color} unit={unit} />
      <BarLinks caption={title} rows={rows} unit={unit} />
      {footnote ? <Footnote>{footnote}</Footnote> : null}
    </DashSection>
  )
}

/** A count row as a tappable table row, which is what every new drill-down is. */
function countRows(
  rows: ReadonlyArray<IdRow>,
  range: Range,
  section: DrillSection,
  filter?: CaseFilter,
): TableRow[] {
  return rows.map((row) => ({
    key: row.name,
    href: href(range, filter, section, row.name),
    cells: [row.name, row.value],
  }))
}

const anyValue = (rows: ReadonlyArray<{ value: number }>): boolean => rows.some((r) => r.value > 0)

// --- 1. the headline --------------------------------------------------------------------------

/**
 * The seven headline tiles that replace the Phase 4 three, each with its delta against the period
 * of the same length before this one. Two columns on a phone, four on a laptop.
 */
/**
 * One icon per headline tile (Phase 9). Keyed on `HeadlineTile.key` here rather than carried on
 * the tile itself, because `src/lib/dashboard/panels.ts` computes numbers and holds no JSX.
 */
const TILE_ICONS: Record<string, ReactNode> = {
  cases: <LayoutList size={16} />,
  episodes: <Users size={16} />,
  median: <Clock size={16} />,
  mean: <Activity size={16} />,
  range: <BarChart3 size={16} />,
  atLeast10: <TriangleAlert size={16} />,
  longest: <History size={16} />,
}

// The only section with no drill-down row of its own: its one link is a case, so no filter.
export function HeadlineTiles({ kpi, range }: Props) {
  const tiles = headlineTiles(kpi, range)
  const h = kpi.headline
  return (
    <>
      <div className="grid grid-cols-2 gap-2 px-4 pb-2 sm:grid-cols-4 lg:px-0">
        {tiles.map((tile) => (
          <Tile
            key={tile.key}
            label={tile.label}
            value={tile.value}
            note={tile.delta}
            href={tile.href}
            tone={tile.tone}
            icon={TILE_ICONS[tile.key]}
          />
        ))}
      </div>
      {h.measured < h.cases ? (
        <p className="px-4 pb-3 text-caption text-muted lg:px-0" data-headline-note>
          {h.cases - h.measured} {h.cases - h.measured === 1 ? 'case has' : 'cases have'} no computable stay
          (leaving time recorded before registration).
        </p>
      ) : null}
    </>
  )
}

// --- 2. stay bands ----------------------------------------------------------------------------

export function StayBandsSection({ kpi, range, filter }: Props) {
  if (!anyValue(kpi.stayBands)) return null
  return (
    <BarSection
      title="Stay bands"
      icon={<BarChart3 size={18} />}
      rows={hbarRows(kpi.stayBands, range, 'stayband', filter)}
      color="accent"
      footnote="Total ED stay: registration to leaving, or to now for a case that is still open."
    />
  )
}

// --- 4. the Adaa panel ------------------------------------------------------------------------

export function AdaaPanel({ kpi, range, filter }: Props) {
  const rows = adaaRows(kpi.adaaOverall)
  const { painkillerYesN, pethidineYesN } = kpi.adaaOverall
  // The form's Pain Killer Statistics block. Nothing to show until a painkiller or a pethidine has
  // been recorded on one case: four zero bands beside three zero doses is not a finding.
  const pain = painkillerYesN > 0 || pethidineYesN > 0
  return (
    <DashSection title="Adaa KPIs, tracked cases only" icon={<ListChecks size={18} />}>
      {/* Phase 11: the same six benchmarked KPIs as pictures first; the table stays under them, and
          stays the section's first table, which is how the suites find it. */}
      <AdaaBullets bullets={adaaBullets(kpi.adaaOverall)} />
      <DataTable
        head={['KPI', 'n', 'Value']}
        rows={rows.map((row) => ({
          key: row.kpi,
          cells: [
            row.name,
            row.n,
            <span key="v" className={row.band ? BENCHMARK_TEXT[row.band] : 'text-muted'}>
              {row.value}
              {/* The benchmark is named as well as coloured: colour is never the only channel. */}
              {row.band ? <span className="ml-1 text-caption text-muted">{BENCHMARK_LABELS[row.band]}</span> : null}
            </span>,
          ],
        }))}
      />
      <PanelLabel>Treated within (door to disposition)</PanelLabel>
      <DataTable head={['Band', 'Cases']} rows={countRows(kpi.treated, range, 'treated', filter)} />
      {pain ? (
        <div className="grid gap-x-6 sm:grid-cols-2" data-pain-block>
          <div>
            <PanelLabel>
              Door to painkiller · <span className="num">{painkillerYesN}</span> prescribed
            </PanelLabel>
            <DataTable
              head={['Band', 'Cases']}
              rows={kpi.painkiller.map((row) => ({
                key: row.name,
                href: href(range, filter, 'painkiller', gridKey('band', row.name)),
                cells: [row.name, row.value],
              }))}
            />
          </div>
          <div>
            <PanelLabel>
              Pethidine dose · <span className="num">{pethidineYesN}</span> prescribed
            </PanelLabel>
            <DataTable
              head={['Dose', 'Cases']}
              rows={kpi.pethidine.map((row) => ({
                key: row.name,
                href: href(range, filter, 'painkiller', gridKey('dose', row.name)),
                cells: [row.name, row.value],
              }))}
            />
          </div>
        </div>
      ) : null}
      <Footnote>Tracked cases, not the whole ED. Benchmarks: Adaa ED KPI definitions.</Footnote>
      {pain ? (
        <Footnote>
          KPI 7 divides deaths by every tracked case in the range, open ones included, as the form does. The bands
          count the {painkillerYesN} {painkillerYesN === 1 ? 'case' : 'cases'} where a painkiller was prescribed and
          the doses the {pethidineYesN} where pethidine was: a painkiller with no time given, or a pethidine with no
          dose of 50, 100 or 150 mg, is in no band and is listed under Documentation.
        </Footnote>
      ) : null}
    </DashSection>
  )
}

// --- 5. working targets -----------------------------------------------------------------------

export function WorkingTargets({ kpi, range, filter }: Props) {
  if (!kpi.targets.some((t) => t.n > 0)) return null
  return (
    <DashSection title="Working targets" icon={<Check size={18} />}>
      {/* "Within / n" is one column, not two: at 390 px two right-aligned numeric columns have no
          air between them, and the pair is read as a fraction anyway. */}
      <DataTable
        head={['Target', 'Within / n', 'Share']}
        rows={kpi.targets.map((row) => ({
          key: row.key,
          href: href(range, filter, 'target', row.key),
          cells: [
            row.name,
            `${row.within} / ${row.n}`,
            <span key="s" className="inline-flex min-w-[56px] flex-col items-end gap-1">
              {fmtShare(row.share)}
              <ShareBar share={row.share} label={row.name} />
            </span>,
          ],
        }))}
      />
      <Footnote>
        Qatif working targets from the navigators&apos; own sheet. Tap a row for the cases that missed it. Lab and
        imaging count investigation rows and the consult target counts consult rows, so n can exceed the number of
        cases; the last two count cases.
      </Footnote>
    </DashSection>
  )
}

// --- 6. admission to unit ---------------------------------------------------------------------

export function AdmissionToUnit({ kpi, range, filter }: Props) {
  const groups = kpi.admissionToUnit.filter((g) => anyValue(g.bands))
  if (groups.length === 0) return null
  return (
    <DashSection title="Admission to unit" icon={<ClipboardList size={18} />}>
      {groups.map((group) => (
        <div key={group.unit}>
          <PanelLabel>{UNIT_LABELS[group.unit] ?? group.unit}</PanelLabel>
          <DataTable
            head={['Order to left ED', 'Cases']}
            rows={group.bands.map((band) => ({
              key: band.name,
              href: href(range, filter, 'unitband', gridKey(group.unit, band.name)),
              cells: [band.name, band.value],
            }))}
          />
        </div>
      ))}
      <Footnote>
        Admission order written to leaving the ED, for cases with a ward recorded. ICU-type is ICU, CCU, PICU and NICU.
      </Footnote>
    </DashSection>
  )
}

// --- 7. turnaround, and exam to consult -------------------------------------------------------

export function TurnaroundSection({ kpi, range, filter }: Props) {
  const bands = TURNAROUND_BANDS.map((b) => b.name)
  const groups = kpi.turnaround.filter((g) => anyValue(g.orderToResult))
  if (groups.length === 0) return null

  const rows: StackRow[] = groups.map((group) => ({
    name: investigationLabel(group.type),
    cells: group.orderToResult.map((band) => ({
      value: band.value,
      href: href(range, filter, 'turnaround', gridKey(group.type, band.name)),
    })),
  }))
  const links = groups.flatMap((group) =>
    group.orderToResult.map((band) => ({
      name: `${investigationLabel(group.type)} ${band.name}`,
      value: band.value,
      href: href(range, filter, 'turnaround', gridKey(group.type, band.name)),
    })),
  )

  return (
    <DashSection title="Turnaround: order to result" icon={<Clock size={18} />}>
      <StackedBar bands={bands} rows={rows} unit="tests" />
      <BandLegend bands={bands} />
      <BarLinks caption="Turnaround: order to result" rows={links} unit="tests" />
      <Footnote>
        Imaging counts the earlier of the preliminary and the official report; lab counts the result. The unit is the
        investigation row, so a case with two scans is counted twice.
      </Footnote>
    </DashSection>
  )
}

export function ExamToConsultSection({ kpi, range, filter }: Props) {
  if (kpi.examToConsult.length === 0) return null
  return (
    <DashSection title="Exam to consult, median" icon={<Users size={18} />}>
      <DataTable
        head={['Team', 'Consults', 'Median']}
        rows={kpi.examToConsult.map((row) => ({
          key: row.name,
          href: href(range, filter, 'examconsult', row.name),
          cells: [row.name, row.n, <Median key="m" value={row.med} n={row.n} />],
        }))}
      />
      <Footnote>
        First physician contact to the consult request. n counts consults, not cases: a case that consults the same team
        twice contributes two.
      </Footnote>
    </DashSection>
  )
}

// --- 8. longest stays -------------------------------------------------------------------------

export function LongestStays({ kpi }: Props) {
  if (kpi.longest.length === 0) return null
  const rows: TableRow[] = kpi.longest.map((row, i) => ({
    key: row.id,
    href: `/cases/${row.id}`,
    cells: [
      <span key="m" className="inline-block">
        <span className="num">
          {i + 1}. {row.mrn}
        </span>
        {row.stageNames.length > 0 ? (
          <span className="block text-caption font-normal text-muted">{row.stageNames.join(' · ')}</span>
        ) : null}
      </span>,
      fmtHours(row.hours),
      row.status === 'OPEN'
        ? 'Still open'
        : row.disposition
          ? (DISPOSITION_LABELS[row.disposition as keyof typeof DISPOSITION_LABELS] ?? row.disposition)
          : 'Not recorded',
      row.lastUpdateAt ? fmtStamp(row.lastUpdateAt.toISOString()) : '–',
    ],
  }))
  return (
    <DashSection title="Longest stays" icon={<History size={18} />}>
      <DataTable head={['# MRN', 'Stay', 'Outcome', 'Last update']} rows={rows} />
      <Footnote>The ten longest stays in this range. Tap a row to open the case.</Footnote>
    </DashSection>
  )
}

// --- 9. actions documented --------------------------------------------------------------------

export function ActionsDocumented({ kpi, range, filter }: Props) {
  const { any, none, byKind } = kpi.actions
  if (any.value === 0 && none.value === 0) return null
  return (
    <DashSection title="Actions documented" icon={<ListChecks size={18} />}>
      <DataTable head={['Action', 'Cases']} rows={countRows([any, none, ...byKind], range, 'action', filter)} />
      <Footnote>
        Of the {kpi.headline.cases} {kpi.headline.cases === 1 ? 'case' : 'cases'} in this range. A case can carry
        several kinds, so the seven below add to more than the first row; &quot;No action documented&quot; is the
        weekly deck&apos;s own row. An action counts whether it was tagged on an update or recorded as a time on the
        case, and the last row is an update written with no category chosen.
      </Footnote>
    </DashSection>
  )
}

// --- 10. outcomes, CTAS, area, repeats, documentation -----------------------------------------

export function OutcomesSection({ kpi, range, filter }: Props) {
  if (kpi.outcomes.length === 0) return null
  return (
    <BarSection
      title="Outcomes"
      icon={<Check size={18} />}
      rows={hbarRows(kpi.outcomes, range, 'outcome', filter)}
      color="ok"
      footnote="Resolved cases by disposition, then the cases still open."
    />
  )
}

/**
 * Decision D, as two share bars: of the cases where the question was answered at all, how many
 * were answered Yes. A case with no answer is in neither number, which is why `n` is on the row —
 * "3 of 4" says something a bare 75 % does not — and the share itself is null below MIN_N and
 * renders "n<3", like every other share on this page.
 */
export function DischargeCommunication({ kpi, range, filter }: Props) {
  if (!kpi.communication.some((row) => row.n > 0)) return null
  return (
    <DashSection title="Discharge communication" icon={<Bell size={18} />}>
      <DataTable
        head={['Question', 'Yes / n', 'Share']}
        rows={kpi.communication.map((row) => ({
          key: row.name,
          href: href(range, filter, 'communication', row.name),
          cells: [
            row.name,
            `${row.within} / ${row.n}`,
            <span key="s" className="inline-flex min-w-[56px] flex-col items-end gap-1">
              {fmtShare(row.share)}
              <ShareBar share={row.share} label={row.name} />
            </span>,
          ],
        }))}
      />
      <Footnote>
        Asked when a case is resolved. n counts the cases where the question was answered — Yes, No or Not sure — and
        the share is the Yes answers among them; a case with no answer is in neither. Tap a row for those cases.
      </Footnote>
    </DashSection>
  )
}

export function ByCtasSection({ kpi, range, filter }: Props) {
  if (!kpi.byCtas.some((r) => r.n > 0)) return null
  return (
    <DashSection title="By CTAS" icon={<LayoutList size={18} />}>
      <DataTable
        head={['CTAS', 'Cases', 'Median stay']}
        rows={kpi.byCtas.map((row) => ({
          key: row.name,
          href: href(range, filter, 'ctas', row.name),
          cells: [row.name, row.n, <Median key="m" value={row.med} n={row.n} />],
        }))}
      />
    </DashSection>
  )
}

export function ByAreaSection({ kpi, range, filter }: Props) {
  // Nothing to show until an area is recorded on at least one case: a table whose only row is
  // "Not recorded" tells the reader nothing they did not already know.
  if (!kpi.byArea.some((r) => r.name !== NOT_RECORDED && r.n > 0)) return null
  return (
    <DashSection title="By ED area" icon={<LayoutList size={18} />}>
      <DataTable
        head={['Area', 'Cases', 'Median stay']}
        rows={kpi.byArea.map((row) => ({
          key: row.name,
          href: href(range, filter, 'area', row.name),
          cells: [row.name, row.n, <Median key="m" value={row.med} n={row.n} />],
        }))}
      />
    </DashSection>
  )
}

export function RepeatVisits({ kpi, range, filter }: Props) {
  if (kpi.repeats.length === 0) return null
  return (
    <DashSection title="Repeat visits" icon={<History size={18} />}>
      <DataTable
        head={['MRN', 'Cases in range']}
        rows={kpi.repeats.map((row) => ({
          key: row.mrn,
          href: href(range, filter, 'repeat', row.mrn),
          cells: [<span key="m" className="num">{row.mrn}</span>, row.ids.length],
        }))}
      />
      <Footnote>One MRN with more than one case flagged in this range.</Footnote>
    </DashSection>
  )
}

export function DocumentationSection({ kpi, range, filter }: Props) {
  if (!anyValue(kpi.completeness)) return null
  return (
    <DashSection title="Documentation" icon={<FileText size={18} />}>
      <DataTable head={['Check', 'Cases']} rows={countRows(kpi.completeness, range, 'quality', filter)} />
      <Footnote>What is missing or contradictory on the record, so it can be fixed while the case is fresh.</Footnote>
    </DashSection>
  )
}

// --- Phase 10: where the time goes, by payer --------------------------------------------------

/**
 * The stay in three parts (docs/specs/phase10-delays.md): front end, decision, after the
 * decision. Phase 11 put the split on top as bars, overall and by outcome (`StaySplit`); under it
 * the tables, the phases with a median and a share, the longest phase per case, then the stages of
 * each phase — only the stages some case in the range carries, and a line saying so when a phase
 * has none. Every row drills down; the grid key is `phase|what`.
 */
export function WhereTimeGoesSection({ kpi, range, filter }: Props) {
  const { phases, completeN } = kpi.phases
  if (!phases.some((p) => p.n > 0)) return null
  return (
    <DashSection title="Where the time goes" icon={<Clock size={18} />}>
      <StaySplit rows={kpi.staySplit} />
      {/* The share is text only now: the bars above draw it, where it was an 80 px sliver here. */}
      <DataTable
        head={['Phase', 'Cases', 'Median', 'Share']}
        rows={phases.map((p) => ({
          key: p.key,
          href: href(range, filter, 'phase', gridKey(p.key, 'median')),
          cells: [p.name, p.n, <Median key="m" value={p.med} n={p.n} />, fmtShare(p.share)],
        }))}
      />
      <PanelLabel>Longest phase of the stay, over the {completeN} cases with all three measured</PanelLabel>
      <DataTable
        head={['Phase', 'Cases']}
        rows={phases.map((p) => ({
          key: `longest-${p.key}`,
          href: href(range, filter, 'phase', gridKey(p.key, 'longest')),
          cells: [p.name, p.longestN],
        }))}
      />
      {phases.map((p) => {
        // `phaseSplit` keeps every stage, zero rows included; a stage no case carries is not a
        // finding, so it is left out here rather than in the figure (Phase 11, item 7).
        const carried = p.stages.filter((s) => s.value > 0)
        return (
          <div key={p.key} data-phase-stages={p.key}>
            <PanelLabel>Reasons recorded in the {p.name.toLowerCase()}</PanelLabel>
            {carried.length > 0 ? (
              <DataTable
                head={['Stage', 'Cases']}
                rows={carried.map((s) => ({
                  key: `${p.key}-${s.name}`,
                  href: href(range, filter, 'phase', gridKey(p.key, s.name)),
                  cells: [s.name, s.value],
                }))}
              />
            ) : (
              <EmptyNote>No case in this range carries one.</EmptyNote>
            )}
          </div>
        )
      })}
      <Footnote>
        Front end is door to physician; decision is physician to the disposition decision; after the decision is
        decision to leaving, so it counts resolved cases only. Shares are summed hours over the cases with all three
        measured. The bars take their medians from those same cases, so they can differ from the table&apos;s, which
        count every case with that phase measured; an outcome with fewer than 3 such cases has no bar. Tap a row for the
        cases.
      </Footnote>
    </DashSection>
  )
}

// --- Phase 11: when the patients arrive --------------------------------------------------------

/**
 * "Arrivals by day and time": `arrivalGrid()` as a table, each cell with cases a drill-down
 * (`arrival:{weekday}|{block}`), carrying the filter like every other row on the page.
 */
export function ArrivalsSection({
  arrivals,
  range,
  filter,
}: {
  arrivals: ArrivalGrid
  range: Range
  filter?: CaseFilter
}) {
  if (arrivals.max === 0) return null
  return (
    <DashSection title="Arrivals by day and time" icon={<Clock size={18} />}>
      <ArrivalTable
        max={arrivals.max}
        rows={arrivals.rows.map((row) => ({
          weekday: row.weekday,
          cells: row.cells.map((cell) => ({
            block: cell.block,
            value: cell.value,
            href: href(range, filter, 'arrival', gridKey(row.weekday, cell.block)),
          })),
        }))}
      />
      <Footnote>
        Registration time in Asia/Riyadh, in three-hour blocks. The darker the cell, the more cases, against the fullest
        cell in this range. Tap a cell for its cases.
      </Footnote>
    </DashSection>
  )
}

/** Nothing to show until a payer is recorded on at least one case, as with the ED area. */
export function ByPayerSection({ kpi, range, filter }: Props) {
  if (!kpi.byPayer.some((r) => r.name !== NOT_RECORDED && r.n > 0)) return null
  return (
    <DashSection title="By payer" icon={<Users size={18} />}>
      <DataTable
        head={['Payer', 'Cases', 'Median stay']}
        rows={kpi.byPayer.map((row) => ({
          key: row.name,
          href: href(range, filter, 'payer', row.name),
          cells: [row.name, row.n, <Median key="m" value={row.med} n={row.n} />],
        }))}
      />
    </DashSection>
  )
}
