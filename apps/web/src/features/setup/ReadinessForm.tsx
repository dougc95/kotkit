/**
 * Task 8.1.3 — ReadinessForm at `/setup/readiness` (design.md's API
 * contracts table; specs/program-setup "Readiness step assigns materials
 * and benchmark times", "Saving never starts a timer", "Benchmark slots
 * freeze once attempted").
 *
 * Loads `GET /programs/current` and renders four controlled rows (baseline
 * A, baseline B, final A, final B). Save sends `PUT /programs/{id}/
 * benchmark-slots` with only the "filled" rows (a blank `materialRef` can
 * never be sent — the wire contract requires `minLength: 1` — so leaving a
 * row untouched simply omits it; an already-frozen row is always resent
 * unchanged since the API replaces whichever slots the body does not name
 * for an unfrozen row, but a frozen slot's key MUST be present). The final
 * A/B planned times mirror the same-label baseline time live, until the
 * user edits a final row's own time field directly (`finalsTouched`).
 *
 * `program.status !== 'draft'` in the PUT response navigates to `/today`
 * (baseline_ready or active, per D38 — this form also serves the
 * already-open-program edit path reached from Settings' "Edit benchmark
 * materials" link, not only first-time setup). A `draft` response instead
 * renders `MissingSlots` from the response's own `missing[]` — never a
 * client-computed completeness guess. This screen never calls
 * `POST /sessions`.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  BenchmarkPhase,
  PutSlotsBodyValue,
  PutSlotsResponseValue,
  SlotLabel,
  SlotResponseValue,
} from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'

// ---------------------------------------------------------------------------
// The four required (phase, label) rows this screen edits. The optional
// midpoint slot is never part of readiness (readiness.ts's own
// `REQUIRED_SLOTS`) and is out of scope here.
// ---------------------------------------------------------------------------

export type SlotKey = 'baseline:A' | 'baseline:B' | 'final:A' | 'final:B'

interface SlotDef {
  readonly key: SlotKey
  readonly phase: 'baseline' | 'final'
  readonly label: SlotLabel
  readonly title: string
}

const SLOT_DEFS: readonly SlotDef[] = [
  { key: 'baseline:A', phase: 'baseline', label: 'A', title: 'Baseline A' },
  { key: 'baseline:B', phase: 'baseline', label: 'B', title: 'Baseline B' },
  { key: 'final:A', phase: 'final', label: 'A', title: 'Final A' },
  { key: 'final:B', phase: 'final', label: 'B', title: 'Final B' },
]

const SLOT_TITLES: Record<SlotKey, string> = {
  'baseline:A': 'Baseline A',
  'baseline:B': 'Baseline B',
  'final:A': 'Final A',
  'final:B': 'Final B',
}

function keyFor(phase: 'baseline' | 'final', label: SlotLabel): SlotKey {
  return `${phase}:${label}` as SlotKey
}

function findSlot(
  slots: readonly SlotResponseValue[],
  phase: BenchmarkPhase,
  label: SlotLabel,
): SlotResponseValue | undefined {
  return slots.find((slot) => slot.phase === phase && slot.label === label)
}

// ---------------------------------------------------------------------------
// Row state
// ---------------------------------------------------------------------------

interface RowFields {
  readonly materialRef: string
  readonly language: string
  readonly deviceFormat: string
  readonly materialLevel: string
  readonly plannedLocalTime: string
}

type RowsState = Record<SlotKey, RowFields>

const BLANK_ROW: RowFields = {
  materialRef: '',
  language: '',
  deviceFormat: '',
  materialLevel: '',
  plannedLocalTime: '',
}

function emptyRows(): RowsState {
  const rows = {} as RowsState
  for (const def of SLOT_DEFS) {
    rows[def.key] = BLANK_ROW
  }
  return rows
}

function seedRows(slots: readonly SlotResponseValue[]): RowsState {
  const rows = {} as RowsState
  for (const def of SLOT_DEFS) {
    const slot = findSlot(slots, def.phase, def.label)
    rows[def.key] = {
      materialRef: slot?.materialRef ?? '',
      language: slot?.language ?? '',
      deviceFormat: slot?.deviceFormat ?? '',
      materialLevel: slot?.materialLevel ?? '',
      plannedLocalTime: slot?.plannedLocalTime ?? '',
    }
  }
  return rows
}

/**
 * A final row counts as already-touched on load only when it already
 * carries a planned time that differs from its same-label baseline's —
 * i.e. it was deliberately set apart in an earlier save. A final row that
 * merely mirrors its baseline (or has no time yet) stays live-synced.
 */
