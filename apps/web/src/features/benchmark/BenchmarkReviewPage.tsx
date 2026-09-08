/**
 * BenchmarkReviewPage — the page shell for `/benchmark/:sessionId/scoring`
 * (task 8.4.2; design.md D4, D10, D20, D25). Rendered inside `SessionLayout`
 * (7.1.4, no navigation) once router.tsx's `ScreenPlaceholder` for this
 * route is replaced (see this task's `centralWiringNeeded`).
 *
 * Fetches `GET /sessions/{id}` (D20) once — the SAME `queryKeys.sessions.
 * byId` cache entry every other session screen reads — and hands
 * `session`/`review` down to each review section as plain props.
 *
 * This was a strictly-sequential, incrementally-built file (never a
 * same-wave parallel edit target), built by four tasks in order, each
 * appending exactly one more section without restructuring what came
 * before:
 *  - 8.4.2 built the page shell and the first section, Scoring.
 *  - 8.4.3 appended CountFields (S/E/M counts + the first-switch preview) as
 *    a second section, plus its own local state slice below the Scoring
 *    slice.
 *  - 8.4.4 appended DisruptionField/ConditionsFields/EligibilityPreview as a
 *    third section, plus its own local state slice.
 *  - 8.4.5 appended `FinalizeSection` (`Finalize.tsx`/`EligibilitySummary.tsx`)
 *    as the fourth and LAST section — the one that actually reads every
 *    earlier slice (including `recallScores`/`scoringComplete` below) and
 *    calls `useFinalizeSession(sessionId)` (7.3.5) itself. This page shell
 *    is complete as of 8.4.5; no later task appends to it.
 *
 * Loading/error states mirror `Recall.tsx` (8.4.1) and `PracticeReview.tsx`
 * (8.6.2): a plain "Loading review"/aria-busy state, then a generic
 * error-with-Retry state, so a fetch failure never renders a stale or
 * half-built review.
 */
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import type {
  CurrentProgramResponseValue,
  ObservedConditionsValue,
  ReviewInputValue,
  SessionResponseValue,
} from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { Button } from '../../ui/Button.js'
import { BLANK_COUNT_FIELDS_VALUE, CountFields, type CountFieldsValue } from './CountFields.js'
import { ConditionsFields } from './ConditionsFields.js'
import { DisruptionField, type DisruptionAnswer } from './DisruptionField.js'
import { deriveEligibilityPreviewInput, EligibilityPreview, IncompleteBanner } from './EligibilityPreview.js'
import { FinalizeSection } from './Finalize.js'
import { Scoring } from './Scoring.js'

type RecallScoresInput = NonNullable<ReviewInputValue['recallScores']>

const BLANK_CONDITIONS: ObservedConditionsValue = {
  deviceFormat: null,
  language: null,
  materialLevel: null,
  accommodations: [],
}

function parseReportedCount(raw: string): number | null {
  const trimmed = raw.trim()
  return trimmed === '' ? null : Number(trimmed)
}

