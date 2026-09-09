/**
 * The dashboard — the prototype's `Dashboard` (docs/reference/ERNavigatorTracker.jsx), section
 * for section and word for word, on `dashboard()` from `src/lib/domain/aggregates.ts`.
 *
 * Nothing on this page counts anything. Every number, every row and every drill-down id comes out
 * of that one call, which is tested against a fixture with hand-computed answers. The two charts
 * are the only client components; the tiles, the tables and every link are server-rendered HTML,
 * so leadership can read this page with JavaScript off and print it.
 */
import Link from 'next/link'
import { HBar, type HBarColor, type HBarRow } from '@/src/components/dashboard/charts/HBar'
import { WeeklyChart, type WeekPoint } from '@/src/components/dashboard/charts/WeeklyChart'
import {
  BarLinks,
  DashSection,
  DataTable,
  EmptyNote,
  Footnote,
  Median,
  ThresholdLabel,
  Tile,
  type TableRow,
} from '@/src/components/dashboard/parts'
import { RANGE_LABELS, dashboardHref, drillKey, type DrillSection } from '@/src/lib/dashboard/drill'
import { RANGES, type CountRow, type Range, type dashboard } from '@/src/lib/domain/aggregates'
import { DISPOSITION_LABELS, SHIFT_LABELS } from '@/src/lib/domain/taxonomy'
import { MIN_N, fmtHours } from '@/src/lib/domain/time'

type DashboardData = ReturnType<typeof dashboard>

const hbarRows = (rows: ReadonlyArray<CountRow>, range: Range, section: DrillSection): HBarRow[] =>
  rows.map((row) => ({
    name: row.name,
    value: row.value,
    href: dashboardHref(range, drillKey(section, row.name)),
  }))

/** A bar section: the chart, and the same rows as links for keyboard, screen readers and print. */
function BarSection({
  title,
  rows,
  color,
  unit = 'cases',
}: {
  title: string
  rows: HBarRow[]
  color: HBarColor
  unit?: string
}) {
  return (
    <DashSection title={title}>
      <HBar rows={rows} color={color} unit={unit} />
      <BarLinks caption={title} rows={rows} unit={unit} />
    </DashSection>
  )
}

export function DashboardView({ data, range }: { data: DashboardData; range: Range }) {
  return (
    <div className="dash">
      <div className="px-4 pt-4 pb-2.5">
        <h2 className="text-title">Dashboard</h2>
        <p className="num mt-0.5 text-[14px] text-muted" data-subtitle>
          {data.inRange} of {data.total} cases
        </p>
      </div>

      <div className="no-print flex flex-wrap gap-2 px-4 pb-3" role="group" aria-label="Date range">
        {RANGES.map((option) => (
          <Link
            key={option}
            href={dashboardHref(option)}
            aria-current={option === range ? 'true' : undefined}
            className={`inline-flex min-h-11 items-center rounded-chip border px-3 text-[14px] ${
              option === range ? 'border-accent bg-accent font-semibold text-white' : 'border-line bg-panel text-ink'
            }`}
          >
            {RANGE_LABELS[option]}
          </Link>
        ))}
      </div>

      <DashboardBody data={data} range={range} />
    </div>
  )
}

/**
 * Every tile, table and chart of the dashboard, without the page's own heading or its range
 * chips. `/report` (Phase 5) renders exactly this under a hospital header for an explicit date
 * range, which is what "the dashboard sections for that range" means: one implementation of every
 * section, printed by the same Phase 4 stylesheet, so the report can never drift from the screen.
 */
