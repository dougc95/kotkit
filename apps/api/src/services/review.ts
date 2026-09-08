/**
 * Task 5.7.2 — `POST /sessions/{id}/recall`: the first of the two benchmark
 * review writes (design.md D10). `decideRecallLock` is the pure decision
 * core (no database import), unit tested directly in
 * `test/services/recall.unit.test.ts`; `lockRecall` is the
 * `withIdempotency`-wrapped entry point the route calls.
 *
 * Check order (fixed by the task brief): ownership 404 (missing or not
 * owned — identical, indistinguishable shape to every other session route)
 * -> `kind !== 'benchmark'` -> 422 `benchmark_only` -> lifecycle
 * `running|paused` -> 409 `interval_not_ended`, `finalized|abandoned` -> 409
 * `session_not_active` -> `startedAt > ctx.now` -> 422
 * `recall_before_interval_end` -> the shared `recallDelaySeconds` (2.3.2),
 * whose own throw for `startedAt < ended_at` is caught and re-raised as the
 * same 422 code -> the state-based lock, independent of the idempotency key:
 * when `session_reviews.recall_locked_at` is already set, identical
 * `recall_points` replay the stored review untouched (200), different points
 * are 409 `recall_locked` -> otherwise one `session_reviews` update sets the
 * five recall columns plus `deriveRecallFlags` (2.3.2) and bumps `version`.
 *
 * `withIdempotency` (3.4.2) wraps all of this: a live receipt for the same
 * `(principalId, idempotencyKey)` with the same request hash replays the
 * CURRENT stored review via `load` (never re-running any check above); the
 * same key with a different hash is 409 `idempotency_mismatch` before this
 * module's own checks ever run (D21) — mirroring `services/session.ts`'s
 * `startSession`.
 *
 * Early-stopped benchmarks (`complete_interval = false`) accept recall too
 * (D25) — this unit never reads `complete_interval` at all, so an incomplete
 * attempt is never specially rejected here.
 */
import { eq, sql, type SQL } from 'drizzle-orm'
import {
  deriveFirstSwitch,
  deriveRecallFlags,
  evaluateEligibility,
  recallDelaySeconds,
  scoreRecall,
  toStoredFirstSwitch,
  type AmendmentBodyValue,
  type AmendmentResponseValue,
  type CountMethod,
  type EventInputValue,
  type EventsBatchBodyValue,
  type ExclusionReason,
  type FinalizeBodyValue,
  type FinalizeResponseValue,
  type LocalDate,
  type ObservedConditionsValue,
  type OutputQuality,
  type Realm,
  type RecallBodyValue,
  type RecallFlag,
  type RecallPoints,
  type RecallScoreValue,
  type ReportedCount,
  type ReviewInputValue,
  type ReviewResponseValue,
  type SessionKind,
  type SessionLifecycle,
  type StoredFirstSwitch,
  type TimeSource,
  type TimerQuality,
} from '@attention-lab/shared'

import type { AppDatabase } from '../plugins/db.js'
import { assertOwnRealm, type RequestContext } from '../plugins/identity.js'
import { ConflictError, DomainError, MalformedError, NotFoundError } from '../errors.js'
import { requestHash } from '../idempotency/requestHash.js'
import { withIdempotency } from '../idempotency/withIdempotency.js'
import { benchmarkSlots } from '../db/schema/benchmarkSlots.js'
import { focusSessions } from '../db/schema/focusSessions.js'
import { sessionAmendments } from '../db/schema/sessionAmendments.js'
import { sessionEvents } from '../db/schema/sessionEvents.js'
import { sessionReviews } from '../db/schema/sessionReviews.js'
import { insertEventRows, loadSessionForResponse } from './session.js'
import {
  serializeAmendment,
  serializeReview,
  toEventLike,
  type SessionEventRow,
} from './sessionSerializer.js'
import {
  buildEventInsertRow,
  EVENT_OFFSET_TOLERANCE_MS,
  findImpossibleOffsets,
  partitionBatch,
  requiredCompanionFieldErrors,
} from './sessionEvents.js'
import { deriveTiming } from './sessionTiming.js'

// ---------------------------------------------------------------------------
// Pure decision core — no database import.
// ---------------------------------------------------------------------------

export interface RecallSessionLike {
  readonly kind: SessionKind
  readonly lifecycle: SessionLifecycle
  readonly endedAt: Date | null
}

export interface RecallReviewLike {
  readonly recallPoints: RecallPoints | null
  readonly recallLockedAt: Date | null
}

export type RecallDecision =
  | { readonly kind: 'replay' }
  | {
      readonly kind: 'lock'
      readonly recallPoints: RecallPoints
      readonly recallStartedAt: Date
      readonly recallLockedAt: Date
      readonly recallDelaySeconds: number
      readonly recallDurationSeconds: number
      readonly recallFlags: RecallFlag[]
    }

/** 422 `benchmark_only`: recall only ever applies to a benchmark attempt. */
export function assertBenchmarkKind(kind: SessionKind): void {
  if (kind !== 'benchmark') {
    throw new DomainError('benchmark_only', 'Recall is only available for benchmark attempts.')
  }
}

/**
 * A session must have reached `awaiting_review` before recall can be timed
 * and locked: `running`/`paused` means the interval has not ended yet (409
 * `interval_not_ended`); `finalized`/`abandoned` means this attempt is
 * closed off (409 `session_not_active`, the same code every other session
 * route uses for a terminal lifecycle).
 */
export function assertRecallableLifecycle(lifecycle: SessionLifecycle): void {
  if (lifecycle === 'running' || lifecycle === 'paused') {
    throw new ConflictError('interval_not_ended', 'The benchmark interval has not ended yet.')
  }
  if (lifecycle === 'finalized' || lifecycle === 'abandoned') {
    throw new ConflictError('session_not_active', 'This session has already ended.')
  }
}

/** Exact five-entry equality — the only comparison the state-based lock check makes (D19). */
export function recallPointsEqual(a: RecallPoints, b: RecallPoints): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/**
 * The pure heart of `lockRecall` (task 5.7.2). Runs the fixed check order
 * above and returns either `{ kind: 'replay' }` (the state-based lock found
 * identical points already stored — the caller must not touch
 * `recall_locked_at` or any other column) or `{ kind: 'lock', ... }` (the
 * full patch to write). Throws `DomainError`/`ConflictError` for every
 * rejection, exactly the codes named above.
 */
