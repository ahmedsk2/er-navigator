# Phase 9: the visual refresh

Ahmed's decision (10 September): sign-in direction **A** (teal hero and white sheet; the desktop
split with the band colours as the picture) and **yes** to the app chrome (coloured header with
the mark and the user's initials, tab bar with icons on the phone, a left rail and full-width rows
on desktop, rows as cards with the elapsed time in a band-coloured pill, tinted icon tiles on the
dashboard). Proposal page: `scratchpad/er-navigator-visual-refresh.html` (published for Ahmed).

Nothing about the workflow, the taxonomy, the fields, the copy or the routes changes. This phase
is the visual layer only, and the existing Playwright suite is the proof that nothing moved: every
role, accessible name, `data-*` hook and class hook it selects on stays exactly as it is (the list
is in "Contracts that stay" below). A slice that needs a selector changed says so in its report,
with the reason; it does not quietly rewrite a test.

Rules for every slice: the hard rules in `CLAUDE.md`; no patient identifier beyond the MRN; no new
runtime dependency (the icon set is copied in, see "Identity kit"; `sharp` may be added as a
devDependency pinned to the version already in `pnpm-lock.yaml`, for the icon script only); no
inline `<script>`, no external stylesheet or font (the CSP and `headers.spec.ts` pin
`font-src 'self'`); every colour stays a 6-digit hex token inside the one `@theme` block of
`app/globals.css` (`tests/unit/tokens.test.ts` regex-parses it); text on a coloured surface keeps
4.5:1 (use the `-ink` variants for text, never `band-h4` or `accent` on white for small text);
44 px tap targets (`min-h-11`); inputs stay 16 px (`--text-input`); tests first where a test can
express the behaviour; `pnpm typecheck`, `pnpm lint`, `pnpm test` (dev database) and the relevant
Playwright specs green before handing back; do not edit `docs/CHANGELOG.md`, `docs/PLAN.md` or
`docs/RUNBOOK.md` (the lead writes those from your report); commit format `[ERN-P9.{n}] imperative
summary`.

Sequence: the lead's identity kit first (P9.1); Slices 9A (sign-in and holding screens) and 9B
(shell) in parallel on top of it; Slice 9C (surfaces) after 9B has merged, because both touch the
board.

## Identity kit (lead, P9.1)

- `src/components/brand/Mark.tsx`: `Mark({ size?, tone?: 'onTeal' | 'onWhite' | 'teal', className? })`,
  the heart-and-trace mark as inline SVG (24 × 24 viewBox, `aria-hidden`), and
  `Wordmark({ tone, size?: 'sm' | 'md' | 'lg', as?: 'h1' | 'span' })` = mark + "ER Navigator" in
  one flex row. `as="h1"` is for the two places that own the page's "ER Navigator" heading (the
  shell header and the login hero); everywhere else the text is a `<span>`, so tests that select
  the heading by that name find exactly one per page.
- `src/components/icons.tsx`: `Icon` components, 24 × 24, `stroke="currentColor"`,
  `stroke-width 2`, round caps, `aria-hidden` by default: `LayoutList` (Board), `BarChart3`
  (Dashboard), `ClipboardList` (Handover), `FileText` (Report), `Download` (Export), `Settings`
  (Admin), `Search`, `Eye`, `EyeOff`, `Plus`, `ChevronLeft`, `MoreHorizontal`, `Printer`,
  `LogOut`, `User`, `Users`, `ListChecks`, `Bell`, `History`, `Activity`, `Clock`, `AlertTriangle`,
  `Check`, `X`. Paths copied from Lucide (ISC licence; the file header carries the notice and the
  version). No dependency.
- `app/globals.css` `@theme`, appended as hex lines: `--color-navy: #10202f` (the desktop rail),
  `--color-accent-deep: #0f4d5c` (the dark end of the hero gradient), `--color-rail-ink: #cfe0e6`
  (rail text, 10.9:1 on navy), `--color-rail-active: #5fc3d3` (active rail icon, decorative);
  shadows `--shadow-card: 0 2px 8px rgb(16 36 59 / 0.05)` and `--shadow-sheet: 0 -10px 30px rgb(15 77 92 / 0.18)`;
  radius `--radius-sheet: 28px`. Below `@theme`, two utility classes: `.bg-hero` (the teal → deep
  gradient, `linear-gradient(160deg, var(--color-accent) 0%, var(--color-accent-ink) 55%, var(--color-accent-deep) 100%)`)
  and `.bg-header` (`linear-gradient(135deg, var(--color-accent), var(--color-accent-ink))`).
  `design/tokens.md` gains the new rows with their contrast figures and a "Phase 9" section on
  the mark, the icon set and the rail.