export function DashboardBody({ data, range }: { data: DashboardData; range: Range }) {
  const { tiles, admission } = data
  const href = (section: DrillSection, name: string | number) => dashboardHref(range, drillKey(section, name))

  const thresholdRows: TableRow[] = data.thresholds.map((row) => ({
    key: String(row.threshold),
    href: href('threshold', row.threshold),
    cells: [<ThresholdLabel key="t" hours={row.threshold} />, row.openNow, row.allCases],
  }))

  const weekPoints: WeekPoint[] = data.weeks.map((week) => ({
    name: week.name,
    cases: week.cases,
    med: week.med,
    href: href('week', week.weekStart),
  }))

  const consultRows: TableRow[] = data.consults.map((row) => ({
    key: row.name,
    href: href('consult', row.name),
    cells: [
      row.name,
      row.n,
      <Median key="s" value={row.toSeen} n={row.n} />,
      <Median key="r" value={row.toReply} n={row.n} />,
    ],
  }))

  const investigationRows: TableRow[] = data.investigations.map((row) => ({
    key: row.type,
    href: href('investigation', row.type),
    cells: [
      row.name,
      row.n,
      <Median key="m" value={row.toMid} n={row.n} />,
      <Median key="d" value={row.toDone} n={row.n} />,
    ],
  }))

  const shiftRows: TableRow[] = data.byShift.map((row) => ({
    key: row.name,
    href: href('shift', row.name),
    cells: [
      SHIFT_LABELS[row.name as keyof typeof SHIFT_LABELS] ?? row.name,
      row.n,
      <Median key="m" value={row.med} n={row.n} />,
    ],
  }))

  const dispoRows = data.byDispo.map((row) => ({
    name: DISPOSITION_LABELS[row.name as keyof typeof DISPOSITION_LABELS] ?? row.name,
    value: row.value,
    href: href('dispo', row.name),
  }))

  return (
    <>
      <div className="flex gap-2 px-4 pb-3">
        <Tile label="Open now" value={String(tiles.openNow)} />
        <Tile label="Open past 6h" value={String(tiles.openPast6)} tone="danger" />
        <Tile
          label="Median LOS, resolved"
          value={tiles.resolvedN < MIN_N ? `n<${MIN_N}` : fmtHours(tiles.medianLos)}
        />
      </div>

      {data.inRange > 0 && (
        <DashSection title="Cases past each threshold">
          <DataTable head={['Threshold', 'Open now', 'All cases']} rows={thresholdRows} />
          <Footnote>
            Tap a row to see the cases. Open now counts wait so far; All cases counts total stay
            including resolved.
          </Footnote>
        </DashSection>
      )}

      {data.inRange === 0 ? (
        <section className="mb-2.5 border-y border-line bg-panel p-6 text-center">
          <p className="m-0 text-body text-muted">
            {data.total ? 'No cases registered in this range.' : 'No cases yet.'}
          </p>
        </section>
      ) : (
        <>
          {data.weeks.length > 1 && (
            <DashSection title="By week: cases and median stay">
              <WeeklyChart weeks={weekPoints} />
              <BarLinks
                caption="By week"
                rows={weekPoints.map((w) => ({ name: w.name, value: w.cases, href: w.href }))}
                unit="cases"
              />
              <Footnote>Bars: cases flagged that week. Line: median total ED stay.</Footnote>
            </DashSection>
          )}

          <BarSection title="Primary delay reason" rows={hbarRows(data.byPrimary, range, 'primary')} color="accent" />
          <BarSection
            title="Journey stage where delays occur"
            rows={hbarRows(data.byStage, range, 'stage')}
            color="ink"
          />
          <BarSection title="Departments involved" rows={hbarRows(data.byDept, range, 'dept')} color="plum" />

          <DashSection title="Consulted team response, median">
            {consultRows.length ? (
              <DataTable head={['Team', 'n', 'To seen', 'To reply']} rows={consultRows} />
            ) : (
              <EmptyNote>Enter consulted, seen, and replied times under each team to see this.</EmptyNote>
            )}
          </DashSection>

          <DashSection title="Investigation turnaround, median from order">
            {investigationRows.length ? (
              <DataTable head={['Test', 'n', 'To done', 'To result']} rows={investigationRows} />
            ) : (
              <EmptyNote>Enter investigation times under a case to see this.</EmptyNote>
            )}
          </DashSection>

          <DashSection title="Admission chain, median">
            {admission.n ? (
              <DataTable
                head={['Step', 'Hours']}
                rows={[
                  {
                    key: 'order',
                    cells: [
                      'Order written to bed assigned',
                      <Median key="v" value={admission.orderToBed} n={admission.n} />,
                    ],
                  },
                  {
                    key: 'request',
                    cells: [
                      'Bed requested to bed assigned',
                      <Median key="v" value={admission.requestToBed} n={admission.n} />,
                    ],
                  },
                  {
                    key: 'bed',
                    cells: [
                      'Bed assigned to left ED',
                      <Median key="v" value={admission.bedToLeave} n={admission.n} />,
                    ],
                  },
                ]}
              />
            ) : (
              <EmptyNote>Enter admission times under a case to see this.</EmptyNote>
            )}
          </DashSection>

          {shiftRows.length > 0 && (
            <DashSection title="By shift">
              <DataTable head={['Shift', 'Cases', 'Median stay']} rows={shiftRows} />
            </DashSection>
          )}

          {data.byWeekday.length > 1 && (
            <BarSection
              title="By day of week"
              rows={hbarRows(data.byWeekday, range, 'weekday')}
              color="muted"
            />
          )}

          <BarSection title="Final disposition" rows={dispoRows} color="ok" />

          <DashSection title={`Other reasons awaiting review (${data.otherQueue.length})`}>
            {data.otherQueue.length === 0 ? (
              <EmptyNote>
                Nothing queued. Anything typed into an &quot;Other&quot; box shows up here so it can be
                promoted to a real category.
              </EmptyNote>
            ) : (
              <ul>
                {data.otherQueue.map((row, i) => (
                  <li key={`${row.id}-${row.stageName}-${i}`} className="border-b border-line-soft last:border-b-0">
                    <Link
                      href={`/cases/${row.id}`}
                      className="block min-h-11 py-1.5 text-body text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                    >
                      <span className="block text-caption text-muted">
                        {row.stageName} · <span className="num">{row.mrn}</span>
                      </span>
                      {row.text}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </DashSection>
        </>
      )}
    </>
  )
}