export function decideRecallLock(
  session: RecallSessionLike,
  review: RecallReviewLike,
  body: RecallBodyValue,
  now: Date,
): RecallDecision {
  assertBenchmarkKind(session.kind)
  assertRecallableLifecycle(session.lifecycle)

  const startedAt = new Date(body.startedAt)
  if (startedAt.getTime() > now.getTime()) {
    throw new DomainError(
      'recall_before_interval_end',
      'Recall cannot be recorded as starting in the future.',
    )
  }

  if (session.endedAt === null) {
    // Invariant: `assertRecallableLifecycle` above only lets an
    // `awaiting_review` session reach here, and every path that sets that
    // lifecycle (the `end` transition, `save_incomplete`) also sets
    // `ended_at` in the same write — a server bug, never a client input, if
    // this is ever reached.
    throw new Error('decideRecallLock: awaiting_review session has no ended_at')
  }

  let delaySeconds: number
  try {
    delaySeconds = recallDelaySeconds(session.endedAt, startedAt)
  } catch {
    throw new DomainError(
      'recall_before_interval_end',
      'Recall cannot be recorded as starting before the interval it recalls ended.',
    )
  }

  if (review.recallLockedAt !== null) {
    if (review.recallPoints !== null && recallPointsEqual(review.recallPoints, body.points)) {
      return { kind: 'replay' }
    }
    throw new ConflictError('recall_locked', 'Recall has already been locked with different answers.')
  }

  const recallFlags = deriveRecallFlags({ delaySeconds, durationSeconds: body.durationSeconds })

  return {
    kind: 'lock',
    recallPoints: body.points,
    recallStartedAt: startedAt,
    recallLockedAt: now,
    recallDelaySeconds: delaySeconds,
    recallDurationSeconds: body.durationSeconds,
    recallFlags,
  }
}

// ---------------------------------------------------------------------------
// lockRecall — POST /sessions/{id}/recall (D6, D10, D21)
// ---------------------------------------------------------------------------

export interface LockRecallResult {
  /** `true` when an existing live idempotency receipt served this response instead of a fresh write (D21). */
  readonly replayed: boolean
  readonly review: ReviewResponseValue
}

/**
 * `POST /sessions/{id}/recall` (design.md D6, D10, D18, D19, D21, D25, D27;
 * task 5.7.2). Wrapped in `withIdempotency` (3.4.2 — `operation: 'recall'`,
 * `resultRef: sessionId`): a replay of the same `(principalId,
 * idempotencyKey)` with an identical body re-reads the CURRENT stored review
 * (never a stashed response body); the same key with a different body is 409
 * `idempotency_mismatch` (`withIdempotency` itself, not this function).
 *
 * Inside a fresh execution: `SELECT ... FOR UPDATE` on both `focus_sessions`
 * and `session_reviews` so two genuinely concurrent recall calls for the
 * same session (different idempotency keys) serialize instead of racing the
 * state-based lock check; `decideRecallLock` makes every decision; a
 * `'replay'` result touches nothing (not even `version`); a `'lock'` result
 * is written in one `UPDATE`, `version + 1`.
 */
export async function lockRecall(
  db: AppDatabase,
  ctx: RequestContext,
  sessionId: string,
  body: RecallBodyValue,
  idempotencyKey: string,
): Promise<LockRecallResult> {
  const hash = requestHash('recall', { id: sessionId }, body)

  const { replayed, value } = await withIdempotency<ReviewResponseValue>(
    db,
    ctx,
    { key: idempotencyKey, operation: 'recall', requestHash: hash },
    async (tx) => {
      const [session] = await tx
        .select({
          userId: focusSessions.userId,
          realm: focusSessions.realm,
          kind: focusSessions.kind,
          lifecycle: focusSessions.lifecycle,
          endedAt: focusSessions.endedAt,
        })
        .from(focusSessions)
        .where(eq(focusSessions.id, sessionId))
        .limit(1)
        .for('update')
      if (session === undefined || session.userId !== ctx.principalId) {
        throw new NotFoundError()
      }
      assertOwnRealm(ctx, session.realm)

      const [review] = await tx
        .select()
        .from(sessionReviews)
        .where(eq(sessionReviews.sessionId, sessionId))
        .limit(1)
        .for('update')
      if (review === undefined) {
        throw new Error(`lockRecall: no session_reviews row for session '${sessionId}'`)
      }

      const decision = decideRecallLock(session, review, body, ctx.now)

      if (decision.kind === 'replay') {
        // Identical points already locked: 200 with the stored review,
        // completely untouched — no UPDATE, no version bump.
        return { resultRef: sessionId, value: serializeReview(review) }
      }

      const [updated] = await tx
        .update(sessionReviews)
        .set({
          recallPoints: [...decision.recallPoints] as RecallPoints,
          recallStartedAt: decision.recallStartedAt,
          recallLockedAt: decision.recallLockedAt,
          recallDelaySeconds: decision.recallDelaySeconds,
          recallDurationSeconds: decision.recallDurationSeconds,
          recallFlags: [...decision.recallFlags],
          version: review.version + 1,
        })
        .where(eq(sessionReviews.sessionId, sessionId))
        .returning()
      if (updated === undefined) {
        throw new Error(`lockRecall: session_reviews update returned no row for '${sessionId}'`)
      }

      return { resultRef: sessionId, value: serializeReview(updated) }
    },
    async (tx, resultRef) => {
      const [review] = await tx
        .select()
        .from(sessionReviews)
        .where(eq(sessionReviews.sessionId, resultRef))
        .limit(1)
      if (review === undefined) {
        throw new Error(`lockRecall: replay load found no session_reviews row for '${resultRef}'`)
      }
      return serializeReview(review)
    },
  )

  return { replayed, review: value }
}

// ---------------------------------------------------------------------------
// finalizeSession — POST /sessions/{id}/finalize (task 5.8.1; design.md D18,
// D19, D20, D21, D24). Only the KIND-INDEPENDENT mechanics live here:
// idempotency, ownership, the lifecycle gate, applying an optional
// `lastBatch`, the expected-vs-stored event count check, and the generic
// (non-kind-specific) `session_reviews` column mapping. Practice's own field
// rules (5.8.2), the benchmark recall/attestation gate (5.8.3) and the
// eligibility/first-switch derivation (5.8.4) extend this function's
// transaction in later tasks; this unit's own tests use a practice session
// with `review: { outputQuality: 'yes' }` and assert nothing about
// `eligible`/`exclusionReasons` — both are simply read back as already
// stored (NULL/[] until 5.8.4 lands).
// ---------------------------------------------------------------------------

/**
 * 409 lifecycle gate for `POST /sessions/{id}/finalize`, checked BEFORE
 * anything else in the transaction — including any `lastBatch` the body
 * carries (task 5.8.1's own "lifecycle gate runs before any lastBatch
 * insert" unit test proves the order by pairing an invalid lifecycle with a
 * `lastBatch` that would otherwise fail its own `impossible_offset` check;
 * the lifecycle error must win). `running`/`paused` means the interval has
 * not ended yet (an expired timer alone never finalizes — the client must
 * post `end` via 5.4 first); `abandoned` is a closed-off lifecycle (mirrors
 * 5.5.1/5.6.1's own `session_not_active` convention); `finalized` is its own
 * distinct code so a fresh (non-replayed) call against an already-finalized
 * session is told exactly that, rather than the generic "not active".
 * `awaiting_review` is the only lifecycle that passes.
 */
export function assertFinalizableLifecycle(lifecycle: SessionLifecycle): void {
  if (lifecycle === 'running' || lifecycle === 'paused') {
    throw new ConflictError('session_not_ended', 'This session has not ended yet.')
  }
  if (lifecycle === 'abandoned') {
    throw new ConflictError('session_not_active', 'This session has already ended.')
  }
  if (lifecycle === 'finalized') {
    throw new ConflictError('already_finalized', 'This session has already been finalized.')
  }
}

