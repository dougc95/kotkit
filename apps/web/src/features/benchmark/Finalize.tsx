/**
 * Finalize — the fourth and LAST section of `/benchmark/:sessionId/scoring`
 * (task 8.4.5; design.md D4, D7.1, D7.2, D7.5, D10, D16, D18-D21, D25, D31;
 * specs/benchmark-assessment: "Disruption is a required self-attestation" —
 * "Attestation unanswered"; "Eligibility is derived server-side with
 * explicit reasons"; "Counts are confirmed at review and blank means
 * unknown" — "Blank count"; "Self-scoring is unavailable until recall is
 * locked" — "Incomplete attempt finalized without recall"; specs/app-shell:
 * "Copy never punishes or gamifies"). Mounted by `BenchmarkReviewPage`
 * (8.4.2's exception file) directly below the Disruption/Conditions/
 * EligibilityPreview section (8.4.4) — this is the section that actually
 * calls `useFinalizeSession(sessionId)` (7.3.5), merging every earlier
 * section's own state slice into the one finalize body.
 *
 * `FinalizeSection` (the piece `BenchmarkReviewPage` mounts) owns exactly
 * one new piece of state — the optional `reviewNote` textarea, capped at 500
 * characters client-side like `DisruptionField`'s note (D31's wire limit is
 * wider; a stricter client cap is always a safe subset) — and derives
 * `missing`/`canFinalize` from the three earlier sections' props: the
 * disruption radio answered, `Scoring`'s own `complete` flag, and
 * `ConditionsFields`' confirm checkbox. Per D25, an incomplete attempt whose
 * recall was skipped already reports `scoringComplete: true` from `Scoring`
 * itself (its `recall_missing` mode), so this gate never separately waits on
 * a recall lock — the SAME three conditions gate every attempt, complete or
 * not.
 *
 * Clicking Finalize while `canFinalize` builds the body — spreading
 * `toFinalizeReview` (8.4.3)'s S/E/M/estimate slice, `materiallyDisrupted`
 * (the required boolean), `conditions` (always present), and OMITTING
 * `disruptionNote`/`recallScores`/`reviewNote` whenever each is blank/
 * `undefined` (D7.1/D31: blank is never coerced into a sent value) — then
 * calls `useFinalizeSession(sessionId).finalize(review)`; that hook owns the
 * outbox flush, `expectedEventCount`, the Idempotency-Key and the
 * event_count_mismatch flush-and-retry loop entirely (no duplicate logic
 * here). While `status` is `'error'` or `'unsaved_entries'` the SAME
 * Finalize control instead calls `retry()` (resubmitting the stored body
 * unchanged) rather than rebuilding a fresh one.
 *
 * KNOWN GAP, recorded here rather than silently worked around: this task's
 * brief calls for a 400/422 `fieldErrors.materiallyDisrupted` response to
 * render beside the disruption radio. `useFinalizeSession` (7.3.5) — which
 * this file may only ever call through, per file ownership — does not
 * expose the rejected error (or its `fieldErrors`) on ANY status; its own
 * `runChain` catches every non-mismatch rejection and sets a bare `'error'`
 * status with no error object retained (confirmed against its source and
 * its own test file, which never asserts an exposed error). `PracticeReview`
 * (8.6.2), the only other screen built on this same hook, hit the identical
 * wall and documented the same fallback in its own header comment: every
 * failure — including a field-level 422 — renders one generic message here.
 * Distinguishing `materiallyDisrupted`'s field error specifically would
 * require `useFinalizeSession` to start exposing the underlying `ApiError`
 * (mirroring `useStartSession`'s `error` field), which is out of this file's
 * ownership (`apps/web/src/lib/**`); see this task's own report for the
 * follow-up this implies.
 */
import { useState } from 'react'
import type {
  NextActionValue,
  ObservedConditionsValue,
  ReviewInputValue,
  SessionResponseValue,
} from '@attention-lab/shared'

import { useFinalizeSession, type FinalizeSessionStatus } from '../../lib/outbox/useFinalizeSession.js'
import { Button } from '../../ui/Button.js'
import type { CountFieldsValue } from './CountFields.js'
import type { DisruptionAnswer } from './DisruptionField.js'
import { EligibilitySummary } from './EligibilitySummary.js'
import { toFinalizeReview } from './toFinalizeReview.js'

type RecallScoresInput = NonNullable<ReviewInputValue['recallScores']>

const MAX_REVIEW_NOTE_LENGTH = 500

const DISRUPTION_MISSING_MESSAGE = 'Answer whether the session was materially disrupted'
const SCORING_MISSING_MESSAGE = 'Finish scoring recall'
const CONDITIONS_MISSING_MESSAGE = 'Confirm the observed conditions'

