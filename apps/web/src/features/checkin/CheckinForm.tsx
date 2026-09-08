/**
 * Check-in core at `/checkin/:date` (task 8.7.1, extended by 8.7.2; design.md
 * D12, D22, D36; specs/daily-checkin). Default render shows exactly sleep,
 * phone, desktop, a "More detail" expand control and one primary Save
 * button — stress, mindfulness, note and per-platform detail rows (FeedRows,
 * FeedTotals, OptionalFields; 8.7.2's own pieces) mount inside the
 * `Collapsible.Content` below and, per Radix's own Presence/`isOpen &&
 * children` behavior, are not present in the DOM at all until "More detail"
 * is opened.
 *
 * State model: `checkinFormReducer` holds the whole day's draft, including
 * `detailRows` and the optional fields, even though this task's own UI never
 * edits them — `PUT /programs/{id}/days/{date}` is a full replace (D36 +
 * `saveCheckin`'s own header comment: every existing `feed_usage` row is
 * deleted and the submitted set reinserted, and an omitted `sleepMinutes` /
 * `stress` / `mindfulnessMinutes` / `note` is stored as `null`), so a save
 * from this screen alone must round-trip whatever 8.7.2 later saves or it
 * would silently erase it. This is also what makes "adding a desktop detail
 * row disables the desktop headline input and shows the summed total" a real
 * 8.7.1 case even before 8.7.2 exists: the GET response can already carry
 * platform-specific rows (a fixture, or a value 8.7.2 saved earlier), and
 * this component must render their disabled/summed state correctly on load.
 *
 * `GET /programs/current` never actually 404s (D22: `program: null` with a
 * 200 when there is no open program) — the brief's "404" is this codebase's
 * shorthand for that no-program case, not a literal HTTP status; the no-
 * program branch below is driven by `program === null`.
 */
