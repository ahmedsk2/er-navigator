'use client'

/**
 * The case editor, ported section for section from the prototype's `CaseEditor`
 * (`docs/reference/ERNavigatorTracker.jsx`): identity and registration, where is the delay,
 * departments, investigations, admission, referral out, journey times, updates, resolve,
 * "Check these times", save.
 *
 * The prototype wins on behaviour; the locked plan wins on permissions. A VIEWER and a voided
 * case both get exactly this screen with `readOnly` set: every control disabled, no Save, no Add,
 * no Resolve, no Void.
 */
import Link from 'next/link'
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import {
  acknowledgeAlert as acknowledgeAlertAction,
  addCaseUpdate as addCaseUpdateAction,
  createCase as createCaseAction,
  reopenCase as reopenCaseAction,
  resolveCase as resolveCaseAction,
  reviewCase as reviewCaseAction,
  saveCase as saveCaseAction,
  voidCase as voidCaseAction,
} from '@/app/cases/actions'
import {
  ActionChip,
  Button,
  Chain,
  Chips,
  ConfirmButton,
  Field,
  FieldGroup,
  Input,
  LocalTimeInput,
  Section,
  Select,
  TimeRow,
  UNREACHABLE_MESSAGE,
} from '@/src/components/ui'
import { appendDictated, DictationRow } from '@/src/components/ui/DictationButton'
import { fmtStamp, hoursAgo, nowLocalInput, shiftMinutes } from '@/src/lib/cases/local-time'
import { caseClockOf } from '@/src/lib/cases/summary'
import type {
  CaseDraft,
  CaseUpdateView,
  DraftConsult,
  DraftInvestigation,
  ReferenceData,
  ValidationIssue,
} from '@/src/lib/cases/types'
import { conflictMessage } from '@/src/lib/cases/conflict'
import {
  ADMISSION_STEPS,
  ANSWER_LABELS,
  CASE_MANAGEMENT_LABELS,
  CONSULT_STEPS,
  CTAS_LEVELS,
  DISPOSITION_LABELS,
  INVESTIGATION_LABELS,
  INVESTIGATION_STEPS,
  MILESTONES,
  PAYER_LABELS,
  PAYERS,
  PETHIDINE_DOSES,
  SHIFT_LABELS,
  TRANSFER_STEPS,
  UPDATE_ACTION_LABELS,
} from '@/src/lib/domain/taxonomy'
import { band, elapsedHours, fmtHours, spokenHours } from '@/src/lib/domain/time'
import { BAND_TEXT } from '@/src/components/bands'
import {
  Activity,
  Check,
  ClipboardList,
  FileText,
  History,
  ListChecks,
  TriangleAlert,
  Users,
} from '@/src/components/icons'
import {
  DIAGNOSIS_MAX,
  MRN_RE,
  NOTE_MAX,
  OTHER_TEXT_MAX,
  phiWarnings,
  REGISTRATION_NUDGE_MINUTES,
  REGISTRATION_QUICK_HOURS,
  UPDATE_TEXT_MAX,
} from '@/src/lib/domain/validation'
import { timeWarnings } from '@/src/lib/domain/warnings'

const CLOCK_TICK_MS = 30_000

// BAND_TEXT comes from src/components/bands.ts (Phase 9). Its `none` was `text-band-none` here and
// `text-muted` on the board and the dashboard; the shared map settles on `text-muted`.

const INVESTIGATION_TYPES = ['LAB', 'CT', 'US', 'XR', 'MRI'] as const
const DISPOSITIONS = Object.keys(DISPOSITION_LABELS) as Array<keyof typeof DISPOSITION_LABELS>
const SHIFTS = Object.keys(SHIFT_LABELS) as Array<keyof typeof SHIFT_LABELS>
/** `Chips` is a string list, so the five CTAS levels travel as strings and come back as numbers. */
const CTAS_OPTIONS = CTAS_LEVELS.map(String)

// --- Phase 8b: the collection decisions' option lists ------------------------------------------

const YES_NO = ['YES', 'NO'] as const
const YES_NO_UNSURE = ['YES', 'NO', 'NOT_SURE'] as const
const UPDATE_ACTIONS = Object.keys(UPDATE_ACTION_LABELS) as Array<keyof typeof UPDATE_ACTION_LABELS>
const CASE_MGMT_REFERRALS = ['CASE_MANAGER', 'COMPLEX_CARE'] as const
const CASE_MGMT_CRITERIA = ['MEETS', 'NOT_MEETING'] as const
const CASE_MGMT_ACTIONS = ['ENROLLED', 'FOR_ENROLLMENT'] as const

/**
 * One row for the pethidine question, because the two columns behind it are one clinical fact:
 * "No" is `pethidinePrescribed = NO` with no dose, and a milligram figure is `YES` with that
 * dose. Recording them separately is what `validation.ts` refuses (a dose against a No), and this
 * row makes that combination unreachable from the screen.
 */
const PETHIDINE_OPTIONS = ['NO', ...PETHIDINE_DOSES.map(String)] as const
type PethidineOption = (typeof PETHIDINE_OPTIONS)[number]

const BLANK_INVESTIGATION = {
  orderedAt: null,
  collectedAt: null,
  receivedAt: null,
  doneAt: null,
  preliminaryAt: null,
  resultedAt: null,
} as const

/** The sections the case page's strip jumps to (Phase 11). One editor per page, so plain ids. */
const JUMP = {
  delay: 'case-delay',
  teams: 'case-teams',
  tests: 'case-tests',
  times: 'case-times',
  updates: 'case-updates',
  resolve: 'case-resolve',
} as const

/**
 * A jump, not a navigation. The chip is a link to `#id`, so it reads as one and still works
 * before hydration; a click scrolls and focuses here instead, because a hash link pushes a
 * history entry for every jump and the phone's Back would then walk back through the sections
 * instead of returning to the board.
 */
function jumpTo(event: React.MouseEvent<HTMLAnchorElement>, id: string): void {
  const target = document.getElementById(id)
  if (!target) return
  event.preventDefault()
  target.scrollIntoView({ block: 'start' })
  target.focus({ preventScroll: true })
}