/** Every non-mismatch failure shares one generic message — see this file's header comment on why. */
function statusMessage(status: FinalizeSessionStatus): string | null {
  switch (status) {
    case 'unsaved_entries':
      return 'Some entries are still unsaved. Retry.'
    case 'error':
      return 'The review could not be saved. Retry.'
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// FinalizeBar
// ---------------------------------------------------------------------------

export interface FinalizeBarProps {
  readonly canFinalize: boolean
  readonly missing: readonly string[]
  readonly onFinalize: () => void
  readonly status: FinalizeSessionStatus
}

const IN_FLIGHT_STATUSES: readonly FinalizeSessionStatus[] = ['flushing', 'submitting', 'mismatch']

export function FinalizeBar({ canFinalize, missing, onFinalize, status }: FinalizeBarProps) {
  const primaryDisabled = !canFinalize || IN_FLIGHT_STATUSES.includes(status)
  const message = statusMessage(status)

  return (
    <div className="space-y-3">
      {missing.length > 0 ? (
        <ul className="space-y-1 text-sm text-[var(--color-text-muted)]" aria-label="What is missing before you can finalize">
          {missing.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}

      <Button type="button" variant="primary" disabled={primaryDisabled} onClick={onFinalize}>
        Finalize
      </Button>

      {message !== null ? (
        <div role="status" className="flex items-center gap-3 text-sm text-[var(--color-text)]">
          <p>{message}</p>
          <Button type="button" variant="secondary" onClick={onFinalize}>
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// buildFinalizeReviewBody — merges every earlier section's slice, per D7.1/
// D31's "blank is omitted, an explicit value is sent" rule applied to each
// of disruptionNote/recallScores/reviewNote independently.
// ---------------------------------------------------------------------------

export interface BuildFinalizeReviewBodyParams {
  readonly countFieldsValue: CountFieldsValue
  readonly recallScores: RecallScoresInput | undefined
  readonly materiallyDisrupted: 'yes' | 'no'
  readonly disruptionNote: string
  readonly conditions: ObservedConditionsValue
  readonly reviewNote: string
}

export function buildFinalizeReviewBody(params: BuildFinalizeReviewBodyParams): ReviewInputValue {
  const body: Record<string, unknown> = {
    ...toFinalizeReview(params.countFieldsValue),
    materiallyDisrupted: params.materiallyDisrupted === 'yes',
    conditions: params.conditions,
  }

  if (params.disruptionNote.trim().length > 0) {
    body.disruptionNote = params.disruptionNote
  }
  if (params.recallScores !== undefined) {
    body.recallScores = params.recallScores
  }
  if (params.reviewNote.trim().length > 0) {
    body.reviewNote = params.reviewNote
  }

  return body as unknown as ReviewInputValue
}

// ---------------------------------------------------------------------------
// FinalizeSection — the piece BenchmarkReviewPage actually mounts.
// ---------------------------------------------------------------------------

export interface FinalizeSectionProps {
  readonly session: SessionResponseValue
  readonly countFieldsValue: CountFieldsValue
  readonly recallScores: RecallScoresInput | undefined
  readonly scoringComplete: boolean
  readonly materiallyDisrupted: DisruptionAnswer
  readonly disruptionNote: string
  readonly conditions: ObservedConditionsValue
  readonly conditionsConfirmed: boolean
  /** Context only, forwarded to `EligibilitySummary` — see that file's header comment. */
  readonly nextAction?: NextActionValue | undefined
}

function computeMissing(params: {
  materiallyDisrupted: DisruptionAnswer
  scoringComplete: boolean
  conditionsConfirmed: boolean
}): string[] {
  const missing: string[] = []
  if (params.materiallyDisrupted === null) {
    missing.push(DISRUPTION_MISSING_MESSAGE)
  }
  if (!params.scoringComplete) {
    missing.push(SCORING_MISSING_MESSAGE)
  }
  if (!params.conditionsConfirmed) {
    missing.push(CONDITIONS_MISSING_MESSAGE)
  }
  return missing
}

export function FinalizeSection({
  session,
  countFieldsValue,
  recallScores,
  scoringComplete,
  materiallyDisrupted,
  disruptionNote,
  conditions,
  conditionsConfirmed,
  nextAction,
}: FinalizeSectionProps) {
  const [reviewNote, setReviewNote] = useState('')
  const finalizeHook = useFinalizeSession(session.id)

  const missing = computeMissing({ materiallyDisrupted, scoringComplete, conditionsConfirmed })
  const canFinalize = missing.length === 0

  function handleFinalize(): void {
    if (finalizeHook.status === 'error' || finalizeHook.status === 'unsaved_entries') {
      void finalizeHook.retry()
      return
    }
    if (!canFinalize || materiallyDisrupted === null) {
      // Defensive only — FinalizeBar's own button is already disabled in
      // this state, so a real click never reaches here.
      return
    }
    const review = buildFinalizeReviewBody({
      countFieldsValue,
      recallScores,
      materiallyDisrupted,
      disruptionNote,
      conditions,
      reviewNote,
    })
    void finalizeHook.finalize(review)
  }

  if (finalizeHook.status === 'success' && finalizeHook.result !== null) {
    return (
      <EligibilitySummary
        session={finalizeHook.result.session}
        review={finalizeHook.result.review}
        eligible={finalizeHook.result.eligible}
        exclusionReasons={finalizeHook.result.exclusionReasons}
        nextAction={nextAction}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="review-note" className="block text-sm font-medium text-[var(--color-text)]">
          Anything else to note?
        </label>
        <textarea
          id="review-note"
          value={reviewNote}
          maxLength={MAX_REVIEW_NOTE_LENGTH}
          rows={3}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
          onChange={(event) => setReviewNote(event.target.value)}
        />
        <p className="text-xs text-[var(--color-text-muted)]">
          {reviewNote.length}/{MAX_REVIEW_NOTE_LENGTH}
        </p>
      </div>

      <FinalizeBar canFinalize={canFinalize} missing={missing} onFinalize={handleFinalize} status={finalizeHook.status} />
    </div>
  )
}
