import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateRevisionBodyValue } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'

/**
 * Settings' "Change practice duration" panel (task 8.9.5; design.md D33/D38;
 * program-setup: "Protocol settings are immutable revisions" / "Target
 * changed on Day 8" / "Revision without reason"; app-shell: "One dominant
 * action per screen").
 *
 * Mounted by `Settings.tsx` (8.9.2) below Preferences — see this task's
 * `centralWiringNeeded` for the exact edit; that file's TODO placeholder is
 * left for this component and is never touched here directly (file
 * ownership: Settings.tsx belongs to 8.9.2).
 *
 * Fetches its own `GET /programs/current` (props: none) and renders nothing
 * while a program is still loading, absent, or terminal (`completed` /
 * `archived`) — a manual revision is only ever meaningful for an open
 * program. A protocol revision changes the GOVERNING duration from today
 * onward; past sessions keep whatever revision they started under (4.4.1) —
 * this panel never implies otherwise.
 *
 * `practiceTargetSeconds` is seeded once from the current day's governing
 * revision (`GET /programs/current`'s `revision`, already the
 * `governingRevisionFor` pick — never the program's very first revision) and
 * only re-seeded from a successful mutation response afterward, so an
 * in-flight edit is never clobbered by a background refetch of the same
 * query. `dirty` tracks only the duration field against that committed
 * value (`useRef`) — reason has no "committed" baseline of its own; typing a
 * reason alone with the duration unchanged has nothing to save. Nothing is
 * sent until Save: the reason-required rule is enforced at submit time, not
 * per keystroke.
 *
 * `settings` on the wire carries only the two keys `CreateRevisionBodyValue`
 * allows (`practiceTargetSeconds`, `leisureAllowanceMin`) — `bandCeilings`
 * is server-owned (4.4.1: `additionalProperties: false` on the nested
 * object, so any other key is a 400) and is deliberately never spread from
 * the loaded revision onto the request body, even though it IS present on
 * `RevisionResponseValue.settings`.
 */

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['completed', 'archived'])

const DURATION_OPTIONS: ReadonlyArray<{ minutes: 5 | 10 | 15 | 20 | 25; seconds: 300 | 600 | 900 | 1200 | 1500 }> = [
  { minutes: 5, seconds: 300 },
  { minutes: 10, seconds: 600 },
  { minutes: 15, seconds: 900 },
  { minutes: 20, seconds: 1200 },
  { minutes: 25, seconds: 1500 },
]

interface DurationFieldProps {
  readonly value: number
  readonly onChange: (seconds: number) => void
}