export type CaseEditorProps = {
  reference: ReferenceData
  initial: CaseDraft
  caseId: string | null
  initialStatus: 'OPEN' | 'RESOLVED' | 'VOIDED'
  /**
   * When the case was last resolved (`LoadedCase.resolvedAt`), or null; absent on a new case. Only
   * the header clock reads it: it is where the stay of a resolved case ends once "Left ED at" has
   * been cleared, as it does on the board row and in the summary (`caseClockOf`).
   */
  initialResolvedAt?: string | null
  voidReason: string | null
  navigatorName: string
  initialUpdates: CaseUpdateView[]
  readOnly: boolean
  canVoid: boolean
  /**
   * Phase 6: the deepest threshold the alerts worker has recorded on this case that nobody has
   * acknowledged, or null. Only ever passed for a SUPERVISOR or an ADMIN (`alert.acknowledge`),
   * so its presence is also the permission to act on it.
   */
  alert?: { id: string; thresholdHours: number; firedAt: string } | null
  /**
   * Phase 8: the read-only Timeline section, rendered on the server by `app/cases/[id]/page.tsx`
   * and slotted in after the updates. A slot rather than a prop of data, because this component
   * holds the form and the timeline holds none of it: nothing here reads it, changes it or
   * re-renders it, and `/cases/new` passes nothing at all.
   */
  timeline?: ReactNode
  /**
   * Phase 10: the case summary trigger, rendered on the server by `app/cases/[id]/page.tsx` and
   * slotted into the header between "‹ Back" and the clock. A slot for the same reason the
   * timeline is one — the summary is a reading of the case as the server last drew it, the editor
   * holds none of it, and `/cases/new` has nothing to summarise and passes nothing.
   */
  summary?: ReactNode
  /**
   * Phase 8b, decision H. `review` is what the case carries (shown to every role, so a navigator
   * can see their entry has been checked); `canReview` is whether this caller may set it, which
   * the page decides from `case.review` and the service checks again. Neither is part of the
   * draft: no save can touch a review, and marking one does not bump the version.
   */
  review?: { at: string; byName: string } | null
  canReview?: boolean
  /** Taken on the server so the first client render is byte-identical. */
  nowIso: string
}