export interface PlanFinalizeLastBatchResult {
  /** New rows to insert, already deduped against both the stored set and repeats within this same batch (D9). */
  readonly toInsert: readonly EventInputValue[]
}

/**
 * Pure (task 5.8.1): decides what `finalizeSession`'s transaction must insert
 * for an optional `lastBatch`, reusing the exact same per-event checks 5.3's
 * `appendEvents` uses (`findImpossibleOffsets`, `requiredCompanionFieldErrors`,
 * `partitionBatch`) rather than a second copy of that logic. Always calls
 * `assertFinalizableLifecycle` FIRST — before ever looking at `lastBatch` —
 * so a rejected lifecycle never even reaches the offset/companion checks
 * below it.
 */
export function planFinalizeLastBatch(
  lifecycle: SessionLifecycle,
  lastBatch: EventsBatchBodyValue | undefined,
  maxAllowedElapsedMs: number,
  storedClientEventIds: ReadonlySet<string>,
): PlanFinalizeLastBatchResult {
  assertFinalizableLifecycle(lifecycle)

  if (lastBatch === undefined || lastBatch.events.length === 0) {
    return { toInsert: [] }
  }

  const impossibleIds = findImpossibleOffsets(lastBatch.events, maxAllowedElapsedMs)
  const companionErrors = requiredCompanionFieldErrors(lastBatch.events)
  if (impossibleIds.length > 0 || companionErrors.length > 0) {
    const fieldErrors: Record<string, string> = {}
    for (const clientEventId of impossibleIds) {
      fieldErrors[clientEventId] = 'elapsedMs exceeds the possible elapsed time'
    }
    for (const error of companionErrors) {
      fieldErrors[error.clientEventId] = error.message
    }
    throw new DomainError('impossible_offset', 'One or more events could not have happened as described.', {
      fieldErrors,
    })
  }

  const { accepted } = partitionBatch(lastBatch.events, storedClientEventIds)
  return { toInsert: accepted }
}

/**
 * 409 `event_count_mismatch` (D18: `details.expected`/`details.stored`,
 * `retryable: true` per D19) when the number of `session_events` rows
 * actually stored for this session (every type, voided included, D21)
 * disagrees with the client's own `expectedEventCount`. Thrown from inside
 * `finalizeSession`'s `withIdempotency` `execute` callback, so the whole
 * transaction — including any `lastBatch` rows just inserted and the receipt
 * itself — rolls back (D21: a rejected finalize writes no receipt, so the
 * identical Idempotency-Key is accepted again once the missing event is
 * posted).
 */
export function assertEventCountMatches(expected: number, stored: number): void {
  if (stored !== expected) {
    throw new ConflictError(
      'event_count_mismatch',
      'The number of stored events does not match what was expected.',
      { details: { expected, stored }, retryable: true },
    )
  }
}

// ---------------------------------------------------------------------------
// Practice finalize semantics (task 5.8.2; design.md D7.1, D11, D19, D20, D31)
// ---------------------------------------------------------------------------

/**
 * Every `ReviewInputSchema` field that means something ONLY for a benchmark
 * review (self-scoring, the disruption attestation, observed conditions, and
 * the first-switch estimate that backs 5.8.4's derivation) — schema-legal on
 * the wire for either kind (2.7's one shared `FinalizeBody`), but a domain
 * violation on a practice body (D19 `benchmark_only_field`).
 */
const BENCHMARK_ONLY_REVIEW_FIELDS = [
  'recallScores',
  'materiallyDisrupted',
  'disruptionNote',
  'conditions',
  'firstSwitchEstimateSeconds',
] as const satisfies readonly (keyof ReviewInputValue)[]

/**
 * 422 `benchmark_only_field` (D19): a practice review body may never carry a
 * field whose meaning is specific to the benchmark review. Checked in a fixed
 * field order so the error is deterministic when more than one is present.
 */
export function assertNoBenchmarkOnlyReviewFields(review: ReviewInputValue): void {
  for (const field of BENCHMARK_ONLY_REVIEW_FIELDS) {
    if (review[field] !== undefined) {
      throw new DomainError(
        'benchmark_only_field',
        'This field is only accepted for a benchmark attempt.',
        { fieldErrors: { [field]: 'is not accepted for a practice session' } },
      )
    }
  }
}

/**
 * 400: `countMethod` is required whenever a real (non-blank) `episodeCount`
 * is reported — an explicit `null` `episodeCount` counts as blank here,
 * exactly like an absent one (D7.1: both mean "not reported"), so only an
 * actual reported number (0 included) triggers the requirement. Shared by
 * practice's own field rules (task 5.8.2) and the benchmark review (task
 * 5.8.3, brief item (f): "counts follow the 5.8.2 rules") — one rule, one
 * owner, never duplicated per kind (D16).
 */
export function assertCountMethodWhenEpisodeCountReported(review: ReviewInputValue): void {
  const episodeCountReported = review.episodeCount !== undefined && review.episodeCount !== null
  if (episodeCountReported && review.countMethod === undefined) {
    throw new MalformedError('A count method is required when a count is reported.', {
      countMethod: 'is required',
    })
  }
}

/**
 * Practice finalize's own field rules (task 5.8.2), validated BEFORE
 * `finalizeSession`'s transaction ever touches `lastBatch` or any row: every
 * benchmark-only field is rejected outright (D19); `outputQuality` is
 * required (its absence is a 400, not a 422 — this is a shape rule on the
 * practice review, not a cross-kind domain rule); `countMethod` is required
 * whenever a real (non-blank) `episodeCount` is reported. Throws
 * `MalformedError`/`DomainError`; never mutates `review`.
 */
export function assertPracticeReviewInput(review: ReviewInputValue): void {
  assertNoBenchmarkOnlyReviewFields(review)

  if (review.outputQuality === undefined) {
    throw new MalformedError('An output quality is required.', { outputQuality: 'is required' })
  }

  assertCountMethodWhenEpisodeCountReported(review)
}

/** The `session_reviews` columns a practice finalize ever writes. */
export interface PracticeReviewPatch {
  readonly episodeCount: ReportedCount
  readonly countMethod: CountMethod | null
  readonly externalCount: ReportedCount
  readonly unplannedAgentChecks: ReportedCount
  readonly mindWanderingCount: ReportedCount
  readonly outputQuality: OutputQuality
  readonly outputNote: string | null
}

/**
 * The pure column mapping `finalizeSession`'s practice branch writes
 * (task 5.8.2). Calls `assertPracticeReviewInput` first, so a caller never
 * needs to validate separately before mapping. Absent maps to `null`, never
 * `0` (D7.1); an explicit `0` is kept as `0`. Deliberately excludes every
 * eligibility-shaped field (`eligible`, `exclusionReasons`, `first_switch_*`,
 * any recall column) by construction — a practice attempt never yields an
 * eligibility value (D20), and this patch has no field that could carry one.
 */
