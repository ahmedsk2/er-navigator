# Phase 11: what the hands-on demo found, and a dashboard that reads at a glance

Ahmed, 11 September: "perform a complete hands on demo starting by creating users till you finish
the full cycle for 5 patients with demo data … check how it goes from UI and UX point of view then
check how the dashboard looks like and maybe add to it graphs and figures if you think of anything
helpful". And: find a logo on Envato Elements.

## How the demo was run

On the exact production build (commit `c057fea`), against a fresh local database (compose project
`ernav-demo`, port 55450; the app on :3300), never production: demo users and five demo patients in
the live database would be permanent (the audit log is append-only and cases can only be voided).
A Playwright script drove every step as the users would, at 390 × 844 first and at 1280 × 800 for
the dashboard and the board, and saved each screen:

1. The admin creates the team: two navigators (Nadia Salem, Omar Faris), a charge nurse (Sara
   Nasser, SUPERVISOR) and the medical director (Dr Huda Khalid, VIEWER), each with an email.
2. Nadia signs in with the temporary password and sets her own at `/account`.
3. Nadia and Omar open five patients with invented MRNs (5100231–5100235) and real-looking times:
   a CTAS 2 NSTEMI waiting for a CCU bed; a CTAS 3 query appendicitis waiting on an ultrasound
   report and surgery; a CTAS 4 wrist fracture transferred out through RCC; an 81-year-old with
   query urosepsis past 24 hours waiting for a medical bed (with an "Other" reason); a CTAS 5
   laceration held up at registration and triage and referred to UCC.
4. The board at its busiest: five open cases in four bands, a row summary, the filter, the
   handover sheet in print preview.
5. Each case worked: journey times, consult and investigation times, admission or transfer steps,
   updates with action tags; the summary; resolved with a disposition, ward, discharge questions
   and a note.
6. Sara reviews three resolved cases, downloads the workbook and opens the printable report.
7. Dr Huda reads the dashboard on her phone and on her laptop, drills into a phase, opens a case
   read-only.

Every step passed. The script, its log (actions and seconds per step) and 35 screens are the
evidence behind every finding below.

## What the demo found

Ranked by what a nurse would feel first.

1. **Recorded times are unreadable on a phone.** `TimeRow` pins the input at 178 px beside its
   label; a `datetime-local` value does not fit, and Chromium clips the start: "0/2026 10:44 PM",
   "1/2026 12:02 AM". The day is the part that is cut, so around midnight a nurse cannot tell which
   day a time belongs to. Every time on the case page has this (journey, consult, investigation,
   admission, transfer, pain, case management).
2. **The case page is seven phone screens long**, and the Updates box, the thing a navigator does
   most, is near the bottom; so is Resolve.
3. **Opening a case: "Open case" is at the bottom of an eight-screen form** on a phone, under
   sections that mean nothing before the case exists.