export function CaseEditor(props: CaseEditorProps) {
  const { reference, caseId, navigatorName, readOnly, canVoid } = props
  const isNew = caseId === null

  const [draft, setDraft] = useState<CaseDraft>(props.initial)
  const [status, setStatus] = useState(props.initialStatus)
  /** Held beside the status because resolve and reopen move both, as the server does. */
  const [resolvedAt, setResolvedAt] = useState(props.initialResolvedAt ?? null)
  const [updates, setUpdates] = useState<CaseUpdateView[]>(props.initialUpdates)
  const [updateText, setUpdateText] = useState('')
  /** The deck category for the update being typed, cleared with the box when it is sent. */
  const [updateAction, setUpdateAction] = useState<(typeof UPDATE_ACTIONS)[number] | null>(null)
  const [updateWarnings, setUpdateWarnings] = useState<string[]>([])
  const [review, setReview] = useState(props.review ?? null)
  const [showJourney, setShowJourney] = useState(!isNew)
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [conflict, setConflict] = useState<{ changedBy: string; changedAt: string } | null>(null)
  const [forbidden, setForbidden] = useState(false)
  /** The action threw rather than answering: nothing reached the database (Phase 7, C11). */
  const [unreachable, setUnreachable] = useState(false)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  /**
   * The consults a chip deselect dropped this session, keyed by department (Phase 7, C18). The
   * prototype keeps `departments` and a `consults` map as two independent fields, so a deselect
   * never touches the recorded times and a re-select brings them back
   * (`ERNavigatorTracker.jsx:338, 342`); the port rebuilds one array from the selected ids, so a
   * thumb catching the chip while scrolling wiped the pair. Editor state only: nothing persisted
   * changes, and a reload still shows exactly what the database holds.
   */
  const [removedConsults, setRemovedConsults] = useState<Record<string, DraftConsult>>({})
  const [voidReasonText, setVoidReasonText] = useState('')
  const [voidOpen, setVoidOpen] = useState(false)
  const [now, setNow] = useState(() => new Date(props.nowIso))
  const [alert, setAlert] = useState(props.alert ?? null)
  /** The two labelled boxes that share their row with the microphone (`Field` with `htmlFor`). */
  const diagnosisId = useId()
  const noteId = useId()
  /**
   * The three selects, named by a `<label for>` too (Phase 11, finding 4): a label wrapped round a
   * select holds every option in its text, so the select could not be found by its label alone.
   */
  const shiftId = useId()
  const primaryReasonId = useId()
  const dispositionId = useId()

  // The clock ticks only while the case is open; a resolved case is frozen at its departure time,
  // or at its resolution once that has been cleared. `now` starts at the server's instant so the
  // first client render matches the server's HTML.
  const ticking = status === 'OPEN'
  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS)
    return () => clearInterval(timer)
  }, [ticking])

  const set = (patch: Partial<CaseDraft>): void => setDraft((previous) => ({ ...previous, ...patch }))

  // --- reference lookups ----------------------------------------------------------------------

  const stageById = useMemo(() => new Map(reference.stages.map((s) => [s.id, s])), [reference])
  const stageOfReason = useMemo(() => {
    const map = new Map<string, (typeof reference.stages)[number]>()
    for (const stage of reference.stages) for (const reason of stage.reasons) map.set(reason.id, stage)
    return map
  }, [reference])
  const reasonById = useMemo(() => {
    const map = new Map<string, (typeof reference.stages)[number]['reasons'][number]>()
    for (const stage of reference.stages) for (const reason of stage.reasons) map.set(reason.id, reason)
    return map
  }, [reference])
  const departmentName = useMemo(
    () => new Map(reference.departments.map((d) => [d.id, d.name])),
    [reference],
  )
  const areaName = useMemo(() => new Map(reference.areas.map((a) => [a.id, a.name])), [reference])
  /**
   * The rows an Admin deactivated while this case already carried them (Phase 7, C4/C10). They
   * come from `loadReferenceForCase`, are only ever present on an existing case, and render as
   * greyed "(retired)" chips the nurse can turn off but never back on.
   */
  const retiredDepartments = useMemo(
    () => new Set(reference.departments.filter((d) => d.retired).map((d) => d.id)),
    [reference],
  )
  const retiredWards = useMemo(
    () => new Set(reference.wards.filter((w) => w.retired).map((w) => w.id)),
    [reference],
  )
  const retiredAreas = useMemo(
    () => new Set(reference.areas.filter((a) => a.retired).map((a) => a.id)),
    [reference],
  )

  const selectedStages = draft.stages.map((id) => stageById.get(id)).filter((s) => s !== undefined)
  const stageCodes = new Set(selectedStages.map((s) => s.code))

  // --- derived state --------------------------------------------------------------------------

  // The clock the board row and the summary read. It used to be built here with no resolvedAt,
  // on the grounds that resolve always writes a departure time, but "Left ED at" can be cleared
  // on a resolved case and saved, and then this header counted on to every page load while the
  // board row stood still at the resolution. It reads the draft, so a departure time typed on
  // this page moves it at once.
  const elapsed = elapsedHours(caseClockOf({ status, resolvedAt, draft }), now)

  const anyReasonNeedsDepartment = draft.reasons.some((r) => reasonById.get(r.reasonId)?.requiresDepartment)
  const anyStageNeedsDepartment = selectedStages.some((s) => s.reasons.some((r) => r.requiresDepartment))
  const showDepartments = anyReasonNeedsDepartment || anyStageNeedsDepartment || stageCodes.has('adm') || stageCodes.has('dispo')
  const showInvestigations = stageCodes.has('inv')
  const showAdmission = stageCodes.has('adm') || draft.disposition === 'ADMITTED'
  const showReferral =
    draft.reasons.some((r) => reasonById.get(r.reasonId)?.requiresReferralNo) || draft.disposition === 'TRANSFERRED'

  const otherTexts = draft.reasons
    .filter((r) => reasonById.get(r.reasonId)?.isOther && r.otherText)
    .map((r) => ({ stage: stageOfReason.get(r.reasonId)?.name ?? 'Other', text: r.otherText ?? '' }))

  const warnings = useMemo(
    () => [
      ...timeWarnings({
        registrationAt: draft.registrationAt,
        triageAt: draft.triageAt,
        roomAt: draft.roomAt,
        physicianAt: draft.physicianAt,
        decisionAt: draft.decisionAt,
        departedAt: draft.departedAt,
        admOrderAt: draft.admOrderAt,
        bedRequestedAt: draft.bedRequestedAt,
        bedAssignedAt: draft.bedAssignedAt,
        handoverAt: draft.handoverAt,
        transferRequestedAt: draft.transferRequestedAt,
        transferAcceptedAt: draft.transferAcceptedAt,
        transportArrivedAt: draft.transportArrivedAt,
        painkillerAt: draft.painkillerAt,
        caseMgmtCalledAt: draft.caseMgmtCalledAt,
        caseMgmtRepliedAt: draft.caseMgmtRepliedAt,
        consults: draft.consults.map((c) => ({
          departmentName: departmentName.get(c.departmentId) ?? 'team',
          consultedAt: c.consultedAt,
          seenAt: c.seenAt,
          repliedAt: c.repliedAt,
        })),
        investigations: draft.investigations,
      }),
      ...phiWarnings('The working diagnosis', draft.diagnosis),
      ...phiWarnings('The resolution note', draft.resolutionNote),
      ...otherTexts.flatMap((o) => phiWarnings(`The other reason under ${o.stage}`, o.text)),
    ],
    // otherTexts is derived from draft.reasons, which is part of draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, departmentName],
  )

  const mrnOk = MRN_RE.test(draft.mrn)
  const canSave = mrnOk && Boolean(draft.registrationAt) && draft.reasons.length > 0

  // --- editing --------------------------------------------------------------------------------

  /** Deselecting a stage drops its reasons, and with them their Other text (prototype). */
  const setStages = (next: string[]): void => {
    const keep = new Set(next)
    const reasons = draft.reasons.filter((r) => {
      const stage = stageOfReason.get(r.reasonId)
      return stage ? keep.has(stage.id) : false
    })
    set({ stages: next, reasons, primaryReasonId: nextPrimary(reasons, draft.primaryReasonId) })
  }

  const setStageReasons = (stageId: string, reasonIds: string[]): void => {
    const others = draft.reasons.filter((r) => stageOfReason.get(r.reasonId)?.id !== stageId)
    const mine = reasonIds.map(
      (id) => draft.reasons.find((r) => r.reasonId === id) ?? { reasonId: id, otherText: null },
    )
    const reasons = [...others, ...mine]
    set({ reasons, primaryReasonId: nextPrimary(reasons, draft.primaryReasonId) })
  }

  const setOtherText = (reasonId: string, text: string): void =>
    set({ reasons: draft.reasons.map((r) => (r.reasonId === reasonId ? { ...r, otherText: text } : r)) })

  const setDepartments = (ids: string[]): void => {
    const keep = new Set(ids)
    const dropped = draft.consults.filter((c) => !keep.has(c.departmentId))
    if (dropped.length > 0) {
      setRemovedConsults((previous) => ({
        ...previous,
        ...Object.fromEntries(dropped.map((c) => [c.departmentId, c])),
      }))
    }
    set({
      consults: ids.map(
        (id) =>
          draft.consults.find((c) => c.departmentId === id) ??
          removedConsults[id] ?? {
            departmentId: id,
            consultedAt: null,
            seenAt: null,
            repliedAt: null,
          },
      ),
    })
  }

  const setConsult = (departmentId: string, patch: Partial<DraftConsult>): void =>
    set({
      consults: draft.consults.map((c) => (c.departmentId === departmentId ? { ...c, ...patch } : c)),
    })

  const setInvestigationTypes = (types: Array<DraftInvestigation['type']>): void =>
    set({
      investigations: types.map(
        (type) =>
          draft.investigations.find((i) => i.type === type) ?? { type, ...BLANK_INVESTIGATION },
      ),
    })

  const setInvestigation = (type: DraftInvestigation['type'], patch: Partial<DraftInvestigation>): void =>
    set({ investigations: draft.investigations.map((i) => (i.type === type ? { ...i, ...patch } : i)) })

  /**
   * The one pethidine chip row, read off the two columns and written back to both. A YES with no
   * dose yet selects nothing — the only way to store that pair is a hand-written UPDATE, and the
   * row simply shows it as unanswered rather than guessing which milligram figure was meant.
   */
  const pethidineChoice: PethidineOption | null =
    draft.pethidinePrescribed === 'NO'
      ? 'NO'
      : draft.pethidinePrescribed === 'YES' && draft.pethidineDoseMg != null
        ? (String(draft.pethidineDoseMg) as PethidineOption)
        : null

  const setPethidine = (choice: PethidineOption | null): void => {
    if (choice === null) set({ pethidinePrescribed: null, pethidineDoseMg: null })
    else if (choice === 'NO') set({ pethidinePrescribed: 'NO', pethidineDoseMg: null })
    else set({ pethidinePrescribed: 'YES', pethidineDoseMg: Number(choice) })
  }

  /** Turning "Painkiller prescribed" off takes the answers that only make sense under Yes with it. */
  const setPainkillerPrescribed = (value: CaseDraft['painkillerPrescribed']): void =>
    set(
      value === 'YES'
        ? { painkillerPrescribed: value }
        : { painkillerPrescribed: value, pethidinePrescribed: null, pethidineDoseMg: null, painkillerAt: null },
    )

  /** The same for the case-management block: no referral, no criteria, action or times. */
  const setCaseMgmtReferral = (value: CaseDraft['caseMgmtReferral']): void =>
    set(
      value
        ? { caseMgmtReferral: value }
        : {
            caseMgmtReferral: null,
            caseMgmtCriteria: null,
            caseMgmtAction: null,
            caseMgmtCalledAt: null,
            caseMgmtRepliedAt: null,
          },
    )

  // --- server round trips ----------------------------------------------------------------------

  const clearFeedback = (): void => {
    setIssues([])
    setConflict(null)
    setForbidden(false)
    setUnreachable(false)
    setSaved(false)
  }

  function handleFailure(result: {
    ok: false
    error: 'validation' | 'conflict' | 'forbidden'
    issues?: ValidationIssue[]
    changedBy?: string
    changedAt?: string
  }): void {
    if (result.error === 'validation') setIssues(result.issues ?? [])
    else if (result.error === 'conflict') {
      setConflict({ changedBy: result.changedBy ?? '', changedAt: result.changedAt ?? '' })
    } else setForbidden(true)
  }

  /**
   * A thrown action — a dropped connection, a 404 during the deploy window, a Prisma transaction
   * timeout — used to be swallowed here: `void onSave()` discarded the rejection, the button
   * greyed and un-greyed, and the nurse read that as "saved". The catch says what happened, and
   * says it in the one way that matters: nothing was written (Phase 7, C11).
   */
  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true)
    clearFeedback()
    try {
      await work()
    } catch {
      setUnreachable(true)
    } finally {
      setBusy(false)
    }
  }

  const onSave = (): Promise<void> =>
    run(async () => {
      if (isNew) {
        // The action redirects to /cases/[id] on success, so only a failure comes back.
        const result = await createCaseAction(draft)
        if (result && !result.ok) handleFailure(result)
        return
      }
      const result = await saveCaseAction(caseId, draft)
      if (result.ok) {
        set({ version: result.version })
        // The server cleared the review with the save (Phase 8b, decision H); say so here rather
        // than leaving a line that a reload would contradict.
        setReview(null)
        setSaved(true)
      } else handleFailure(result)
    })

  const onAddUpdate = (): Promise<void> =>
    run(async () => {
      const text = updateText.trim()
      if (!text || !caseId) return
      setUpdateWarnings([])
      const result = await addCaseUpdateAction(caseId, text, updateAction)
      if (result.ok) {
        setUpdates((rows) => [...rows, result.update])
        setUpdateText('')
        setUpdateAction(null)
        setUpdateWarnings(result.warnings)
      } else handleFailure(result)
    })

  const onReview = (): Promise<void> =>
    run(async () => {
      if (!caseId) return
      const result = await reviewCaseAction(caseId)
      if (result.ok) setReview({ at: result.reviewedAt, byName: result.reviewedByName })
      else handleFailure(result)
    })

  const onResolve = (): Promise<void> =>
    run(async () => {
      if (!caseId || !draft.disposition) return
      const departedAt = draft.departedAt ?? new Date().toISOString()
      const result = await resolveCaseAction(caseId, { ...draft, departedAt })
      if (result.ok) {
        set({ version: result.version, departedAt })
        setStatus('RESOLVED')
        // `resolveCase` writes the departure time as the resolution as well.
        setResolvedAt(departedAt)
        setReview(null)
        setUpdates((rows) => [...rows, result.update])
      } else handleFailure(result)
    })

  const onReopen = (): Promise<void> =>
    run(async () => {
      if (!caseId) return
      const result = await reopenCaseAction(caseId, draft.version)
      if (result.ok) {
        set({ version: result.version })
        setStatus('OPEN')
        // `reopenCase` clears the resolution and keeps the departure time as entered.
        setResolvedAt(null)
        setUpdates((rows) => [...rows, result.update])
      } else handleFailure(result)
    })

  const onAcknowledge = (): Promise<void> =>
    run(async () => {
      if (!caseId || !alert) return
      const result = await acknowledgeAlertAction(caseId, alert.id)
      if (result.ok) setAlert(null)
      else setForbidden(true)
    })

  const onVoid = (): Promise<void> =>
    run(async () => {
      if (!caseId) return
      const result = await voidCaseAction(caseId, { version: draft.version, voidReason: voidReasonText.trim() })
      if (result.ok) window.location.reload()
      else handleFailure(result)
    })

  // --- render -----------------------------------------------------------------------------------

  const disabled = readOnly || busy

  /**
   * The strip's chips (Phase 11, finding 2): a worked case is seven phone screens long, and the
   * Updates box — what a navigator does most — and Resolve are at the bottom of it. One chip per
   * section a nurse goes looking for, in page order; Teams and Tests only while their sections
   * are on the page. "Times" is the journey times, the one section of times every case has.
   */
  const jumps: ReadonlyArray<{ id: string; label: string }> = [
    { id: JUMP.delay, label: 'Delay' },
    ...(showDepartments ? [{ id: JUMP.teams, label: 'Teams' }] : []),
    ...(showInvestigations ? [{ id: JUMP.tests, label: 'Tests' }] : []),
    { id: JUMP.times, label: 'Times' },
    { id: JUMP.updates, label: 'Updates' },
    { id: JUMP.resolve, label: 'Resolve' },
  ]

  /** Why "Open case" or "Save changes" is dead, under the button. */
  const saveHint = !mrnOk
    ? 'Enter the MRN as digits only.'
    : draft.reasons.length === 0
      ? 'Select at least one delay reason.'
      : ''

  /**
   * What the last action said: a conflict, a refusal, an unreachable server, a save, or the
   * validation issues. One fragment in two places since Phase 11 — under the sections on a case,
   * in the bar over "Open case" on a new one — so the two can never say different things.
   */
  const feedback = (
    <>
      {conflict ? (
        <div className="mb-2.5 rounded-card border border-band-h4 bg-panel p-3" role="alert">
          <p className="text-body text-band-h4-ink">
            {conflictMessage(conflict.changedBy, conflict.changedAt ? fmtStamp(conflict.changedAt) : '')}
          </p>
          <Button className="mt-2" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      ) : null}
      {forbidden ? (
        <p className="mb-2.5 rounded-card border border-line bg-panel p-3 text-body text-danger" role="alert">
          Your role cannot do that.
        </p>
      ) : null}
      {unreachable ? (
        <p
          data-unreachable
          className="mb-2.5 rounded-card border border-danger bg-panel p-3 text-body text-danger"
          role="alert"
        >
          {UNREACHABLE_MESSAGE}
        </p>
      ) : null}
      {saved ? (
        <p className="mb-2.5 text-caption text-band-ok" role="status">
          Saved.
        </p>
      ) : null}
      {issues.length > 0 ? (
        <div className="mb-2.5 rounded-card border border-danger bg-panel p-3" role="alert">
          {issues.map((issue) => (
            <p key={`${issue.path}:${issue.message}`} className="text-body text-danger">
              {issue.message}
            </p>
          ))}
        </div>
      ) : null}
    </>
  )

  return (
    // A <main> landmark: /cases/* sits outside the (app) shell, which has its own, and a page
    // with none is what Lighthouse flagged on the case editor (Phase 7). A new case ends on its
    // Open case bar (Phase 11), which comes to rest on the foot of the page rather than above a
    // strip of padding.
    <main className={`mx-auto max-w-[720px] ${isNew ? '' : 'pb-16'}`}>
      <div className="flex items-baseline justify-between px-4 pt-3.5 pb-1.5">
        <Link
          href="/"
          className="-ml-1 inline-flex min-h-11 items-center rounded-button px-3 text-body font-semibold text-accent-ink"
        >
          ‹ Back
        </Link>
        {/* Phase 10: the summary trigger sits between the way out and the clock — the two things
            a nurse reaches for from this header — and is nothing at all on a new case. */}
        {props.summary ? <div className="ml-auto mr-3 self-center">{props.summary}</div> : null}
        {/* The visible clock is tabular and terse; the label is the whole sentence, because a
            screen reader reads "6h 05m" as "six h zero five m" and "–" as nothing at all. */}
        <div
          className={`num text-clock ${BAND_TEXT[band(elapsed)]}`}
          /* role="img", not "status": the clock re-renders every 30 s, and a live region would
             read the whole thing out again on every tick. This announces once, on focus or on
             the reader's own pass. */
          role="img"
          aria-label={`Time in the Emergency Department: ${spokenHours(elapsed)}`}
        >
          <span aria-hidden="true">{fmtHours(elapsed)}</span>
        </div>
      </div>

      {/* Phase 11: the jump strip, under the header, which keeps its place. It sticks to the top
          of the screen below `lg`; on a laptop the page is one column in a wide screen, so the
          strip stays where it is and scrolls away with the header. A new case has no Updates or
          Resolve to jump to and gets none. "Jump to", not "… sections": the suites find the
          shell's tab bar as the navigation named "Sections", and a name holding that word would
          be found with it. */}
      {isNew ? null : (
        <nav
          aria-label="Jump to"
          className="no-print sticky top-0 z-10 mb-2.5 border-b border-line bg-bg px-4 py-1.5 lg:static lg:border-b-0 lg:py-0"
        >
          {/* Six equal chips across a 390 px screen, so each label gets its whole width: no
              side padding to speak of, and a 4 px gap. */}
          <ul className="flex gap-1 lg:gap-1.5">
            {jumps.map((jump) => (
              <li key={jump.id} className="min-w-0 flex-1 lg:flex-none">
                <a
                  href={`#${jump.id}`}
                  onClick={(event) => jumpTo(event, jump.id)}
                  className="flex min-h-11 items-center justify-center rounded-chip border border-line bg-panel px-0.5 text-label font-semibold text-ink-2 hover:bg-accent-soft lg:px-3.5"
                >
                  {jump.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {alert ? (
        <div
          data-alert-banner
          role="status"
          className="mx-4 mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded-card border border-band-h6 bg-panel p-3"
        >
          <p className="text-body text-ink-2">
            Past the <span className="num font-semibold">{alert.thresholdHours}h</span> threshold —
            recorded {fmtStamp(alert.firedAt)}, not yet acknowledged.
          </p>
          <Button disabled={busy} onClick={() => void onAcknowledge()}>
            Acknowledge
          </Button>
        </div>
      ) : null}

      {status === 'VOIDED' ? (
        <div className="mx-4 mb-2.5 rounded-card border border-danger bg-panel p-3 text-body text-danger" role="status">
          This case was voided{props.voidReason ? `: ${props.voidReason}` : ''}. It is kept for the record and
          cannot be changed.
        </div>
      ) : null}

      {readOnly && status !== 'VOIDED' ? (
        <div className="mx-4 mb-2.5 rounded-card border border-line bg-panel p-3 text-body text-muted" role="status">
          You have view-only access. Nothing on this page can be changed.
        </div>
      ) : null}

      {/* 2. Identity and registration */}
      <Section>
        <h1 className="mb-2.5 text-section">{isNew ? 'New case' : `Case ${draft.mrn}`}</h1>
        <Field label="MRN (digits only)">
          <Input
            className="num"
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 851557"
            disabled={disabled}
            value={draft.mrn}
            onChange={(e) => set({ mrn: e.target.value.replace(/\D/g, '') })}
          />
        </Field>
        <Field label="Registration time (clock starts here)">
          <LocalTimeInput
            value={draft.registrationAt}
            max={nowLocalInput()}
            disabled={disabled}
            onChange={(next) => set({ registrationAt: next ?? draft.registrationAt })}
          />
        </Field>
        <div className="-mt-2 mb-1">
          {REGISTRATION_QUICK_HOURS.map((h) => (
            <ActionChip key={h} disabled={disabled} onClick={() => set({ registrationAt: hoursAgo(new Date(), h) })}>
              {h}h ago
            </ActionChip>
          ))}
          <ActionChip
            disabled={disabled}
            onClick={() => set({ registrationAt: shiftMinutes(draft.registrationAt, -REGISTRATION_NUDGE_MINUTES) })}
          >
            −{REGISTRATION_NUDGE_MINUTES}m
          </ActionChip>
          <ActionChip
            disabled={disabled}
            onClick={() => set({ registrationAt: shiftMinutes(draft.registrationAt, REGISTRATION_NUDGE_MINUTES) })}
          >
            +{REGISTRATION_NUDGE_MINUTES}m
          </ActionChip>
        </div>
        <p className="num mb-3.5 text-caption text-muted">Waiting {fmtHours(elapsed)} so far</p>
        <div className="flex gap-2.5">
          <div className="flex-1">
            <Field label="Navigator">
              <Input value={navigatorName} readOnly disabled />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Shift" htmlFor={shiftId}>
              <Select
                id={shiftId}
                disabled={disabled}
                value={draft.shift ?? ''}
                onChange={(e) => set({ shift: (e.target.value || null) as CaseDraft['shift'] })}
              >
                <option value="">Select</option>
                {SHIFTS.map((s) => (
                  <option key={s} value={s}>
                    {SHIFT_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>

        {/* Phase 8. Both optional: every KPI in the ED decks and the Adaa form is reported per
            CTAS and the March deck splits everything by area, but a navigator who does not know
            one leaves it blank. Single-select, and tapping the chip again clears it — the same
            gesture the Ward row uses. */}
        <FieldGroup label="CTAS">
          <Chips
            groupLabel="CTAS"
            options={CTAS_OPTIONS}
            value={draft.ctas == null ? [] : [String(draft.ctas)]}
            onChange={(values) => {
              const last = values[values.length - 1]
              set({ ctas: last === undefined ? null : Number(last) })
            }}
            disabled={disabled}
          />
        </FieldGroup>
        {/* Phase 10, Ahmed's second request of 10 September: one line, beside CTAS, so the board
            row and the weekly deck can say what the patient came in with. It is a clinical line
            and not an identifier — but it is free text, so `phiWarnings` reads it like every
            other box and the 10-digit warning applies. */}
        <Field label="Working diagnosis (optional)" htmlFor={diagnosisId}>
          <DictationRow
            disabled={disabled}
            onText={(text) => set({ diagnosis: appendDictated(draft.diagnosis, text, DIAGNOSIS_MAX) })}
          >
            <Input
              id={diagnosisId}
              maxLength={DIAGNOSIS_MAX}
              placeholder="one line, e.g. chest pain, for admission"
              disabled={disabled}
              value={draft.diagnosis}
              onChange={(e) => set({ diagnosis: e.target.value })}
            />
          </DictationRow>
        </Field>
        <FieldGroup label="ED area">
          <Chips
            groupLabel="ED area"
            options={reference.areas.map((a) => a.id)}
            value={draft.areaId ? [draft.areaId] : []}
            onChange={(ids) => set({ areaId: ids[ids.length - 1] ?? null })}
            labelOf={(id) => areaName.get(id) ?? id}
            retiredOf={(id) => retiredAreas.has(id)}
            disabled={disabled}
          />
        </FieldGroup>
        {/* Phase 10, Ahmed's sixth request: who pays for the visit. Single-select with the same
            gesture as every other chip row — tap again to clear. */}
        <ChoiceRow
          label="Payer"
          options={PAYERS}
          labelOf={(p) => PAYER_LABELS[p]}
          value={draft.payer}
          onChange={(v) => set({ payer: v })}
          disabled={disabled}
        />
      </Section>

      {/* 3. Where is the delay */}
      <Section id={JUMP.delay} title="Where is the delay?" icon={<TriangleAlert size={18} />}>
        <p className="mb-2.5 text-caption text-muted">
          Tap every stage that applies, then the reasons under each. If you pick more than one reason, choose the
          primary one below.
        </p>
        <Chips
          groupLabel="Stages"
          options={reference.stages.map((s) => s.id)}
          value={draft.stages}
          onChange={setStages}
          disabled={disabled}
          labelOf={(id) => stageById.get(id)?.name ?? id}
        />
        {selectedStages.map((stage) => {
          const mine = draft.reasons.filter((r) => stageOfReason.get(r.reasonId)?.id === stage.id)
          const other = stage.reasons.find((r) => r.isOther)
          const otherSelected = other ? mine.some((r) => r.reasonId === other.id) : false
          return (
            <div key={stage.id} className="mt-3 border-t border-dashed border-line pt-2.5">
              <p className="mb-2 text-body font-semibold">{stage.name}</p>
              <Chips
                groupLabel={`${stage.name} reasons`}
                options={stage.reasons.map((r) => r.id)}
                value={mine.map((r) => r.reasonId)}
                onChange={(ids) => setStageReasons(stage.id, ids)}
                primary={draft.primaryReasonId}
                onPrimary={(id) => set({ primaryReasonId: id })}
                labelOf={(id) => reasonById.get(id)?.name ?? id}
                retiredOf={(id) => reasonById.get(id)?.retired === true}
                disabled={disabled}
              />
              {otherSelected && other ? (
                <DictationRow
                  disabled={disabled}
                  onText={(text) =>
                    setOtherText(
                      other.id,
                      appendDictated(
                        mine.find((r) => r.reasonId === other.id)?.otherText ?? '',
                        text,
                        OTHER_TEXT_MAX,
                      ),
                    )
                  }
                >
                  <Input
                    maxLength={OTHER_TEXT_MAX}
                    placeholder="Describe the other reason (goes to the review queue)"
                    disabled={disabled}
                    aria-label={`Other reason under ${stage.name}`}
                    value={mine.find((r) => r.reasonId === other.id)?.otherText ?? ''}
                    onChange={(e) => setOtherText(other.id, e.target.value)}
                  />
                </DictationRow>
              ) : null}
            </div>
          )
        })}
        {draft.reasons.length > 1 ? (
          <div className="mt-3.5">
            <Field label="Primary reason (the biggest contributor)" htmlFor={primaryReasonId}>
              <Select
                id={primaryReasonId}
                disabled={disabled}
                value={draft.primaryReasonId ?? ''}
                onChange={(e) => set({ primaryReasonId: e.target.value || null })}
              >
                {draft.reasons.map((r) => (
                  <option key={r.reasonId} value={r.reasonId}>
                    {stageOfReason.get(r.reasonId)?.name}: {reasonById.get(r.reasonId)?.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : null}
      </Section>

      {/* 4. Department / consulted team */}
      {showDepartments ? (
        <Section id={JUMP.teams} title="Department / consulted team involved" icon={<Users size={18} />}>
          <Chips
            groupLabel="Departments"
            options={reference.departments.map((d) => d.id)}
            value={draft.consults.map((c) => c.departmentId)}
            onChange={setDepartments}
            labelOf={(id) => departmentName.get(id) ?? id}
            retiredOf={(id) => retiredDepartments.has(id)}
            disabled={disabled}
          />
          {draft.consults.map((consult) => (
            <div key={consult.departmentId} className="mt-3 border-t border-dashed border-line pt-2.5">
              <p className="mb-2 text-body font-semibold">{departmentName.get(consult.departmentId)}</p>
              <Chain
                steps={CONSULT_STEPS}
                value={consult}
                onChange={(next) => setConsult(consult.departmentId, next)}
                disabled={disabled}
              />
            </div>
          ))}
        </Section>
      ) : null}

      {/* 5. Investigation times */}
      {showInvestigations ? (
        <Section id={JUMP.tests} title="Investigation times" icon={<Activity size={18} />}>
          <Chips
            groupLabel="Investigation types"
            options={INVESTIGATION_TYPES}
            value={draft.investigations.map((i) => i.type)}
            onChange={setInvestigationTypes}
            labelOf={(t) => INVESTIGATION_LABELS[t]}
            disabled={disabled}
          />
          {draft.investigations.map((investigation) => (
            <div key={investigation.type} className="mt-3 border-t border-dashed border-line pt-2.5">
              <p className="mb-2 text-body font-semibold">{INVESTIGATION_LABELS[investigation.type]}</p>
              <Chain
                steps={INVESTIGATION_STEPS[investigation.type]}
                value={investigation}
                onChange={(next) => setInvestigation(investigation.type, next)}
                disabled={disabled}
              />
            </div>
          ))}
        </Section>
      ) : null}

      {/* 5b. Pain management (Phase 8b, decision F). Unconditional: Adaa KPI 8 is reported for
          every case, not only for the ones with an investigation. Nothing here is required. */}
      <Section title="Pain management (Adaa KPI 8)" icon={<ListChecks size={18} />}>
        <ChoiceRow
          label="Painkiller prescribed"
          options={YES_NO}
          labelOf={(v) => ANSWER_LABELS[v]}
          value={draft.painkillerPrescribed}
          onChange={setPainkillerPrescribed}
          disabled={disabled}
        />
        {draft.painkillerPrescribed === 'YES' ? (
          <>
            <ChoiceRow
              label="Pethidine"
              options={PETHIDINE_OPTIONS}
              labelOf={(v) => (v === 'NO' ? 'No' : `${v} mg`)}
              value={pethidineChoice}
              onChange={setPethidine}
              disabled={disabled}
            />
            <TimeRow
              label="Painkiller given at"
              value={draft.painkillerAt}
              onChange={(next) => set({ painkillerAt: next })}
              disabled={disabled}
            />
          </>
        ) : null}
        <div className="mt-2">
          <ChoiceRow
            label="Sickle-cell treatment identified"
            options={YES_NO}
            labelOf={(v) => ANSWER_LABELS[v]}
            value={draft.sickleCellTreatment}
            onChange={(v) => set({ sickleCellTreatment: v })}
            disabled={disabled}
          />
        </div>
      </Section>

      {/* 6. Admission times */}
      {showAdmission ? (
        <Section title="Admission times" icon={<ClipboardList size={18} />}>
          <Chain steps={ADMISSION_STEPS} value={draft} onChange={(next) => set(next)} disabled={disabled} />
        </Section>
      ) : null}

      {/* 6b. Case management (Phase 8b, decision B). Also unconditional: a referral to the case
          manager can happen at any stage, and the coordinator's response time is the figure. */}
      <Section title="Case management" icon={<Users size={18} />}>
        <ChoiceRow
          label="Referred to"
          options={CASE_MGMT_REFERRALS}
          labelOf={(v) => CASE_MANAGEMENT_LABELS.referral[v]}
          value={draft.caseMgmtReferral}
          onChange={setCaseMgmtReferral}
          disabled={disabled}
        />
        {draft.caseMgmtReferral ? (
          <>
            <ChoiceRow
              label="Criteria"
              options={CASE_MGMT_CRITERIA}
              labelOf={(v) => CASE_MANAGEMENT_LABELS.criteria[v]}
              value={draft.caseMgmtCriteria}
              onChange={(v) => set({ caseMgmtCriteria: v })}
              disabled={disabled}
            />
            <ChoiceRow
              label="Action"
              options={CASE_MGMT_ACTIONS}
              labelOf={(v) => CASE_MANAGEMENT_LABELS.action[v]}
              value={draft.caseMgmtAction}
              onChange={(v) => set({ caseMgmtAction: v })}
              disabled={disabled}
            />
            <TimeRow
              label="Called at"
              value={draft.caseMgmtCalledAt}
              onChange={(next) => set({ caseMgmtCalledAt: next })}
              disabled={disabled}
            />
            <TimeRow
              label="Replied at"
              value={draft.caseMgmtRepliedAt}
              onChange={(next) => set({ caseMgmtRepliedAt: next })}
              disabled={disabled}
            />
          </>
        ) : null}
      </Section>

      {/* 7. Referral out */}
      {showReferral ? (
        <Section title="Referral out" icon={<FileText size={18} />}>
          <Field label="Referral tracking number">
            <Input
              placeholder="e.g. RCC-48213"
              disabled={disabled}
              value={draft.referralTrackingNo}
              onChange={(e) => set({ referralTrackingNo: e.target.value })}
            />
          </Field>
          <Field label="Receiving facility">
            <Input
              placeholder="e.g. Al Mouwasat, Erada"
              disabled={disabled}
              value={draft.transferFacility}
              onChange={(e) => set({ transferFacility: e.target.value })}
            />
          </Field>
          <Chain steps={TRANSFER_STEPS} value={draft} onChange={(next) => set(next)} disabled={disabled} />
        </Section>
      ) : null}

      {/* 8. Journey times */}
      <Section id={JUMP.times}>
        <Button className="w-full text-left" onClick={() => setShowJourney(!showJourney)}>
          {showJourney ? 'Hide' : 'Add'} journey times (optional)
        </Button>
        {showJourney ? (
          <div className="mt-3">
            {/* The milestone number is the row's own `step` since Phase 11: on a phone it sits on
                the label's line, so the time box below it keeps the whole width. */}
            {MILESTONES.map(([key, label], index) => (
              <TimeRow
                key={key}
                step={index + 1}
                label={label}
                value={draft[key]}
                onChange={(next) => set({ [key]: next } as Partial<CaseDraft>)}
                disabled={disabled}
              />
            ))}
            <div className="mt-2">
              <TimeRow
                label="Medical admin on-call informed at"
                value={draft.medAdminInformedAt}
                onChange={(next) => set({ medAdminInformedAt: next })}
                disabled={disabled}
              />
            </div>
          </div>
        ) : null}
      </Section>

      {/* 9. Updates */}
      {!isNew ? (
        <Section id={JUMP.updates} title="Updates" icon={<History size={18} />}>
          {updates.length === 0 ? (
            <p className="mb-2 text-caption text-muted">No updates yet. Add one when something changes.</p>
          ) : null}
          <ul className="mb-2.5">
            {updates.map((u) => (
              <li key={u.id} className="border-b border-line-soft py-1.5 text-body">
                <span className="num mr-2 text-muted">{fmtStamp(u.createdAt)}</span>
                {/* Phase 8b, decision C: the deck's category, before the text it describes. */}
                {u.action ? (
                  <span
                    data-update-action={u.action}
                    className="mr-1.5 rounded-chip border border-line px-1.5 py-px text-caption text-ink-2"
                  >
                    {UPDATE_ACTION_LABELS[u.action]}
                  </span>
                ) : null}
                {u.text}
                <span className="text-muted"> · {u.author}</span>
              </li>
            ))}
          </ul>
          {readOnly ? null : (
            <>
              {/* Optional: most updates describe no action at all, and the deck counts those as
                  their own row rather than pretending they were one of the six. */}
              <ChoiceRow
                label="Action taken (optional)"
                options={UPDATE_ACTIONS}
                labelOf={(a) => UPDATE_ACTION_LABELS[a]}
                value={updateAction}
                onChange={setUpdateAction}
                disabled={busy}
              />
              {/* `items-start`: the microphone's line, when it shows, is under the box only, and the
                  Add button keeps its height rather than stretching down beside it. */}
              <div className="flex items-start gap-2">
                <DictationRow
                  disabled={busy}
                  onText={(text) => setUpdateText((current) => appendDictated(current, text, UPDATE_TEXT_MAX))}
                >
                  <Input
                    maxLength={UPDATE_TEXT_MAX}
                    aria-label="What changed?"
                    placeholder="What changed?"
                    disabled={busy}
                    value={updateText}
                    onChange={(e) => setUpdateText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void onAddUpdate()
                      }
                    }}
                  />
                </DictationRow>
                <Button tone="main" className="shrink-0" disabled={busy} onClick={() => void onAddUpdate()}>
                  Add
                </Button>
              </div>
              <p className="mt-1.5 text-caption text-muted">MRN only, no names.</p>
              {updateWarnings.map((w) => (
                <p key={w} className="mt-1.5 text-caption text-band-h4-ink" role="status">
                  {w}
                </p>
              ))}
            </>
          )}
        </Section>
      ) : null}

      {/* 9b. Timeline (Phase 8): server-rendered, read-only, after the updates. */}
      {props.timeline}

      {/* 10. Resolve */}
      {!isNew ? (
        <Section
          id={JUMP.resolve}
          title={status === 'RESOLVED' ? 'Resolved' : 'Resolve case'}
          icon={<Check size={18} />}
        >
          <Field label="Final disposition" htmlFor={dispositionId}>
            <Select
              id={dispositionId}
              disabled={disabled}
              value={draft.disposition ?? ''}
              onChange={(e) =>
                set({ disposition: (e.target.value || null) as CaseDraft['disposition'] })
              }
            >
              <option value="">Select</option>
              {DISPOSITIONS.map((d) => (
                <option key={d} value={d}>
                  {DISPOSITION_LABELS[d]}
                </option>
              ))}
            </Select>
          </Field>
          {/* Phase 8b, decision D. Three answers, not two: a navigator writing the case up after
              the shift may genuinely not know whether the doctor gave instructions. */}
          <ChoiceRow
            label="Instructions given by doctor"
            options={YES_NO_UNSURE}
            labelOf={(v) => ANSWER_LABELS[v]}
            value={draft.instructionsGiven}
            onChange={(v) => set({ instructionsGiven: v })}
            disabled={disabled}
          />
          <ChoiceRow
            label="Family engaged"
            options={YES_NO_UNSURE}
            labelOf={(v) => ANSWER_LABELS[v]}
            value={draft.familyEngagement}
            onChange={(v) => set({ familyEngagement: v })}
            disabled={disabled}
          />
          {draft.disposition === 'ADMITTED' ? (
            <div>
              <FieldGroup label="Ward">
                <Chips
                  groupLabel="Ward"
                  options={reference.wards.map((w) => w.id)}
                  value={draft.wardId ? [draft.wardId] : []}
                  onChange={(ids) => set({ wardId: ids[ids.length - 1] ?? null })}
                  labelOf={(id) => reference.wards.find((w) => w.id === id)?.code ?? id}
                  retiredOf={(id) => retiredWards.has(id)}
                  disabled={disabled}
                />
              </FieldGroup>
              <label className="mb-3 flex min-h-11 items-center gap-2 text-body">
                <input
                  type="checkbox"
                  className="size-5 rounded-sm border-line accent-accent"
                  disabled={disabled}
                  checked={draft.isolation}
                  onChange={(e) => set({ isolation: e.target.checked })}
                />
                Isolation / negative pressure room
              </label>
            </div>
          ) : null}
          <Field label="Left ED at (defaults to now)">
            <LocalTimeInput
              value={draft.departedAt}
              disabled={disabled}
              onChange={(next) => set({ departedAt: next })}
            />
          </Field>
          <Field label="Resolution note (optional)" htmlFor={noteId}>
            <DictationRow
              disabled={disabled}
              onText={(text) => set({ resolutionNote: appendDictated(draft.resolutionNote, text, NOTE_MAX) })}
            >
              <Input
                id={noteId}
                maxLength={NOTE_MAX}
                disabled={disabled}
                value={draft.resolutionNote}
                onChange={(e) => set({ resolutionNote: e.target.value })}
              />
            </DictationRow>
          </Field>
          {readOnly ? null : status === 'OPEN' ? (
            <Button
              tone="main"
              className="w-full"
              disabled={busy || !draft.disposition}
              onClick={() => void onResolve()}
            >
              Mark resolved
            </Button>
          ) : (
            <Button className="w-full" disabled={busy} onClick={() => void onReopen()}>
              Reopen case
            </Button>
          )}

          {/* Phase 8b, decision H. Under the Resolve block: the line for everyone, the control
              only for a SUPERVISOR or an ADMIN (`case.review`, re-checked in the service). A
              second mark simply moves the time and the name to whoever read it last. */}
          {review || props.canReview ? (
            <div
              data-review
              className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-dashed border-line pt-3"
            >
              {review ? (
                <p className="text-caption text-muted">
                  Reviewed by {review.byName}, <span className="num">{fmtStamp(review.at)}</span>
                </p>
              ) : null}
              {props.canReview ? (
                <Button disabled={busy} onClick={() => void onReview()}>
                  {review ? 'Mark again' : 'Mark reviewed'}
                </Button>
              ) : null}
            </div>
          ) : null}
        </Section>
      ) : null}

      {/* 11. Check these times */}
      {warnings.length > 0 ? (
        <Section title="Check these times" tone="warn" icon={<TriangleAlert size={18} />}>
          {warnings.map((w) => (
            <p key={w} className="py-0.5 text-caption">
              {w}
            </p>
          ))}
          <p className="mt-2 text-caption text-muted">
            You can still save. Out-of-order times are left out of the averages.
          </p>
        </Section>
      ) : null}

      {/* feedback: under the sections on a case, in the bar over "Open case" on a new one */}
      {isNew ? null : <div className="mx-4">{feedback}</div>}

      {/* 12. Save */}
      {readOnly ? null : isNew ? (
        /* Phase 11, finding 3: on a new case the bar sticks to the foot of the screen, above the
           home indicator, so the case opens the moment the MRN, the stage and the reason are in;
           it used to wait under every section the form grows, most of which mean nothing before
           the case exists. The sections stay where they were: the bar is still last in the page
           and settles into its place at the end. What a refused create says is in the bar too,
           over the button, because a message at the foot of the form is off screen from the top. */
        <div className="sticky bottom-0 z-10 border-t border-line bg-panel px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] lg:mx-4 lg:rounded-t-card lg:border-x">
          {/* Edge to edge on a phone, like the tab bar; on a laptop, where the column sits in open
              ground, a tray lined up with the cards above it. */}
          {feedback}
          <Button tone="main" className="w-full" disabled={!canSave || busy} onClick={() => void onSave()}>
            Open case
          </Button>
          {!canSave ? <p className="mt-1.5 text-caption text-muted">{saveHint}</p> : null}
        </div>
      ) : (
        <>
          <div className="flex gap-2.5 p-4">
            <Button tone="main" className="flex-1" disabled={!canSave || busy} onClick={() => void onSave()}>
              Save changes
            </Button>
            {canVoid ? (
              <Button tone="danger" disabled={busy} onClick={() => setVoidOpen(!voidOpen)}>
                Void
              </Button>
            ) : null}
          </div>
          {voidOpen ? (
            <div className="px-4 pb-4">
              <Field label="Why is this case voided?">
                <Input
                  disabled={busy}
                  placeholder="e.g. opened twice by mistake"
                  value={voidReasonText}
                  onChange={(e) => setVoidReasonText(e.target.value)}
                />
              </Field>
              {/* Two taps on the destructive step, the prototype's guard: the first arms the
                  button for three seconds, the second commits. Nothing is deleted; the case is
                  voided with this reason and stays on the record. */}
              <ConfirmButton
                label="Void this case"
                confirmLabel="Tap again to void"
                disabled={busy || voidReasonText.trim().length < 3}
                onConfirm={() => void onVoid()}
              />
            </div>
          ) : null}
          {!canSave ? <p className="mx-4 mb-4 text-caption text-muted">{saveHint}</p> : null}
        </>
      )}
    </main>
  )
}

/** Keep the first selected reason as primary when the current one is gone (prototype). */
function nextPrimary(reasons: ReadonlyArray<{ reasonId: string }>, current: string | null): string | null {
  if (current && reasons.some((r) => r.reasonId === current)) return current
  return reasons[0]?.reasonId ?? null
}

/**
 * A labelled single-select chip row over a nullable enum — the shape every Phase 8b answer takes,
 * and the same gesture the Ward and ED-area rows already use: tap to choose, tap the chosen chip
 * again to clear. `Chips` is a multi-select control, so "single" is the last value it hands back.
 */
function ChoiceRow<T extends string>({
  label,
  options,
  labelOf,
  value,
  onChange,
  disabled,
}: {
  label: string
  options: readonly T[]
  labelOf: (value: T) => string
  value: T | null
  onChange: (next: T | null) => void
  disabled?: boolean
}) {
  return (
    <FieldGroup label={label}>
      <Chips
        groupLabel={label}
        options={options}
        value={value === null ? [] : [value]}
        onChange={(next) => onChange(next[next.length - 1] ?? null)}
        labelOf={labelOf}
        disabled={disabled}
      />
    </FieldGroup>
  )
}
