/**
 * `BlockCard` + `StartPracticeForm` (task 8.2.2; design.md D16, D20-D21;
 * practice-sessions: "Practice requires a short intended output" / "Today
 * shows one next action and two blocks" / "Returning user can start in
 * three actions" / "Practice metrics stay separate from benchmarks";
 * benchmark-assessment: "Practice can never become a baseline";
 * session-recovery: "Starting a session requires the server" / "Start while
 * offline" / "Start retried after timeout").
 *
 * Rendered twice by Today (8.2.1 — an earlier wave that left a commented
 * placeholder `[data-block-index]` slot for each of `today.blocks`; this
 * file does not import or edit `Today.tsx` itself, per this workflow's file-
 * ownership rule — the exact wiring edit is reported separately). Every
 * block always shows its status badge and target duration; only the block
 * Today marks `isNext` additionally hosts `StartPracticeForm`.
 *
 * `StartPracticeForm` owns exactly the controlled `intendedOutput` field —
 * `useStartSession` (7.4.4) owns the `POST /sessions` mutation, its
 * Idempotency-Key and its status/error state entirely; this component never
 * builds its own key and never sends a `slotId` (a practice session is
 * never tied to a benchmark slot). Nothing here starts a clock:
 * `useStartSession().start()` is awaited and only once it resolves does this
 * navigate to `/focus/:sessionId` — before that, no timer, digits or
 * countdown appear anywhere in this component's own output.
 *
 * Error handling matches the brief's three distinct outcomes for one
 * `start()` call:
 *  - 400 `fieldErrors.intendedOutput` -> the server's message is shown
 *    beside the field (a structural read of the thrown error's shape, the
 *    same convention `features/setup/PlanForm.tsx` and `features/today/
 *    Today.tsx` already use — never `instanceof`, so both a real
 *    `ValidationError` and a plain test-built error object work
 *    identically).
 *  - 409 `active_session_exists` -> rendered as nothing further here.
 *    `useStartSession` already sets its own `activeSessionId` state and
 *    invalidates `['sessions','active']` on this exact code (7.4.4's own
 *    contract) — Today (8.2.1) mounts `ActiveSessionCard` (8.2.5) in that
 *    case, so this form performs no 409 routing and shows no error text for
 *    it.
 *  - anything else (a network failure, once the hook's own automatic
 *    retries are exhausted) -> "The session could not be started" plus a
 *    Retry control that calls `start()` again with the identical typed
 *    output, which `useStartSession` recognises as the same logical start
 *    and replays under the same Idempotency-Key.
 */
import { useId, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router'
import type { SessionResponseValue, TodayBlockValue } from '@attention-lab/shared'

import { useStartSession } from '../../lib/query/useStartSession.js'
import { Button } from '../../ui/Button.js'

const MAX_OUTPUT_LENGTH = 200

const STATUS_LABEL: Record<TodayBlockValue['status'], string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
  partial: 'Partial',
}

function formatMinutes(targetSeconds: number): string {
  return `${Math.round(targetSeconds / 60)} min`
}

/**
 * Structural read of a thrown error's D18-shaped fields — works for both a
 * real `ApiError` subclass and a test's plain error object (the same
 * convention `PlanForm.tsx`'s `isApiErrorLike`/`fieldErrorText` and
 * `Today.tsx`'s `isNotFound` already use), never `instanceof`.
 */
interface ApiErrorLike {
  readonly code?: unknown
  readonly fieldErrors?: Record<string, string | ReadonlyArray<string>>
}

function isApiErrorLike(value: unknown): value is ApiErrorLike {
  return typeof value === 'object' && value !== null
}

function fieldErrorText(value: string | ReadonlyArray<string> | undefined): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value[0]
  }
  return undefined
}

export interface StartPracticeFormProps {
  readonly programId: string
  readonly targetSeconds: number
  /**
   * Called once `start()` resolves, just before navigating. `BlockCard`
   * itself has nothing further to do once the session exists — this is a
   * hook for a future caller (e.g. an analytics or focus-management need)
   * rather than something this task's own behavior depends on.
   */
  readonly onStarted?: (session: SessionResponseValue) => void
}

