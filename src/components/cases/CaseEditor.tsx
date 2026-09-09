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
import { useEffect, useMemo, useState } from 'react'
import {
  acknowledgeAlert as acknowledgeAlertAction,
  addCaseUpdate as addCaseUpdateAction,
  createCase as createCaseAction,
  reopenCase as reopenCaseAction,
  resolveCase as resolveCaseAction,
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
} from '@/src/components/ui'
import { fmtStamp, hoursAgo, nowLocalInput, shiftMinutes } from '@/src/lib/cases/local-time'
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
  CONSULT_STEPS,
  DISPOSITION_LABELS,
  INVESTIGATION_LABELS,
  INVESTIGATION_STEPS,
  MILESTONES,
  SHIFT_LABELS,
  TRANSFER_STEPS,
} from '@/src/lib/domain/taxonomy'
import { band, elapsedHours, fmtHours, spokenHours, type Band } from '@/src/lib/domain/time'
import { MRN_RE, phiWarnings, REGISTRATION_NUDGE_MINUTES, REGISTRATION_QUICK_HOURS } from '@/src/lib/domain/validation'
import { timeWarnings } from '@/src/lib/domain/warnings'

const CLOCK_TICK_MS = 30_000

/** The 4 h band is the one token that is too light for text; its ink variant is the text colour. */
const BAND_TEXT: Record<Band, string> = {
  none: 'text-band-none',
  ok: 'text-band-ok',
  h4: 'text-band-h4-ink',
  h6: 'text-band-h6',
  h12: 'text-band-h12',
  h24: 'text-band-h24',
}

const INVESTIGATION_TYPES = ['LAB', 'CT', 'US', 'XR'] as const
const DISPOSITIONS = Object.keys(DISPOSITION_LABELS) as Array<keyof typeof DISPOSITION_LABELS>
const SHIFTS = Object.keys(SHIFT_LABELS) as Array<keyof typeof SHIFT_LABELS>

const BLANK_INVESTIGATION = {
  orderedAt: null,
  collectedAt: null,
  receivedAt: null,
  doneAt: null,
  resultedAt: null,
} as const

export type CaseEditorProps = {
  reference: ReferenceData
  initial: CaseDraft
  caseId: string | null
  initialStatus: 'OPEN' | 'RESOLVED' | 'VOIDED'
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
  /** Taken on the server so the first client render is byte-identical. */
  nowIso: string
}