- `src/components/bands.ts`: the one Band → class map, `BAND_BG`, `BAND_TEXT` (values exactly as
  `BoardRowItem.tsx` has them today, `none: 'text-muted'`), and the new `BAND_PILL` (background
  and white text for the elapsed-time pill: `ok: 'bg-band-ok text-white'`,
  `h4: 'bg-band-h4-ink text-white'` (band-h4 itself is 3.6:1, too light for text),
  `h6: 'bg-band-h6 text-white'`, `h12: 'bg-band-h12 text-white'`, `h24: 'bg-band-h24 text-white'`,
  `none: 'bg-line-soft text-muted'`). `BoardRowItem.tsx`, `dashboard/parts.tsx` and
  `CaseEditor.tsx` import from it instead of holding their own copies (the editor's
  `none: 'text-band-none'` becomes `text-muted` like the other two; nothing selects on it).
- Unit tests: `src/components/__tests__/bands.test.ts` (every Band has all three classes; every
  pill background is a token whose contrast with white is ≥ 4.5:1, computed from `@theme` the way
  `tokens.test.ts` does), `tokens.test.ts` extended with the new text token (`rail-ink` on
  `navy` ≥ 4.5:1).

## Slice 9A (Opus agent): sign-in and the holding screens

`app/login/page.tsx` and `app/login/login-form.tsx`, direction A:

- Phone (below `lg`): a hero of `min-h-[300px]`, about 40 % of the viewport, `.bg-hero`, white
  text, the ECG polyline as an absolutely positioned inline SVG at 28 % opacity, the `Wordmark`
  (tone `onTeal`) top-left, the line "Every long stay, seen in time." as a `<p>` (not a heading)
  and under it "Qatif Central Hospital · Emergency Department" (this line moves out of the form
  and into the hero; keep it as a `<p>`). Below the hero, the sheet: a white panel with
  `rounded-t-[var(--radius-sheet)]`, `shadow-sheet`, overlapping the hero by 28 px. The page's one heading is the
  hero wordmark: `<Wordmark as="h1" tone="onTeal">` renders `<h1>ER Navigator</h1>` there (smoke
  and auth specs select the heading by that name and need exactly one, visible); the sheet's
  title is `<p class="text-title">Sign in</p>`. Then the fields exactly as they are: `<label for="username">Username</label>`, `<label for="password">Password</label>`, ids
  `#username` / `#password`, names `username` / `password` / `remember` / `next`, the checkbox
  "Remember this device", the submit button "Sign in", the error `<p role="alert">` with the
  same four messages, the `role="status"` session-ended notice with `data-session-ended`, and
  the footnote "Hospital accounts only. Ask the ER Navigator lead for access." A password
  visibility toggle is allowed: a `<button type="button" aria-label="Show password">` /
  `"Hide password"` with the `Eye` / `EyeOff` icon inside the field, `aria-pressed`; it must not
  carry the visible text "Password" (the tests use `getByLabel('Password', { exact: true })`).