/** The five practice durations a revision may set (300..1500 s, step 300), rendered as their minute labels. */
function DurationField({ value, onChange }: DurationFieldProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">New practice duration</legend>
      <div className="flex flex-wrap gap-4">
        {DURATION_OPTIONS.map((option) => (
          <label key={option.minutes} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="changePracticeDuration"
              value={option.seconds}
              checked={value === option.seconds}
              onChange={() => {
                onChange(option.seconds)
              }}
            />
            {option.minutes} minutes
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** The shape every thrown error carries in both production (`ApiError` subclasses) and the 7.1.1 mock client (`mockClient.ts`'s `reject()`) — read structurally, matching `features/setup/PlanForm.tsx`'s convention. */
interface ApiErrorLike {
  status: number
  code?: string
  fieldErrors?: Record<string, string | ReadonlyArray<string>>
}

function isApiErrorLike(value: unknown): value is ApiErrorLike {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return typeof (value as { status?: unknown }).status === 'number'
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

export function ChangePracticeDuration() {
  const queryClient = useQueryClient()
  const current = useQuery({ queryKey: queryKeys.programs.current, queryFn: api.programs.current })

  // Seeded once, from the first successful load of the governing revision;
  // updated again only from a successful mutation response (never from a
  // background refetch of the same query while an edit may be in flight).
  const committedRef = useRef<number | null>(null)
  const [practiceTargetSeconds, setPracticeTargetSeconds] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | undefined>(undefined)
  const [banner, setBanner] = useState<string | null>(null)
  const [successNotice, setSuccessNotice] = useState(false)
  // A 409 program_terminal race (the program ended on another tab between
  // this panel loading and Submit) — distinct from the render guard below,
  // which only ever sees the LAST-FETCHED status.
  const [raceEnded, setRaceEnded] = useState(false)

  const reasonId = useId()
  const reasonErrorId = useId()

  const program = current.data?.program ?? null
  const revision = current.data?.revision ?? null
  const day = current.data?.day ?? null

  useEffect(() => {
    if (revision !== null && committedRef.current === null) {
      committedRef.current = revision.settings.practiceTargetSeconds
      setPracticeTargetSeconds(revision.settings.practiceTargetSeconds)
    }
  }, [revision])

  const createRevision = useMutation({
    mutationFn: (body: CreateRevisionBodyValue) => {
      if (program === null) {
        return Promise.reject(new Error('ChangePracticeDuration: no program to revise'))
      }
      return api.programs.createRevision(program.id, body)
    },
  })

  if (raceEnded) {
    return (
      <section aria-label="Change practice duration">
        <p role="alert" className="text-sm">
          This program has ended.
        </p>
      </section>
    )
  }

  const isTerminal = program !== null && TERMINAL_STATUSES.has(program.status)

  if (current.data === undefined || program === null || isTerminal || revision === null || practiceTargetSeconds === null) {
    return null
  }

  const dirty = practiceTargetSeconds !== committedRef.current

  // Rebound to fresh `const`s with their own (already-narrowed) inferred
  // types, since a nested function declaration below does not retain the
  // control-flow narrowing established by the early-return guard above.
  const openProgram = program
  const openRevision = revision
  const selectedSeconds = practiceTargetSeconds

  async function submit() {
    setSuccessNotice(false)
    setBanner(null)
    const trimmedReason = reason.trim()
    if (trimmedReason === '') {
      setReasonError('A reason is required')
      return
    }
    setReasonError(undefined)

    // `effectiveDay` is always today's program day (4.4.1's own comment:
    // "this should not occur" for the 422 below) — clamped defensively into
    // the 0..14 range `CreateRevisionBody` requires, since `currentProgramDay`
    // (2.1) does not clamp a pre-baseline negative day itself.
    const effectiveDay = Math.min(14, Math.max(0, day ?? 0))

    const body: CreateRevisionBodyValue = {
      effectiveDay,
      settings: {
        practiceTargetSeconds: selectedSeconds,
        leisureAllowanceMin: openRevision.settings.leisureAllowanceMin,
      },
      reason: trimmedReason,
    }

    try {
      const result = await createRevision.mutateAsync(body)
      committedRef.current = result.revision.settings.practiceTargetSeconds
      setPracticeTargetSeconds(result.revision.settings.practiceTargetSeconds)
      setReason('')
      setSuccessNotice(true)
      void queryClient.invalidateQueries({ queryKey: queryKeys.programs.current })
      void queryClient.invalidateQueries({ queryKey: queryKeys.programs.today(openProgram.id) })
    } catch (error) {
      if (isApiErrorLike(error) && error.status === 400) {
        const text = fieldErrorText(error.fieldErrors?.reason)
        if (text !== undefined) {
          setReasonError(text)
          return
        }
      }
      if (isApiErrorLike(error) && error.status === 422 && error.code === 'effective_day_in_past') {
        setBanner('This program day has already passed; changes apply from today onward')
        return
      }
      if (isApiErrorLike(error) && error.status === 409 && error.code === 'program_terminal') {
        setRaceEnded(true)
        return
      }
      setBanner('Could not save. Retry.')
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submit()
  }

  return (
    <section aria-label="Change practice duration">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Change practice duration</h2>

        <DurationField
          value={practiceTargetSeconds}
          onChange={(seconds) => {
            setPracticeTargetSeconds(seconds)
          }}
        />

        <div className="flex flex-col gap-2">
          <label htmlFor={reasonId} className="text-sm font-medium">
            Reason for change
          </label>
          <input
            id={reasonId}
            type="text"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value)
            }}
            aria-invalid={reasonError !== undefined ? true : undefined}
            aria-describedby={reasonError !== undefined ? reasonErrorId : undefined}
            className="min-h-11 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
          />
          {reasonError !== undefined ? (
            <p id={reasonErrorId} role="alert" className="text-sm">
              {reasonError}
            </p>
          ) : null}
        </div>

        {banner !== null ? (
          <p role="alert" className="text-sm">
            {banner}
          </p>
        ) : null}

        {successNotice ? (
          <p role="status" className="text-sm">
            Practice duration updated for today onward.
          </p>
        ) : null}

        <Button type="submit" disabled={!dirty || createRevision.isPending}>
          Save
        </Button>
      </form>
    </section>
  )
}
