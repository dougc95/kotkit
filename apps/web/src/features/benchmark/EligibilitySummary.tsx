/**
 * EligibilitySummary — the real, server-written result shown once a
 * benchmark review has finalized (task 8.4.5; design.md D4, D7.2, D25, D31;
 * specs/benchmark-assessment: "Eligibility is derived server-side with
 * explicit reasons"; specs/app-shell: "Copy never punishes or gamifies").
 * Mounted by `FinalizeSection` (this same file's sibling `Finalize.tsx`)
 * only once `useFinalizeSession(sessionId)`'s `status` reaches `'success'`
 * — this is the ONE place in the Scoring flow that renders a real
 * eligibility result rather than `EligibilityPreview`'s (8.4.4) always-a-
 * preview label, and it renders the finalize response's own
 * `eligible`/`exclusionReasons` verbatim (D4 — never a client re-derivation).
 *
 * Every reason renders through `packages/shared`'s own `EXCLUSION_REASON_COPY`
 * — the exact same map `EligibilityPreview` uses — so `recall_missing` and
 * `scoring_incomplete` can appear together for an incomplete attempt without
 * this component inventing its own wording. S (`review.episodeCount`) and
 * recall score (`review.recallScore`) each render "Not reported" for a
 * `null` value (D31: never `0` for blank), and the first-switch line reuses
 * `formatFirstSwitch` verbatim so "Unknown" and "20+, capped" stay the same
 * two disjoint strings they are everywhere else in this flow. Nothing here
 * computes or renders a percentage, a score-out-of framing beyond the plain
 * "n/5 (self-reported)" recall line, or any causal/celebratory wording — an
 * ineligible attempt is shown with the same neutral layout as an eligible
 * one (the "attempt still shown" requirement: exclusion reasons are additive
 * information, never a reason to hide the rest of the summary).
 *
 * "Continue" (the one primary action here) refetches `GET /programs/current`
 * itself — rather than trusting whatever `nextAction` this component was
 * mounted with, which can be stale the instant finalize changes what the
 * server would compute next — and routes to `/benchmark/:slotId` for a
 * `benchmark` or `final` `nextAction`, else `/today`. The optional
 * `nextAction` prop exists only so a parent that already has a fresh value
 * (e.g. immediately after its own `GET /programs/current`) can pass it
 * through for context; the click handler never trusts it for the actual
 * routing decision.
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import {
  EXCLUSION_REASON_COPY,
  formatFirstSwitch,
  type ExclusionReason,
  type NextActionValue,
  type ReviewResponseValue,
  type SessionResponseValue,
} from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'

export interface EligibilitySummaryProps {
  readonly session: SessionResponseValue
  readonly review: ReviewResponseValue
  readonly eligible: boolean | null
  readonly exclusionReasons: readonly ExclusionReason[]
  /** Context only — see the module comment on why Continue never routes off this value directly. */
  readonly nextAction?: NextActionValue | undefined
}

function formatEpisodeCount(value: number | null): string {
  return value === null ? 'Not reported' : String(value)
}

function formatRecallScore(value: number | null): string {
  return value === null ? 'Not reported' : `${value}/5 (self-reported)`
}

export function EligibilitySummary({ session, review, eligible, exclusionReasons }: EligibilitySummaryProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [continuing, setContinuing] = useState(false)

  async function handleContinue(): Promise<void> {
    setContinuing(true)
    try {
      const fresh = await api.programs.current()
      queryClient.setQueryData(queryKeys.programs.current, fresh)
      if (fresh.nextAction.kind === 'benchmark' || fresh.nextAction.kind === 'final') {
        navigate(`/benchmark/${fresh.nextAction.slotId}`)
      } else {
        navigate('/today')
      }
    } finally {
      setContinuing(false)
    }
  }

  return (
    <div className="space-y-4" data-testid="eligibility-summary">
      <p className="text-base font-semibold text-[var(--color-text)]">{eligible === true ? 'Eligible' : 'Not eligible'}</p>

      {eligible !== true && exclusionReasons.length > 0 ? (
        <ul className="space-y-1 text-sm text-[var(--color-text-muted)]">
          {exclusionReasons.map((reason) => (
            <li key={reason}>{EXCLUSION_REASON_COPY[reason]}</li>
          ))}
        </ul>
      ) : null}

      <dl className="space-y-1 text-sm text-[var(--color-text)]">
        <div>
          <dt className="inline text-[var(--color-text-muted)]">Local date: </dt>
          <dd className="inline">{session.localDate}</dd>
        </div>
        <div>
          <dt className="inline text-[var(--color-text-muted)]">Off-task episodes (S): </dt>
          <dd className="inline">{formatEpisodeCount(review.episodeCount)}</dd>
        </div>
        <div>
          <dt className="inline text-[var(--color-text-muted)]">Recall score: </dt>
          <dd className="inline">{formatRecallScore(review.recallScore)}</dd>
        </div>
        <div>
          <dt className="inline text-[var(--color-text-muted)]">First switch: </dt>
          <dd className="inline">{review.firstSwitch === null ? 'Not reported' : formatFirstSwitch(review.firstSwitch)}</dd>
        </div>
      </dl>

      <Button type="button" variant="primary" disabled={continuing} onClick={() => void handleContinue()}>
        Continue
      </Button>
    </div>
  )
}