function seedFinalsTouched(slots: readonly SlotResponseValue[]): Record<SlotLabel, boolean> {
  const touched = {} as Record<SlotLabel, boolean>
  for (const label of ['A', 'B'] as const) {
    const baseline = findSlot(slots, 'baseline', label)
    const final = findSlot(slots, 'final', label)
    touched[label] = final?.plannedLocalTime != null && final.plannedLocalTime !== (baseline?.plannedLocalTime ?? null)
  }
  return touched
}

function frozenKeysFromSlots(slots: readonly SlotResponseValue[]): ReadonlySet<SlotKey> {
  const keys = new Set<SlotKey>()
  for (const def of SLOT_DEFS) {
    const slot = findSlot(slots, def.phase, def.label)
    if (slot?.frozenAt !== null && slot?.frozenAt !== undefined) {
      keys.add(def.key)
    }
  }
  return keys
}

// ---------------------------------------------------------------------------
// Client-side rules
// ---------------------------------------------------------------------------

/** The literal copy read-only frozen rows and the 409 `slot_frozen` notice both use. */
const FROZEN_EXPLANATION = 'This slot is frozen because it already has an attempt.'
const ONE_HOUR_MESSAGE = 'Baseline A and B must be at least one hour apart.'
const STALE_NOTICE = 'The program changed in another tab.'

function minutesOfDay(time: string): number {
  const hours = Number(time.slice(0, 2))
  const minutes = Number(time.slice(3, 5))
  return hours * 60 + minutes
}

/** Mirrors readiness.ts's `atLeastOneHourApart` client-side (this task's own pre-check). */
function atLeastOneHourApart(a: string, b: string): boolean {
  return Math.abs(minutesOfDay(a) - minutesOfDay(b)) >= 60
}