export function CaseEditor(props: CaseEditorProps) {
  const { reference, caseId, navigatorName, readOnly, canVoid } = props
  const isNew = caseId === null

  const [draft, setDraft] = useState<CaseDraft>(props.initial)
  const [status, setStatus] = useState(props.initialStatus)
  const [updates, setUpdates] = useState<CaseUpdateView[]>(props.initialUpdates)
  const [updateText, setUpdateText] = useState('')
  const [updateWarnings, setUpdateWarnings] = useState<string[]>([])
  const [showJourney, setShowJourney] = useState(!isNew)
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [conflict, setConflict] = useState<{ changedBy: string; changedAt: string } | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [voidReasonText, setVoidReasonText] = useState('')
  const [voidOpen, setVoidOpen] = useState(false)
  const [now, setNow] = useState(() => new Date(props.nowIso))
  const [alert, setAlert] = useState(props.alert ?? null)

  // The clock ticks only while the case is open; a resolved case is frozen at its departure time.
  // `now` starts at the server's instant so the first client render matches the server's HTML.
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

  const selectedStages = draft.stages.map((id) => stageById.get(id)).filter((s) => s !== undefined)
  const stageCodes = new Set(selectedStages.map((s) => s.code))

  // --- derived state --------------------------------------------------------------------------

  const elapsed = elapsedHours(
    {
      status,
      registrationAt: new Date(draft.registrationAt),
      // resolve always writes departedAt, so it is the end of the clock for a resolved case.
      departedAt: draft.departedAt ? new Date(draft.departedAt) : null,
      resolvedAt: null,
    },
    now,
  )

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
        consults: draft.consults.map((c) => ({
          departmentName: departmentName.get(c.departmentId) ?? 'team',
          consultedAt: c.consultedAt,
          seenAt: c.seenAt,
          repliedAt: c.repliedAt,
        })),
        investigations: draft.investigations,
      }),
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

  const setDepartments = (ids: string[]): void =>
    set({
      consults: ids.map(
        (id) =>
          draft.consults.find((c) => c.departmentId === id) ?? {
            departmentId: id,
            consultedAt: null,
            seenAt: null,
            repliedAt: null,
          },
      ),
    })

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

  // --- server round trips ----------------------------------------------------------------------

  const clearFeedback = (): void => {
    setIssues([])
    setConflict(null)
    setForbidden(false)
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

  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true)
    clearFeedback()
    try {
      await work()
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
        setSaved(true)
      } else handleFailure(result)
    })

  const onAddUpdate = (): Promise<void> =>
    run(async () => {
      const text = updateText.trim()
      if (!text || !caseId) return
      setUpdateWarnings([])
      const result = await addCaseUpdateAction(caseId, text)
      if (result.ok) {
        setUpdates((rows) => [...rows, result.update])
        setUpdateText('')
        setUpdateWarnings(result.warnings)
      } else handleFailure(result)
    })

  const onResolve = (): Promise<void> =>
    run(async () => {
      if (!caseId || !draft.disposition) return
      const departedAt = draft.departedAt ?? new Date().toISOString()
      const result = await resolveCaseAction(caseId, { ...draft, departedAt })
      if (result.ok) {
        set({ version: result.version, departedAt })
        setStatus('RESOLVED')
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

  return (
    // A <main> landmark: /cases/* sits outside the (app) shell, which has its own, and a page
    // with none is what Lighthouse flagged on the case editor (Phase 7).
    <main className="mx-auto max-w-[720px] pb-16">
      <div className="flex items-baseline justify-between px-4 pt-3.5 pb-1.5">
        <Link
          href="/"
          className="-ml-1 inline-flex min-h-11 items-center rounded-button px-3 text-body font-semibold text-accent-ink"
        >
          ‹ Back
        </Link>
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
            <Field label="Shift">
              <Select
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
      </Section>

      {/* 3. Where is the delay */}
      <Section title="Where is the delay?">
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
                disabled={disabled}
              />
              {otherSelected && other ? (
                <Input
                  placeholder="Describe the other reason (goes to the review queue)"
                  disabled={disabled}
                  aria-label={`Other reason under ${stage.name}`}
                  value={mine.find((r) => r.reasonId === other.id)?.otherText ?? ''}
                  onChange={(e) => setOtherText(other.id, e.target.value)}
                />
              ) : null}
            </div>
          )
        })}
        {draft.reasons.length > 1 ? (
          <div className="mt-3.5">
            <Field label="Primary reason (the biggest contributor)">
              <Select
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
        <Section title="Department / consulted team involved">
          <Chips
            groupLabel="Departments"
            options={reference.departments.map((d) => d.id)}
            value={draft.consults.map((c) => c.departmentId)}
            onChange={setDepartments}
            labelOf={(id) => departmentName.get(id) ?? id}
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
        <Section title="Investigation times">
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

      {/* 6. Admission times */}
      {showAdmission ? (
        <Section title="Admission times">
          <Chain steps={ADMISSION_STEPS} value={draft} onChange={(next) => set(next)} disabled={disabled} />
        </Section>
      ) : null}

      {/* 7. Referral out */}
      {showReferral ? (
        <Section title="Referral out">
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
      <Section>
        <Button className="w-full text-left" onClick={() => setShowJourney(!showJourney)}>
          {showJourney ? 'Hide' : 'Add'} journey times (optional)
        </Button>
        {showJourney ? (
          <div className="mt-3">
            {MILESTONES.map(([key, label], index) => (
              <div key={key} className="flex items-center gap-2">
                <span className="num w-4 text-caption text-muted" aria-hidden>
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <TimeRow
                    label={label}
                    value={draft[key]}
                    onChange={(next) => set({ [key]: next } as Partial<CaseDraft>)}
                    disabled={disabled}
                  />
                </div>
              </div>
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
        <Section title="Updates">
          {updates.length === 0 ? (
            <p className="mb-2 text-caption text-muted">No updates yet. Add one when something changes.</p>
          ) : null}
          <ul className="mb-2.5">
            {updates.map((u) => (
              <li key={u.id} className="border-b border-line-soft py-1.5 text-body">
                <span className="num mr-2 text-muted">{fmtStamp(u.createdAt)}</span>
                {u.text}
                <span className="text-muted"> · {u.author}</span>
              </li>
            ))}
          </ul>
          {readOnly ? null : (
            <>
              <div className="flex gap-2">
                <Input
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

      {/* 10. Resolve */}
      {!isNew ? (
        <Section title={status === 'RESOLVED' ? 'Resolved' : 'Resolve case'}>
          <Field label="Final disposition">
            <Select
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
          {draft.disposition === 'ADMITTED' ? (
            <div>
              <FieldGroup label="Ward">
                <Chips
                  groupLabel="Ward"
                  options={reference.wards.map((w) => w.id)}
                  value={draft.wardId ? [draft.wardId] : []}
                  onChange={(ids) => set({ wardId: ids[ids.length - 1] ?? null })}
                  labelOf={(id) => reference.wards.find((w) => w.id === id)?.code ?? id}
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
          <Field label="Resolution note (optional)">
            <Input
              disabled={disabled}
              value={draft.resolutionNote}
              onChange={(e) => set({ resolutionNote: e.target.value })}
            />
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
        </Section>
      ) : null}

      {/* 11. Check these times */}
      {warnings.length > 0 ? (
        <Section title="Check these times" tone="warn">
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

      {/* feedback */}
      {conflict ? (
        <div className="mx-4 mb-2.5 rounded-card border border-band-h4 bg-panel p-3" role="alert">
          <p className="text-body text-band-h4-ink">
            {conflictMessage(conflict.changedBy, conflict.changedAt ? fmtStamp(conflict.changedAt) : '')}
          </p>
          <Button className="mt-2" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      ) : null}
      {forbidden ? (
        <p className="mx-4 mb-2.5 rounded-card border border-line bg-panel p-3 text-body text-danger" role="alert">
          Your role cannot do that.
        </p>
      ) : null}
      {saved ? (
        <p className="mx-4 mb-2.5 text-caption text-band-ok" role="status">
          Saved.
        </p>
      ) : null}
      {issues.length > 0 ? (
        <div className="mx-4 mb-2.5 rounded-card border border-danger bg-panel p-3" role="alert">
          {issues.map((issue) => (
            <p key={`${issue.path}:${issue.message}`} className="text-body text-danger">
              {issue.message}
            </p>
          ))}
        </div>
      ) : null}

      {/* 12. Save */}
      {readOnly ? null : (
        <>
          <div className="flex gap-2.5 p-4">
            <Button tone="main" className="flex-1" disabled={!canSave || busy} onClick={() => void onSave()}>
              {isNew ? 'Open case' : 'Save changes'}
            </Button>
            {!isNew && canVoid ? (
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
          {!canSave ? (
            <p className="mx-4 mb-4 text-caption text-muted">
              {!mrnOk
                ? 'Enter the MRN as digits only.'
                : draft.reasons.length === 0
                  ? 'Select at least one delay reason.'
                  : ''}
            </p>
          ) : null}
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
