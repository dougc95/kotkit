import { useId, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { CreateProgramBodyValue } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { newIdempotencyKey } from '../../lib/api/newIdempotencyKey.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'

/**
 * Setup's basic-plan step (task 8.1.2; program-setup: "Basic plan captures
 * only what is required" / "Timezone is confirmed, not assumed" /
 * "Initial duration below ten minutes"; "One program per user at a time" /
 * "Second program while one is active"; "Saving never starts a timer";
 * design.md D18's `program_exists -> { existingProgramId, existingStatus }`
 * conflict).
 *
 * Only what the spec requires is collected: a baseline local date, a
 * CONFIRMED timezone (never assumed from the detected value alone), an
 * initial practice duration of 5/10/15 minutes, an editable leisure-
 * allowance goal defaulting to 20 minutes, and an optional feed-time
 * estimate a user may leave blank. A blank feed estimate is never coerced
 * to `0` and is omitted from the request body entirely (CLAUDE.md's
 * "Unknown != zero" carried into the wire body, not just the UI) — an
 * explicit "0" IS sent, since that is a measurement.
 *
 * One `Idempotency-Key` is minted for this form instance (`newIdempotencyKeyRef`,
 * never regenerated on this component's later renders or on Retry) and sent
 * on `POST /programs` — the identical key on a retry after a network
 * failure, matching the header comment on `newIdempotencyKey.ts` about one
 * key per logical mutation. This does not use `useStartSession` (7.4.4);
 * that hook is scoped to `POST /sessions` only, and this screen never calls
 * it (`design.md`: "Saving never starts a timer").
 *
 * Outcomes:
 *  - 201 -> `['programs','current']` invalidated, navigate to
 *    `/setup/readiness`.
 *  - 409 (`program_exists`, D18) -> `GET /programs/current` is fetched to
 *    read the existing program's status: `draft` routes back to
 *    `/setup/readiness`, anything else routes to `/today` — both carry a
 *    `notice` in navigation state ("You already have a program") for
 *    whichever screen picks it up.
 *  - 400 field errors render beside their field; the form stays.
 *  - Any other failure (network, timeout, 5xx) renders an inline
 *    "Could not save the plan" message with a Retry control; every typed
 *    value is kept (nothing is cleared on error) and Retry resubmits with
 *    the SAME Idempotency-Key.
 */

/** The three initial durations design.md's `InitialPracticeTargetSecondsSchema` allows. */
const DURATION_OPTIONS: ReadonlyArray<{ minutes: 5 | 10 | 15; seconds: 300 | 600 | 900 }> = [
  { minutes: 5, seconds: 300 },
  { minutes: 10, seconds: 600 },
  { minutes: 15, seconds: 900 },
]

const DEFAULT_LEISURE_ALLOWANCE_MINUTES = 20

/** `Intl.DateTimeFormat().resolvedOptions().timeZone`, guarded for an environment where it throws. */
function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

/**
 * Every IANA zone name `Intl.supportedValuesOf` knows, always including the
 * detected zone even on a host whose list happens to omit it. A `<select>`
 * built from this list is valid-by-construction — the component never needs
 * a separate "is this a real IANA name" check.
 */
function listTimezones(detected: string): string[] {
  try {
    const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
    return zones.includes(detected) ? zones : [detected, ...zones]
  } catch {
    return [detected]
  }
}

/** The shape every thrown error carries in both production (`ApiError` subclasses) and the 7.1.1 mock client (`mockClient.ts`'s `reject()`) — read structurally, never via `instanceof`, so both work identically. */
interface ApiErrorLike {
  status: number
  code: string
  fieldErrors?: Record<string, string | ReadonlyArray<string>>
}

function isApiErrorLike(value: unknown): value is ApiErrorLike {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  return typeof record.status === 'number' && typeof record.code === 'string'
}

/** A field-error value is a single string on the real wire (D18) but the mock harness types it as `string[]` — either is rendered as its first/only message. */
function fieldErrorText(value: string | ReadonlyArray<string> | undefined): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value[0]
  }
  return undefined
}

type FieldName = 'baselineDate' | 'timezone' | 'leisureAllowanceMinutes' | 'feedEstimateMinutes'
type FieldErrorMap = Partial<Record<FieldName, string>>

