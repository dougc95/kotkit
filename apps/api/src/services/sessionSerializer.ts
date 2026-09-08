/**
 * Task 5.1.1 — `serializeSession`: the single D20 response shape every
 * sessions route returns (`POST /sessions` here; `GET /sessions/{id}`,
 * `GET /sessions/active` and group 5b's transitions/clock-gap/recall/finalize
 * later reuse this same function rather than re-deriving the shape — D16, one
 * owner per shared piece).
 *
 * Stored `focus_sessions` columns are mapped to camelCase as-is; `serverNow`
 * is `now.toISOString()`; `timing` comes from `deriveTiming` (5.2.1) and
 * `tallies` from `deriveTallies` (5.2.1) — both pure, no DB; `eventCount` is
 * every stored `session_events` row for the session including voided ones
 * (distinct from `tallies`, which excludes voided rows, D20); `events[]`
 * includes voided rows with their `voidedAt`; `review` maps every
 * `ReportedCount` column through as JSON `null`, never `0` (D7.1), and
 * reconstructs the wire `firstSwitch`/`firstSwitchMethod` pair from the
 * stored `first_switch_*` trio via `packages/shared`'s
 * `fromStoredFirstSwitch` (D16 — the first-switch reconstruction rule lives
 * there, not duplicated here); `agentPlan` is `null` when no row exists yet;
 * `amendments` defaults to `[]`.
 */
import {
  fromStoredFirstSwitch,
  type AgentPlanResponseValue,
  type AmendmentResponseValue,
  type EventLike,
  type EventResponseValue,
  type ExclusionReason,
  type RecallFlag,
  type ReviewResponseValue,
  type SessionResponseValue,
} from '@attention-lab/shared'

import type { agentPlans } from '../db/schema/agentPlans.js'
import type { focusSessions } from '../db/schema/focusSessions.js'
import type { sessionAmendments } from '../db/schema/sessionAmendments.js'
import type { sessionEvents } from '../db/schema/sessionEvents.js'
import type { sessionReviews } from '../db/schema/sessionReviews.js'
import { deriveTallies } from './sessionTallies.js'
import { deriveTiming } from './sessionTiming.js'

export type FocusSessionRow = typeof focusSessions.$inferSelect
export type SessionReviewRow = typeof sessionReviews.$inferSelect
export type SessionEventRow = typeof sessionEvents.$inferSelect
export type AgentPlanRow = typeof agentPlans.$inferSelect
export type SessionAmendmentRow = typeof sessionAmendments.$inferSelect

// ---------------------------------------------------------------------------
// events[] and tallies
// ---------------------------------------------------------------------------

function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString()
}

/**
 * Exported (task 5.3.2, D16): `voidEvent` (`services/session.ts`) reuses this
 * exact function to serialize the single event row it returns, rather than
 * re-deriving the `EventResponse` shape a second way.
 */
export function serializeEvent(row: SessionEventRow): EventResponseValue {
  return {
    id: row.id,
    clientEventId: row.clientEventId,
    type: row.type,
    elapsedMs: row.elapsedMs,
    occurredAt: row.occurredAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    details: row.details,
    voidedAt: isoOrNull(row.voidedAt),
  }
}

/**
 * `deriveTallies` (5.2.1, wrapping `packages/shared`'s `tallyEvents`) takes
 * `EventLike`, whose `voidedAt` is a string (or `null`) rather than the
 * stored `Date | null` — this is the one conversion between the two shapes,
 * kept local to this module so `sessionTallies.ts` itself stays free of any
 * DB-row type.
 *
 * Exported (task 5.8.4, D16): `finalizeSession`'s benchmark branch
 * (`services/review.ts`) reuses this exact conversion to build the
 * `EventLike[]` the shared `deriveFirstSwitch` filters internally, rather
 * than re-deriving the DB-row-to-`EventLike` mapping a second way.
 */
export function toEventLike(row: SessionEventRow): EventLike {
  return {
    clientEventId: row.clientEventId,
    type: row.type,
    elapsedMs: row.elapsedMs,
    voidedAt: isoOrNull(row.voidedAt),
    // Every stored `details` shape (`EventDetailsValue` for a plain event,
    // `ClockGapDetailsValue` for a `clock_gap` row) is a superset of what
    // `EventLike` reads (`alsoOffTask` only) — the cast documents that
    // `deriveTallies` never looks at anything else in `details`.
    details: row.details as { readonly alsoOffTask?: boolean },
  }
}

// ---------------------------------------------------------------------------
// review
// ---------------------------------------------------------------------------

type LockedRecallScores = ReviewResponseValue['recallScores']

/**
 * `session_reviews.recall_scores` is typed at the schema level as either the
 * partial `RecallPointScores` (an entry may be `null` mid-scoring) or a full
 * `RecallScoreValue[]` — but `packages/shared`'s `scoreRecall` (D7.3) only
 * ever WRITES this column as `null` or a complete five-entry `0|1` array,
 * never a partial one (a non-blank, unscored point leaves the whole result
 * `null` instead). The wire `ReviewResponse.recallScores` is therefore typed
 * as a full locked tuple or `null`; this cast documents and relies on that
 * write-side invariant rather than re-deriving it here.
 */
function toLockedRecallScores(value: SessionReviewRow['recallScores']): LockedRecallScores {
  if (value === null) return null
  return value as [0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1]
}

/**
 * Exported (task 5.7.2, D16): `lockRecall` (`services/review.ts`) reuses this
 * exact function to serialize the `session_reviews` row it reads or updates,
 * rather than re-deriving the `ReviewResponse` shape a second way.
 */