export function BenchmarkReviewPage() {
  const { sessionId } = useParams<{ sessionId: string }>()

  // --- Scoring section state (8.4.2) --------------------------------------
  // Fed by Scoring's `onChange(recallScores, complete)`; 8.4.5 reads both
  // when it builds the finalize body (recallScores omitted from that body
  // entirely when it is `undefined`, D25's recall-missing path).
  const [recallScores, setRecallScores] = useState<RecallScoresInput | undefined>(undefined)
  const [scoringComplete, setScoringComplete] = useState(false)

  function handleScoringChange(nextScores: RecallScoresInput | undefined, nextComplete: boolean): void {
    setRecallScores(nextScores)
    setScoringComplete(nextComplete)
  }

  // --- CountFields section state (8.4.3) ----------------------------------
  // Fully controlled: CountFields reports every change (including its own
  // one-time event prefill) back through `setCountFieldsValue`, never
  // holding the values themselves in its own local state. 8.4.5's finalize
  // body is `toFinalizeReview(countFieldsValue)` merged with every other
  // section's own contribution.
  const [countFieldsValue, setCountFieldsValue] = useState<CountFieldsValue>(BLANK_COUNT_FIELDS_VALUE)

  // --- Disruption/Conditions/EligibilityPreview section state (8.4.4) -----
  // `materiallyDisrupted`/`disruptionNote` start blank with no default —
  // `review.materiallyDisrupted` is written only by finalize (D31), so it is
  // always `null` at this point regardless. `conditions` starts as the blank
  // shape and is prefilled exactly once, below, from `review.conditions`
  // (the server's own D7.5 default from the slot) the moment session data
  // arrives — the same "prefill on arrival, never again" rule `CountFields`
  // (8.4.3) applies to S/E, just hoisted here because `ConditionsFields`
  // itself takes no `session`/`review` prop.
  const [materiallyDisrupted, setMateriallyDisrupted] = useState<DisruptionAnswer>(null)
  const [disruptionNote, setDisruptionNote] = useState('')
  const [conditions, setConditions] = useState<ObservedConditionsValue>(BLANK_CONDITIONS)
  const [conditionsConfirmed, setConditionsConfirmed] = useState(false)

  function handleDisruptionChange(nextValue: DisruptionAnswer, nextNote: string): void {
    setMateriallyDisrupted(nextValue)
    setDisruptionNote(nextNote)
  }

  function handleConditionsChange(nextValue: ObservedConditionsValue, nextConfirmed: boolean): void {
    setConditions(nextValue)
    setConditionsConfirmed(nextConfirmed)
  }

  // reviewNote local state and `useFinalizeSession(sessionId)` itself now
  // live inside `FinalizeSection` (8.4.5, mounted below) — it is the one
  // section that reads every earlier slice above.

  const sessionQuery = useQuery<SessionResponseValue>({
    queryKey: queryKeys.sessions.byId(sessionId ?? ''),
    queryFn: () => api.sessions.get(sessionId ?? ''),
    enabled: sessionId !== undefined,
  })

  // EligibilityPreview's `slotAssignedLocalDate` input (D23's `timing_deviation`
  // comparison) — read from `GET /programs/current`'s `slots[]`, matching the
  // same query `Ready.tsx` already runs. Cached under the one shared
  // `queryKeys.programs.current` key, so this adds no extra network traffic
  // once Today/Ready have already populated it.
  const currentQuery = useQuery<CurrentProgramResponseValue>({
    queryKey: queryKeys.programs.current,
    queryFn: api.programs.current,
  })

  const conditionsPrefilledRef = useRef(false)
  useEffect(() => {
    if (conditionsPrefilledRef.current || sessionQuery.data === undefined) {
      return
    }
    conditionsPrefilledRef.current = true
    setConditions(sessionQuery.data.review.conditions)
  }, [sessionQuery.data])

  if (sessionId === undefined) {
    return <p>Session not found</p>
  }

  if (sessionQuery.isError) {
    return (
      <div className="mx-auto max-w-xl px-4 py-6 space-y-4">
        <p>The review could not be loaded.</p>
        <Button
          onClick={() => {
            void sessionQuery.refetch()
          }}
        >
          Retry
        </Button>
      </div>
    )
  }

  if (sessionQuery.isPending || sessionQuery.data === undefined) {
    return (
      <div className="mx-auto max-w-xl px-4 py-6" aria-busy="true">
        Loading review
      </div>
    )
  }

  const session = sessionQuery.data

  const slot = currentQuery.data?.slots.find((candidate) => candidate.id === session.slotId)
  const eligibilityInput = deriveEligibilityPreviewInput({
    completeInterval: session.completeInterval,
    recallLockedAt: session.review.recallLockedAt,
    scoringComplete,
    // `recallScores` (Scoring's own state) is the wire-shaped tuple of five
    // `0 | 1 | null` entries; Scoring itself guarantees no `null` entry ever
    // reaches here (a blank point always contributes `0`, see Scoring.tsx),
    // so this narrows the same way Scoring.tsx's own `recallScores` cast does.
    recallScores: recallScores as readonly (0 | 1)[] | undefined,
    episodeCount: parseReportedCount(countFieldsValue.episodeCount),
    materiallyDisrupted,
    timerQuality: session.timerQuality,
    sessionLocalDate: session.localDate,
    slotAssignedLocalDate: slot?.assignedLocalDate ?? null,
    excludedByAmendment: session.amendments.some((amendment) => amendment.excludeFromReport),
    realm: session.realm,
    timeSource: session.timeSource,
  })

  return (
    <div className="mx-auto max-w-xl px-4 py-6 space-y-8">
      <h1 className="text-lg font-semibold text-[var(--color-text)]">Benchmark review</h1>

      <Scoring session={session} review={session.review} onChange={handleScoringChange} />

      <CountFields session={session} value={countFieldsValue} onChange={setCountFieldsValue} />

      <div className="space-y-6">
        {session.completeInterval === false ? (
          <IncompleteBanner elapsedSeconds={session.timing.elapsedSeconds} />
        ) : null}

        <DisruptionField value={materiallyDisrupted} note={disruptionNote} onChange={handleDisruptionChange} />

        <ConditionsFields value={conditions} confirmed={conditionsConfirmed} onChange={handleConditionsChange} />

        <EligibilityPreview input={eligibilityInput} />
      </div>

      <FinalizeSection
        session={session}
        countFieldsValue={countFieldsValue}
        recallScores={recallScores}
        scoringComplete={scoringComplete}
        materiallyDisrupted={materiallyDisrupted}
        disruptionNote={disruptionNote}
        conditions={conditions}
        conditionsConfirmed={conditionsConfirmed}
        nextAction={currentQuery.data?.nextAction}
      />
    </div>
  )
}