export function practiceReviewPatch(review: ReviewInputValue): PracticeReviewPatch {
  assertPracticeReviewInput(review)

  return {
    episodeCount: review.episodeCount ?? null,
    countMethod: review.countMethod ?? null,
    externalCount: review.externalCount ?? null,
    unplannedAgentChecks: review.unplannedAgentChecks ?? null,
    mindWanderingCount: review.mindWanderingCount ?? null,
    // Non-null: assertPracticeReviewInput above already rejected an absent value.
    outputQuality: review.outputQuality as OutputQuality,
    outputNote: review.outputNote ?? null,
  }
}

// ---------------------------------------------------------------------------
// Benchmark finalize semantics (task 5.8.3; design.md D10, D19, D20, D25,
// D31, D33). Letters (a)-(g) below track the task brief's own enumeration.
// ---------------------------------------------------------------------------

/**
 * Every `ReviewInputSchema` field that means something ONLY for a practice
 * review — schema-legal on the wire for either kind, but a domain violation
 * on a benchmark body (D19 `practice_only_field`, brief item (e)). The
 * mirror image of `BENCHMARK_ONLY_REVIEW_FIELDS` above.
 */
const PRACTICE_ONLY_REVIEW_FIELDS = ['outputQuality', 'outputNote'] as const satisfies readonly (keyof ReviewInputValue)[]

/** 422 `practice_only_field` (D19): a benchmark review body may never carry a field whose meaning is practice-specific. */
export function assertNoPracticeOnlyReviewFields(review: ReviewInputValue): void {
  for (const field of PRACTICE_ONLY_REVIEW_FIELDS) {
    if (review[field] !== undefined) {
      throw new DomainError(
        'practice_only_field',
        'This field is only accepted for a practice session.',
        { fieldErrors: { [field]: 'is not accepted for a benchmark session' } },
      )
    }
  }
}

/** What `assertRecallLockedForFinalize` needs to know about the session and its stored review. */
export interface BenchmarkRecallGateInput {
  readonly completeInterval: boolean | null
  readonly recallLockedAt: Date | null
}

/**
 * 422 `recall_not_locked` (D25, D10; brief item (a)): a COMPLETE benchmark
 * interval always requires a locked recall before finalize, whether or not
 * the body carries `recallScores`. An INCOMPLETE interval (stop-early or
 * `save_incomplete`) may finalize without ever locking recall — eligibility
 * then carries `recall_missing`/`scoring_incomplete` on its own (5.8.4,
 * D25) — but self-scoring always requires a lock regardless of interval
 * completeness, so a `recallScores` present in the body is rejected the same
 * way even when the interval is incomplete.
 */
export function assertRecallLockedForFinalize(
  input: BenchmarkRecallGateInput,
  recallScoresProvided: boolean,
): void {
  if (input.recallLockedAt !== null) return
  if (input.completeInterval === true || recallScoresProvided) {
    throw new DomainError(
      'recall_not_locked',
      'Recall must be saved and locked before this benchmark can be finalized.',
    )
  }
}

/** 400 (brief item (b)): a benchmark review always requires an explicit disruption attestation. */
export function assertMateriallyDisruptedProvided(review: ReviewInputValue): void {
  if (typeof review.materiallyDisrupted !== 'boolean') {
    throw new MalformedError('A disruption attestation is required.', {
      materiallyDisrupted: 'required',
    })
  }
}

/**
 * Benchmark finalize's own field rules (task 5.8.3), validated BEFORE
 * `finalizeSession`'s transaction ever touches `lastBatch` or any row —
 * mirroring `assertPracticeReviewInput`'s role for practice. Check order
 * follows the task brief's own (a)-(f) enumeration: the recall gate, then
 * the disruption attestation, then the practice-only-field rejection, then
 * the D7.1 count-method requirement. Throws `DomainError`/`MalformedError`;
 * never mutates `review`.
 */
export function assertBenchmarkReviewInput(
  session: BenchmarkRecallGateInput,
  review: ReviewInputValue,
): void {
  assertRecallLockedForFinalize(session, review.recallScores !== undefined)
  assertMateriallyDisruptedProvided(review)
  assertNoPracticeOnlyReviewFields(review)
  assertCountMethodWhenEpisodeCountReported(review)
}

/** The subset of the stored `session_reviews` row `benchmarkReviewPatch` needs to score recall and keep/replace conditions. */
export interface BenchmarkStoredReviewInput {
  readonly recallPoints: RecallPoints | null
  readonly recallLockedAt: Date | null
  readonly observedConditions: ObservedConditionsValue
}

/** The `session_reviews` columns a benchmark finalize ever writes (beyond what `finalizeSession` maps generically). */
export interface BenchmarkReviewPatch {
  readonly episodeCount: ReportedCount
  readonly countMethod: CountMethod | null
  readonly externalCount: ReportedCount
  readonly unplannedAgentChecks: ReportedCount
  readonly mindWanderingCount: ReportedCount
  readonly materiallyDisrupted: boolean
  readonly disruptionNote: string | null
  readonly observedConditions: ObservedConditionsValue
  readonly recallScores: readonly RecallScoreValue[] | null
  readonly recallScore: ReportedCount
}

/**
 * The pure column mapping `finalizeSession`'s benchmark branch writes (task
 * 5.8.3). Calls `assertBenchmarkReviewInput` first, so a caller never needs
 * to validate separately before mapping.
 *
 * - (c) Self-scoring: only attempted when recall is actually locked
 *   (`storedReview.recallLockedAt !== null`, which — by `lockRecall`'s own
 *   invariant, 5.7.2 — guarantees `storedReview.recallPoints` is non-null
 *   too). The stored `recallPoints` and the body's `recallScores` (or `null`
 *   when absent) pass through the shared `scoreRecall` (`packages/shared/src/
 *   domain/recall.ts`, D16): `complete: true` stores its `recallScores`/
 *   `recallScore`; `complete: false` (a non-blank point left unscored, or no
 *   `recallScores` submitted at all while a non-blank point exists) stores
 *   both as NULL — never a partial array, never a zero-filled guess. Recall
 *   never locked (D25 incomplete path) → both stay NULL without ever calling
 *   `scoreRecall` (there are no `recallPoints` to score).
 * - (d) `conditions`, when present, replaces `observedConditions` outright;
 *   absent keeps the value already stored (the slot's defaults from session
 *   start, D7.5/D31, or whatever an earlier finalize replay already wrote).
 */
export function benchmarkReviewPatch(
  session: BenchmarkRecallGateInput,
  review: ReviewInputValue,
  storedReview: BenchmarkStoredReviewInput,
): BenchmarkReviewPatch {
  assertBenchmarkReviewInput(session, review)

  let recallScores: readonly RecallScoreValue[] | null = null
  let recallScore: ReportedCount = null
  if (storedReview.recallLockedAt !== null && storedReview.recallPoints !== null) {
    const scored = scoreRecall(storedReview.recallPoints, review.recallScores ?? null)
    recallScores = scored.recallScores
    recallScore = scored.recallScore
  }

  return {
    episodeCount: review.episodeCount ?? null,
    countMethod: review.countMethod ?? null,
    externalCount: review.externalCount ?? null,
    unplannedAgentChecks: review.unplannedAgentChecks ?? null,
    mindWanderingCount: review.mindWanderingCount ?? null,
    // Non-null: assertBenchmarkReviewInput above already required a boolean.
    materiallyDisrupted: review.materiallyDisrupted as boolean,
    disruptionNote: review.disruptionNote ?? null,
    observedConditions: review.conditions ?? storedReview.observedConditions,
    recallScores,
    recallScore,
  }
}