4. **Four selects are named by their current value too.** A `<select>` inside the wrapping
   `<label>` of `Field` gets the accessible name "Shift Select", "Final disposition Select…" (the
   label's content includes the selected option). Shift, Primary reason, Final disposition, the
   export Format and the admin Lists "Stage" filter.
5. **"Change it at /account", but nothing says Account.** The admin panel tells a new user to
   change the temporary password at /account; the phone menu's only way there is a row that shows
   the user's name.
6. **The admin Users table is cut off on a phone** (the email box runs off the right edge; the
   role, active and reset controls are out of reach), and the "+ New case" button floats over the
   admin and account forms.
7. **The sign-in hero's ECG trace runs through the headline** ("seen in time." sits on the line).
8. **"Updated 0h 00m ago"** on a card updated seconds ago reads as a machine; on the printed
   handover sheet a relative time is wrong by the time the paper is read.
9. **The dashboard is 13 screens long on a phone and 13 on a laptop**, with no way to jump; on a
   1280 screen every section is one full-width column with the numbers 1,000 px from their labels;
   bar labels are cut at 22 characters ("No bed available on a…"); the headline's seven tiles leave
   an empty cell and the Range value wraps; "Where the time goes" lists every stage including the
   ones with no case, and its shares are drawn as 80-pixel bars at the end of table rows.
10. **The dashboard shows few pictures of the questions it answers.** How the stay splits, how the
    Adaa KPIs sit against their benchmark bands, how the last days went, and when the delayed
    patients arrive are each either a table or not shown.

What worked and should not change: signing in, the temporary password flow, the board's bands and
chips, the row summary, the filter, the handover sheet's content, the timeline, the summary sheet,
resolve, review, the export and the report. Actions per step are in the log: opening a case with
every Phase 10 field took 12 to 19 actions; working a case (all its times) 10 to 30.

## Slice 11A (Opus): the fixes a nurse would feel

Files: `src/components/ui/index.tsx` (TimeRow, Field), `src/components/cases/CaseEditor.tsx`,
`src/components/shell/*` (menu, FAB), `src/components/admin/UsersPanel.tsx`,
`src/components/admin/ListsPanel.tsx`, `src/components/export/ExportPanel.tsx`, the login page, the
board row's "Updated …" text and `HandoverSheet.tsx`. Not the dashboard.

- **TimeRow** (finding 1): below `sm` the label takes its own line and the input and "Now" share
  the line under it, the input filling the width; from `sm` the row stays side by side with an
  input wide enough for the whole value. Prove it at 390 × 844 in e2e: for every visible
  `datetime-local` on a worked case, the input's `scrollWidth <= clientWidth` (nothing clipped).
- **Case page navigation** (finding 2): a compact strip that sticks to the top of the case page on
  a phone (below `lg`), holding chips that jump to the sections: Delay, Teams (when shown), Tests
  (when shown), Times, Updates, Resolve. Sections get `scroll-margin-top` so a jump does not land
  under the strip. On a laptop the strip may stay (not sticky) or be omitted; do not move the
  existing header (Back, Summary, the clock). No section changes order.
- **New case** (finding 3): on `/cases/new` the "Open case" bar sticks to the bottom of the screen
  above the safe area, so a nurse can open the case the moment MRN, stage and reason are in; the
  sections stay where they are. The existing button's name stays "Open case".
- **Selects** (finding 4): `Field` already takes `htmlFor`; the five selects get an id (`useId`) and
  a `<label for>`, so each accessible name is exactly its label. Prove with exact `getByLabel`.
- **Account** (finding 5): the phone menu's account row says what it is: the name and role, and a
  second line "Account and password". The laptop rail's account entry says the same.
- **Admin Users on a phone** (finding 6): below `md` each user is a card (username, display name,
  the email box with its Save, the role select, active, Reset password); from `md` the table as
  now. Every existing `aria-label` (`Email for {username}`, `Role for {username}` …) is kept. The
  "+ New case" button is not shown on `/admin*` or `/account`.
- **Sign-in** (finding 7): the ECG trace sits below the headline block, never behind its text, at
  both widths.
- **"Just now"** (finding 8): under one minute the board card reads "Updated just now" (the
  "No update for …" warning is unchanged); the handover sheet's Last update column prints the
  clock time (dd/mm HH:mm, Asia/Riyadh) instead of a relative time.

## Slice 11B (Opus): the dashboard

Files: `src/lib/domain/{aggregates,kpi}.ts` and their tests (new pure functions only; no existing
figure changes), `src/lib/dashboard/drill.ts`, `src/components/dashboard/*` including new chart
components, `src/components/report/ReportView.tsx` only if a new section needs placing on paper.

Charts are drawn with what is installed (Recharts 3, or plain HTML/SVG where that reads and prints
better). Every colour is a token (`tests/unit/colour-literals.test.ts` and `tokens.test.ts` must
stay green); every chart has its numbers as visible text or an accessible table beside it; a
figure over fewer than 3 cases shows "n<3" exactly as elsewhere; charts do not animate under
`prefers-reduced-motion`.

1. **Adaa KPIs against their bands.** At the top of the Adaa panel, one bullet chart per KPI with a
   benchmark (`ADAA_BENCHMARKS`: KPI 1, 2, 3, 4, 5, 8): a track split into the four tiers — world
   class, acceptable, needs improvement, unacceptable — to scale, with a marker at the value and
   the value and its tier in words beside it; KPI 5 (higher is better) reads the same way round.
   Below 3 cases: the track, no marker, "n<3". The panel's table stays under it (paper, screen
   readers).