/**
 * "What will you produce?" plus Start — the whole returning-user path is
 * "type, Start" (practice-sessions: "Returning user can start in three
 * actions"). No target picker here: `targetSeconds` is the current
 * revision's value, already shown read-only by the enclosing `BlockCard`'s
 * own duration label — never a field a user edits from this form.
 */
export function StartPracticeForm({ programId, targetSeconds, onStarted }: StartPracticeFormProps) {
  const [intendedOutput, setIntendedOutput] = useState('')
  const [textareaError, setTextareaError] = useState<string | null>(null)
  const [startFailed, setStartFailed] = useState(false)
  const navigate = useNavigate()
  const { start, status } = useStartSession()

  const textareaId = useId()
  const errorId = useId()
  const counterId = useId()
  const isPending = status === 'pending'
  const hasError = textareaError !== null

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const next = event.target.value
    // Client-side truncation rather than relying on the `maxLength`
    // attribute alone: jsdom's `<textarea>` does not enforce it on a
    // programmatic value change the way a real browser does on typed input,
    // and a pasted/typed value beyond the limit must be blocked either way
    // (this task's own "> 200 blocked" validation rule).
    setIntendedOutput(next.length > MAX_OUTPUT_LENGTH ? next.slice(0, MAX_OUTPUT_LENGTH) : next)
  }

  async function attemptStart() {
    const trimmed = intendedOutput.trim()
    if (trimmed.length < 1) {
      setTextareaError('Required')
      setStartFailed(false)
      return
    }
    setTextareaError(null)
    setStartFailed(false)

    try {
      // No `slotId` — a practice session is never tied to a benchmark slot.
      const session = await start({
        programId,
        kind: 'practice',
        intendedOutput: trimmed,
        targetSeconds,
      })
      onStarted?.(session)
      navigate(`/focus/${session.id}`)
    } catch (thrown) {
      if (isApiErrorLike(thrown) && thrown.code === 'active_session_exists') {
        return
      }
      const message = isApiErrorLike(thrown) ? fieldErrorText(thrown.fieldErrors?.intendedOutput) : undefined
      if (message !== undefined) {
        setTextareaError(message)
        return
      }
      setStartFailed(true)
    }
  }

  function handleStartClick() {
    void attemptStart()
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={textareaId} className="text-sm font-medium text-[var(--color-text)]">
        What will you produce?
      </label>
      <textarea
        id={textareaId}
        value={intendedOutput}
        maxLength={MAX_OUTPUT_LENGTH}
        disabled={isPending}
        aria-invalid={hasError ? true : undefined}
        aria-describedby={[counterId, hasError ? errorId : undefined]
          .filter((id): id is string => id !== undefined)
          .join(' ')}
        onChange={handleChange}
        className="min-h-20 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
      />
      <span id={counterId} className="text-xs text-[var(--color-text-muted)]">
        {`${intendedOutput.length}/${MAX_OUTPUT_LENGTH}`}
      </span>
      {hasError ? (
        <p id={errorId} role="alert" className="text-sm">
          {textareaError}
        </p>
      ) : null}
      {startFailed ? (
        <p role="alert" className="text-sm">
          The session could not be started
        </p>
      ) : null}
      <Button onClick={handleStartClick} disabled={isPending}>
        {startFailed ? 'Retry' : 'Start'}
      </Button>
    </div>
  )
}

export interface BlockCardProps {
  readonly block: TodayBlockValue
  /**
   * The governing revision's practice target in seconds (equal to
   * `block.targetSeconds`, per `apps/api/src/services/program/blocks.ts`'s
   * `deriveBlocks` — every block on a day shares the same target). Taken as
   * its own prop per this task's brief rather than re-read off `block`, so
   * a caller may source it from either the block itself or `revision.
   * settings.practiceTargetSeconds` directly.
   */
  readonly target: number
  readonly isNext: boolean
  readonly programId: string
}

export function BlockCard({ block, target, isNext, programId }: BlockCardProps) {
  return (
    <div
      data-status={block.status}
      className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--color-text)]">{`Block ${block.index}`}</span>
        <span className="text-sm text-[var(--color-text-muted)]">{STATUS_LABEL[block.status]}</span>
      </div>
      <p className="text-sm text-[var(--color-text-muted)]">{formatMinutes(target)}</p>
      {isNext ? <StartPracticeForm programId={programId} targetSeconds={target} /> : null}
    </div>
  )
}
