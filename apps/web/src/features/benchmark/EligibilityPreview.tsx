/**
 * EligibilityPreview and IncompleteBanner — the last two pieces of the
 * third section of `/benchmark/:sessionId/scoring` (task 8.4.4; design.md
 * D4, D7.2, D24, D25; specs/benchmark-assessment: "Fixed interval with no
 * valid pause" — "Stop early"; "Eligibility is derived server-side with
 * explicit reasons"). Mounted by `BenchmarkReviewPage` after
 * `DisruptionField`/`ConditionsFields`.
 *
 * `EligibilityPreview` never re-derives eligibility itself (D4): it calls
 * `packages/shared`'s own `evaluateEligibility` — the exact function the API
 * uses at finalize — over an `EligibilityInput` the parent assembles, and
 * always renders the result under the "Preview — the server decides at
 * finalize" label so an "Eligible" preview is never mistaken for the real,
 * server-written result. `input === null` (the matching benchmark slot has
 * not loaded from `GET /programs/current` yet) renders a plain loading note
 * instead of guessing.
 */
import {
  EXCLUSION_REASON_COPY,
  evaluateEligibility,
  type EligibilityInput,
  type Realm,
  type ReportedCount,
  type TimeSource,
  type TimerQuality,
} from '@attention-lab/shared'

import { formatRemaining } from '../../lib/clock/remaining.js'

// ---------------------------------------------------------------------------
// deriveEligibilityPreviewInput — assembles the domain function's exact input
// shape from this page's own state plus the two earlier sections' state.
// ---------------------------------------------------------------------------

export interface EligibilityPreviewInputParams {
  readonly completeInterval: boolean | null
  readonly recallLockedAt: string | null
  /** Scoring's (8.4.2) own `complete` flag — see the `recallScores` note below. */
  readonly scoringComplete: boolean
  /** Scoring's (8.4.2) own `recallScores` — `undefined` whenever recall is missing or not yet locked. */
  readonly recallScores: readonly (0 | 1)[] | undefined
  /** CountFields' (8.4.3) parsed `episodeCount` — `null` while S is blank, never `0` for blank. */
  readonly episodeCount: ReportedCount
  readonly materiallyDisrupted: 'yes' | 'no' | null
  readonly timerQuality: TimerQuality
  readonly sessionLocalDate: string
  /** The matching slot's `assignedLocalDate` from `GET /programs/current`; `null` while that query has not resolved. */
  readonly slotAssignedLocalDate: string | null
  readonly excludedByAmendment: boolean
  readonly realm: Realm
  readonly timeSource: TimeSource
}

/**
 * Returns `null` only while the slot date is not yet known — there is no
 * defensible preview to show without it (a missing/present `timing_deviation`
 * reason would otherwise be a guess).
 *
 * `materiallyDisrupted: null` (unanswered) reads as `false` for this PREVIEW
 * ONLY: `EligibilityInput.materiallyDisrupted` is a plain, non-nullable
 * `boolean` (only finalize ever writes a real value there), so there is no
 * third state to hand it. Finalize itself (8.4.5) refuses to proceed while
 * this is unanswered regardless of what the preview shows, and the preview
 * is always rendered under the "Preview — the server decides at finalize"
 * label — this never claims a real result, it only omits a reason
 * (`materially_disrupted`) that would appear the instant the user answers
 * Yes.
 *
 * `recallScores` counts as "reported" only once `scoringComplete` is true
 * (D25): Scoring's `recall_missing` mode reports `complete: true` together
 * with `recallScores: undefined`, and that combination must still read as
 * `scoring_incomplete` here — exactly the "recall_missing and
 * scoring_incomplete together" pairing 8.4.5's summary lists for an
 * incomplete attempt.
 */
export function deriveEligibilityPreviewInput(
  params: EligibilityPreviewInputParams,
): EligibilityInput | null {
  if (params.slotAssignedLocalDate === null) {
    return null
  }
  return {
    completeInterval: params.completeInterval,
    recallLockedAt: params.recallLockedAt,
    recallScores: params.scoringComplete && params.recallScores !== undefined ? params.recallScores : null,
    episodeCount: params.episodeCount,
    materiallyDisrupted: params.materiallyDisrupted === 'yes',
    timerQuality: params.timerQuality,
    sessionLocalDate: params.sessionLocalDate,
    slotAssignedLocalDate: params.slotAssignedLocalDate,
    excludedByAmendment: params.excludedByAmendment,
    realm: params.realm,
    timeSource: params.timeSource,
  }
}

// ---------------------------------------------------------------------------
// EligibilityPreview
// ---------------------------------------------------------------------------

export interface EligibilityPreviewProps {
  readonly input: EligibilityInput | null
}

const PREVIEW_LABEL = 'Preview — the server decides at finalize'

export function EligibilityPreview({ input }: EligibilityPreviewProps) {
  if (input === null) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]" aria-busy="true">
        Eligibility preview — loading
      </p>
    )
  }

  const result = evaluateEligibility(input)

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-[var(--color-text)]">{PREVIEW_LABEL}</p>
      {result.eligible ? (
        <p className="text-sm text-[var(--color-text)]">Eligible</p>
      ) : (
        <ul className="space-y-1 text-sm text-[var(--color-text-muted)]">
          {result.exclusionReasons.map((reason) => (
            <li key={reason}>{EXCLUSION_REASON_COPY[reason]}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// IncompleteBanner
// ---------------------------------------------------------------------------

export interface IncompleteBannerProps {
  readonly elapsedSeconds: number
}

/**
 * Rendered by `BenchmarkReviewPage` only when `session.completeInterval ===
 * false` (D24: expiry never proves completion, and Stop early/`save_incomplete`
 * both leave it `false`, never `null`, so this banner's gate is unambiguous).
 * The elapsed time is read verbatim from `session.timing.elapsedSeconds`
 * (D20) — never a client-recomputed duration — via `lib/clock`'s own
 * `formatRemaining`, the same zero-padded `mm:ss` formatter `TimerDisplay`
 * uses, so this attempt's incomplete-but-real elapsed time reads identically
 * everywhere it appears.
 */
export function IncompleteBanner({ elapsedSeconds }: IncompleteBannerProps) {
  return (
    <div
      role="status"
      className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm text-[var(--color-text)]"
    >
      <p className="font-medium">Incomplete attempt</p>
      <p>Recorded elapsed time: {formatRemaining(elapsedSeconds)}</p>
    </div>
  )
}