2. **The stay split.** At the top of "Where the time goes", one 100 % bar in three segments (front
   end, decision, after the decision) with each share and median as text, over the cases with all
   three measured; then the same bar for each outcome group with at least 3 such cases — Admitted,
   Discharged (home and DAMA), Transferred, Other outcomes — so "admitted patients spend most of
   their stay after the decision" is visible. A pure `phaseSplitByOutcome(cases)` in `kpi.ts`
   (built on `phaseSplit`) with hand-computed tests.
3. **The last days.** On the 7- and 30-day ranges, "By day: cases and median stay": one bar per
   Asia/Riyadh calendar day in the range (zero days included), the median stay as a line (a day
   under 3 cases shows no median), a reference line at 6 h. The weekly chart stays for 90 days and
   all time. A pure `byDay(cases, range, now)` in `aggregates.ts`; drill section `day`
   (`day:YYYY-MM-DD`), each bar and a link list reach it.
4. **When the delayed patients arrive.** "Arrivals by day and time": a real `<table>`, weekdays down,
   eight three-hour blocks across (00–03 … 21–24, Asia/Riyadh registration time), the count in each
   cell, the cell's fill stepped by count from the accent tokens (empty cells plain); a cell with
   cases links to them (drill section `arrival`, key `{weekday}|{block}`). A pure
   `arrivalGrid(cases)` in `aggregates.ts`.
5. **Layout.** On the screen from `lg`: a two-column grid of sections, the wide ones (headline,
   thresholds, where the time goes, Adaa, longest stays) across both columns, the short ones paired.
   On the phone: a row of jump chips under the range chips (Overview, Time, Reasons, KPIs, Teams,
   Outcomes, Quality) to anchors on the first section of each group. The printed report keeps its
   single column and its order; the chips are `no-print`.
6. **Bars with whole labels.** The horizontal bar sections (primary delay reason, pathways,
   departments, outcomes, day of week) show the full label — above the bar on a phone, wrapping
   rather than cut — and stay links to their drill-downs.
7. **Tidying.** The headline's Range tile spans two columns (no empty cell at 2 or 4 columns); in
   "Where the time goes" a stage with no case in the range is left out of its phase's list (a phase
   with none says so).

The dashboard spec's section-title order (`tests/e2e/dashboard.spec.ts`, read off `.dash h3`) is
updated for the new sections; every drill key that exists keeps its meaning; `dashboardHref`,
`parseDrill` and the filter carry to the new drill sections as they do to the old.

## Contracts that stay

- MRN only; no free text on any new surface beyond what already shows.
- `a[data-mrn][data-band]` one per board row; `[data-summary-for]`; the board spec's `/?f=` and
  `/?q=` serialisation; heading names the suites count.
- The Phase 10 filter narrows every new figure exactly as it narrows the old (the new aggregates
  take the already-filtered cases).
- No new runtime dependency. No change to the workflow, the taxonomy or any stored field.
- The whole chain green at both viewports; gate screenshots `phase11-*` for every changed screen.

## After the build

The demo is run again on a fresh database against the new build, and the before and after screens
go in the gate report beside the findings they answer.

## The logo (Envato Elements)

Six shortlisted from "medical heart logo", "heartbeat pulse logo", "emergency care cross logo",
"medical arrow direction logo", "ecg line medical logo" and "hospital pin location logo" (Logos):
Health Pulse (3ab2ou, a teal outlined cross with an ECG trace — recommended: it carries the
emergency department's two symbols, is already in the app's teal, and is drawn in the same 2 px
line style as the app's icons), Medical Cross Hospital (3ab2ou, a cross drawn as parallel paths),
Medical Map (shazidesigns, a pin with a cross), mediplus (muhisya, a navy cross of tiles), Fit
Heart (Luluwiz) and Heart Up (MightyFire_STD). Downloading needs Ahmed's Envato account; once the
files are in hand, the mark, the favicon, the PWA icons and the sign-in hero are rebuilt from it
(the icon script already exists), recoloured to the tokens. Envato's licence covers use in this
app; a logo from a template cannot be registered as a trademark.
