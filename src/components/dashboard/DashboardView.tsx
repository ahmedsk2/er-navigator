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
import type { ReactNode } from 'react'
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
import { MIN_N, fmtHours } from '@/src/lib/domain/time'

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

      {/* Phase 11: the phone's way down a page of twenty-odd sections — one chip per group, each an
          in-page link, so it works with JavaScript off. A laptop has the two-column grid instead,
          and paper has neither. Nothing to jump to when the range is empty. */}
      {data.inRange > 0 ? (
        <nav aria-label="Jump to a section" className="no-print px-4 pb-3 lg:hidden" data-jump>
          <ul className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
            {DASHBOARD_GROUPS.map((group) => (
              <li key={group.id}>
                <a
                  href={`#dash-${group.id}`}
                  className="inline-flex min-h-11 items-center rounded-chip border border-line-soft bg-accent-soft px-3 text-label font-semibold text-accent-ink"
                >
                  {group.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

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
 * `variant` is the one thing the two differ in, and it changes order and layout, never content: a
 * printed report opens with the four sections a reader of the deck looks for first — the headline,
 * the stay bands, the Adaa panel and the working targets — and the screen keeps them where a
 * reader scrolling the page expects them (Phase 8 spec, Slice E).
 *
 * Phase 11 grouped the screen — overview, time, reasons, KPIs, teams, outcomes, quality — so a
 * phone can jump to a group and a laptop can pair the short sections two to a row. That moved "By
 * shift" and "By day of week" up among the other "when" sections; nothing else changed places.
 * The report is one column in the order it has always printed.
 */
/**
 * A trend point's median in words, for the chart's text equivalent: the median line is otherwise
 * only a tooltip, and the tooltip drops a point with no median rather than saying "n<3".
 */
function medianDetail(med: number | null): string {
  return med == null ? `median stay n<${MIN_N}` : `median stay ${fmtHours(med)}`
}

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

  // Phase 11: every section is built once, here, and the two variants below only order them.
  const screen = variant === 'screen'

  const thresholds =
    data.inRange > 0 ? (
      <DashSection title="Cases past each threshold" icon={<Clock size={18} />}>
        {/* Across both columns on a laptop, so capped: three columns of a table 1,000 px wide put
            every number that far from its label. */}
        <DataTable
          head={['Threshold', 'Open now', 'All cases']}
          rows={thresholdRows}
          className={screen ? 'lg:max-w-2xl' : ''}
        />
        <Footnote>
          Tap a row to see the cases. Open now counts wait so far; All cases counts total stay
          including resolved.
        </Footnote>
      </DashSection>
    ) : null

  const empty = (
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
  )

  const stayBands = <StayBandsSection kpi={kpi} range={range} filter={filter} />
  const whereTime = <WhereTimeGoesSection kpi={kpi} range={range} filter={filter} wide={screen} />
  const adaa = <AdaaPanel kpi={kpi} range={range} filter={filter} wide={screen} />
  const targets = <WorkingTargets kpi={kpi} range={range} filter={filter} />

  const trend = daily ? (
    <DashSection title="By day: cases and median stay" icon={<Activity size={18} />}>
      <TrendChart points={dayPoints} kind="daily" reference={{ hours: 6, label: '6 h' }} />
      {/* The days a bar can be seen on: a day with no case has nothing to list. */}
      <BarLinks
        caption="By day"
        rows={dayPoints
          .filter((d) => d.cases > 0)
          .map((d) => ({ name: d.label!, value: d.cases, href: d.href, detail: medianDetail(d.med) }))}
        unit="cases"
      />
      <Footnote>
        Bars: cases flagged each day, by registration in Asia/Riyadh, the empty days kept; the first bar is the part
        of its day inside the range. Line: median total ED stay; a day with fewer than {MIN_N} cases shows no median.
        The dashed line is 6 h.
      </Footnote>
    </DashSection>
  ) : data.weeks.length > 1 ? (
    <DashSection title="By week: cases and median stay" icon={<Activity size={18} />}>
      <TrendChart points={weekPoints} kind="weekly" />
      <BarLinks
        caption="By week"
        rows={weekPoints.map((w) => ({ name: w.name, value: w.cases, href: w.href, detail: medianDetail(w.med) }))}
        unit="cases"
      />
      <Footnote>
        Bars: cases flagged that week. Line: median total ED stay; a week with fewer than {MIN_N} cases
        shows no median.
      </Footnote>
    </DashSection>
  ) : null

  const primary = (
    <BarSection
      title="Primary delay reason"
      icon={<TriangleAlert size={18} />}
      rows={hbarRows(data.byPrimary, range, 'primary', filter)}
      color="accent"
    />
  )
  // The weekly deck's "delay pathway" classification, expressed through the locked stage taxonomy
  // rather than a second one (brief, section 6).
  const pathways = (
    <BarSection
      title="Pathways"
      icon={<Activity size={18} />}
      rows={hbarRows(data.byStage, range, 'stage', filter)}
      color="ink"
      unit={`of ${data.inRange} cases`}
      footnote="The journey stage each delay reason belongs to. A case whose reasons span several stages is counted in each, so the bars add to more than the number of cases."
    />
  )
  const departments = (
    <BarSection
      title="Departments involved"
      icon={<Users size={18} />}
      rows={hbarRows(data.byDept, range, 'dept', filter)}
      color="plum"
    />
  )

  const admissionToUnit = <AdmissionToUnit kpi={kpi} range={range} filter={filter} />
  const turnaround = <TurnaroundSection kpi={kpi} range={range} filter={filter} />
  const examToConsult = <ExamToConsultSection kpi={kpi} range={range} filter={filter} />

  const consulted = (
    <DashSection title="Consulted team response, median" icon={<Users size={18} />}>
      {consultRows.length ? (
        <DataTable head={['Team', 'n', 'To seen', 'To reply']} rows={consultRows} />
      ) : (
        <EmptyNote>Enter consulted, seen, and replied times under each team to see this.</EmptyNote>
      )}
    </DashSection>
  )

  const investigations = (
    <DashSection title="Investigation turnaround, median from order" icon={<Activity size={18} />}>
      {investigationRows.length ? (
        <DataTable head={['Test', 'n', 'To done', 'To result']} rows={investigationRows} />
      ) : (
        <EmptyNote>Enter investigation times under a case to see this.</EmptyNote>
      )}
    </DashSection>
  )

  const admissionChain = (
    <DashSection title="Admission chain, median" icon={<ClipboardList size={18} />}>
      {admission.n ? (
        <DataTable
          head={['Step', 'Hours']}
          rows={[
            {
              key: 'order',
              cells: ['Order written to bed assigned', <Median key="v" value={admission.orderToBed} n={admission.n} />],
            },
            {
              key: 'request',
              cells: ['Bed requested to bed assigned', <Median key="v" value={admission.requestToBed} n={admission.n} />],
            },
            {
              key: 'bed',
              cells: ['Bed assigned to left ED', <Median key="v" value={admission.bedToLeave} n={admission.n} />],
            },
          ]}
        />
      ) : (
        <EmptyNote>Enter admission times under a case to see this.</EmptyNote>
      )}
    </DashSection>
  )

  const longest = <LongestStays kpi={kpi} range={range} filter={filter} />
  const actions = <ActionsDocumented kpi={kpi} range={range} filter={filter} />

  const byShift =
    shiftRows.length > 0 ? (
      <DashSection title="By shift" icon={<History size={18} />}>
        <DataTable head={['Shift', 'Cases', 'Median stay']} rows={shiftRows} />
      </DashSection>
    ) : null

  const byWeekday =
    data.byWeekday.length > 1 ? (
      <BarSection
        title="By day of week"
        icon={<BarChart3 size={18} />}
        rows={hbarRows(data.byWeekday, range, 'weekday', filter)}
        color="muted"
      />
    ) : null
  const arrivals = <ArrivalsSection arrivals={data.arrivals} range={range} filter={filter} />

  const outcomes = <OutcomesSection kpi={kpi} range={range} filter={filter} />
  const communication = <DischargeCommunication kpi={kpi} range={range} filter={filter} />
  const byCtas = <ByCtasSection kpi={kpi} range={range} filter={filter} />
  const byArea = <ByAreaSection kpi={kpi} range={range} filter={filter} />
  const byPayer = <ByPayerSection kpi={kpi} range={range} filter={filter} />
  const repeats = <RepeatVisits kpi={kpi} range={range} filter={filter} />
  const documentation = <DocumentationSection kpi={kpi} range={range} filter={filter} />

  const otherQueue = (
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
  )

  // Paper: one column, in the order the report has always printed — the deck's opening four
  // first, then the rest as the screen listed them before Phase 11 — with the arrivals table
  // beside the other "when" sections, after "By day of week".
  if (!screen) {
    return (
      <>
        <HeadlineTiles kpi={kpi} range={range} filter={filter} />
        {stayBands}
        {adaa}
        {targets}
        {whereTime}
        {thresholds}
        {data.inRange === 0 ? (
          empty
        ) : (
          <>
            {trend}
            {primary}
            {pathways}
            {departments}
            {admissionToUnit}
            {turnaround}
            {examToConsult}
            {consulted}
            {investigations}
            {admissionChain}
            {longest}
            {actions}
            {byShift}
            {byWeekday}
            {arrivals}
            {outcomes}
            {communication}
            {byCtas}
            {byArea}
            {byPayer}
            {repeats}
            {documentation}
            {otherQueue}
          </>
        )}
      </>
    )
  }

  // The screen: the sections in seven groups, each the target of a jump chip on the phone, the
  // wide sections across both columns from `lg` and the short ones paired under them.
  return (
    <>
      <Group id="overview">
        <HeadlineTiles kpi={kpi} range={range} filter={filter} />
        {thresholds}
        <Pairs>{data.inRange > 0 ? stayBands : null}</Pairs>
      </Group>
      {data.inRange === 0 ? (
        empty
      ) : (
        <>
          <Group id="time">
            {whereTime}
            <Pairs>
              {trend}
              {arrivals}
              {byShift}
              {byWeekday}
            </Pairs>
          </Group>
          <Group id="reasons">
            <Pairs>
              {primary}
              {pathways}
              {departments}
            </Pairs>
          </Group>
          <Group id="kpis">
            {adaa}
            <Pairs>
              {targets}
              {admissionToUnit}
            </Pairs>
          </Group>
          <Group id="teams">
            <Pairs>
              {turnaround}
              {examToConsult}
              {consulted}
              {investigations}
              {admissionChain}
            </Pairs>
          </Group>
          <Group id="outcomes">
            {longest}
            <Pairs>
              {actions}
              {outcomes}
              {communication}
              {byCtas}
              {byArea}
              {byPayer}
              {repeats}
            </Pairs>
          </Group>
          <Group id="quality">
            <Pairs>
              {documentation}
              {otherQueue}
            </Pairs>
          </Group>
        </>
      )}
    </>
  )
}

/**
 * The screen's section groups (Phase 11, item 5), in page order: the jump chips link to them, and
 * each wraps its sections so the chip lands on the first. The ids are the anchors.
 */
export const DASHBOARD_GROUPS = [
  { id: 'overview', label: 'Overview' },
  { id: 'time', label: 'Time' },
  { id: 'reasons', label: 'Reasons' },
  { id: 'kpis', label: 'KPIs' },
  { id: 'teams', label: 'Teams' },
  { id: 'outcomes', label: 'Outcomes' },
  { id: 'quality', label: 'Quality' },
] as const

function Group({ id, children }: { id: (typeof DASHBOARD_GROUPS)[number]['id']; children: ReactNode }) {
  // A little air above the first section when a chip scrolls to it.
  return (
    <div id={`dash-${id}`} data-dash-group={id} className="scroll-mt-3">
      {children}
    </div>
  )
}

/**
 * The short sections of a group, two to a row from `lg`. A section with nothing to show renders
 * nothing, so which one ends up alone on the last row depends on the data: whichever it is spans
 * both columns rather than leaving half a row empty, and its tables keep a short section's width
 * so their numbers stay near their labels. Paper takes the grid away (`.dash-pairs` in
 * app/globals.css), so a printed page is one column whatever the window was.
 */
function Pairs({ children }: { children: ReactNode }) {
  return (
    <div className="dash-pairs lg:grid lg:grid-cols-2 lg:gap-x-2.5 lg:[&>:last-child:nth-child(odd)]:col-span-2 lg:[&>:last-child:nth-child(odd)_table]:max-w-2xl">
      {children}
    </div>
  )
}