import { useEffect, useReducer, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { Collapsible } from 'radix-ui'
import {
  FEED_PLATFORM_ALL,
  feedAggregates,
  type CheckinField,
  type CheckinStatus as CheckinStatusValue,
  type DayResponseValue,
  type FeedRowInput,
  type FeedRowValue,
  type PutDayBodyValue,
} from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'
import { CheckinStatus } from './CheckinStatus.js'
import { DeviceMinutesField, type HeadlineDevice } from './DeviceMinutesField.js'
import {
  DUPLICATE_ROW_MESSAGE,
  FeedRows,
  OptionalFields,
  SUBSET_VIOLATION_MESSAGE,
  hasBlockingDetailRowErrors,
  sendableDetailRow,
  toDraftRow,
  toFeedRowInput,
  validateDetailRows,
  validateMindfulnessMinutes,
  validateStress,
  type FeedRowDraft,
  type FeedRowFieldErrors,
  type FeedRowsErrors,
} from './FeedRows.js'
import { FeedTotals } from './FeedTotals.js'

// ---------------------------------------------------------------------------
// Form state and reducer
// ---------------------------------------------------------------------------

interface HeadlineDeviceRows {
  readonly phone: number | null
  readonly desktop: number | null
}

interface CheckinFormState {
  readonly sleepMinutes: number | null
  readonly deviceRows: HeadlineDeviceRows
  /** Every loaded/edited row whose platform is not `'all'` (any device) — edited in place by FeedRows (8.7.2). */
  readonly detailRows: readonly FeedRowDraft[]
  readonly stress: number | null
  readonly mindfulnessMinutes: number | null
  readonly note: string
  readonly version: number
  readonly status: CheckinStatusValue
  readonly missing: readonly CheckinField[]
}

const EMPTY_STATE: CheckinFormState = {
  sleepMinutes: null,
  deviceRows: { phone: null, desktop: null },
  detailRows: [],
  stress: null,
  mindfulnessMinutes: null,
  note: '',
  version: 0,
  status: 'not_reported',
  missing: ['sleep', 'feed'],
}

/** Splits a loaded day's `feed[]` into the phone/desktop headline values and every other row (D36). */
function stateFromDay(day: DayResponseValue): CheckinFormState {
  let phone: number | null = null
  let desktop: number | null = null
  const detailRows: FeedRowDraft[] = []

  for (const row of day.feed) {
    if (row.platform === FEED_PLATFORM_ALL && row.device === 'phone') {
      phone = row.minutes
      continue
    }
    if (row.platform === FEED_PLATFORM_ALL && row.device === 'desktop') {
      desktop = row.minutes
      continue
    }
    detailRows.push(toDraftRow(row))
  }

  return {
    sleepMinutes: day.checkin.sleepMinutes,
    deviceRows: { phone, desktop },
    detailRows,
    stress: day.checkin.stress,
    mindfulnessMinutes: day.checkin.mindfulnessMinutes,
    note: day.checkin.note ?? '',
    version: day.version,
    status: day.status.status,
    missing: day.status.missing,
  }
}

type CheckinFormAction =
  | { readonly type: 'loaded'; readonly day: DayResponseValue }
  | { readonly type: 'setSleep'; readonly value: number | null }
  | { readonly type: 'setDevice'; readonly device: HeadlineDevice; readonly value: number | null }
  | { readonly type: 'setDetailRows'; readonly rows: readonly FeedRowDraft[] }
  | { readonly type: 'setOptionalFields'; readonly patch: Partial<Pick<CheckinFormState, 'stress' | 'mindfulnessMinutes' | 'note'>> }
  | { readonly type: 'restoreDraft'; readonly draft: CheckinFormState }

/** Every currently-complete detail row, as `FeedRowInput` — the shape `feedAggregates` (2.6) expects. */
function completedDetailFeedInputs(rows: readonly FeedRowDraft[]): FeedRowInput[] {
  const inputs: FeedRowInput[] = []
  for (const row of rows) {
    const sendable = sendableDetailRow(row)
    if (sendable !== null) inputs.push(toFeedRowInput(sendable))
  }
  return inputs
}

function checkinFormReducer(state: CheckinFormState, action: CheckinFormAction): CheckinFormState {
  switch (action.type) {
    case 'loaded':
      return stateFromDay(action.day)
    case 'setSleep':
      return { ...state, sleepMinutes: action.value }
    case 'setDevice':
      return { ...state, deviceRows: { ...state.deviceRows, [action.device]: action.value } }
    case 'setDetailRows': {
      // D36: the first complete scope-`feed` detail row for a device CLEARS
      // (not merely visually overrides) that device's headline value, so it
      // never silently reappears once every detail row for the device is
      // removed again.
      const aggregates = feedAggregates(completedDetailFeedInputs(action.rows))
      const phone = aggregates.feedByDevice.phone !== null ? null : state.deviceRows.phone
      const desktop = aggregates.feedByDevice.desktop !== null ? null : state.deviceRows.desktop
      return { ...state, detailRows: action.rows, deviceRows: { phone, desktop } }
    }
    case 'setOptionalFields':
      return { ...state, ...action.patch }
    case 'restoreDraft':
      // Keeps the CURRENT (server-fresh) version — only the field values come from the draft.
      return { ...action.draft, version: state.version }
    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Feed row helpers
// ---------------------------------------------------------------------------

function headlineRow(device: HeadlineDevice, minutes: number): FeedRowValue {
  return { device, platform: FEED_PLATFORM_ALL, minutes, measurementScope: 'feed', source: 'estimate' }
}

/** Where one entry of the sent `feed[]` array came from — needed to route a server 422's `feed[i]...` field error back to the right on-screen control (a headline field, or a specific detail row by its ORIGINAL `state.detailRows` index, not its position among only the complete/sent rows). */
type FeedRowOrigin = { readonly kind: 'phone' } | { readonly kind: 'desktop' } | { readonly kind: 'detail'; readonly index: number }

/** D36: a headline row is sent only when its device carries no scope-`feed` detail row; an incomplete detail row (FeedRows.tsx's `sendableDetailRow`) is simply omitted, exactly like a blank headline field. */
function buildFeedSendPlan(
  state: CheckinFormState,
  disabled: Record<HeadlineDevice, boolean>,
): { readonly rows: FeedRowValue[]; readonly origin: FeedRowOrigin[] } {
  const rows: FeedRowValue[] = []
  const origin: FeedRowOrigin[] = []
  if (!disabled.phone && state.deviceRows.phone !== null) {
    rows.push(headlineRow('phone', state.deviceRows.phone))
    origin.push({ kind: 'phone' })
  }
  if (!disabled.desktop && state.deviceRows.desktop !== null) {
    rows.push(headlineRow('desktop', state.deviceRows.desktop))
    origin.push({ kind: 'desktop' })
  }
  state.detailRows.forEach((row, index) => {
    const sendable = sendableDetailRow(row)
    if (sendable === null) return
    rows.push(sendable)
    origin.push({ kind: 'detail', index })
  })
  return { rows, origin }
}

function buildPutBody(
  state: CheckinFormState,
  disabled: Record<HeadlineDevice, boolean>,
): { readonly body: PutDayBodyValue; readonly origin: FeedRowOrigin[] } {
  const { rows, origin } = buildFeedSendPlan(state, disabled)
  const body: PutDayBodyValue = {
    expectedVersion: state.version,
    feed: rows,
  }
  if (state.sleepMinutes !== null) {
    body.sleepMinutes = state.sleepMinutes
  }
  if (state.stress !== null) {
    body.stress = state.stress
  }
  if (state.mindfulnessMinutes !== null) {
    body.mindfulnessMinutes = state.mindfulnessMinutes
  }
  if (state.note.trim() !== '') {
    body.note = state.note
  }
  return { body, origin }
}

function deviceSummaryText(effective: number | null): string {
  return effective === null ? 'Not reported' : `${effective} min`
}

// ---------------------------------------------------------------------------
// Error shape — matches both a real `ApiError` instance and mockClient's
// plain-object stand-in (7.1.1's `reject()`), which is not one, structurally.
// ---------------------------------------------------------------------------

interface StructuredApiError {
  readonly status: number
  readonly code: string
  readonly fieldErrors?: Record<string, string | ReadonlyArray<string>>
  readonly details?: Record<string, unknown>
}

function isStructuredApiError(error: unknown): error is StructuredApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { status?: unknown }).status === 'number' &&
    typeof (error as { code?: unknown }).code === 'string'
  )
}

