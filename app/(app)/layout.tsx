import { Mark } from '@/src/components/brand/Mark'
import { NewCaseFab } from '@/src/components/shell/NewCaseFab'
import { OverflowMenu } from '@/src/components/shell/OverflowMenu'
import { TabBar } from '@/src/components/shell/TabBar'
import { ROLE_LABELS } from '@/src/lib/admin/user-view'
import { requireUser } from '@/src/lib/auth/session'
import { can } from '@/src/lib/authz/policy'

/**
 * The signed-in shell: a coloured app bar with the mark and the overflow menu, the page, the
 * floating "+ New case" button, and the navigation — the prototype's bottom tab bar on a phone,
 * the navy left rail from `lg` up (Phase 9, Ahmed's direction A).
 *
 * Everything inside this route group needs a signed-in user. The gate in proxy.ts only sees the
 * cookie; this is where the session is actually resolved, and a stale or forged cookie is turned
 * into a redirect to /login.
 *
 * `/cases/*` deliberately sits outside this group — the editor is a full-screen task with its own
 * "‹ Back", exactly as the prototype hides the bar and the FAB in its editor view.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()

  // Two layouts, one container. On a phone it is the prototype's centred column and the tab bar
  // is `fixed` at the foot, out of the flow. From `lg` it becomes a two-column grid: the same
  // <nav>, now the rail, in the first column, and everything else in the second — which is why
  // the header and the main are wrapped in an element that is `display: contents` until then.
  //
  // `print:max-w-none`: the centred phone column becomes a paper-width sheet on the printer.
  //
  // `has-[[data-wide]]`: the board, the dashboard and the export page are a phone column; Admin
  // is a laptop screen with tables (Phase 6 spec: "desktop first for admin (1280) but usable at
  // 390"). Rather than a second shell, the admin pages mark themselves `data-wide` and the same
  // container relaxes its width for them. At 390 the max-width never binds either way, and from
  // `lg` the grid is full width for every page, so the rule only ever applies to a wide phone.
  return (
    <div className="shell-grid mx-auto flex min-h-dvh max-w-md flex-col has-[[data-wide]]:max-w-[1200px] print:max-w-none lg:grid lg:max-w-none lg:grid-cols-[232px_minmax(0,1fr)] lg:has-[[data-wide]]:max-w-none">
      {/*
        The rail's column, painted navy for its whole height so a page longer than the screen does
        not end the colour where the viewport ends; the nav inside it is what sticks. Until `lg`
        this wrapper is `display: contents` and the nav is `fixed` at the foot of the phone.
      */}
      <div className="no-print contents lg:block lg:bg-navy">
        <TabBar
          showExport={can(user.role, 'export.xlsx')}
          showAdmin={user.role === 'ADMIN'}
          displayName={user.displayName}
          roleLabel={ROLE_LABELS[user.role]}
        />
      </div>

      <div className="contents lg:flex lg:min-w-0 lg:flex-col">
        <header className="no-print bg-header flex items-center justify-between gap-3 px-4 py-2.5 text-white lg:px-6">
          <span className="flex items-center gap-2.5">
            <Mark size={32} tone="onTeal" />
            <h1 className="text-section tracking-tight">ER Navigator</h1>
          </span>
          <OverflowMenu displayName={user.displayName} roleLabel={ROLE_LABELS[user.role]} />
        </header>

        <main className="shell-main flex-1 pb-32 lg:mx-auto lg:w-full lg:max-w-[1200px] lg:px-6 lg:pb-16">{children}</main>
      </div>

      {can(user.role, 'case.create') ? <NewCaseFab /> : null}
    </div>
  )
}
