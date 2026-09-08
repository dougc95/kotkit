/**
 * Ready — the benchmark's pre-session screen (task 8.3.1; design.md D20,
 * D22, D23, D30; benchmark-assessment: "Benchmark ready state" (Slot on its
 * assigned date / Slot before its date), "One replacement per slot with a
 * reason" (Replacement after disruption / Third attempt / Replacement of an
 * eligible attempt), "Benchmarks are visually distinct from practice",
 * "Final benchmarks on Day 14", "Eligibility is derived server-side with
 * explicit reasons" (Attempt outside its date); session-recovery: "Starting
 * a session requires the server" / "Start while offline"; app-shell:
 * "Navigation exists outside session mode only"). Route `/benchmark/:slotId`,
 * rendered by `BenchmarkRoute.tsx` inside `SessionLayout` (7.1.4, no
 * navigation) — this component renders no `<nav>` of its own.
 *
 * Loads `GET /programs/current` (D22: `slots[]` carry
 * `attempts: [{ sessionId, lifecycle, eligible, excludedByAmendment }]`) to
 * find this route's slot, and `GET /programs/{id}/today` for the
 * server-derived `localDate` the date gate compares against — this screen
 * never reads `Date.now()`/`new Date()` itself, so a skewed browser clock
 * cannot move the gate (CLAUDE.md: no client-computed measurement). Also
 * mounts `['sessions','active']` (`lib/query/hooks.ts`'s `useActiveSession`,
 * the SAME cache entry `useStartSession` (7.4.4) itself writes on a
 * successful start) and renders `ActiveSessionCard` (8.2.5) in place of every
 * Start control whenever that query holds a session — both a pre-existing
 * active session on mount and a session this screen itself just started
 * (task 8.3.3, next wave, extends `BenchmarkRoute.tsx` with a real Running
 * branch for the latter case; until then this screen's own ActiveSessionCard
 * branch is what a fresh Start lands on, matching design.md D16's "One
 * ActiveSessionCard" — never a second copy of its routing logic here).
 *
 * Date gate (D23): `today.localDate < slot.assignedLocalDate` -> no Start,
 * "Scheduled for {date} at {time}". `today.localDate >= assignedLocalDate`
 * -> Start is offered; the timing-deviation notice ("This slot was assigned
 * to {date}. An attempt today will be labeled a timing deviation.") is shown
 * additionally whenever `today.localDate > assignedLocalDate`.
 *
 * Prior attempts (D22, no separate report call — read straight off
 * `slot.attempts[]`): zero -> Start, no reason field; `attempts.length === 1`
 * with `eligible !== true` (ineligible, excluded by amendment, or still
 * undetermined) -> Start is rendered but disabled until a required
 * "Reason for replacement" (1-500 chars) is typed, sent as
 * `replacementReason`; `attempts.length === 1` with `eligible === true` -> no
 * Start, "Eligible attempts are not retaken"; `attempts.length >= 2` -> no
 * Start, "This slot already has two attempts". Whether an abandoned or
 * unfinalized attempt counts toward that ceiling is the server's call — this
 * reads `slot.attempts` and any resulting 422 exactly as sent, computing no
 * count of its own beyond `attempts.length`.
 *
 * Start calls `useStartSession().start({ programId, kind: 'benchmark',
 * slotId, replacementReason? })` (7.4.4 owns the Idempotency-Key and its own
 * retry/409 handling entirely — no local key or 409 routing here). Neither
 * `intendedOutput` nor `targetSeconds` is ever sent (D30: the server always
 * stores 1200s for a benchmark). A thrown `active_session_exists` is
 * swallowed here (the hook's own `['sessions','active']` invalidation is
 * what flips this screen to the ActiveSessionCard branch above); a 422 shows
 * the server's own `message` verbatim ("422 slot rule -> the server
 * message"); anything else (a network failure, once the hook's own
 * automatic retries are exhausted) shows a generic could-not-start notice —
 * Start remains available to try again, under the SAME logical start
 * `useStartSession` already owns.
 *
 * Final phase uses this exact same screen, labeled "Final A"/"Final B" (the
 * header interpolates `slot.phase`/`slot.label` verbatim, title-cased —
 * never a phase-specific branch).
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import type {
  CreateSessionBodyValue,
  CurrentProgramResponseValue,
  SlotAttemptValue,
  SlotResponseValue,
  TodayResponseValue,
} from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { useActiveSession } from '../../lib/query/hooks.js'
import { useStartSession } from '../../lib/query/useStartSession.js'
import { Button } from '../../ui/Button.js'
import { ActiveSessionCard } from '../session/ActiveSessionCard.js'

const LEAVING_NOTE = 'Leaving this page to read does not count as distraction.'
const MAX_REASON_LENGTH = 500

const PROTOCOL_CHECKLIST_ITEMS: readonly string[] = [
  'Set a fixed 20-minute timer before you begin.',
  'Keep your reading material closed until you start.',
  'Record any off-task episode or external interruption as it happens.',
  'When the timer ends, close your material immediately.',
]

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

export interface ChecklistProps {
  readonly items: readonly string[]
}

export function Checklist({ items }: ChecklistProps) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-text)]">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// ReplacementReasonField
// ---------------------------------------------------------------------------

export interface ReplacementReasonFieldProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly required: boolean
}

export function ReplacementReasonField({ value, onChange, required }: ReplacementReasonFieldProps) {
  return (
    <div className="space-y-1">
      <label htmlFor="replacement-reason" className="block text-sm font-medium text-[var(--color-text)]">
        Reason for replacement
      </label>
      <textarea
        id="replacement-reason"
        value={value}
        maxLength={MAX_REASON_LENGTH}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
      />
      <p className="text-xs text-[var(--color-text-muted)]">
        {value.length}/{MAX_REASON_LENGTH}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Prior-attempt gating (D22: read straight off slot.attempts[], no count of
// our own beyond .length)
// ---------------------------------------------------------------------------

type PriorAttemptState = 'none' | 'requiresReason' | 'eligibleNotRetaken' | 'full'

function priorAttemptState(attempts: readonly SlotAttemptValue[]): PriorAttemptState {
  if (attempts.length >= 2) {
    return 'full'
  }
  if (attempts.length === 0) {
    return 'none'
  }
  return attempts[0]?.eligible === true ? 'eligibleNotRetaken' : 'requiresReason'
}

function phaseLabel(phase: SlotResponseValue['phase']): string {
  return phase.charAt(0).toUpperCase() + phase.slice(1)
}

// ---------------------------------------------------------------------------
// Error duck-typing — mirrors BlockCard.tsx's `isApiErrorLike`/
// `fieldErrorText` convention: works for both a real `ApiError` subclass and
// mockClient's plain-Error-shaped rejection, never `instanceof`.
// ---------------------------------------------------------------------------

interface ApiErrorLike {
  readonly code?: unknown
  readonly status?: unknown
  readonly message?: unknown
}

function isApiErrorLike(value: unknown): value is ApiErrorLike {
  return typeof value === 'object' && value !== null
}

// ---------------------------------------------------------------------------
// Retry (loading/error) — mirrors Today.tsx's own RetryNotice.
// ---------------------------------------------------------------------------

function RetryNotice({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-6 space-y-4">
      <p>{message}</p>
      <Button onClick={onRetry}>Retry</Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ready
// ---------------------------------------------------------------------------

export function Ready() {
  const { slotId } = useParams<{ slotId: string }>()
  const [replacementReason, setReplacementReason] = useState('')
  const [startFailed, setStartFailed] = useState<string | null>(null)

  const currentQuery = useQuery<CurrentProgramResponseValue>({
    queryKey: queryKeys.programs.current,
    queryFn: api.programs.current,
  })
  const current = currentQuery.data
  const programId = current?.program?.id
  const slot = current?.slots.find((candidate) => candidate.id === slotId)

  const todayQuery = useQuery<TodayResponseValue>({
    queryKey: queryKeys.programs.today(programId ?? ''),
    queryFn: () => api.programs.today(programId as string),
    enabled: programId !== undefined,
  })

  const activeQuery = useActiveSession()
  const { start, status } = useStartSession()

  function retryAll(): void {
    void currentQuery.refetch()
    if (programId !== undefined) {
      void todayQuery.refetch()
    }
    void activeQuery.refetch()
  }

  async function handleStart(): Promise<void> {
    if (programId === undefined || slot === undefined) {
      return
    }
    setStartFailed(null)
    const body: CreateSessionBodyValue = {
      programId,
      kind: 'benchmark',
      slotId: slot.id,
      ...(priorAttemptState(slot.attempts) === 'requiresReason'
        ? { replacementReason: replacementReason.trim() }
        : {}),
    }
    try {
      await start(body)
    } catch (thrown) {
      if (isApiErrorLike(thrown) && thrown.code === 'active_session_exists') {
        // useStartSession has already invalidated ['sessions','active'] —
        // the activeQuery branch below takes over once it refetches.
        return
      }
      if (isApiErrorLike(thrown) && thrown.status === 422 && typeof thrown.message === 'string') {
        setStartFailed(thrown.message)
        return
      }
      setStartFailed('The benchmark could not be started. Retry.')
    }
  }

  if (currentQuery.isPending) {
    return (
      <div className="mx-auto max-w-xl px-4 py-6" aria-busy="true">
        Loading
      </div>
    )
  }
  if (currentQuery.isError || current === undefined) {
    return <RetryNotice message="The benchmark could not be loaded." onRetry={retryAll} />
  }
  if (slot === undefined) {
    return <RetryNotice message="Benchmark slot not found." onRetry={retryAll} />
  }
  if (programId === undefined) {
    // Data inconsistency guard: a slot only exists once a program does.
    return <RetryNotice message="The benchmark could not be loaded." onRetry={retryAll} />
  }
  if (todayQuery.isPending) {
    return (
      <div className="mx-auto max-w-xl px-4 py-6" aria-busy="true">
        Loading
      </div>
    )
  }
  if (todayQuery.isError || todayQuery.data === undefined) {
    return <RetryNotice message="The benchmark could not be loaded." onRetry={retryAll} />
  }
  if (activeQuery.isPending) {
    return (
      <div className="mx-auto max-w-xl px-4 py-6" aria-busy="true">
        Loading
      </div>
    )
  }

  const today = todayQuery.data

  if (activeQuery.data) {
    return (
      <div data-mode="benchmark" className="mx-auto max-w-xl px-4 py-6">
        <ActiveSessionCard session={activeQuery.data} />
      </div>
    )
  }

  const localDate = today.localDate
  const isBeforeDate = localDate < slot.assignedLocalDate
  const isAfterDate = localDate > slot.assignedLocalDate
  const priorState = priorAttemptState(slot.attempts)
  const reasonTrimmed = replacementReason.trim()
  const startEnabled =
    priorState === 'none' || (priorState === 'requiresReason' && reasonTrimmed.length >= 1)

  return (
    <div data-mode="benchmark" className="mx-auto max-w-xl px-4 py-6 space-y-6 border-t-4 border-t-amber-500">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">
          {`Fixed 20-minute assessment — ${phaseLabel(slot.phase)} ${slot.label}`}
        </h1>
        <p className="text-sm text-[var(--color-text)]">{slot.materialRef}</p>
        {slot.plannedLocalTime !== null ? (
          <p className="text-sm text-[var(--color-text-muted)]">{`Planned time: ${slot.plannedLocalTime}`}</p>
        ) : null}
      </header>

      <Checklist items={PROTOCOL_CHECKLIST_ITEMS} />

      <p className="text-sm text-[var(--color-text-muted)]">{LEAVING_NOTE}</p>

      {isBeforeDate ? (
        <p>
          {`Scheduled for ${slot.assignedLocalDate}${
            slot.plannedLocalTime !== null ? ` at ${slot.plannedLocalTime}` : ''
          }`}
        </p>
      ) : priorState === 'full' ? (
        <p>This slot already has two attempts</p>
      ) : priorState === 'eligibleNotRetaken' ? (
        <p>Eligible attempts are not retaken</p>
      ) : (
        <div className="space-y-4">
          {isAfterDate ? (
            <p role="status">
              {`This slot was assigned to ${slot.assignedLocalDate}. An attempt today will be labeled a timing deviation.`}
            </p>
          ) : null}
          {priorState === 'requiresReason' ? (
            <ReplacementReasonField value={replacementReason} onChange={setReplacementReason} required />
          ) : null}
          <Button
            onClick={() => {
              void handleStart()
            }}
            disabled={!startEnabled || status === 'pending'}
          >
            Start
          </Button>
          {startFailed !== null ? <p role="alert">{startFailed}</p> : null}
        </div>
      )}
    </div>
  )
}