/**
 * (g) `reviewNote` (D31): the optional free-text note, identical for either
 * kind — it is not in either kind's own-fields exclusion list, so it is
 * mapped once here rather than inside `practiceReviewPatch`/
 * `benchmarkReviewPatch`. Absent maps to `null`; present is stored verbatim.
 */
export function reviewNotePatch(review: ReviewInputValue): string | null {
  return review.reviewNote ?? null
}

// ---------------------------------------------------------------------------
// Benchmark eligibility and first-switch derivation (task 5.8.4; design.md
// D11, D15, D23, D25, D26, D33). Pure — no database import — so
// `deriveBenchmarkFinalizeEligibility` can be unit-tested directly
// (`test/services/finalize-eligibility.unit.test.ts`); `finalizeSession`'s
// benchmark branch below is the only caller.
// ---------------------------------------------------------------------------

/**
 * D26: true when at least one non-voided `clock_gap` event's stored
 * `details` carries no `resolution` at all — the client posted the gap but
 * the prompt was never (or not yet) answered, so this interval's timing
 * cannot be trusted. `buildEventInsertRow` (5.3.1) guarantees an unresolved
 * gap's `details` round-trips with no `resolution` key present (never a
 * stored `null`), so `=== undefined` is the exact test; a resolved gap
 * (`resolution` set to any of the three literal values) and a voided gap are
 * both ignored, and every non-`clock_gap` event is irrelevant here. Mirrors
 * the brief's own `SELECT 1 FROM session_events WHERE type = 'clock_gap' AND
 * voided_at IS NULL AND details->>'resolution' IS NULL LIMIT 1`.
 */
export function hasUnresolvedClockGap(events: readonly SessionEventRow[]): boolean {
  return events.some(
    (event) =>
      event.type === 'clock_gap' &&
      event.voidedAt === null &&
      (event.details as { readonly resolution?: unknown }).resolution === undefined,
  )
}

/**
 * D26: the `timer_quality` value `finalizeSession`'s benchmark branch commits
 * before ever calling `evaluateEligibility` — forced to `'uncertain'` the
 * moment `hasUnresolvedClockGap` finds one, whatever the column currently
 * holds, so the persisted column and the `timer_uncertain` exclusion reason
 * always agree (unresolved uncertainty persists as a flag even if the client
 * never called `/clock-gap`). Otherwise the stored value passes through
 * unchanged — an earlier `'uncertain'` (from a resolved gap's `uncertain`
 * answer, or from `save_incomplete`, 5.5.1) is never reset back to `'ok'`
 * here; only `POST .../clock-gap`'s own `continued` resolution does that.
 */
export function timerQualityAtFinalize(
  storedTimerQuality: TimerQuality,
  events: readonly SessionEventRow[],
): TimerQuality {
  return hasUnresolvedClockGap(events) ? 'uncertain' : storedTimerQuality
}

/** Everything `deriveBenchmarkFinalizeEligibility` needs beyond the session's stored events. */
export interface BenchmarkFinalizeDerivationInput {
  /** Every stored `session_events` row for the session, `lastBatch` already applied — voided rows and every type included; filtering is `hasUnresolvedClockGap`'s and the shared `deriveFirstSwitch`'s own job, never re-done here. */
  readonly events: readonly SessionEventRow[]
  /** S as this finalize call is about to write (`benchmarkReviewPatch`'s own D7.1-mapped value) — `null` only when not reported. */
  readonly episodeCount: ReportedCount
  readonly countMethod: CountMethod | null
  /** The body's `review.firstSwitchEstimateSeconds`, or `null` when absent. */
  readonly firstSwitchEstimateSeconds: number | null
  readonly completeInterval: boolean | null
  readonly recallLockedAt: Date | null
  /** The recallScores this finalize call is about to write (`benchmarkReviewPatch`'s own `scoreRecall`-derived value). */
  readonly recallScores: readonly RecallScoreValue[] | null
  /** Non-null: `assertMateriallyDisruptedProvided` already required a boolean before this is ever called. */
  readonly materiallyDisrupted: boolean
  readonly storedTimerQuality: TimerQuality
  readonly sessionLocalDate: LocalDate
  readonly slotAssignedLocalDate: LocalDate
  readonly realm: Realm
  readonly timeSource: TimeSource
}

export interface BenchmarkFinalizeDerivation {
  /** Post clock-gap force (D26) — the exact value `finalizeSession` writes to `focus_sessions.timer_quality`. */
  readonly timerQuality: TimerQuality
  /** The exact `first_switch_*` column trio (D16: `toStoredFirstSwitch`, 2.2.2) — all null together when `episodeCount` is null. */
  readonly firstSwitch: StoredFirstSwitch
  readonly eligible: boolean
  readonly exclusionReasons: ExclusionReason[]
}

/**
 * The whole benchmark-only derivation task 5.8.4 adds to `finalizeSession`:
 * force `timer_quality` for an unresolved clock gap (D26) BEFORE deriving
 * anything else, build the first-switch input from the session's own events
 * and call the shared `deriveFirstSwitch` (2.2.2), then call the shared
 * `evaluateEligibility` (2.3.1) with the just-forced `timerQuality` and the
 * about-to-be-written `episodeCount`/`recallScores`. `excludedByAmendment` is
 * always `false` here (amendments are only accepted after finalize, 5.9.1);
 * `recallLockedAt` is read as the ISO string `evaluateEligibility` expects,
 * `null` staying `null`.
 */
export function deriveBenchmarkFinalizeEligibility(
  input: BenchmarkFinalizeDerivationInput,
): BenchmarkFinalizeDerivation {
  const timerQuality = timerQualityAtFinalize(input.storedTimerQuality, input.events)

  const firstSwitch = toStoredFirstSwitch(
    deriveFirstSwitch({
      events: input.events.map(toEventLike),
      episodeCount: input.episodeCount,
      countMethod: input.countMethod,
      estimateSeconds: input.firstSwitchEstimateSeconds,
    }),
  )

  const { eligible, exclusionReasons } = evaluateEligibility({
    completeInterval: input.completeInterval,
    recallLockedAt: input.recallLockedAt === null ? null : input.recallLockedAt.toISOString(),
    recallScores: input.recallScores,
    episodeCount: input.episodeCount,
    materiallyDisrupted: input.materiallyDisrupted,
    timerQuality,
    sessionLocalDate: input.sessionLocalDate,
    slotAssignedLocalDate: input.slotAssignedLocalDate,
    excludedByAmendment: false,
    realm: input.realm,
    timeSource: input.timeSource,
  })

  return { timerQuality, firstSwitch, eligible, exclusionReasons }
}

