/**
 * Scoring — the first section of `/benchmark/:sessionId/scoring` (task
 * 8.4.2; design.md D4, D7.3, D10, D25; specs/benchmark-assessment:
 * "Self-scoring is unavailable until recall is locked" — "Attempt to score
 * before recall", "Score with two blank points", "Incomplete attempt
 * finalized without recall"; specs/benchmark-assessment: "Recall is a
 * separate, timed, then locked step" — "Recall text is immutable after
 * save", "Recall started after a long break"). Mounted by
 * `BenchmarkReviewPage` (created in this same task) as the first of four
 * sections — 8.4.3/8.4.4/8.4.5 each append one more section to that file
 * without touching this component.
 *
 * Three states, checked in this order (never a client re-derivation of
 * eligibility — that stays server-side, D4):
 *
 *  1. `review.recallLockedAt === null && session.completeInterval === true`
 *     — a complete interval whose recall has not been saved yet. Renders
 *     "Recall must be saved first" with a link back to `/recall` and NO
 *     scoring controls in the DOM at all (finalizing here would be 422
 *     `recall_not_locked`, D25).
 *  2. `review.recallLockedAt === null && session.completeInterval === false`
 *     — an incomplete attempt whose recall was skipped (D25 permits this).
 *     Renders "Recall not saved — this attempt will be recorded with recall
 *     missing", NO scoring controls, and deliberately NO link back to
 *     recall (Skip recall's whole point, from Recall.tsx/8.4.1, is that this
 *     attempt proceeds straight to Finalize, 8.4.5, without one).
 *  3. Otherwise (`recallLockedAt !== null`) — the five locked points render
 *     as read-only text (never a textarea/input — the text is immutable
 *     after save, D10). Each non-blank point gets its own required
 *     Accurate/Not-accurate radio group (`PointRow`); a blank point (empty
 *     string) shows "Scored 0 because blank" and no radios at all, because a
 *     blank point can never be scored Accurate. The preview line "Recall
 *     score (self-reported, preview): n/5" counts only Accurate answers —
 *     never rendered as a percentage or an "attention" framing. Every entry
 *     in `review.recallFlags` (`recall_delayed`, `recall_overrun`) renders as
 *     a visible, explicitly non-excluding deviation note — flags describe
 *     the recall attempt, they never gate or lower the preview score.
 *
 * Emits `onChange(recallScores, complete)` on every relevant change (state 3)
 * or once per mount for states 1/2, so `BenchmarkReviewPage` always has a
 * current value: state 1 -> `(undefined, false)` (can never legitimately
 * finalize from here); state 2 -> `(undefined, true)` — recall is missing
 * entirely, so 8.4.5 sends no `recallScores` in the finalize body at all;
 * state 3 -> `(scores, complete)` where `scores` is five entries of `0 | 1`
 * (a blank point always contributes `0`, matching the preview count) and
 * `complete` is true only once every non-blank point has been answered.
 */
import { useEffect, useMemo, useState } from 'react'
import { RadioGroup } from 'radix-ui'
import { Link } from 'react-router'
import type { RecallFlag, ReviewInputValue, ReviewResponseValue, SessionResponseValue } from '@attention-lab/shared'

type RecallScoresInput = NonNullable<ReviewInputValue['recallScores']>

const POINT_INDICES = [0, 1, 2, 3, 4] as const
type PointIndex = (typeof POINT_INDICES)[number]

const BLANK_POINTS: readonly [string, string, string, string, string] = ['', '', '', '', '']

type PointAnswer = 'accurate' | 'not_accurate' | null
type Answers = readonly [PointAnswer, PointAnswer, PointAnswer, PointAnswer, PointAnswer]

const BLANK_ANSWERS: Answers = [null, null, null, null, null]

const FLAG_COPY: Record<RecallFlag, string> = {
  recall_delayed: 'Recall started more than 10 minutes after the interval',
  recall_overrun: 'Recall ran more than 30 s over 3:00',
}

// ---------------------------------------------------------------------------
// PointRow
// ---------------------------------------------------------------------------

export interface PointRowProps {
  readonly index: PointIndex
  readonly text: string
  readonly value: PointAnswer
  readonly onChange: (value: 'accurate' | 'not_accurate') => void
}

/**
 * One locked recall point: read-only text (never a textarea/input) plus,
 * only when the point is non-blank, a required Accurate/Not-accurate radio
 * group. A blank point renders "Scored 0 because blank" and no radios —
 * there is nothing to score.
 */
