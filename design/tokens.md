# Design tokens (Phase 0.3, extracted 2026-09-09)

Sources read: Tailwick v2.2.0 (`HTML/src/assets/css/themes.css`, Tailwind 4 `@theme`; Figma), LuminaHealth Hospital Management Dashboard (Figma render 2880 x 2048, font note), MedAxis Clinic Management Dashboard (Figma thumbnail, font readme), Vristo (Next.js source), Hospenta (Figma thumbnail). The prototype (`docs/reference/ERNavigatorTracker.jsx`, `const C`) stays the reference for information design.

Only tokens and layout patterns were taken. No content, copy, logos, illustrations or component names from any template enter the codebase.

## What the templates agree on

- A near-white ground with white panels separated by a 1 px hairline, not by shadow. Tailwick: body `zinc-50`, card white; LuminaHealth: `#F5F7F8` ground, white cards, `#E6EAEE` hairlines; MedAxis: the same with a dark navy sidebar (desktop only).
- One saturated accent used sparingly: buttons, the active nav item, links. Tailwick blue-500, LuminaHealth teal `#14B8A6`, MedAxis indigo. Semantic colours are separate from the accent and appear as soft tinted pills (LuminaHealth priority chips: tinted background, coloured text and dot).
- Neutral text in three weights: ink for values, mid-grey for labels, light grey for captions. Uppercase only for tiny section eyebrows with letter-spacing (LuminaHealth "STAFF ON DUTY"); the prototype's rule is no all-caps labels, so eyebrows are the single permitted exception and only in the dashboard.
- Radii: 12 to 16 px on cards, 8 px on fields, 10 px on buttons, pills for status chips. Tailwick keeps Tailwind's default radius scale; LuminaHealth is rounder (16 px cards, 24 px chips).
- Elevation: one soft shadow for floating elements only (the FAB, dropdowns); cards rely on the hairline.
- Type: a single humanist sans for everything. Tailwick DM Sans; LuminaHealth Plus Jakarta Sans (headings) + Satoshi (body); MedAxis a Google sans. Headings 600 to 700, body 400, labels 500. Line-height 1.1 on display sizes (Tailwick), about 1.45 on body.
- Density: 16 px section padding, 12 px row padding, 8 px gaps inside rows, 14 to 15 px body on mobile.

## Decisions for ER Navigator

| Token | Value | From | Note |
| --- | --- | --- | --- |
| `--color-bg` | `#f5f7f6` | LuminaHealth ground, hue-shifted toward the accent | prototype `#f5f7f5`; a touch cooler to sit with the teal |
| `--color-panel` | `#ffffff` | all three | |
| `--color-ink` | `#16243b` | prototype | 13.9:1 on white |
| `--color-ink-2` | `#33415a` | new, between ink and muted | secondary values (reg time on rows) |
| `--color-muted` | `#5b6673` | prototype | labels, 5.4:1 on bg |
| `--color-line` | `#d9dfdb` | prototype `#d6dcd7`, lifted 1 step | hairlines |
| `--color-line-soft` | `#e8ede9` | new | row separators inside lists |
| `--color-accent` | `#1f7a8c` | prototype (deeper than LuminaHealth teal) | 4.97:1 on white, passes as text |
| `--color-accent-ink` | `#155d6b` | new | accent used as small text or on the soft tint |
| `--color-accent-soft` | `#e3f1f4` | prototype | selected chip ring, soft badges |
| `--color-band-none` | `#d9dfdb` | prototype `C.line` | no-data band, equals line |
| `--color-band-ok` | `#2e7d5b` | prototype | 5.0:1 |
| `--color-band-h4` | `#b8790f` | replaced (Section 1 of the plan) | 3.6:1 band; text uses the ink variant |
| `--color-band-h4-ink` | `#8a5e0e` | new | 5.7:1 |
| `--color-band-h6` | `#b93a2e` | prototype | 5.7:1 |
| `--color-band-h12` | `#6b2058` | prototype | 10.6:1 |
| `--color-band-h24` | `#16243b` | prototype | ink |
| `--color-danger` | `#b93a2e` | = band-h6 | destructive buttons |
| `--font-sans` | IBM Plex Sans, self-hosted through `next/font` | chosen over DM Sans and Plus Jakarta Sans | tabular figures (`tnum`) for every time; IBM Plex Sans Arabic is the matching face for the Phase 8 RTL build; no runtime font fetch, so it works on the hospital network and under the `font-src 'self'` CSP |
| `--radius-field` | 8 px | Tailwick fields, prototype | |
| `--radius-button` | 10 px | prototype | |
| `--radius-card` | 12 px | Tailwick cards (LuminaHealth 16 px felt soft for a dense board) | dashboard tiles only; sections are full-bleed with hairlines, as in the prototype |
| `--radius-chip` | 999 px | all | |
| `--shadow-float` | `0 6px 16px rgb(22 36 59 / 0.25)` | prototype FAB | FAB and menus only |
| `--shadow-panel` | `0 1px 2px rgb(22 36 59 / 0.06)` | LuminaHealth cards | dashboard tiles only |

Type ramp (mobile first; desktop identical, more columns not larger type):

| Role | Size / weight / line-height | Where |
| --- | --- | --- |
| clock | 26 px / 700 / 1.1, tabular | the elapsed clock in the editor header |
| row clock | 20 px / 700 / 1.1, tabular | elapsed time on board rows |
| title | 22 px / 700 / 1.15 | page titles (Board, Dashboard) |
| section | 15 px / 700 / 1.2 | section headings in the editor |
| body | 15 px / 400 / 1.45 | row text, chip labels 14 px |
| label | 13 px / 500 / 1.3, muted | field labels |
| caption | 12 px / 400 / 1.3, muted | timestamps, helper text, tabular where numeric |
| input | 16 px / 400 | inputs stay 16 px so iOS does not zoom |

Spacing: 4 px base. Section padding 16 px; row padding 12 px 14 px 12 px 0 with the 6 px band flush left; chip padding 8 px 12 px; 44 px minimum tap height on chips, rows and buttons.

## Kept from the prototype on purpose

Left threshold band on rows; tabular numerals for all times; no all-caps labels outside dashboard eyebrows; no decorative cards on the board or in the editor; the elapsed clock as the one memorable element; the bottom tab bar and the floating New case button.

## Not adopted

Sidebars (desktop admin only, Phase 6, and then as a plain list); Tailwick's blue primary and violet secondary; LuminaHealth's coloured avatars; any dark theme in v1; illustration, marketing hero blocks, KPI tiles with sparklines on the board (the dashboard has three plain tiles, as the prototype does).
