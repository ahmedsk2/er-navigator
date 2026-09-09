# Design assets: what to download from Envato Elements and how they are used

Reviewed 2026-09-08 against the Elements catalogue (admin templates, UX/UI kits). The brief comes from the locked plan section 5: the template supplies visual language only (colour, type, spacing, radius, elevation); the prototype's information design is kept as is.

## Download these

| # | Item | Author | Format to download | Link |
| --- | --- | --- | --- | --- |
| 1 | Tailwick, 15-in-1 Tailwind CSS Admin & Dashboard | themesdesign | Next.js 15 + TypeScript variant, plus the Figma file | https://elements.envato.com/tailwick-15-in-1-tailwind-css-admin-dashboard-8UZCM3G |
| 2 | LuminaHealth Hospital Management Dashboard UI Kit | CreateBigSupply | Figma | https://elements.envato.com/luminahealth-hospital-management-dashboard-ui-kit-9D5ZWGL |
| 3 | MedAxis, Clinic Management Dashboard UI Kit | Vktr Supply | Figma | https://elements.envato.com/medaxis-clinic-management-dashboard-ui-kit-BZ9NTYS |

Optional fallbacks: Vristo (Next.js/Tailwind admin, https://elements.envato.com/vristo-tailwind-reactjs-nextjs-admin-template-TNR7P9L) if Tailwick's Next.js variant disappoints; Hospenta Healthcare Mobile App UI Kit (https://elements.envato.com/hospenta-healthcare-mobile-app-ui-kit-LMXN9HM) for phone-form spacing.

Received 9 September and unzipped under `C:\Users\ahmed\Documents\Navigators\design-template\` (tailwick/, vristo/, luminahealth/, medaxis/, hospenta/). They are licensed files: they never go into this repository.

## Why these and not the others

- Tailwick is the only widely used admin kit on Elements that ships Tailwind 4, TypeScript, a Next.js variant, RTL and Figma in one package. That covers Phase 0 (tokens), Phase 3/4 (table and chart patterns) and Phase 8 (Arabic RTL).
- LuminaHealth is the closest subject match: emergency alerts, patient flow, bed occupancy, department analytics, with global colour and text styles defined in Figma.
- MedAxis is deliberately minimalist and uses open-source fonts. It shows the quiet version of every component and keeps the extraction honest.
- Hospital-specific templates in Angular, PHP or Bootstrap React were rejected: wrong stack, and their content would be discarded anyway. Fonts, icons and charts are better sourced free: Inter or IBM Plex Sans (Google Fonts, tabular figures), Lucide icons (MIT), Recharts (already in the prototype).

## Extraction procedure (Phase 0.3)

1. Open the Figma files. Record in `design/tokens.md`: neutral scale (7 to 9 steps), accent and accent-soft, semantic success/warning/danger, text ramp (size, weight, line height for display, heading, body, small, caption), spacing scale, radii (field, button, chip, card), elevation (two levels at most).
2. Translate into `app/globals.css` `@theme` variables. Keep the token names already used by the scaffold (`--color-bg`, `--color-panel`, `--color-ink`, `--color-line`, `--color-muted`, `--color-accent`, `--color-accent-soft`, `--radius-*`).
3. The five threshold colours (`--color-band-ok/h4/h6/h12/h24`) are information design. Keep the prototype's values unless the template's semantic colours pass the contrast test and remain distinguishable from one another; write the decision down. One change is already recorded: the prototype's amber (`#C98A1B`, 2.9:1) is replaced by `#B8790F` for the band and `#8A5E0E` (`--color-band-h4-ink`) wherever amber is text (the clock, the staleness line, the threshold table). `tests/unit/tokens.test.ts` fails the build if a text token drops below 4.5:1 or a band below 3:1 on either ground, so the template session cannot regress it silently.
4. Choose the font: Inter or IBM Plex Sans, loaded through `next/font/google` with `font-feature-settings: "tnum"` on `.num`.
5. Screenshot the holding page at 390 x 844 and 1280 x 800 before and after with `node scripts/screenshots.mjs <label> <url> home`; the script waits for the h1 and refuses blank captures. Commit both under `design/screens/`.

## Rules that do not change

- Left threshold band on rows, tabular numerals for all times, no all-caps labels, no decorative cards, the elapsed clock is the one memorable element.
- Touch targets at least 44 px; body text at least 15 px on mobile; contrast AA.
- Nothing from a template's content, copy, logos or component names enters the codebase.

## Extraction result (Phase 0.3, 2026-09-09)

Done. The decisions, with the template each value came from, are in `design/tokens.md`; the values are in `app/globals.css`; the font is IBM Plex Sans self-hosted through `next/font` (tabular figures, an Arabic companion face for Phase 8, no runtime fetch). The prototype's information design is unchanged. Before/after screenshots: `design/screens/phase0-*` and `design/screens/tokens-*`.