interface TimezoneConfirmProps {
  readonly value: string
  readonly confirmed: boolean
  readonly onChange: (value: string) => void
  readonly onConfirm: (confirmed: boolean) => void
  readonly zones: readonly string[]
  readonly error: string | undefined
}

/** Timezone select + its explicit confirm checkbox (program-setup: "Timezone is confirmed, not assumed"). */
function TimezoneConfirm({ value, confirmed, onChange, onConfirm, zones, error }: TimezoneConfirmProps) {
  const selectId = useId()
  const checkboxId = useId()
  const errorId = useId()

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={selectId} className="text-sm font-medium">
        Timezone
      </label>
      <select
        id={selectId}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
        className="min-h-11 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>

      <label htmlFor={checkboxId} className="flex items-center gap-2 text-sm">
        <input
          id={checkboxId}
          type="checkbox"
          checked={confirmed}
          onChange={(event) => {
            onConfirm(event.target.checked)
          }}
        />
        Confirm timezone
      </label>

      {error !== undefined ? (
        <p id={errorId} role="alert" className="text-sm">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Client-side validation mirroring the brief's Validation rules; run before any request is sent. */
function validate(
  baselineDate: string,
  confirmed: boolean,
  leisureAllowanceMinutes: string,
  feedEstimateMinutes: string,
): FieldErrorMap {
  const errors: FieldErrorMap = {}

  if (!/^\d{4}-\d{2}-\d{2}$/.test(baselineDate)) {
    errors.baselineDate = 'Enter the baseline date.'
  }

  if (!confirmed) {
    errors.timezone = 'Confirm your timezone before saving.'
  }

  const leisureValue = leisureAllowanceMinutes.trim()
  if (leisureValue === '' || !/^\d+$/.test(leisureValue)) {
    errors.leisureAllowanceMinutes = 'Enter a leisure allowance of 0 or more minutes.'
  }

  const feedValue = feedEstimateMinutes.trim()
  if (feedValue !== '' && !/^\d+$/.test(feedValue)) {
    errors.feedEstimateMinutes = 'Enter a whole number of minutes, or leave this blank.'
  }

  return errors
}

export function PlanForm() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [baselineDate, setBaselineDate] = useState('')
  const [timezone, setTimezone] = useState(() => detectTimezone())
  const [confirmed, setConfirmed] = useState(false)
  const [durationMinutes, setDurationMinutes] = useState<5 | 10 | 15>(10)
  const [leisureAllowanceMinutes, setLeisureAllowanceMinutes] = useState(String(DEFAULT_LEISURE_ALLOWANCE_MINUTES))
  const [feedEstimateMinutes, setFeedEstimateMinutes] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrorMap>({})
  const [saveFailed, setSaveFailed] = useState(false)

  const zones = useRef<string[] | null>(null)
  if (zones.current === null) {
    zones.current = listTimezones(timezone)
  }

  // One Idempotency-Key per form instance (never regenerated by a later
  // render, an edit, or a Retry click) — the brief's "generated once per
  // form instance and reused on retry".
  const idempotencyKeyRef = useRef<string | null>(null)
  if (idempotencyKeyRef.current === null) {
    idempotencyKeyRef.current = newIdempotencyKey()
  }

  const dateId = useId()
  const dateErrorId = useId()
  const leisureId = useId()
  const leisureErrorId = useId()
  const feedId = useId()
  const feedHelpId = useId()
  const feedErrorId = useId()

  const createProgram = useMutation({
    mutationFn: (body: CreateProgramBodyValue) =>
      api.programs.create(body, { idempotencyKey: idempotencyKeyRef.current as string }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.programs.current })
    },
  })

  function buildBody(): CreateProgramBodyValue {
    const seconds = DURATION_OPTIONS.find((option) => option.minutes === durationMinutes)?.seconds ?? 600
    const body: CreateProgramBodyValue = {
      baselineDate,
      timezone,
      practiceTargetSeconds: seconds,
      leisureAllowanceMinutes: Number(leisureAllowanceMinutes.trim()),
    }
    const trimmedFeed = feedEstimateMinutes.trim()
    if (trimmedFeed !== '') {
      body.feedEstimateMinutes = Number(trimmedFeed)
    }
    return body
  }

  async function routeToExistingProgram() {
    try {
      const current = await api.programs.current()
      const destination = current.program?.status === 'draft' ? '/setup/readiness' : '/today'
      navigate(destination, { state: { notice: 'You already have a program' } })
    } catch {
      setSaveFailed(true)
    }
  }

  async function submit() {
    const errors = validate(baselineDate, confirmed, leisureAllowanceMinutes, feedEstimateMinutes)
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})
    setSaveFailed(false)

    try {
      await createProgram.mutateAsync(buildBody())
      navigate('/setup/readiness')
    } catch (error) {
      if (isApiErrorLike(error) && error.status === 409) {
        await routeToExistingProgram()
        return
      }
      if (isApiErrorLike(error) && error.status === 400) {
        const mapped: FieldErrorMap = {}
        for (const [key, value] of Object.entries(error.fieldErrors ?? {})) {
          const text = fieldErrorText(value)
          if (text !== undefined && isFieldName(key)) {
            mapped[key] = text
          }
        }
        setFieldErrors(mapped)
        return
      }
      setSaveFailed(true)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submit()
  }

  const isPending = createProgram.isPending

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-md flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Set up your plan</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          This saves a draft — nothing starts running yet.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={dateId} className="text-sm font-medium">
          Baseline date (Day 0)
        </label>
        <input
          id={dateId}
          type="date"
          value={baselineDate}
          onChange={(event) => {
            setBaselineDate(event.target.value)
          }}
          aria-invalid={fieldErrors.baselineDate !== undefined ? true : undefined}
          aria-describedby={fieldErrors.baselineDate !== undefined ? dateErrorId : undefined}
          className="min-h-11 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
        />
        {fieldErrors.baselineDate !== undefined ? (
          <p id={dateErrorId} role="alert" className="text-sm">
            {fieldErrors.baselineDate}
          </p>
        ) : null}
      </div>

      <TimezoneConfirm
        value={timezone}
        confirmed={confirmed}
        onChange={setTimezone}
        onConfirm={setConfirmed}
        zones={zones.current}
        error={fieldErrors.timezone}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Practice block duration</legend>
        <div className="flex gap-4">
          {DURATION_OPTIONS.map((option) => (
            <label key={option.minutes} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="duration"
                value={option.minutes}
                checked={durationMinutes === option.minutes}
                onChange={() => {
                  setDurationMinutes(option.minutes)
                }}
              />
              {option.minutes} minutes
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor={leisureId} className="text-sm font-medium">
          Leisure allowance (minutes)
        </label>
        <input
          id={leisureId}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={leisureAllowanceMinutes}
          onChange={(event) => {
            setLeisureAllowanceMinutes(event.target.value)
          }}
          aria-invalid={fieldErrors.leisureAllowanceMinutes !== undefined ? true : undefined}
          aria-describedby={fieldErrors.leisureAllowanceMinutes !== undefined ? leisureErrorId : undefined}
          className="min-h-11 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
        />
        {fieldErrors.leisureAllowanceMinutes !== undefined ? (
          <p id={leisureErrorId} role="alert" className="text-sm">
            {fieldErrors.leisureAllowanceMinutes}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={feedId} className="text-sm font-medium">
          Current daily feed time (estimate)
        </label>
        <input
          id={feedId}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={feedEstimateMinutes}
          onChange={(event) => {
            setFeedEstimateMinutes(event.target.value)
          }}
          aria-invalid={fieldErrors.feedEstimateMinutes !== undefined ? true : undefined}
          aria-describedby={
            [feedHelpId, fieldErrors.feedEstimateMinutes !== undefined ? feedErrorId : undefined]
              .filter((id): id is string => id !== undefined)
              .join(' ') || undefined
          }
          className="min-h-11 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
        />
        <p id={feedHelpId} className="text-sm text-[var(--color-text-muted)]">
          leave blank if you do not know
        </p>
        {fieldErrors.feedEstimateMinutes !== undefined ? (
          <p id={feedErrorId} role="alert" className="text-sm">
            {fieldErrors.feedEstimateMinutes}
          </p>
        ) : null}
      </div>

      {saveFailed ? (
        <p role="alert" className="text-sm">
          Could not save the plan
        </p>
      ) : null}

      <Button type="submit" disabled={isPending}>
        {saveFailed ? 'Retry' : 'Save'}
      </Button>
    </form>
  )
}

function isFieldName(key: string): key is FieldName {
  return key === 'baselineDate' || key === 'timezone' || key === 'leisureAllowanceMinutes' || key === 'feedEstimateMinutes'
}