/**
 * D33: the atomic `baseline_ready -> active` auto-activation, run directly
 * against Postgres inside `finalizeSession`'s own transaction rather than
 * decided by a separate read-then-write (the SQL's own WHERE clause is what
 * makes it race-safe and idempotent-replay-safe — see the call site below).
 * Exported as its own function purely so its shape is unit-testable without
 * a database connection (`test/services/finalize-benchmark.unit.test.ts`
 * inspects the rendered SQL text); `finalizeSession` always executes exactly
 * this query, never a hand-rolled equivalent.
 */
export function autoActivateBaselineReadySql(programId: string): SQL {
  return sql`
    UPDATE programs
    SET status = 'active', version = version + 1
    WHERE id = ${programId}
      AND status = 'baseline_ready'
      AND (
        SELECT COUNT(DISTINCT bs.label)
        FROM focus_sessions fs
        JOIN benchmark_slots bs ON fs.slot_id = bs.id
        WHERE bs.program_id = ${programId}
          AND bs.phase = 'baseline'
          AND fs.lifecycle = 'finalized'
      ) = 2
  `
}

/** The subset of a `focus_sessions` row `finalizeSession` needs. */
interface FinalizeSessionRow {
  readonly userId: string
  readonly programId: string
  /** `null` for `practice`; the `focus_sessions_benchmark_has_slot` CHECK (3.3) guarantees non-null for `benchmark` (task 5.8.4). */
  readonly slotId: string | null
  readonly realm: Realm
  readonly kind: SessionKind
  readonly lifecycle: SessionLifecycle
  readonly startedAt: Date
  readonly endedAt: Date | null
  readonly targetSeconds: number
  readonly pausedSeconds: number
  readonly currentPauseStartedAt: Date | null
  /** `null` only for a session that never reached `awaiting_review` — `assertFinalizableLifecycle` above rejects those before this is ever read for a benchmark (D24). */
  readonly completeInterval: boolean | null
  /** The local date the attempt actually ran on — compared to the slot's `assignedLocalDate` for D23's `timing_deviation` (task 5.8.4). */
  readonly localDate: LocalDate
  readonly timeSource: TimeSource
  /** Read BEFORE task 5.8.4's own D26 clock-gap force — `deriveBenchmarkFinalizeEligibility` decides the effective value from this plus the session's events. */
  readonly timerQuality: TimerQuality
  readonly version: number
}

/**
 * The full `session_reviews` measurement-column set either kind's branch
 * fills in for the single UPDATE below — practice's `practiceReviewPatch`
 * plus the benchmark-only columns held at their kept/null defaults, or
 * benchmark's `benchmarkReviewPatch` plus `outputQuality`/`outputNote` held
 * at `null` (`assertNoPracticeOnlyReviewFields` already rejected them on the
 * wire if present).
 */
interface FinalizeMeasurementPatch {
  readonly episodeCount: ReportedCount
  readonly countMethod: CountMethod | null
  readonly externalCount: ReportedCount
  readonly unplannedAgentChecks: ReportedCount
  readonly mindWanderingCount: ReportedCount
  readonly outputQuality: OutputQuality | null
  readonly outputNote: string | null
  readonly materiallyDisrupted: boolean | null
  readonly disruptionNote: string | null
  readonly observedConditions: ObservedConditionsValue
  readonly recallScores: readonly RecallScoreValue[] | null
  readonly recallScore: ReportedCount
}

export interface FinalizeSessionResult {
  /** `true` when an existing live idempotency receipt served this response instead of a fresh write (D21). */
  readonly replayed: boolean
  readonly result: FinalizeResponseValue
}

/**
 * `POST /sessions/{id}/finalize` (design.md D18, D19, D20, D21, D24, D25,
 * D33; tasks 5.8.1-5.8.3). Wrapped in `withIdempotency` (3.4.2 —
 * `operation: 'finalize'`, `resultRef: sessionId`): a replay of the same
 * `(principalId, idempotencyKey)` with an identical body re-reads the
 * CURRENT stored session/review (never a stashed response body — the review
 * is immutable after finalize so this equals the recorded result); the same
 * key with a different body is 409 `idempotency_mismatch` (`withIdempotency`
 * itself, before this function's own checks ever run, D21).
 *
 * Inside a fresh execution: `SELECT ... FOR UPDATE` on `focus_sessions` ->
 * ownership 404 (missing or not owned — identical, indistinguishable shape
 * to every other session route) -> `assertFinalizableLifecycle` (the
 * lifecycle gate, before `lastBatch` is ever touched) -> `SELECT ... FOR
 * UPDATE` on `session_reviews` (task 5.8.3 moved this up from its old spot
 * near the end, since the benchmark recall gate needs it before `lastBatch`
 * too) -> kind-specific review-body validation (`assertPracticeReviewInput`
 * or `assertBenchmarkReviewInput`) -> `planFinalizeLastBatch` inserts any new
 * `lastBatch` rows (`ON CONFLICT (session_id, client_event_id) DO NOTHING`,
 * the same D9 dedupe backstop `appendEvents` uses) -> `COUNT(*)` over every
 * stored `session_events` row (voided included) -> `assertEventCountMatches`
 * -> the kind-specific `session_reviews` column mapping (`practiceReviewPatch`
 * or `benchmarkReviewPatch`, D7.1: absent maps to NULL, never 0; a benchmark
 * finalize is the only one that ever replaces `observedConditions` or writes
 * `recallScores`/`recallScore`, through the shared `scoreRecall`) plus
 * `reviewNote` (either kind) -> `session_reviews.finalized_at = ctx.now`,
 * `version + 1` -> `focus_sessions.lifecycle = 'finalized'`, `version + 1` ->
 * for a benchmark, the D33 `baseline_ready -> active` auto-activation SQL
 * (`autoActivateBaselineReadySql`, a safe no-op outside its exact condition)
 * -> the receipt is written by `withIdempotency` itself, only on this
 * successful return (D21).
 */
