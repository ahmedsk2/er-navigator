/**
 * Which copy of the app you are looking at (Phase 12 item 1, readiness audit D6).
 *
 * Modelled on `src/lib/export/report-header.ts`, the established pattern for a runtime
 * environment string: one variable, read at request time, on the app container's allowlist in
 * `docker/entrypoint.sh` and defaulted in `docker-compose.production.yml`.
 *
 * Unset or blank in production, where nothing about the page changes. `DEMO` on the hosted demo
 * instance, where every page carries an undismissable banner saying so. Two nurses on two phones,
 * one of them on the demo, is the accident this exists to prevent.
 *
 * A value that is not recognisable as a label is treated as unset rather than rendered: the
 * banner is server-rendered text, and a narrow alphabet is one less thing to reason about.
 */

/** `[A-Za-z0-9 ._-]`, 1 to 24 characters. Anything else is treated as unset. */
export const INSTANCE_LABEL_RE = /^[A-Za-z0-9 ._-]{1,24}$/

export function instanceLabel(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.INSTANCE_LABEL?.trim()
  if (!raw) return null
  return INSTANCE_LABEL_RE.test(raw) ? raw : null
}

export function instanceBannerText(label: string): string {
  return `${label}: invented patients only`
}

/**
 * How tall the banner is, published to the rest of the page (Phase 12 review round, finding 4).
 *
 * The banner is in normal flow, so on a laptop it pushes the whole shell down — including the
 * sticky navy rail, which is a full viewport tall. A full height starting one banner down ends
 * one banner below the fold, and the last thing in the rail is the link to /account: at
 * 1280 x 800 with nothing scrolled, "Account and password" was cut off.
 *
 * So `app/layout.tsx` sets `--instance-banner` on `<body>` — only when a label is set, so
 * production's rail reads the `0px` fallback and is unchanged — `InstanceBanner` takes its own
 * height *from* the variable, which is what keeps the two from drifting apart, and
 * `TabBar` subtracts it from the rail's height and adds it to the rail's sticky top.
 *
 * 1.75rem is `h-7`: 12 px of caption text at line-height 1.3 with the 6 px padding it had before.
 */
export const INSTANCE_BANNER_HEIGHT = '1.75rem'