/** A field-error value is a single string on the real wire (D18) but mockClient's `reject()` types it as `string[]`; either is read as its first/only message. */
function fieldErrorText(value: string | ReadonlyArray<string> | undefined): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0]
  return undefined
}

const FEED_PLATFORM_CONFLICT_MESSAGE = 'Clear this total or remove the detail rows below'

// ---------------------------------------------------------------------------
// CheckinForm
// ---------------------------------------------------------------------------

export function CheckinForm() {
  const { date } = useParams<{ date: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const programQuery = useQuery({ queryKey: queryKeys.programs.current, queryFn: api.programs.current })
  const programId = programQuery.data?.program?.id ?? null

  const dayQuery = useQuery({
    queryKey: programId !== null && date !== undefined ? queryKeys.days(programId, date) : (['days', 'unresolved'] as const),
    queryFn: () => api.days.get(programId as string, date as string),
    enabled: programId !== null && date !== undefined,
  })

  const mutation = useMutation({
    mutationFn: (body: PutDayBodyValue) => api.days.put(programId as string, date as string, body),
  })

  const [state, dispatch] = useReducer(checkinFormReducer, EMPTY_STATE)
  const loadedForDateRef = useRef<string | null>(null)

  useEffect(() => {
    if (dayQuery.data !== undefined && date !== undefined && loadedForDateRef.current !== date) {
      dispatch({ type: 'loaded', day: dayQuery.data })
      loadedForDateRef.current = date
    }
  }, [dayQuery.data, date])

  const [fieldErrors, setFieldErrors] = useState<{ sleep?: string; phone?: string; desktop?: string }>({})
  const [detailRowErrors, setDetailRowErrors] = useState<FeedRowsErrors>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [staleNotice, setStaleNotice] = useState<{ readonly draft: CheckinFormState } | null>(null)

  // --- Which devices are disabled (D36) and their effective values --------
  const detailAggregates = feedAggregates(completedDetailFeedInputs(state.detailRows))
  const disabled: Record<HeadlineDevice, boolean> = {
    phone: detailAggregates.feedByDevice.phone !== null,
    desktop: detailAggregates.feedByDevice.desktop !== null,
  }
  const effectivePhone = disabled.phone ? detailAggregates.feedByDevice.phone : state.deviceRows.phone
  const effectiveDesktop = disabled.desktop ? detailAggregates.feedByDevice.desktop : state.deviceRows.desktop
  const feedSendPlan = buildFeedSendPlan(state, disabled)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (programId === null || date === undefined) return

    setFieldErrors({})
    setDetailRowErrors({})
    setSaveError(null)

    // Client-side gate mirroring the server's own rules (FeedRows.tsx,
    // mirroring packages/shared's validateFeedRows/D4) — named per row/field
    // so Save never sends a row FeedRows is already showing as invalid.
    const detailValidation = validateDetailRows(state.detailRows)
    if (hasBlockingDetailRowErrors(detailValidation)) {
      setDetailRowErrors(detailValidation)
      return
    }
    if (validateStress(state.stress) !== undefined || validateMindfulnessMinutes(state.mindfulnessMinutes) !== undefined) {
      // OptionalFields already renders these messages straight from state — nothing further to set here.
      return
    }

    const { body, origin } = buildPutBody(state, disabled)

    try {
      const response = await mutation.mutateAsync(body)
      queryClient.setQueryData(queryKeys.days(programId, date), response)
      void queryClient.invalidateQueries({ queryKey: queryKeys.programs.today(programId) })
      dispatch({ type: 'loaded', day: response })
      navigate('/today', { state: { notice: 'Check-in saved.' } })
    } catch (error) {
      if (isStructuredApiError(error)) {
        if (error.status === 409 && error.code === 'stale_version') {
          const current = (error.details as { current?: DayResponseValue } | undefined)?.current
          if (current !== undefined) {
            setStaleNotice({ draft: state })
            dispatch({ type: 'loaded', day: current })
          }
          return
        }
        if (error.status === 422 && error.code === 'feed_platform_conflict') {
          // D36: a conflict named on a headline row's index -> that headline
          // field; named on a detail row's index -> that row's own group
          // (task 8.7.2's brief), not a specific field.
          const nextHeadline: { phone?: string; desktop?: string } = {}
          const nextDetail: Record<number, FeedRowFieldErrors> = {}
          for (const key of Object.keys(error.fieldErrors ?? {})) {
            const match = /^feed\[(\d+)]/.exec(key)
            if (match === null) continue
            const index = Number(match[1])
            const rowOrigin = origin[index]
            if (rowOrigin === undefined) continue
            if (rowOrigin.kind === 'detail') {
              nextDetail[rowOrigin.index] = { ...nextDetail[rowOrigin.index], row: FEED_PLATFORM_CONFLICT_MESSAGE }
            } else {
              nextHeadline[rowOrigin.kind] = FEED_PLATFORM_CONFLICT_MESSAGE
            }
          }
          setFieldErrors(nextHeadline)
          setDetailRowErrors(nextDetail)
          return
        }
        if (error.status === 422 && error.code === 'feed_subset_violation') {
          const nextDetail: Record<number, FeedRowFieldErrors> = {}
          for (const key of Object.keys(error.fieldErrors ?? {})) {
            const match = /^feed\[(\d+)]\.shortVideoMinutes$/.exec(key)
            if (match === null) continue
            const index = Number(match[1])
            const rowOrigin = origin[index]
            if (rowOrigin?.kind === 'detail') {
              nextDetail[rowOrigin.index] = { ...nextDetail[rowOrigin.index], shortVideoMinutes: SUBSET_VIOLATION_MESSAGE }
            }
          }
          setDetailRowErrors(nextDetail)
          return
        }
        if (error.status === 422 && error.code === 'duplicate_feed_row') {
          const nextDetail: Record<number, FeedRowFieldErrors> = {}
          for (const key of Object.keys(error.fieldErrors ?? {})) {
            const match = /^feed\[(\d+)]$/.exec(key)
            if (match === null) continue
            const index = Number(match[1])
            const rowOrigin = origin[index]
            if (rowOrigin?.kind === 'detail') {
              nextDetail[rowOrigin.index] = { ...nextDetail[rowOrigin.index], row: DUPLICATE_ROW_MESSAGE }
            }
          }
          setDetailRowErrors(nextDetail)
          return
        }
        if (error.status === 400 && error.fieldErrors !== undefined) {
          const sleepError = fieldErrorText(error.fieldErrors.sleepMinutes)
          if (sleepError !== undefined) {
            setFieldErrors({ sleep: sleepError })
            return
          }
        }
      }
      setSaveError('Could not save. Retry.')
    }
  }

  function handleReapplyMyValues(): void {
    if (staleNotice === null) return
    dispatch({ type: 'restoreDraft', draft: staleNotice.draft })
    setStaleNotice(null)
  }

  // --- Loading / gating states ---------------------------------------------

  if (programQuery.isPending) {
    return <div aria-busy="true">Loading</div>
  }

  if (programQuery.isError || programQuery.data === undefined) {
    return (
      <div>
        <p>Could not load your program. Retry.</p>
        <Button
          onClick={() => {
            void programQuery.refetch()
          }}
        >
          Retry
        </Button>
      </div>
    )
  }

  if (programQuery.data.program === null) {
    return (
      <div>
        <Link to="/setup">Set up your program first</Link>
      </div>
    )
  }

  if (date === undefined) {
    return <p>No check-in date was given.</p>
  }

  if (dayQuery.isPending) {
    return <div aria-busy="true">Loading</div>
  }

  if (dayQuery.isError) {
    return (
      <div>
        <p>Could not load check-in. Retry.</p>
        <Button
          onClick={() => {
            void dayQuery.refetch()
          }}
        >
          Retry
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6">
      <CheckinStatus status={state.status} missing={state.missing} />

      {staleNotice !== null ? (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm">
          <p>This check-in was updated elsewhere; showing the current values</p>
          <Button type="button" variant="secondary" onClick={handleReapplyMyValues}>
            Re-apply my values
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor="checkin-sleep" className="text-sm font-medium text-[var(--color-text)]">
          Sleep minutes
        </label>
        <input
          id="checkin-sleep"
          name="checkin-sleep"
          type="number"
          inputMode="numeric"
          min={0}
          max={1440}
          step={1}
          value={state.sleepMinutes === null ? '' : state.sleepMinutes}
          onChange={(event) => {
            const raw = event.target.value
            if (raw.trim() === '') {
              dispatch({ type: 'setSleep', value: null })
              return
            }
            const parsed = Number(raw)
            if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1440) return
            dispatch({ type: 'setSleep', value: parsed })
          }}
          className="min-h-11 w-full max-w-40 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
        />
        {fieldErrors.sleep !== undefined ? (
          <p role="alert" className="text-sm text-red-700">
            {fieldErrors.sleep}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <DeviceMinutesField
          device="phone"
          value={effectivePhone}
          disabled={disabled.phone}
          onChange={(value) => dispatch({ type: 'setDevice', device: 'phone', value })}
        />
        <p className="text-sm text-[var(--color-text-muted)]">Phone: {deviceSummaryText(effectivePhone)}</p>
        {fieldErrors.phone !== undefined ? (
          <p role="alert" className="text-sm text-red-700">
            {fieldErrors.phone}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <DeviceMinutesField
          device="desktop"
          value={effectiveDesktop}
          disabled={disabled.desktop}
          onChange={(value) => dispatch({ type: 'setDevice', device: 'desktop', value })}
        />
        <p className="text-sm text-[var(--color-text-muted)]">Desktop: {deviceSummaryText(effectiveDesktop)}</p>
        {fieldErrors.desktop !== undefined ? (
          <p role="alert" className="text-sm text-red-700">
            {fieldErrors.desktop}
          </p>
        ) : null}
      </div>

      <Collapsible.Root>
        <Collapsible.Trigger
          type="button"
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-transparent px-4 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface)]"
        >
          More detail
        </Collapsible.Trigger>
        <Collapsible.Content className="flex flex-col gap-6 pt-2">
          <FeedRows
            rows={state.detailRows}
            errors={detailRowErrors}
            onChange={(rows) => dispatch({ type: 'setDetailRows', rows })}
          />
          <FeedTotals rows={feedSendPlan.rows} />
          <OptionalFields
            stress={state.stress}
            mindfulnessMinutes={state.mindfulnessMinutes}
            note={state.note}
            onChange={(patch) => dispatch({ type: 'setOptionalFields', patch })}
          />
        </Collapsible.Content>
      </Collapsible.Root>

      {saveError !== null ? (
        <p role="alert" className="text-sm text-red-700">
          {saveError}
        </p>
      ) : null}

      <Button type="submit" disabled={mutation.isPending}>
        Save
      </Button>
    </form>
  )
}
