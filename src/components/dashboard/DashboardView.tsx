/**
 * The dashboard — the prototype's `Dashboard` (docs/reference/ERNavigatorTracker.jsx), section
 * for section and word for word, on `dashboard()` from `src/lib/domain/aggregates.ts`, with the
 * Phase 8 panels from `sections.tsx` interleaved into it.
 *
 * Nothing on this page counts anything. Every number, every row and every drill-down id comes out
 * of that one call, which is tested against a fixture with hand-computed answers. The two Recharts
 * charts — the trend panels and the turnaround stack — are the only client components; the tiles,
 * the tables, the bars and every link are server-rendered HTML, so leadership can read this page
 * with JavaScript off and print it.
 */
import Link from 'next/link'
import {
  Activity,
  BarChart3,
  ClipboardList,
  Clock,
  Ellipsis,
  History,
  TriangleAlert,
  Users,
} from '@/src/components/icons'
import { TrendChart, type TrendPoint } from '@/src/components/dashboard/charts/TrendChart'
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
  ArrivalsSection,
  BarSection,
  ByAreaSection,
  ByCtasSection,
  ByPayerSection,
  DischargeCommunication,
  DocumentationSection,
  ExamToConsultSection,
  HeadlineTiles,
  LongestStays,
  OutcomesSection,
  RepeatVisits,
  StayBandsSection,
  WhereTimeGoesSection,
  TurnaroundSection,
  WorkingTargets,
  hbarRows,
} from '@/src/components/dashboard/sections'
import { FilterBar } from '@/src/components/filter/FilterBar'
import { PageHeader } from '@/src/components/shell/PageHeader'
import { RANGE_LABELS, dashboardHref, drillKey, type DrillSection } from '@/src/lib/dashboard/drill'
import { RANGES, type Range, type dashboard } from '@/src/lib/domain/aggregates'
import {
  EMPTY_FILTER,
  describeFilter,
  isEmptyFilter,
  type CaseFilter,
  type FilterOptions,
} from '@/src/lib/domain/case-filter'
import { SHIFT_LABELS } from '@/src/lib/domain/taxonomy'
import { weekPoint } from '@/src/lib/dashboard/weeks'
import { MIN_N } from '@/src/lib/domain/time'

type DashboardData = ReturnType<typeof dashboard>

