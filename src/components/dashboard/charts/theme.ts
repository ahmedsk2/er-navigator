/**
 * The design tokens the charts need as literal values.
 *
 * Recharts writes colours into SVG attributes from JavaScript, so it cannot read a Tailwind class
 * or a `var(--color-…)` the way the rest of the app does. These are therefore duplicates of the
 * `@theme` block in `app/globals.css` — and `__tests__/theme.test.ts` parses that file and fails
 * if any of them drifts, the same trick `src/lib/auth/__tests__/route-gate.test.ts` uses to keep
 * `proxy.ts` honest about the cookie name.
 *
 * `dataviz`: chart text (axis ticks, labels, legend) wears the text tokens — muted for chrome,
 * ink for category names — never the series colour.
 */
export const CHART = {
  /** Series colours. One per chart, except the weekly chart, whose two marks differ in form too. */
  accent: '#1f7a8c',
  accentSoft: '#e3f1f4',
  danger: '#b93a2e',
  ink: '#16243b',
  plum: '#6b2058',
  muted: '#5b6673',
  ok: '#2e7d5b',
  /** Chrome: hairline axes, and the surface a marker's ring is cut from. */
  line: '#d9dfdb',
  panel: '#ffffff',
} as const

/** The token name in app/globals.css each entry above copies. Read by the drift test. */
export const CHART_TOKEN_NAMES = {
  accent: 'color-accent',
  accentSoft: 'color-accent-soft',
  danger: 'color-danger',
  ink: 'color-ink',
  plum: 'color-band-h12',
  muted: 'color-muted',
  ok: 'color-band-ok',
  line: 'color-line',
  panel: 'color-panel',
} as const satisfies Record<keyof typeof CHART, string>

/** Axis and label type: 11 px, the caption size, from the Phase 0.3 ramp. */
export const CHART_TICK = { fontSize: 11, fill: CHART.muted } as const
export const CHART_CATEGORY_TICK = { fontSize: 11, fill: CHART.ink } as const

/** One panel, one hairline, the tokens' card radius — the tooltip is a small panel, not chrome. */
export const TOOLTIP_STYLE = {
  background: CHART.panel,
  border: `1px solid ${CHART.line}`,
  borderRadius: 8,
  fontSize: 12,
  color: CHART.ink,
  padding: '6px 8px',
  boxShadow: 'none',
} as const

export const TOOLTIP_LABEL_STYLE = { color: CHART.muted, marginBottom: 2 } as const
