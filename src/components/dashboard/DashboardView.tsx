/**
 * The dashboard — the prototype's `Dashboard` (docs/reference/ERNavigatorTracker.jsx), section
 * for section and word for word, on `dashboard()` from `src/lib/domain/aggregates.ts`, with the
 * Phase 8 panels from `sections.tsx` interleaved into it.
 *
 * Nothing on this page counts anything. Every number, every row and every drill-down id comes out
 * of that one call, which is tested against a fixture with hand-computed answers. The three charts
 * are the only client components; the tiles, the tables and every link are server-rendered HTML,
 * so leadership can read this page with JavaScript off and print it.
 */
import Link from 'next/link'
import { WeeklyChart, type WeekPoint } from '@/src/components/dashboard/charts/WeeklyChart'
import {
  BarLinks,
  DashSection,
  DataTable,
  EmptyNote,
  Footnote,
  Median,
  ThresholdLabel,
  type TableRow,
} from '@/src/components/dashboard/parts'
import {
  ActionsDocumented,
  AdaaPanel,
  AdmissionToUnit,
  BarSection,
  ByAreaSection,
  ByCtasSection,
  DischargeCommunication,
  DocumentationSection,
  ExamToConsultSection,
  HeadlineTiles,
  LongestStays,
  OutcomesSection,
  RepeatVisits,
  StayBandsSection,
  TurnaroundSection,
  WorkingTargets,
  hbarRows,
} from '@/src/components/dashboard/sections'
import { RANGE_LABELS, dashboardHref, drillKey, type DrillSection } from '@/src/lib/dashboard/drill'
import { RANGES, type Range, type dashboard } from '@/src/lib/domain/aggregates'
import { SHIFT_LABELS } from '@/src/lib/domain/taxonomy'
import { weekPoint } from '@/src/lib/dashboard/weeks'
import { MIN_N } from '@/src/lib/domain/time'

type DashboardData = ReturnType<typeof dashboard>

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
 *
 * `variant` is the one thing the two differ in, and it changes order, never content: a printed
 * report opens with the four sections a reader of the deck looks for first — the headline, the
 * stay bands, the Adaa panel and the working targets — and the screen keeps them where a reader
 * scrolling the page expects them (Phase 8 spec, Slice E).
 */
export function DashboardBody({
  data,
  range,
  variant = 'screen',
}: {
  data: DashboardData
  range: Range
  variant?: 'screen' | 'report'
}) {
  const { admission, kpi } = data
  const href = (section: DrillSection, name: string | number) => dashboardHref(range, drillKey(section, name))

  const thresholdRows: TableRow[] = data.thresholds.map((row) => ({
    key: String(row.threshold),
    href: href('threshold', row.threshold),
    cells: [<ThresholdLabel key="t" hours={row.threshold} />, row.openNow, row.allCases],
  }))

  const weekPoints: WeekPoint[] = data.weeks.map((week) => weekPoint(week, href('week', week.weekStart)))

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

  /** What a printed report opens with, and what the screen keeps further down the page. */
  const lead = (
    <>
      <StayBandsSection kpi={kpi} range={range} />
      <AdaaPanel kpi={kpi} range={range} />
      <WorkingTargets kpi={kpi} range={range} />
    </>
  )

  return (
    <>
      <HeadlineTiles kpi={kpi} range={range} />

      {variant === 'report' ? lead : null}

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
          {variant === 'screen' ? <StayBandsSection kpi={kpi} range={range} /> : null}

          {data.weeks.length > 1 && (
            <DashSection title="By week: cases and median stay">
              <WeeklyChart weeks={weekPoints} />
              <BarLinks
                caption="By week"
                rows={weekPoints.map((w) => ({ name: w.name, value: w.cases, href: w.href }))}
                unit="cases"
              />
              <Footnote>
                Bars: cases flagged that week. Line: median total ED stay; a week with fewer than {MIN_N} cases
                shows no median.
              </Footnote>
            </DashSection>
          )}

          <BarSection title="Primary delay reason" rows={hbarRows(data.byPrimary, range, 'primary')} color="accent" />
          {/* The weekly deck's "delay pathway" classification, expressed through the locked stage
              taxonomy rather than a second one (brief, section 6). */}
          <BarSection
            title="Pathways"
            rows={hbarRows(data.byStage, range, 'stage')}
            color="ink"
            unit={`of ${data.inRange} cases`}
            footnote="The journey stage each delay reason belongs to. A case whose reasons span several stages is counted in each, so the bars add to more than the number of cases."
          />
          <BarSection title="Departments involved" rows={hbarRows(data.byDept, range, 'dept')} color="plum" />

          {variant === 'screen' ? (
            <>
              <AdaaPanel kpi={kpi} range={range} />
              <WorkingTargets kpi={kpi} range={range} />
            </>
          ) : null}

          <AdmissionToUnit kpi={kpi} range={range} />
          <TurnaroundSection kpi={kpi} range={range} />
          <ExamToConsultSection kpi={kpi} range={range} />

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

          <LongestStays kpi={kpi} range={range} />
          <ActionsDocumented kpi={kpi} range={range} />

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

          <OutcomesSection kpi={kpi} range={range} />
          <DischargeCommunication kpi={kpi} range={range} />
          <ByCtasSection kpi={kpi} range={range} />
          <ByAreaSection kpi={kpi} range={range} />
          <RepeatVisits kpi={kpi} range={range} />
          <DocumentationSection kpi={kpi} range={range} />

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