export function DashboardView({
  data,
  range,
  filter = EMPTY_FILTER,
  filterOptions,
}: {
  data: DashboardData
  range: Range
  /** The Phase 10 case filter the page is drawn over; every number above is already narrowed by it. */
  filter?: CaseFilter
  filterOptions: FilterOptions
}) {
  const filtered = !isEmptyFilter(filter)
  return (
    <div className="dash">
      <PageHeader
        title="Dashboard"
        subtitle={
          <>
            <p className="num mt-0.5 text-[14px] text-muted" data-subtitle>
              {data.inRange} of {data.total} cases
            </p>
            {/* What the page is counting, said in words directly under the count it changed. A
                filtered dashboard that does not say so is a wrong number with a confident face. */}
            {filtered ? (
              <p className="mt-0.5 text-caption text-muted" data-filter-note>
                Filtered: {describeFilter(filter, filterOptions)}
              </p>
            ) : null}
          </>
        }
      />

      <div className="no-print flex flex-wrap gap-2 px-4 pb-3 lg:px-0" role="group" aria-label="Date range">
        {RANGES.map((option) => (
          <Link
            key={option}
            href={dashboardHref(option, null, filter)}
            aria-current={option === range ? 'true' : undefined}
            className={`inline-flex min-h-11 items-center rounded-chip border px-3.5 text-[14px] ${
              option === range
                ? 'border-accent bg-accent font-semibold text-white'
                : 'border-line bg-panel text-ink-2'
            }`}
          >
            {RANGE_LABELS[option]}
          </Link>
        ))}
      </div>

      <FilterBar
        basePath="/dashboard"
        baseQuery={range === '30' ? '' : `r=${range}`}
        filter={filter}
        options={filterOptions}
      />

      <DashboardBody data={data} range={range} filter={filter} />
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
  filter,
  variant = 'screen',
}: {
  data: DashboardData
  range: Range
  filter?: CaseFilter
  variant?: 'screen' | 'report'
}) {
  const { admission, kpi } = data
  const href = (section: DrillSection, name: string | number) =>
    dashboardHref(range, drillKey(section, name), filter)

  const thresholdRows: TableRow[] = data.thresholds.map((row) => ({
    key: String(row.threshold),
    href: href('threshold', row.threshold),
    cells: [<ThresholdLabel key="t" hours={row.threshold} />, row.openNow, row.allCases],
  }))

  const weekPoints: TrendPoint[] = data.weeks.map((week) => weekPoint(week, href('week', week.weekStart)))
  // Phase 11: on the 7- and 30-day ranges a week is too coarse — thirty days is four or five bars —
  // so the chart is by day there; 90 days and all time keep the weeks.
  const daily = range === '7' || range === '30'
  const dayPoints: TrendPoint[] = data.days.map((day) => ({
    name: day.name,
    label: `${day.weekday} ${day.name}`,
    cases: day.cases,
    med: day.med,
    href: href('day', day.date),
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

  /** What a printed report opens with, and what the screen keeps further down the page. */
  const lead = (
    <>
      <StayBandsSection kpi={kpi} range={range} filter={filter} />
      <AdaaPanel kpi={kpi} range={range} filter={filter} />
      <WorkingTargets kpi={kpi} range={range} filter={filter} />
      <WhereTimeGoesSection kpi={kpi} range={range} filter={filter} />
    </>
  )

  return (
    <>
      <HeadlineTiles kpi={kpi} range={range} filter={filter} />

      {variant === 'report' ? lead : null}

      {data.inRange > 0 && (
        <DashSection title="Cases past each threshold" icon={<Clock size={18} />}>
          <DataTable head={['Threshold', 'Open now', 'All cases']} rows={thresholdRows} />
          <Footnote>
            Tap a row to see the cases. Open now counts wait so far; All cases counts total stay
            including resolved.
          </Footnote>
        </DashSection>
      )}

      {data.inRange === 0 ? (
        <section className="mx-4 mb-2.5 rounded-card border border-line bg-panel p-6 text-center shadow-card lg:mx-0">
          <p className="m-0 text-body text-muted">
            {/* Under a filter `total` is the filtered population too, so a filter that matches
                nothing would otherwise read "No cases yet." — a claim about the whole department
                that only the filter made. */}
            {filter && !isEmptyFilter(filter)
              ? 'No case in this range matches this filter.'
              : data.total
                ? 'No cases registered in this range.'
                : 'No cases yet.'}
          </p>
        </section>
      ) : (
        <>
          {variant === 'screen' ? <StayBandsSection kpi={kpi} range={range} filter={filter} /> : null}
          {variant === 'screen' ? <WhereTimeGoesSection kpi={kpi} range={range} filter={filter} /> : null}

          {daily ? (
            <DashSection title="By day: cases and median stay" icon={<Activity size={18} />}>
              <TrendChart points={dayPoints} kind="daily" reference={{ hours: 6, label: '6 h' }} />
              {/* The days a bar can be seen on: a day with no case has nothing to list. */}
              <BarLinks
                caption="By day"
                rows={dayPoints.filter((d) => d.cases > 0).map((d) => ({ name: d.label!, value: d.cases, href: d.href }))}
                unit="cases"
              />
              <Footnote>
                Bars: cases flagged each day, by registration in Asia/Riyadh, the empty days kept; the first bar is the
                part of its day inside the range. Line: median total ED stay; a day with fewer than {MIN_N} cases shows no
                median. The dashed line is 6 h.
              </Footnote>
            </DashSection>
          ) : (
            data.weeks.length > 1 && (
              <DashSection title="By week: cases and median stay" icon={<Activity size={18} />}>
                <TrendChart points={weekPoints} kind="weekly" />
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
            )
          )}

          <BarSection
            title="Primary delay reason"
            icon={<TriangleAlert size={18} />}
            rows={hbarRows(data.byPrimary, range, 'primary', filter)}
            color="accent"
          />
          {/* The weekly deck's "delay pathway" classification, expressed through the locked stage
              taxonomy rather than a second one (brief, section 6). */}
          <BarSection
            title="Pathways"
            icon={<Activity size={18} />}
            rows={hbarRows(data.byStage, range, 'stage', filter)}
            color="ink"
            unit={`of ${data.inRange} cases`}
            footnote="The journey stage each delay reason belongs to. A case whose reasons span several stages is counted in each, so the bars add to more than the number of cases."
          />
          <BarSection
            title="Departments involved"
            icon={<Users size={18} />}
            rows={hbarRows(data.byDept, range, 'dept', filter)}
            color="plum"
          />

          {variant === 'screen' ? (
            <>
              <AdaaPanel kpi={kpi} range={range} filter={filter} />
              <WorkingTargets kpi={kpi} range={range} filter={filter} />
            </>
          ) : null}

          <AdmissionToUnit kpi={kpi} range={range} filter={filter} />
          <TurnaroundSection kpi={kpi} range={range} filter={filter} />
          <ExamToConsultSection kpi={kpi} range={range} filter={filter} />

          <DashSection title="Consulted team response, median" icon={<Users size={18} />}>
            {consultRows.length ? (
              <DataTable head={['Team', 'n', 'To seen', 'To reply']} rows={consultRows} />
            ) : (
              <EmptyNote>Enter consulted, seen, and replied times under each team to see this.</EmptyNote>
            )}
          </DashSection>

          <DashSection title="Investigation turnaround, median from order" icon={<Activity size={18} />}>
            {investigationRows.length ? (
              <DataTable head={['Test', 'n', 'To done', 'To result']} rows={investigationRows} />
            ) : (
              <EmptyNote>Enter investigation times under a case to see this.</EmptyNote>
            )}
          </DashSection>

          <DashSection title="Admission chain, median" icon={<ClipboardList size={18} />}>
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

          <LongestStays kpi={kpi} range={range} filter={filter} />
          <ActionsDocumented kpi={kpi} range={range} filter={filter} />

          {shiftRows.length > 0 && (
            <DashSection title="By shift" icon={<History size={18} />}>
              <DataTable head={['Shift', 'Cases', 'Median stay']} rows={shiftRows} />
            </DashSection>
          )}

          {data.byWeekday.length > 1 && (
            <BarSection
              title="By day of week"
              icon={<BarChart3 size={18} />}
              rows={hbarRows(data.byWeekday, range, 'weekday', filter)}
              color="muted"
            />
          )}
          <ArrivalsSection arrivals={data.arrivals} range={range} filter={filter} />

          <OutcomesSection kpi={kpi} range={range} filter={filter} />
          <DischargeCommunication kpi={kpi} range={range} filter={filter} />
          <ByCtasSection kpi={kpi} range={range} filter={filter} />
          <ByAreaSection kpi={kpi} range={range} filter={filter} />
          <ByPayerSection kpi={kpi} range={range} filter={filter} />
          <RepeatVisits kpi={kpi} range={range} filter={filter} />
          <DocumentationSection kpi={kpi} range={range} filter={filter} />

          <DashSection title={`Other reasons awaiting review (${data.otherQueue.length})`} icon={<Ellipsis size={18} />}>
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