- Desktop (`lg` and up): a two-column grid `lg:grid-cols-[46%_54%]`, `min-h-dvh`. Left: `.bg-hero`,
  the `Wordmark`, the headline, the purpose line ("The ED navigators' board for patients whose
  stay is running long: who is waiting, on what, and for how long."), and the four band bars as
  the illustration (labels "under 4 h", "4 h and over", "6 h and over", "12 h and over"; bars in
  the band tints lightened for the teal ground: use the `band-ok`, a lightened h4 (`#e0a23a`),
  h6 (`#e0645a`) and h12 (`#b56aa6`) as literal fills on the SVG rects, decorative, `aria-hidden`;
  these four hexes are the only literals allowed and they live in one `const` with a comment),
  the hospital line at the bottom. Right: the ground `bg-bg`, the form in a card
  (`max-w-[400px] rounded-card border border-line bg-panel shadow-card p-8`) centred.
- `app/error.tsx`, `app/not-found.tsx`, `app/forbidden.tsx`, `app/global-error.tsx`: the same
  headings and copy as today (tests select "Not allowed", "Something went wrong" and the
  buttons), presented as the sheet: a slim `.bg-header` band with the `Wordmark` above a white
  card. `global-error.tsx` keeps inline styles (no Tailwind is guaranteed there) and mirrors the
  new hexes by hand, with the comment it already has.
- `app/(app)/account/page.tsx`: unchanged content and headings; wrap the `<dl>` and the
  "Change password" section in cards (`rounded-card border border-line bg-panel shadow-card`).
- PWA icons: `scripts/generate-icons.mjs` is rewritten to rasterise the mark with `sharp`
  (devDependency, pinned to the lockfile's version): the mark in white on a rounded square of
  `--color-accent` for `icon-192.png`, `icon-512.png` (with the maskable safe zone respected: the
  mark within the inner 80 %), `apple-touch-icon.png` 180 × 180, and `favicon.ico` as the existing
  32 px PNG-in-ICO packing. `app/manifest.ts` unchanged (`theme_color`, `background_color`,
  names are pinned). Commit the PNGs. `pnpm lint` must still pass on the script.
- Tests: `tests/e2e/auth.spec.ts` unchanged and green; add to it (or to `smoke.spec.ts`) a check
  at both viewports that `[data-login-hero]` is visible and that on desktop the form card sits in
  the right half (`boundingBox().x > 600`); `pwa.spec.ts` green; `headers.spec.ts` green (no
  inline style attribute on the login page other than what Tailwind emits: use classes, not
  `style=`; the ECG SVG's `stroke` etc. are attributes, fine). Screenshots: `phase9-login` at both
  viewports via the screenshot script, plus `phase9-forbidden` desktop.

## Slice 9B (Opus agent): the shell

`app/(app)/layout.tsx`, `src/components/shell/*`, `app/(app)/admin/layout.tsx`, `app/(app)/admin/nav.tsx`:

- One navigation, two shapes. `TabBar.tsx` keeps its export name and props
  (`TabBar({ showExport, showAdmin })`) and its DOM contract: `<nav aria-label="Sections">` with
  `<ul>` of links named exactly "Board", "Dashboard", "Export", "Admin", `aria-current="page"` on
  the active one, `.no-print`. It gains an icon before each label (`LayoutList`, `BarChart3`,
  `Download`, `Settings`, `aria-hidden`) and, on `lg` and up, renders as the left rail: the same
  element positioned `lg:static lg:h-dvh lg:w-[232px] lg:flex-col lg:border-r lg:border-t-0
  lg:bg-navy lg:text-rail-ink` (sticky within the grid), the `Wordmark` (tone `onTeal`, on the
  navy) at the top of the rail on desktop only (`hidden lg:flex`), the links stacked with the
  active one on `bg-white/10 text-white` and its icon `text-rail-active`, and at the bottom a
  non-interactive user block (initials circle, display name, role label) — `TabBar` gains the
  optional props `displayName` and `roleLabel` for it. On the phone: `fixed bottom-0`, height
  `min-h-16`, icon above label, the active tab `text-accent-ink`, others `text-muted`. Because the
  height grows from 56 to 64 px, `main` becomes `pb-32` and the FAB wrapper `pb-[76px]`; both in
  the same commit.
- The shell container: `mx-auto flex min-h-dvh max-w-md flex-col` stays for the phone; on `lg`:
  `lg:grid lg:max-w-none lg:grid-cols-[232px_minmax(0,1fr)]` with the nav in the first column
  and a content column that keeps its own `mx-auto w-full max-w-[1200px] px-6`. The
  `has-[[data-wide]]:max-w-[1200px]` rule stays for the phone-width admin case. `print:max-w-none`
  stays. The header (`.no-print`) becomes `.bg-header text-white`: the `Mark` (tone `onTeal`) and
  the `<h1 class="text-section tracking-tight">ER Navigator</h1>` (text unchanged) on the left;
  on the right the `OverflowMenu` trigger, which keeps `aria-label="Menu"`, `aria-haspopup="menu"`,
  `aria-expanded`, but shows the user's initials in a 36 px circle (`bg-white/20 text-white
  font-semibold`) instead of "⋯" (`OverflowMenu` gains a `displayName`-derived `initials` prop or
  computes it: first letters of the first two words, upper-cased). The menu itself keeps
  `role="menu"`, the three items with their exact names, the `logout` form action; it gains the
  `User`, `Printer` and `LogOut` icons (`aria-hidden`).
- `NewCaseFab.tsx`: the `Plus` icon before the text; the accessible name stays exactly
  "+ New case" (keep the literal text; the icon is `aria-hidden`). On desktop it stays a floating
  button at the bottom right of the content column (`lg:right-8`).
- Page headers: a `PageHeader({ title, subtitle?, children? })` component in `src/components/shell/PageHeader.tsx`
  renders the `<h2 class="text-title">` (the pages pass their exact titles: "ER board",
  "Dashboard", "Export and print", "Your account", "Administration") with the subtitle slot and a
  right-hand actions slot, `px-4 pt-4 pb-2.5` on the phone, `lg:flex lg:items-end lg:justify-between lg:px-0 lg:pt-6`
  on desktop. Adopt it in `Board.tsx`, `DashboardView.tsx`, `ExportPanel.tsx`, the account page
  and the admin layout; the heading text, level and the `[data-subtitle]` / freshness / counters
  elements move inside it unchanged.
- `AdminNav`: keep `nav aria-label="Administration sections"`, the link names and
  `aria-current`; style the chips like the filter chips (soft tint inactive, accent active) and
  add the `Users`, `ListChecks`, `History`, `Bell`, `History` icons where they fit.
- `InstallPrompt`: untouched (its position below the list and its attributes are pinned).
- Print: the header, nav, FAB keep `.no-print`; verify the handover sheet still prints from the
  board (`board.spec.ts` print test).
- Tests: every existing spec green at both viewports. Add to `tests/e2e/board.spec.ts` or a new
  `tests/e2e/shell.spec.ts`: on desktop the "Sections" navigation's bounding box has `x < 240`
  and `height > 400` (it is the rail) and the content is wider than 448 px (`a[data-mrn]` first
  row `boundingBox().width > 700`); on mobile the navigation sits at the bottom
  (`y > 700`). The phase 3 and phase 6 screenshot specs are re-run and their PNGs refreshed.

## Slice 9C (Opus agent): surfaces

After 9B merges. `src/components/board/*`, `src/components/dashboard/parts.tsx` and `sections.tsx`,
`src/components/ui/index.tsx`, `src/components/cases/CaseEditor.tsx` (styling only),
`src/components/export/ExportPanel.tsx`:

- Board rows (`BoardRowItem.tsx`): the `<li><a data-mrn data-band href>` contract and every text
  stay (MRN, "reg …", the reason line, "No update for …" / "Updated … ago", the resolved line,
  the clock "Nh MMm" with its sr-only sentence, the `[data-chip]` identity chips). Phone: the row
  becomes a card (`mx-3 my-2 rounded-card border border-line-soft bg-panel shadow-card p-3.5`),
  the band stripe becomes the elapsed-time pill: the clock span gets `BAND_PILL[band]` with
  `rounded-button px-2.5 py-1.5 text-rowclock`; the stripe span is removed. Desktop (`lg`): the
  same `<a>` becomes a five-column grid `lg:grid lg:grid-cols-[110px_120px_minmax(0,1fr)_180px_110px]
  lg:items-center` (MRN · registered · reason line · last update · pill, right-aligned), and
  `Board.tsx` renders above the list, desktop only (`hidden lg:grid`, `aria-hidden`), a label row
  "MRN · Registered · Waiting on · Last update · Elapsed" in `text-caption text-muted`. The
  handover sheet (`.print-only`) and the drill-down list (which reuses `BoardRowItem`) inherit
  the card look; the print sheet is unchanged.
- Board header (`Board.tsx`): the counters line keeps its exact text and element (the test
  matches the sentence), but its three figures get weight through inner spans: "{n} open" in
  `text-ink font-semibold`, "{n} past 6h" in `text-band-h6 font-semibold`, "{n} past 12h" in
  `text-band-h12 font-semibold`; the separators stay in the same `<p>` as plain text. The search
  box uses the `ui` `Input` styling with the `Search` icon inside (the sr-only label "Search MRN"
  and `type="search"`, `id="board-search"` stay); the filter chips keep
  `role="group" aria-label="Filter"` and the three links, styled as the soft-tint chip set
  (active `bg-accent text-white`, inactive `bg-panel border-line text-ink-2`).
- Dashboard (`parts.tsx`): `DashSection` keeps `<section>` > `<h3>` as the first child with the
  table or chart as the h3's sibling (tests use `xpath=../table` and `.dash h3` order); it gains
  an optional `icon` prop rendered inside the `<h3>` before the text (`aria-hidden`; the heading's
  accessible name is unchanged because the SVG has no text). Cards: `rounded-card border
  border-line bg-panel shadow-card` instead of `border-y` (both viewports; on the phone keep
  `mx-3`). `Tile` gains a tinted icon square (28 px, `bg-accent-soft text-accent-ink`) and keeps
  `[data-tile]`, `[data-tile-note]`, the "Longest stay" number inside its `<a>`. `ShareBar`,
  `DataTable` tappable rows, `BarLinks`, the Recharts wrappers and `charts/theme.ts` untouched.
  `ReportView` gets the same section cards (it shares `DashboardBody`); `.dash .shadow-card`
  joins the print rules that strip shadows on paper.
- `ui/index.tsx`: `Section` gets the same card styling and the optional `icon`; `Chips` options
  keep `role="group"`, `aria-pressed`, names and the retired label, styled soft-tint (inactive
  `bg-panel border-line`, pressed `bg-accent-soft border-accent text-accent-ink`); `Button` main
  keeps `bg-accent`, quiet gets `bg-panel border-line`, danger unchanged. `ExportPanel`'s
  duplicated `DATE_INPUT` / `LINK_BASE` strings are replaced by the primitives (the risk the map
  found).
- `CaseEditor.tsx`: only the section header icon row (`Section icon=`) and the chip/button
  primitives above; no field, label, order or copy change. `[data-*]` hooks untouched.
- Tests: every spec green at both viewports; `tests/e2e/dashboard.spec.ts` heading-order and
  `xpath=../table` assertions prove the section structure held; the screenshot specs for phases
  2, 4, 5, 8 and 8b are re-run and the PNGs refreshed; the Lighthouse gate is re-run on `/`,
  `/cases/new` and `/cases/[id]` with the numbers recorded in `design/screens/phase9-lighthouse.json`
  (accessibility must stay ≥ 90 and performance ≥ 90).

## Contracts that stay (from the code map of 10 September)

- Headings selected by name without level: "ER Navigator" (shell h1 and login h1; exactly one per
  page), "ER board", "Dashboard", "Export and print", "Your account", "Change password",
  "Administration" (only in the admin layout, never in a page body), "Not allowed", "Not found",
  "Something went wrong", "New case", "Case {mrn}", "Timeline", "Resolved", every dashboard
  section title, every case editor section title.
- Navigation: `nav[aria-label="Sections"]` with links "Board" / "Dashboard" / "Export" / "Admin"
  and `aria-current="page"`; absent on `/cases/*` and `/report`. `button[aria-label="Menu"]`
  opening `role="menu"` with items "{displayName} · {roleLabel}", "Print handover", "Log out".
  Link "+ New case" → `/cases/new`, absent for VIEWER and on `/cases/*`, hidden in print.
- Board: `a[data-mrn][data-band]` rows and their texts; the counters sentence
  "{n} open · {n} past 6h · {n} past 12h" in one element; `[data-board-freshness]`; label
  "Search MRN"; `role="group" aria-label="Filter"` with "Open" / "Resolved" / "All" and
  `aria-current="true"`; the empty-state sentences; `section.print-only` handover with its h2 text.
- Dashboard and report: `.dash` wrapper; `section > h3` first child with the table as the h3's
  sibling; the exact section titles and their order; `[data-tile]`, `[data-subtitle]`,
  `[data-drill-label]`, the range chips in `role="group" aria-label="Date range"` with
  `aria-current="true"`; drill links named by row label; `svg[role="application"]` in the charts;
  `[data-report-header]`, `[data-report-range]`; the "Print" button.
- Sign-in: labels "Username" and "Password" (exact), ids `#username` / `#password`, button
  "Sign in", the four error strings, `?next=` and `?expired=1` behaviour, the cookie names.
- Tokens: every existing `--color-*` name and value unchanged; `theme_color #1f7a8c` and
  `background_color #f5f7f6` in the manifest and the viewport.
- CSP: no inline scripts, no `style=` attributes that need `unsafe-inline` beyond what exists
  (styles are allowed inline by the CSP today; keep to classes anyway), fonts self-hosted.