export function serializeReview(row: SessionReviewRow): ReviewResponseValue {
  const derived = fromStoredFirstSwitch({
    first_switch_kind: row.firstSwitchKind,
    first_switch_seconds: row.firstSwitchSeconds,
    first_switch_method: row.firstSwitchMethod,
  })

  return {
    sessionId: row.sessionId,
    episodeCount: row.episodeCount,
    countMethod: row.countMethod,
    firstSwitch: derived === null ? null : derived.firstSwitch,
    firstSwitchMethod: derived === null ? null : derived.method,
    externalCount: row.externalCount,
    unplannedAgentChecks: row.unplannedAgentChecks,
    mindWanderingCount: row.mindWanderingCount,
    outputQuality: row.outputQuality,
    outputNote: row.outputNote,
    reviewNote: row.reviewNote,
    materiallyDisrupted: row.materiallyDisrupted,
    disruptionNote: row.disruptionNote,
    recallPoints: row.recallPoints === null ? null : [...row.recallPoints],
    recallStartedAt: isoOrNull(row.recallStartedAt),
    recallLockedAt: isoOrNull(row.recallLockedAt),
    recallDelaySeconds: row.recallDelaySeconds,
    recallDurationSeconds: row.recallDurationSeconds,
    // `session_reviews.recall_flags` is a plain (untyped) text[] column at
    // the schema level (like `focus_sessions.exclusion_reasons` below) — its
    // only writers ever store `RecallFlag` members (`deriveRecallFlags`,
    // packages/shared/src/domain/recall.ts).
    recallFlags: [...row.recallFlags] as RecallFlag[],
    recallScores: toLockedRecallScores(row.recallScores),
    recallScore: row.recallScore,
    conditions: row.observedConditions,
    finalizedAt: isoOrNull(row.finalizedAt),
    version: row.version,
  }
}

// ---------------------------------------------------------------------------
// agentPlan and amendments
// ---------------------------------------------------------------------------

/**
 * Exported (task 5.6.1, D16): `putAgentPlan` (`services/session.ts`) reuses
 * this exact function to serialize the row its own insert/update returns,
 * rather than re-deriving the `AgentPlanResponse` shape a second way.
 */
export function serializeAgentPlan(row: AgentPlanRow): AgentPlanResponseValue {
  return {
    sessionId: row.sessionId,
    workstream: row.workstream,
    waitingTask: row.waitingTask,
    // `agent_plans.review_checkpoint` is a plain NOT NULL text column whose
    // only value this codebase ever writes is 'end_of_block' (see
    // agentPlans.ts and the 2.7 contract's own single-literal type) — the
    // cast documents that invariant rather than widening the wire type.
    reviewCheckpoint: row.reviewCheckpoint as 'end_of_block',
    resumeNote: row.resumeNote,
    reviewAt: isoOrNull(row.reviewAt),
    version: row.version,
  }
}

/**
 * Exported (task 5.9.1, D16): `addAmendment` (`services/review.ts`) reuses
 * this exact function to serialize the `session_amendments` row its own
 * insert returns, rather than re-deriving the `AmendmentResponse` shape a
 * second way.
 */
export function serializeAmendment(row: SessionAmendmentRow): AmendmentResponseValue {
  return {
    id: row.id,
    sessionId: row.sessionId,
    reason: row.reason,
    excludeFromReport: row.excludeFromReport,
    createdAt: row.createdAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// serializeSession (D20)
// ---------------------------------------------------------------------------

export function serializeSession(
  session: FocusSessionRow,
  review: SessionReviewRow,
  events: readonly SessionEventRow[],
  plan: AgentPlanRow | null,
  amendments: readonly SessionAmendmentRow[],
  now: Date,
): SessionResponseValue {
  return {
    id: session.id,
    programId: session.programId,
    slotId: session.slotId,
    revisionId: session.revisionId,
    realm: session.realm,
    kind: session.kind,
    lifecycle: session.lifecycle,
    targetSeconds: session.targetSeconds,
    startedAt: session.startedAt.toISOString(),
    endedAt: isoOrNull(session.endedAt),
    pausedSeconds: session.pausedSeconds,
    currentPauseStartedAt: isoOrNull(session.currentPauseStartedAt),
    localDate: session.localDate,
    intendedOutput: session.intendedOutput,
    timeSource: session.timeSource,
    timerQuality: session.timerQuality,
    clockGapSeconds: session.clockGapSeconds,
    completeInterval: session.completeInterval,
    eligible: session.eligible,
    // Plain (untyped) text[] column at the schema level — only ever written
    // with `ExclusionReason` members (eligibility derivation is a later
    // group's job; this session-start route always writes `[]`).
    exclusionReasons: [...session.exclusionReasons] as ExclusionReason[],
    replacementReason: session.replacementReason,
    version: session.version,
    serverNow: now.toISOString(),
    timing: deriveTiming(session, now),
    // D20: no combined/total field — offTask and agentChecks overlap by
    // design (D11), so tallies is exactly the three-key shape deriveTallies
    // returns, never spread with an invented aggregate.
    tallies: deriveTallies(events.map(toEventLike)),
    // Every stored row, voided included — distinct from tallies, which skip
    // voided rows (D20).
    eventCount: events.length,
    events: events.map(serializeEvent),
    review: serializeReview(review),
    agentPlan: plan === null ? null : serializeAgentPlan(plan),
    amendments: amendments.map(serializeAmendment),
  }
}