export async function finalizeSession(
  db: AppDatabase,
  ctx: RequestContext,
  sessionId: string,
  body: FinalizeBodyValue,
  idempotencyKey: string,
): Promise<FinalizeSessionResult> {
  const hash = requestHash('finalize', { id: sessionId }, body)

  const { replayed, value } = await withIdempotency<FinalizeResponseValue>(
    db,
    ctx,
    { key: idempotencyKey, operation: 'finalize', requestHash: hash },
    async (tx) => {
      const [session] = await tx
        .select({
          userId: focusSessions.userId,
          programId: focusSessions.programId,
          slotId: focusSessions.slotId,
          realm: focusSessions.realm,
          kind: focusSessions.kind,
          lifecycle: focusSessions.lifecycle,
          startedAt: focusSessions.startedAt,
          endedAt: focusSessions.endedAt,
          targetSeconds: focusSessions.targetSeconds,
          pausedSeconds: focusSessions.pausedSeconds,
          currentPauseStartedAt: focusSessions.currentPauseStartedAt,
          completeInterval: focusSessions.completeInterval,
          localDate: focusSessions.localDate,
          timeSource: focusSessions.timeSource,
          timerQuality: focusSessions.timerQuality,
          version: focusSessions.version,
        })
        .from(focusSessions)
        .where(eq(focusSessions.id, sessionId))
        .limit(1)
        .for('update')
      const row: FinalizeSessionRow | undefined = session
      if (row === undefined || row.userId !== ctx.principalId) {
        throw new NotFoundError()
      }
      assertOwnRealm(ctx, row.realm)

      // Kind-specific review-body validation (5.8.2 practice; 5.8.3
      // benchmark) runs right after the lifecycle gate and strictly BEFORE
      // any write this transaction makes — including `lastBatch` — so a
      // 400/422 here never inserts a single event row (task 5.8.1's own
      // ordering rule). `planFinalizeLastBatch` below re-checks the
      // lifecycle itself (harmless — a pure, side-effect-free check that
      // simply passes again).
      assertFinalizableLifecycle(row.lifecycle)

      // The review row is fetched here (moved up from its old post-event-
      // count spot, task 5.8.3) — before any lastBatch application — because
      // the benchmark recall gate (D25, brief item (a)) needs
      // `recall_locked_at` before this transaction is allowed to write
      // anything. Fetching it this early costs practice nothing (its own
      // validation never reads it); the row is reused, never re-selected,
      // when the measurement-column UPDATE below is built.
      const [review] = await tx
        .select()
        .from(sessionReviews)
        .where(eq(sessionReviews.sessionId, sessionId))
        .limit(1)
        .for('update')
      if (review === undefined) {
        throw new Error(`finalizeSession: no session_reviews row for session '${sessionId}'`)
      }

      if (row.kind === 'practice') {
        assertPracticeReviewInput(body.review)
      } else {
        assertBenchmarkReviewInput(
          { completeInterval: row.completeInterval, recallLockedAt: review.recallLockedAt },
          body.review,
        )
      }

      // Every stored session_events row for this session, regardless of
      // type or void state (D9/D21) — the base for both the lastBatch
      // dedupe and the final COUNT(*) below.
      const storedRows = await tx
        .select({ clientEventId: sessionEvents.clientEventId })
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, sessionId))
      const storedClientEventIds = new Set(storedRows.map((r) => r.clientEventId))

      // Measured to `endedAt` (an awaiting_review session always has one) —
      // exactly the ceiling `appendEvents` (5.3.1) computes for the same
      // reason.
      const { elapsedSeconds } = deriveTiming(row, ctx.now)
      const maxAllowedElapsedMs = elapsedSeconds * 1000 + EVENT_OFFSET_TOLERANCE_MS

      const { toInsert } = planFinalizeLastBatch(
        row.lifecycle,
        body.lastBatch,
        maxAllowedElapsedMs,
        storedClientEventIds,
      )

      if (toInsert.length > 0) {
        // A `lastBatch` event is never late-reconciliation-flagged: it
        // arrives as part of THIS finalize call, still inside the
        // `awaiting_review` window `assertFinalizableLifecycle` just
        // confirmed — not a stray post-finalize event (D21's own
        // `reconciliation_warning` is `appendEvents`' concern, not this
        // one). `insertEventRows` (`services/session.ts`) is the only
        // place in this codebase that writes a new row to session_events
        // (`test/unit/sessionEvents.test.ts`'s repository guard, D16) —
        // this module never does that insert itself.
        const insertRows = toInsert.map((event) =>
          buildEventInsertRow({ sessionId, event, receivedAt: ctx.now, reconciliationWarning: false }),
        )
        await insertEventRows(tx, insertRows)
      }

      const [countRow] = await tx
        .select({ count: sql<string>`count(*)` })
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, sessionId))
      const stored = Number(countRow?.count ?? 0)

      assertEventCountMatches(body.expectedEventCount, stored)

      // The measurement columns: for a practice session these come from the
      // validated, D7.1-mapped `practiceReviewPatch` (task 5.8.2 —
      // `assertPracticeReviewInput` was already called above, so this second
      // call only maps) with the benchmark-only columns held at their
      // fixed null/kept defaults; for a benchmark session (task 5.8.3)
      // `benchmarkReviewPatch` maps the disruption attestation, the D7.1
      // counts, the replaced-or-kept `observedConditions` and the recall
      // scoring (its own internal `assertBenchmarkReviewInput` call is
      // likewise a harmless repeat of the one above) with `outputQuality`/
      // `outputNote` held at `null` (`assertNoPracticeOnlyReviewFields`
      // already rejected them on the wire if the body carried either).
      const measurementColumns: FinalizeMeasurementPatch =
        row.kind === 'practice'
          ? {
              ...practiceReviewPatch(body.review),
              materiallyDisrupted: null,
              disruptionNote: null,
              observedConditions: review.observedConditions,
              recallScores: null,
              recallScore: null,
            }
          : (() => {
              const patch = benchmarkReviewPatch(
                { completeInterval: row.completeInterval, recallLockedAt: review.recallLockedAt },
                body.review,
                review,
              )
              return {
                episodeCount: patch.episodeCount,
                countMethod: patch.countMethod,
                externalCount: patch.externalCount,
                unplannedAgentChecks: patch.unplannedAgentChecks,
                mindWanderingCount: patch.mindWanderingCount,
                outputQuality: null,
                outputNote: null,
                materiallyDisrupted: patch.materiallyDisrupted,
                disruptionNote: patch.disruptionNote,
                observedConditions: patch.observedConditions,
                recallScores: patch.recallScores,
                recallScore: patch.recallScore,
              }
            })()

      // task 5.8.4: the benchmark-only eligibility/first-switch derivation,
      // run AFTER `measurementColumns` (it needs the about-to-be-written S
      // and recallScores) and BEFORE either UPDATE below writes anything —
      // both the `session_reviews.first_switch_*` trio and
      // `focus_sessions.eligible`/`exclusion_reasons`/`timer_quality` come
      // from this one derivation, so the two tables never disagree. `null`
      // for `practice` (5.8.2 leaves `eligible` NULL and every `first_switch_*`
      // column NULL, matching `toStoredFirstSwitch(null)` below).
      let benchmarkDerivation: BenchmarkFinalizeDerivation | null = null
      if (row.kind === 'benchmark') {
        // Every stored session_events row, lastBatch already applied above
        // (D9/D21) — the base for both the D26 clock-gap force and the
        // D11/D15 first-switch derivation `deriveBenchmarkFinalizeEligibility`
        // makes internally.
        const eventRows = await tx
          .select()
          .from(sessionEvents)
          .where(eq(sessionEvents.sessionId, sessionId))

        if (row.slotId === null) {
          // Invariant: `focus_sessions_benchmark_has_slot` (3.3) guarantees a
          // `benchmark` session always carries a `slot_id` — a server bug,
          // never a client input, if this is ever reached.
          throw new Error(`finalizeSession: benchmark session '${sessionId}' has no slot_id`)
        }
        const [slot] = await tx
          .select({ assignedLocalDate: benchmarkSlots.assignedLocalDate })
          .from(benchmarkSlots)
          .where(eq(benchmarkSlots.id, row.slotId))
          .limit(1)
        if (slot === undefined) {
          throw new Error(`finalizeSession: no benchmark_slots row for slot '${row.slotId}'`)
        }

        benchmarkDerivation = deriveBenchmarkFinalizeEligibility({
          events: eventRows,
          episodeCount: measurementColumns.episodeCount,
          countMethod: measurementColumns.countMethod,
          firstSwitchEstimateSeconds: body.review.firstSwitchEstimateSeconds ?? null,
          completeInterval: row.completeInterval,
          recallLockedAt: review.recallLockedAt,
          recallScores: measurementColumns.recallScores,
          // Non-null: `assertBenchmarkReviewInput` (via `benchmarkReviewPatch`
          // above) already required a boolean for a benchmark review.
          materiallyDisrupted: measurementColumns.materiallyDisrupted as boolean,
          storedTimerQuality: row.timerQuality,
          sessionLocalDate: row.localDate,
          slotAssignedLocalDate: slot.assignedLocalDate,
          realm: row.realm,
          timeSource: row.timeSource,
        })
      }
      const firstSwitchPatch = benchmarkDerivation?.firstSwitch ?? toStoredFirstSwitch(null)

      const [updatedReview] = await tx
        .update(sessionReviews)
        .set({
          ...measurementColumns,
          firstSwitchKind: firstSwitchPatch.first_switch_kind,
          firstSwitchSeconds: firstSwitchPatch.first_switch_seconds,
          firstSwitchMethod: firstSwitchPatch.first_switch_method,
          reviewNote: reviewNotePatch(body.review),
          finalizedAt: ctx.now,
          version: review.version + 1,
        })
        .where(eq(sessionReviews.sessionId, sessionId))
        .returning()
      if (updatedReview === undefined) {
        throw new Error(`finalizeSession: session_reviews update returned no row for '${sessionId}'`)
      }

      if (benchmarkDerivation === null) {
        // practice (5.8.2): `eligible`/`exclusion_reasons`/`timer_quality`
        // are never touched here — a practice attempt never yields an
        // eligibility value (D20), so they stay at whatever session start
        // (5.1) already wrote (`eligible` NULL, `exclusion_reasons` `[]`).
        await tx
          .update(focusSessions)
          .set({ lifecycle: 'finalized', version: row.version + 1 })
          .where(eq(focusSessions.id, sessionId))
      } else {
        await tx
          .update(focusSessions)
          .set({
            lifecycle: 'finalized',
            version: row.version + 1,
            timerQuality: benchmarkDerivation.timerQuality,
            eligible: benchmarkDerivation.eligible,
            exclusionReasons: [...benchmarkDerivation.exclusionReasons],
          })
          .where(eq(focusSessions.id, sessionId))
      }

      // D33: auto-activate a `baseline_ready` program the moment its second
      // baseline-phase attempt (by distinct label) is finalized. Scoped to a
      // benchmark finalize only; the query's own phase/status filters
      // already make it a no-op for a final-phase finalize or a program that
      // has already left `baseline_ready`, so it is safe to run
      // unconditionally on every benchmark finalize — including a later
      // idempotent replay of THIS SAME call, which never re-enters this
      // `execute` callback at all (D21).
      if (row.kind === 'benchmark') {
        await tx.execute(autoActivateBaselineReadySql(row.programId))
      }

      const sessionValue = await loadSessionForResponse(tx, sessionId, ctx.now)

      return {
        resultRef: sessionId,
        value: {
          session: sessionValue,
          review: serializeReview(updatedReview),
          eligible: sessionValue.eligible,
          exclusionReasons: sessionValue.exclusionReasons,
        },
      }
    },
    async (tx, resultRef) => {
      const sessionValue = await loadSessionForResponse(tx, resultRef, ctx.now)
      const [review] = await tx
        .select()
        .from(sessionReviews)
        .where(eq(sessionReviews.sessionId, resultRef))
        .limit(1)
      if (review === undefined) {
        throw new Error(`finalizeSession: replay load found no session_reviews row for '${resultRef}'`)
      }
      return {
        session: sessionValue,
        review: serializeReview(review),
        eligible: sessionValue.eligible,
        exclusionReasons: sessionValue.exclusionReasons,
      }
    },
  )

  return { replayed, result: value }
}

