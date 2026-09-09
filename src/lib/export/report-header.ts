/**
 * The line at the top of the printed report.
 *
 * The Phase 5 spec calls this "the settings placeholder": Phase 6 gives Admin an editable
 * settings table, and until then the hospital's own name comes from one environment variable so a
 * second site can deploy the same image without a code change. It is on the app container's
 * allowlist in docker/entrypoint.sh, and defaulted in docker-compose.production.yml, so an unset
 * variable still prints the right header rather than an empty one.
 */
export const DEFAULT_REPORT_HEADER = 'Qatif Central Hospital, Emergency Department. ER Navigator'

export function reportHeader(): string {
  const configured = process.env.REPORT_HEADER?.trim()
  return configured ? configured : DEFAULT_REPORT_HEADER
}
