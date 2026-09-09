/**
 * Times in the editor. The server stores UTC; a nurse types wall-clock time.
 *
 * `datetime-local` has no timezone, so it is read and written in the browser's local zone — the
 * prototype's `toLocal` / `fromLocal`, unchanged. Every phone in the ED is on Asia/Riyadh, so
 * that is the zone they type in.
 *
 * Anything that is *displayed* rather than edited is formatted in Asia/Riyadh explicitly, with
 * `Intl` and no timezone library: that keeps the server-rendered HTML and the hydrated client
 * identical no matter which zone the Node process runs in (production containers are UTC).
 */
const pad = (n: number): string => String(n).padStart(2, '0')

/** ISO instant -> "YYYY-MM-DDTHH:mm" in the browser's local zone, for a datetime-local input. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "YYYY-MM-DDTHH:mm" in the browser's local zone -> ISO instant (UTC), or null when cleared. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function nowLocalInput(): string {
  return toLocalInput(new Date().toISOString())
}

const RIYADH = 'Asia/Riyadh'
const stampFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: RIYADH,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** "dd/mm HH:mm" in Asia/Riyadh — the prototype's `fmtDT`, for update timestamps. */
export function fmtStamp(iso: string): string {
  const parts = stampFormat.formatToParts(new Date(iso))
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '00'
  return `${get('day')}/${get('month')} ${get('hour')}:${get('minute')}`
}

/** Shift a registration time by whole minutes (the −30m / +30m chips). */
export function shiftMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString()
}

/** "n hours ago" from a reference instant (the 4h / 6h / 8h / 12h chips). */
export function hoursAgo(from: Date, hours: number): string {
  return new Date(from.getTime() - hours * 36e5).toISOString()
}