// ---------------------------------------------------------------------------
// Amendments — POST /sessions/{id}/amendments (task 5.9.1; design.md D32).
// No `Idempotency-Key` (the API contract table carries no (IK) marker for
// this route, unlike recall/finalize above): every accepted call appends a
// genuinely new `session_amendments` row (201), there is no update or
// delete route, and — because `finalized` is a terminal lifecycle a session
// never leaves — the ownership/lifecycle read this function makes can never
// race a concurrent write that would invalidate it, so no transaction or
// row lock is needed around it (unlike `lockRecall`/`finalizeSession`,
// which guard a lifecycle that CAN still change underneath them).
// ---------------------------------------------------------------------------

/**
 * 409 `not_finalized` (D32): amendments are accepted on a finalized session
 * of EITHER kind — `kind` itself is never checked, only `lifecycle`.
 */
export function assertAmendableLifecycle(lifecycle: SessionLifecycle): void {
  if (lifecycle !== 'finalized') {
    throw new ConflictError('not_finalized', 'Amendments can only be added to a finalized session.')
  }
}

/**
 * `POST /sessions/{id}/amendments` (task 5.9.1). Ownership 404 first (same
 * indistinguishable-from-missing shape as every other session route), then
 * the D32 lifecycle gate, then a single `INSERT` into `session_amendments`
 * with `user_id = ctx.principalId`, `reason`, `exclude_from_report` and
 * `created_at = ctx.now` — never an `UPDATE`, and never a touch of
 * `session_reviews` or `focus_sessions.eligible`/`exclusion_reasons` (those
 * stay exactly as finalize last wrote them; the report/replacement-rule
 * overlay in 5.9.2/5.9.3 is what honors this row at read time). No update or
 * delete route exists for this resource at all — every accepted call is a
 * fresh append, reflected in `serializeSession`'s `amendments[]` (5.1.1) via
 * `loadSessionForResponse`'s own `created_at`-ordered load.
 */
export async function addAmendment(
  db: AppDatabase,
  ctx: RequestContext,
  sessionId: string,
  body: AmendmentBodyValue,
): Promise<AmendmentResponseValue> {
  const [session] = await db
    .select({
      userId: focusSessions.userId,
      realm: focusSessions.realm,
      lifecycle: focusSessions.lifecycle,
    })
    .from(focusSessions)
    .where(eq(focusSessions.id, sessionId))
    .limit(1)
  if (session === undefined || session.userId !== ctx.principalId) {
    throw new NotFoundError()
  }
  assertOwnRealm(ctx, session.realm)
  assertAmendableLifecycle(session.lifecycle)

  const [inserted] = await db
    .insert(sessionAmendments)
    .values({
      sessionId,
      userId: ctx.principalId,
      reason: body.reason,
      excludeFromReport: body.excludeFromReport,
      createdAt: ctx.now,
    })
    .returning()
  if (inserted === undefined) {
    throw new Error(`addAmendment: insert into session_amendments returned no row for session '${sessionId}'`)
  }
  return serializeAmendment(inserted)
}
