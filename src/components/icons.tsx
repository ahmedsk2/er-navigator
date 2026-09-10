/**
 * The app's icon set (Phase 9): twenty-four line icons, 24 × 24, stroke 2, round caps, drawn in
 * `currentColor`. Decorative by default (`aria-hidden`); pass `label` for the rare standalone
 * icon that carries meaning and it becomes `role="img"` with that name.
 *
 * Paths are copied from Lucide 1.43.0 (https://lucide.dev), ISC License, Copyright (c) 2026
 * Lucide Icons and Contributors: permission to use, copy, modify and distribute is granted
 * provided the notice appears, which it does here. Copied rather than installed: the locked plan
 * admits no new runtime dependency, and the app needs these twenty-four, not the library.
 */
import type { ReactNode, SVGProps } from 'react'

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  /** Rendered size in px (width and height). */
  size?: number
  /** An accessible name for an icon that stands alone; omit for a decorative one. */
  label?: string
}

function icon(props: IconProps, children: ReactNode) {
  const { size = 20, label, ...rest } = props
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const Activity = (p: IconProps) =>
  icon(p, <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />)

export const BarChart3 = (p: IconProps) =>
  icon(
    p,
    <>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </>,
  )

export const Bell = (p: IconProps) =>
  icon(
    p,
    <>
      <path d="M10.268 21a2 2 0 0 0 3.464 0" />
      <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
    </>,
  )

export const Check = (p: IconProps) => icon(p, <path d="M20 6 9 17l-5-5" />)

export const ChevronLeft = (p: IconProps) => icon(p, <path d="m15 18-6-6 6-6" />)

export const ClipboardList = (p: IconProps) =>
  icon(
    p,
    <>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M12 11h4" />
      <path d="M12 16h4" />
      <path d="M8 11h.01" />
      <path d="M8 16h.01" />
    </>,
  )

export const Clock = (p: IconProps) =>
  icon(
    p,
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>,
  )

export const Download = (p: IconProps) =>
  icon(
    p,
    <>
      <path d="M12 15V3" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
    </>,
  )

export const Ellipsis = (p: IconProps) =>
  icon(
    p,
    <>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </>,
  )

export const Eye = (p: IconProps) =>
  icon(
    p,
    <>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </>,
  )

export const EyeOff = (p: IconProps) =>
  icon(
    p,
    <>
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </>,
  )

export const FileText = (p: IconProps) =>
  icon(
    p,
    <>
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </>,
  )

export const History = (p: IconProps) =>
  icon(
    p,
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </>,
  )

export const LayoutList = (p: IconProps) =>
  icon(
    p,
    <>
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
      <path d="M14 4h7" />
      <path d="M14 9h7" />
      <path d="M14 15h7" />
      <path d="M14 20h7" />
    </>,
  )

export const ListChecks = (p: IconProps) =>
  icon(
    p,
    <>
      <path d="M13 5h8" />
      <path d="M13 12h8" />
      <path d="M13 19h8" />
      <path d="m3 17 2 2 4-4" />
      <path d="m3 7 2 2 4-4" />
    </>,
  )

export const LogOut = (p: IconProps) =>
  icon(
    p,
    <>
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    </>,
  )

export const Plus = (p: IconProps) =>
  icon(
    p,
    <>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </>,
  )

export const Printer = (p: IconProps) =>
  icon(
    p,
    <>
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" />
      <rect x="6" y="14" width="12" height="8" rx="1" />
    </>,
  )

export const Search = (p: IconProps) =>
  icon(
    p,
    <>
      <path d="m21 21-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </>,
  )

export const Settings = (p: IconProps) =>
  icon(
    p,
    <>
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
      <circle cx="12" cy="12" r="3" />
    </>,
  )

export const TriangleAlert = (p: IconProps) =>
  icon(
    p,
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>,
  )

export const User = (p: IconProps) =>
  icon(
    p,
    <>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>,
  )

export const Users = (p: IconProps) =>
  icon(
    p,
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <path d="M16 3.128a4 4 0 0 1 0 7.744" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <circle cx="9" cy="7" r="4" />
    </>,
  )

export const X = (p: IconProps) =>
  icon(
    p,
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>,
  )