export function PointRow({ index, text, value, onChange }: PointRowProps) {
  const label = `Point ${index + 1}`
  const isBlank = text.trim().length === 0

  if (isBlank) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-[var(--color-text)]">{label}</p>
        <p className="text-sm text-[var(--color-text-muted)]">Scored 0 because blank</p>
      </div>
    )
  }

  const accurateId = `point-${index}-accurate`
  const notAccurateId = `point-${index}-not-accurate`

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-[var(--color-text)]">{label}</p>
      <p className="text-sm text-[var(--color-text)]">{text}</p>
      <fieldset>
        <legend className="sr-only">{`${label} score`}</legend>
        <RadioGroup.Root
          className="flex gap-4"
          required
          value={value ?? null}
          onValueChange={(next) => onChange(next as 'accurate' | 'not_accurate')}
        >
          <div className="flex items-center gap-2">
            <RadioGroup.Item
              id={accurateId}
              value="accurate"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] data-[state=checked]:border-[var(--color-primary)]"
            >
              <RadioGroup.Indicator className="h-2.5 w-2.5 rounded-full bg-[var(--color-primary)]" />
            </RadioGroup.Item>
            <label htmlFor={accurateId} className="text-sm text-[var(--color-text)]">
              Accurate
            </label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroup.Item
              id={notAccurateId}
              value="not_accurate"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] data-[state=checked]:border-[var(--color-primary)]"
            >
              <RadioGroup.Indicator className="h-2.5 w-2.5 rounded-full bg-[var(--color-primary)]" />
            </RadioGroup.Item>
            <label htmlFor={notAccurateId} className="text-sm text-[var(--color-text)]">
              Not accurate
            </label>
          </div>
        </RadioGroup.Root>
      </fieldset>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoringProps {
  readonly session: SessionResponseValue
  readonly review: ReviewResponseValue
  readonly onChange: (recallScores: RecallScoresInput | undefined, complete: boolean) => void
}

type ScoringMode = 'locked_required' | 'recall_missing' | 'scored'

function scoringMode(session: SessionResponseValue, review: ReviewResponseValue): ScoringMode {
  if (review.recallLockedAt !== null) {
    return 'scored'
  }
  return session.completeInterval === false ? 'recall_missing' : 'locked_required'
}

export function Scoring({ session, review, onChange }: ScoringProps) {
  const mode = scoringMode(session, review)
  const points = review.recallPoints ?? BLANK_POINTS
  const [answers, setAnswers] = useState<Answers>(BLANK_ANSWERS)

  function handleAnswerChange(index: PointIndex, value: 'accurate' | 'not_accurate'): void {
    setAnswers((previous) => {
      const next = [...previous] as [PointAnswer, PointAnswer, PointAnswer, PointAnswer, PointAnswer]
      next[index] = value
      return next
    })
  }

  // Kept as a plain `0 | 1` tuple internally (never `null`) so the preview
  // sum below stays ordinary arithmetic; only the value handed to `onChange`
  // is widened to `RecallScoresInput`'s wire type (`0 | 1 | null` per entry,
  // D31's `ReviewInputSchema` shape — this component itself never produces a
  // `null` entry, a blank point always contributes `0`).
  const scoreValues = useMemo<readonly [0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1]>(() => {
    return POINT_INDICES.map((index) => {
      const isBlank = points[index].trim().length === 0
      if (isBlank) {
        return 0
      }
      return answers[index] === 'accurate' ? 1 : 0
    }) as [0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1]
  }, [points, answers])

  const recallScores = scoreValues as unknown as RecallScoresInput

  const complete = useMemo(() => {
    return POINT_INDICES.every((index) => points[index].trim().length === 0 || answers[index] !== null)
  }, [points, answers])

  const previewScore = useMemo(() => scoreValues.reduce<number>((total, entry) => total + entry, 0), [scoreValues])

  // Reports the current value on every render where it could plausibly have
  // changed (mode, the derived scores/complete). `onChange` is intentionally
  // left out of the dependency array (mirrors PracticeReview.tsx's status
  // effect) — it is the parent's stable setState pair, and including it
  // would refire this effect on every parent render for no functional
  // reason since the values themselves already gate it.
  useEffect(() => {
    if (mode === 'locked_required') {
      onChange(undefined, false)
    } else if (mode === 'recall_missing') {
      onChange(undefined, true)
    } else {
      onChange(recallScores, complete)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, recallScores, complete])

  if (mode === 'locked_required') {
    return (
      <div className="space-y-2">
        <p>Recall must be saved first</p>
        <Link to={`/benchmark/${session.id}/recall`} className="text-sm underline text-[var(--color-primary)]">
          Go to recall
        </Link>
      </div>
    )
  }

  if (mode === 'recall_missing') {
    return (
      <div className="space-y-2">
        <p>Recall not saved — this attempt will be recorded with recall missing</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {POINT_INDICES.map((index) => (
          <PointRow
            key={index}
            index={index}
            text={points[index]}
            value={answers[index]}
            onChange={(value) => handleAnswerChange(index, value)}
          />
        ))}
      </div>

      <p className="text-sm font-medium text-[var(--color-text)]">
        Recall score (self-reported, preview): {previewScore}/5
      </p>

      {review.recallFlags.length > 0 ? (
        <ul className="space-y-1 text-sm text-[var(--color-text-muted)]">
          {review.recallFlags.map((flag) => (
            <li key={flag}>
              {FLAG_COPY[flag]} (noted, not excluding)
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