function trimmedOrUndefined(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

type SlotItem = PutSlotsBodyValue['slots'][number]

function buildSlotItem(def: SlotDef, row: RowFields, materialRef: string): SlotItem {
  const language = trimmedOrUndefined(row.language)
  const deviceFormat = trimmedOrUndefined(row.deviceFormat)
  const materialLevel = trimmedOrUndefined(row.materialLevel)
  const plannedLocalTime = trimmedOrUndefined(row.plannedLocalTime)
  return {
    phase: def.phase,
    label: def.label,
    materialRef,
    ...(language !== undefined ? { language } : {}),
    ...(deviceFormat !== undefined ? { deviceFormat } : {}),
    ...(materialLevel !== undefined ? { materialLevel } : {}),
    ...(plannedLocalTime !== undefined ? { plannedLocalTime } : {}),
  }
}

function missingKeysFrom(missing: PutSlotsResponseValue['missing']): SlotKey[] {
  const keys: SlotKey[] = []
  for (const item of missing) {
    const key = keyFor(item.phase === 'final' ? 'final' : 'baseline', item.label)
    if (!keys.includes(key)) {
      keys.push(key)
    }
  }
  return keys
}

/** Duck-typed against the D18 error envelope — works for both a real `ApiError` and `mockClient`'s plain-Error `reject()` shape. */
interface KnownApiError {
  readonly status: number
  readonly code: string
  readonly details?: Record<string, unknown>
  readonly fieldErrors?: Record<string, unknown>
}

function asKnownApiError(error: unknown): KnownApiError | null {
  if (typeof error !== 'object' || error === null) {
    return null
  }
  const record = error as Record<string, unknown>
  if (typeof record.status !== 'number' || typeof record.code !== 'string') {
    return null
  }
  return record as unknown as KnownApiError
}

function formatFieldError(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') : String(value)
}

// ---------------------------------------------------------------------------
// SlotRow
// ---------------------------------------------------------------------------

export interface SlotRowProps {
  readonly slot: SlotDef
  readonly frozen: boolean
  readonly value: RowFields
  readonly onChange: (field: keyof RowFields, value: string) => void
}

export function SlotRow({ slot, frozen, value, onChange }: SlotRowProps) {
  const idBase = `readiness-${slot.key.replace(':', '-')}`

  return (
    <fieldset
      disabled={frozen}
      data-slot-key={slot.key}
      className="mb-6 rounded-md border border-[var(--color-border)] p-4"
    >
      <legend className="px-1 text-base font-semibold">{slot.title}</legend>

      {frozen ? <p className="mb-2 text-sm text-[var(--color-text-muted)]">{FROZEN_EXPLANATION}</p> : null}

      <div className="grid gap-3">
        <div>
          <label htmlFor={`${idBase}-materialRef`}>Material reference</label>
          <input
            id={`${idBase}-materialRef`}
            type="text"
            value={value.materialRef}
            onChange={(event) => onChange('materialRef', event.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] px-3 py-2"
          />
        </div>

        <div>
          <label htmlFor={`${idBase}-language`}>Language (optional)</label>
          <input
            id={`${idBase}-language`}
            type="text"
            value={value.language}
            onChange={(event) => onChange('language', event.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] px-3 py-2"
          />
        </div>

        <div>
          <label htmlFor={`${idBase}-deviceFormat`}>Device format (optional)</label>
          <input
            id={`${idBase}-deviceFormat`}
            type="text"
            value={value.deviceFormat}
            onChange={(event) => onChange('deviceFormat', event.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] px-3 py-2"
          />
        </div>

        <div>
          <label htmlFor={`${idBase}-materialLevel`}>Material level (optional)</label>
          <input
            id={`${idBase}-materialLevel`}
            type="text"
            value={value.materialLevel}
            onChange={(event) => onChange('materialLevel', event.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] px-3 py-2"
          />
        </div>

        <div>
          <label htmlFor={`${idBase}-plannedLocalTime`}>{slot.title} planned time</label>
          <input
            id={`${idBase}-plannedLocalTime`}
            type="text"
            inputMode="numeric"
            placeholder="HH:MM"
            value={value.plannedLocalTime}
            onChange={(event) => onChange('plannedLocalTime', event.target.value)}
            className="mt-1 w-32 rounded-md border border-[var(--color-border)] px-3 py-2"
          />
        </div>
      </div>
    </fieldset>
  )
}

// ---------------------------------------------------------------------------
// MissingSlots
// ---------------------------------------------------------------------------

export interface MissingSlotsProps {
  readonly missing: readonly SlotKey[]
}

export function MissingSlots({ missing }: MissingSlotsProps) {
  if (missing.length === 0) {
    return null
  }

  return (
    <div className="mb-6 rounded-md border border-[var(--color-border)] p-4">
      <p>Still needed before this program is ready:</p>
      <ul aria-label="Missing slots">
        {missing.map((key) => (
          <li key={key}>{SLOT_TITLES[key]}</li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ReadinessForm
// ---------------------------------------------------------------------------

export function ReadinessForm() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: queryKeys.programs.current, queryFn: api.programs.current })

  const [rows, setRows] = useState<RowsState>(emptyRows)
  const [finalsTouched, setFinalsTouched] = useState<Record<SlotLabel, boolean>>({ A: false, B: false })
  const [missing, setMissing] = useState<readonly SlotKey[]>([])
  const [oneHourMessage, setOneHourMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(null)
  const [frozenOverride, setFrozenOverride] = useState<ReadonlySet<SlotKey>>(new Set())
  const initializedRef = useRef(false)

  useEffect(() => {
    if (initializedRef.current || query.data === undefined) {
      return
    }
    initializedRef.current = true
    setRows(seedRows(query.data.slots))
    setFinalsTouched(seedFinalsTouched(query.data.slots))
  }, [query.data])

  const mutation = useMutation<
    PutSlotsResponseValue,
    unknown,
    { readonly programId: string; readonly body: PutSlotsBodyValue }
  >({
    mutationFn: ({ programId, body }) => api.programs.putSlots(programId, body),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.programs.current })
      setNotice(null)
      setFieldErrors(null)
      if (data.program.status !== 'draft') {
        navigate('/today')
        return
      }
      setMissing(missingKeysFrom(data.missing))
    },
    onError: (error) => {
      const known = asKnownApiError(error)
      if (known === null) {
        return
      }
      if (known.status === 409 && known.code === 'stale_version') {
        setNotice(STALE_NOTICE)
        void queryClient.invalidateQueries({ queryKey: queryKeys.programs.current })
        return
      }
      if (known.status === 409 && known.code === 'slot_frozen') {
        const details = known.details as { phase?: unknown; label?: unknown } | undefined
        if (typeof details?.phase === 'string' && typeof details?.label === 'string') {
          const phase = details.phase === 'final' ? 'final' : 'baseline'
          const label = details.label === 'B' ? 'B' : 'A'
          setFrozenOverride((prev) => new Set(prev).add(keyFor(phase, label)))
        }
        setNotice(FROZEN_EXPLANATION)
        return
      }
      if (known.status === 422 && known.code === 'baseline_times_too_close') {
        setOneHourMessage(ONE_HOUR_MESSAGE)
        return
      }
      if ((known.status === 400 || known.status === 422) && known.fieldErrors !== undefined) {
        setFieldErrors(known.fieldErrors)
      }
    },
  })

  if (query.isPending) {
    return <div aria-busy="true">Loading</div>
  }

  if (query.isError || query.data === undefined) {
    return (
      <div>
        <p>Could not reach the server</p>
        <Button
          onClick={() => {
            void query.refetch()
          }}
        >
          Retry
        </Button>
      </div>
    )
  }

  const { program, slots } = query.data

  if (program === null) {
    // A cached `program: null` snapshot can be stale rather than current:
    // PlanForm's mutation `onSuccess` invalidates this same query key with a
    // fire-and-forget `void queryClient.invalidateQueries(...)` before
    // navigating here, so this component can mount and read the
    // pre-creation cache entry synchronously, before that background
    // refetch (which DOES have the just-created program) resolves. Redirect
    // only once a fetch is not in flight — a genuinely absent program stays
    // absent once settled, but a mid-refetch `null` gets one more chance.
    if (query.isFetching) {
      return <div aria-busy="true">Loading</div>
    }
    return <Navigate to="/setup" replace />
  }

  // Captured as primitives (never a nested closure over `program` itself) so
  // TypeScript's null-narrowing above survives into `handleSubmit`, which is
  // declared later in this same function body.
  const programId = program.id
  const expectedVersion = program.version

  const frozenKeys = new Set<SlotKey>([...frozenKeysFromSlots(slots), ...frozenOverride])

  function handleFieldChange(def: SlotDef, field: keyof RowFields, value: string): void {
    if (field === 'plannedLocalTime') {
      if (def.phase === 'baseline') {
        const finalKey = keyFor('final', def.label)
        setRows((prev) => {
          const next: RowsState = { ...prev, [def.key]: { ...prev[def.key], plannedLocalTime: value } }
          if (!finalsTouched[def.label]) {
            next[finalKey] = { ...prev[finalKey], plannedLocalTime: value }
          }
          return next
        })
      } else {
        setRows((prev) => ({ ...prev, [def.key]: { ...prev[def.key], plannedLocalTime: value } }))
        setFinalsTouched((prev) => ({ ...prev, [def.label]: true }))
      }
      return
    }
    setRows((prev) => ({ ...prev, [def.key]: { ...prev[def.key], [field]: value } }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setOneHourMessage(null)
    setNotice(null)
    setFieldErrors(null)

    const baselineATime = rows['baseline:A'].plannedLocalTime.trim()
    const baselineBTime = rows['baseline:B'].plannedLocalTime.trim()
    if (baselineATime !== '' && baselineBTime !== '' && !atLeastOneHourApart(baselineATime, baselineBTime)) {
      setOneHourMessage(ONE_HOUR_MESSAGE)
      return
    }

    const items: SlotItem[] = []
    for (const def of SLOT_DEFS) {
      const row = rows[def.key]
      const materialRef = row.materialRef.trim()
      if (materialRef === '' && !frozenKeys.has(def.key)) {
        continue
      }
      items.push(buildSlotItem(def, row, materialRef))
    }

    if (items.length === 0) {
      return
    }

    mutation.mutate({ programId, body: { expectedVersion, slots: items } })
  }

  return (
    <div>
      <h1>Readiness</h1>
      <p>Reading elsewhere is allowed; tallying on paper is fine.</p>

      {notice !== null ? <p role="status">{notice}</p> : null}
      {oneHourMessage !== null ? <p role="alert">{oneHourMessage}</p> : null}
      {fieldErrors !== null ? (
        <ul role="alert">
          {Object.entries(fieldErrors).map(([field, value]) => (
            <li key={field}>{formatFieldError(value)}</li>
          ))}
        </ul>
      ) : null}

      <form onSubmit={handleSubmit}>
        {SLOT_DEFS.map((def) => (
          <SlotRow
            key={def.key}
            slot={def}
            frozen={frozenKeys.has(def.key)}
            value={rows[def.key]}
            onChange={(field, value) => handleFieldChange(def, field, value)}
          />
        ))}

        <MissingSlots missing={missing} />

        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save'}
        </Button>
      </form>
    </div>
  )
}
