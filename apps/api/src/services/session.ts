/**
 * Task 5.1.1 (practice), 5.1.2 (benchmark) — `POST /sessions`; task 5.3.1 —
 * `POST /sessions/{id}/events`; task 5.3.2 — `POST
 * /sessions/{id}/events/{clientEventId}/void`. `startSession` is the one
 * entry point both kinds share, plus `loadSessionForResponse`, the one loader
 * 5.2.2's `GET /sessions/{id}` and 5.2.3's `GET /sessions/active` are expected
 * to reuse (D16).
 *
 * Check order (fixed for all of group 5a, per design.md's task decomposition
 * notes): contract 400 (the route's TypeBox schema, before this module ever
 * runs) → Idempotency-Key handling (`withIdempotency`, 3.4.2: replay 200 /
 * mismatch 409, checked before `execute` below ever runs) → ownership 404
 * (`loadOwnedProgram`) → active-session 409 (`assertNoActiveSession`) →
 * domain 422/404 (kind-specific field rules, then — benchmark only — the
 * slot's own 404 and `checkSlotStart` 422s). A first (non-replay) write
 * responds 201; a replay responds 200 (D21) — both decided by the route
 * (`routes/sessions/start.ts`), not here.
 */
import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  currentProgramDay,
  type AgentPlanBodyValue,
  type AgentPlanResponseValue,
  type ClockGapBodyValue,
  type ClockGapResolution,
  type CreateSessionBodyValue,
  type EventInputValue,
  type EventResponseValue,
  type ObservedConditionsValue,
  type Realm,
  type SessionKind,
  type SessionLifecycle,
  type SessionResponseValue,
  type TimeSource,
  type TimerQuality,
  type TransitionBodyValue,
} from '@attention-lab/shared'

import type { AppDatabase } from '../plugins/db.js'
import { assertOwnRealm, type RequestContext } from '../plugins/identity.js'
import { ConflictError, DomainError, MalformedError, NotFoundError } from '../errors.js'
import { requestHash } from '../idempotency/requestHash.js'
import { withIdempotency, type AppTransaction } from '../idempotency/withIdempotency.js'
import { agentPlans } from '../db/schema/agentPlans.js'
import { benchmarkSlots } from '../db/schema/benchmarkSlots.js'
import { focusSessions } from '../db/schema/focusSessions.js'
import { protocolRevisions } from '../db/schema/protocolRevisions.js'
import { sessionAmendments } from '../db/schema/sessionAmendments.js'
import { sessionEvents } from '../db/schema/sessionEvents.js'
import { sessionReviews } from '../db/schema/sessionReviews.js'
import { extractPgError, governingRevisionFor, loadOwnedProgram, slotAttempts } from './program/programService.js'
import { serializeAgentPlan, serializeEvent, serializeSession } from './sessionSerializer.js'
import {
  buildEventInsertRow,
  canVoid,
  EVENT_OFFSET_TOLERANCE_MS,
  findImpossibleOffsets,
  isVoidableType,
  partitionBatch,
  requiredCompanionFieldErrors,
  type EventInsertRow,
} from './sessionEvents.js'
import { deriveTiming } from './sessionTiming.js'
import { applyTransition, buildPauseEventRow } from './sessionTransitions.js'
import { checkSlotStart, defaultConditionsFromSlot, type SlotStartFailureReason } from './slotAttempts.js'

/** The three lifecycles that make a session "unfinished" (3.3's partial unique index). */
const ACTIVE_LIFECYCLES = ['running', 'paused', 'awaiting_review'] as const satisfies readonly SessionLifecycle[]

/** D30: a benchmark session's `target_seconds` is always exactly 20 minutes, never the governing revision's practice target. */
const BENCHMARK_TARGET_SECONDS = 1200

/** The fixed D19 message for each of `checkSlotStart`'s four failure reasons (the reason string itself IS the wire code). */
const SLOT_START_FAILURE_MESSAGES: Record<SlotStartFailureReason, string> = {
  before_slot_date: 'This benchmark cannot start before its assigned date.',
  slot_full: 'This benchmark slot already has two attempts.',
  replacement_reason_required: 'A reason is required to replace this benchmark attempt.',
  eligible_attempt_not_retaken: 'This benchmark slot already has an eligible attempt.',
}

/** D31: a practice session's review conditions default to the all-null `ObservedConditions`. */
const EMPTY_OBSERVED_CONDITIONS: ObservedConditionsValue = {
  deviceFormat: null,
  language: null,
  materialLevel: null,
  accommodations: [],
}

// ---------------------------------------------------------------------------
// Pure helpers (unit tested directly in test/unit/session.start.test.ts, no
// database import anywhere in this section).
// ---------------------------------------------------------------------------

/**
 * Trims `value`. A blank result — absent, empty, or whitespace-only — is 400
 * `malformed_request` naming `intendedOutput`: this is a required-field
 * validation, not a domain-rule violation, so it follows the same pattern as
 * 4.4.1's `normalizeReason` (a blank `reason` on `POST
 * .../revisions`) rather than reusing `practice_only_field` — that code
 * means "this field only applies to the other session kind" (its real use,
 * 5.1.2's rejection of `intendedOutput` supplied on a *benchmark* body), a
 * distinct condition from "this field was required and left blank" that a
 * shared error code would conflate for API consumers. Interior whitespace is
 * preserved: only the trimmed leading/trailing ends are removed, so
 * `"  a   b  "` normalizes to `"a   b"`, not `"a b"`.
 */
export function normalizeIntendedOutput(value: string | undefined): string {
  const trimmed = (value ?? '').trim()
  if (trimmed === '') {
    throw new MalformedError('An intended output is required.', { intendedOutput: 'is required' })
  }
  return trimmed
}

/** D31: `body.conditions` when given, else the all-null `ObservedConditions` — never invented. */
export function practiceObservedConditions(
  conditions: ObservedConditionsValue | undefined,
): ObservedConditionsValue {
  return conditions ?? EMPTY_OBSERVED_CONDITIONS
}

export interface FocusSessionInsertRow {
  readonly id: string
  readonly userId: string
  readonly programId: string
  readonly revisionId: string
  readonly slotId: null
  readonly realm: Realm
  readonly kind: SessionKind
  readonly lifecycle: 'running'
  readonly targetSeconds: number
  readonly startedAt: Date
  readonly endedAt: null
  readonly pausedSeconds: 0
  readonly currentPauseStartedAt: null
  readonly localDate: string
  readonly intendedOutput: string
  readonly timeSource: TimeSource
  readonly timerQuality: 'ok'
  readonly clockGapSeconds: null
  readonly completeInterval: null
  readonly eligible: null
  readonly exclusionReasons: readonly string[]
  readonly replacementReason: null
  readonly version: 1
}

export interface BuildPracticeSessionInsertParams {
  readonly id: string
  readonly ctx: Pick<RequestContext, 'principalId' | 'realm' | 'now' | 'timeSource'>
  readonly programId: string
  readonly revisionId: string
  readonly localDate: string
  readonly targetSeconds: number
  readonly intendedOutput: string
}

/**
 * Pure: the exact `focus_sessions` insert row for a new practice session
 * (design.md Database model). `ctx.timeSource` is stored verbatim (D8) — the
 * identity plugin has already derived `'measured'` vs `'demo_clock'` from
 * the stored demo offset; this function never recomputes it.
 */
export function buildPracticeSessionInsert(params: BuildPracticeSessionInsertParams): FocusSessionInsertRow {
  const { id, ctx, programId, revisionId, localDate, targetSeconds, intendedOutput } = params
  return {
    id,
    userId: ctx.principalId,
    programId,
    revisionId,
    slotId: null,
    realm: ctx.realm,
    kind: 'practice',
    lifecycle: 'running',
    targetSeconds,
    startedAt: ctx.now,
    endedAt: null,
    pausedSeconds: 0,
    currentPauseStartedAt: null,
    localDate,
    intendedOutput,
    timeSource: ctx.timeSource,
    timerQuality: 'ok',
    clockGapSeconds: null,
    completeInterval: null,
    eligible: null,
    exclusionReasons: [],
    replacementReason: null,
    version: 1,
  }
}

export interface BenchmarkSessionInsertRow {
  readonly id: string
  readonly userId: string
  readonly programId: string
  readonly revisionId: string
  readonly slotId: string
  readonly realm: Realm
  readonly kind: SessionKind
  readonly lifecycle: 'running'
  readonly targetSeconds: typeof BENCHMARK_TARGET_SECONDS
  readonly startedAt: Date
  readonly endedAt: null
  readonly pausedSeconds: 0
  readonly currentPauseStartedAt: null
  readonly localDate: string
  readonly intendedOutput: null
  readonly timeSource: TimeSource
  readonly timerQuality: 'ok'
  readonly clockGapSeconds: null
  readonly completeInterval: null
  readonly eligible: null
  readonly exclusionReasons: readonly string[]
  readonly replacementReason: string | null
  readonly version: 1
}

export interface BuildBenchmarkSessionInsertParams {
  readonly id: string
  readonly ctx: Pick<RequestContext, 'principalId' | 'realm' | 'now' | 'timeSource'>
  readonly programId: string
  readonly revisionId: string
  readonly slotId: string
  readonly localDate: string
  /** `null` unless `checkSlotStart` reported `isReplacement: true` — a reason on a first attempt is accepted but never stored (task notes). */
  readonly replacementReason: string | null
}

/**
 * Pure: the exact `focus_sessions` insert row for a new benchmark attempt
 * (design.md Database model, D30). `targetSeconds` is always
 * `BENCHMARK_TARGET_SECONDS` — never the governing revision's practice
 * target — and `intendedOutput` is always `null` (a benchmark body cannot
 * carry one; `startBenchmarkSession` rejects it before this ever runs).
 */
export function buildBenchmarkSessionInsert(params: BuildBenchmarkSessionInsertParams): BenchmarkSessionInsertRow {
  const { id, ctx, programId, revisionId, slotId, localDate, replacementReason } = params
  return {
    id,
    userId: ctx.principalId,
    programId,
    revisionId,
    slotId,
    realm: ctx.realm,
    kind: 'benchmark',
    lifecycle: 'running',
    targetSeconds: BENCHMARK_TARGET_SECONDS,
    startedAt: ctx.now,
    endedAt: null,
    pausedSeconds: 0,
    currentPauseStartedAt: null,
    localDate,
    intendedOutput: null,
    timeSource: ctx.timeSource,
    timerQuality: 'ok',
    clockGapSeconds: null,
    completeInterval: null,
    eligible: null,
    exclusionReasons: [],
    replacementReason,
    version: 1,
  }
}

// ---------------------------------------------------------------------------
// Active-session check (D19 `active_session_exists`) and its race backstop
// ---------------------------------------------------------------------------

/**
 * Pre-check: throws `ConflictError('active_session_exists')` with
 * `details.activeSessionId` when the principal already has an unfinished
 * (`running` | `paused` | `awaiting_review`) session. This is a plain
 * `SELECT`, not `FOR UPDATE` — there is no existing row to lock for a brand
 * new session, so `mapSessionInsertPgError` below is the real backstop for
 * two genuinely concurrent starts (design.md's 3.3 partial unique index is
 * what Postgres itself enforces).
 */
async function assertNoActiveSession(tx: AppTransaction, userId: string): Promise<void> {
  const [row] = await tx
    .select({ id: focusSessions.id })
    .from(focusSessions)
    .where(and(eq(focusSessions.userId, userId), inArray(focusSessions.lifecycle, ACTIVE_LIFECYCLES)))
    .limit(1)
  if (row !== undefined) {
    throw new ConflictError('active_session_exists', 'A session is already in progress.', {
      details: { activeSessionId: row.id },
    })
  }
}

/** Re-reads the principal's own active session id to fill `details` after a race (mirrors `loadOpenProgramDetails`). */
async function loadActiveSessionId(tx: AppTransaction, userId: string): Promise<string> {
  const [row] = await tx
    .select({ id: focusSessions.id })
    .from(focusSessions)
    .where(and(eq(focusSessions.userId, userId), inArray(focusSessions.lifecycle, ACTIVE_LIFECYCLES)))
    .limit(1)
  if (!row) {
    throw new Error(`loadActiveSessionId: expected an active session for user '${userId}', found none`)
  }
  return row.id
}

/**
 * Turns the one Postgres constraint violation a session insert can hit
 * (`23505` on `focus_sessions_one_active_per_user`, 3.3) into
 * `ConflictError('active_session_exists')` — the race backstop behind
 * `assertNoActiveSession`'s pre-check, same shape as
 * `programService.ts`'s `mapPgError` for `programs_one_open_per_user`. Every
 * other error is rethrown completely unchanged.
 */
function mapSessionInsertPgError(err: unknown): never {
  const pgError = extractPgError(err)
  if (pgError?.code === '23505' && pgError.constraintName === 'focus_sessions_one_active_per_user') {
    throw new ConflictError('active_session_exists', 'A session is already in progress.')
  }
  throw err
}

// ---------------------------------------------------------------------------
// Response loader — also what 5.2.2's GET /sessions/{id} and 5.2.3's
// GET /sessions/active are expected to reuse (D16: one owner per shared
// piece) rather than re-querying the same five tables a second way.
// ---------------------------------------------------------------------------

export async function loadSessionForResponse(
  db: AppDatabase | AppTransaction,
  sessionId: string,
  now: Date,
): Promise<SessionResponseValue> {
  const [session] = await db.select().from(focusSessions).where(eq(focusSessions.id, sessionId)).limit(1)
  if (!session) {
    throw new Error(`loadSessionForResponse: no focus_sessions row for id '${sessionId}'`)
  }
  const [review] = await db.select().from(sessionReviews).where(eq(sessionReviews.sessionId, sessionId)).limit(1)
  if (!review) {
    throw new Error(`loadSessionForResponse: no session_reviews row for session '${sessionId}'`)
  }
  const events = await db
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId))
    .orderBy(sessionEvents.elapsedMs, sessionEvents.receivedAt)
  const [plan] = await db.select().from(agentPlans).where(eq(agentPlans.sessionId, sessionId)).limit(1)
  const amendments = await db
    .select()
    .from(sessionAmendments)
    .where(eq(sessionAmendments.sessionId, sessionId))
    .orderBy(sessionAmendments.createdAt)

  return serializeSession(session, review, events, plan ?? null, amendments, now)
}

// ---------------------------------------------------------------------------
// readSession — GET /sessions/{id} (task 5.2.2; D20, D24)
// ---------------------------------------------------------------------------

/**
 * `GET /sessions/{id}`. Ownership check first: `focus_sessions` WHERE
 * `id = sessionId AND user_id = ctx.principalId` — a session that genuinely
 * does not exist and one that belongs to a different principal are
 * indistinguishable, both throwing the identical `NotFoundError` (404;
 * identity-realm "Every resource is scoped to its owner": existence is never
 * disclosed). A row that IS this principal's own but carries a foreign realm
 * (only reachable by directly mutating the row, mirroring
 * `loadOwnedProgram`'s own guard) is rejected with `DomainError`
 * (`realm_mismatch`, 422) rather than silently served.
 *
 * Once ownership is confirmed, this reuses `loadSessionForResponse` (5.1.1,
 * D16 — one owner per shared piece) for the rest of the D20 shape, exactly as
 * `startSession` above does for its own replay path. Strictly read-only
 * (D24): no write happens here, and a reached deadline is only ever confirmed
 * by the next `end` transition (5.4.2) — this route may return
 * `timing.deadlineReached: true` on a session that is still `running`.
 */
export async function readSession(
  db: AppDatabase,
  ctx: RequestContext,
  sessionId: string,
): Promise<SessionResponseValue> {
  const [row] = await db
    .select({ userId: focusSessions.userId, realm: focusSessions.realm })
    .from(focusSessions)
    .where(eq(focusSessions.id, sessionId))
    .limit(1)
  if (row === undefined || row.userId !== ctx.principalId) {
    throw new NotFoundError()
  }
  assertOwnRealm(ctx, row.realm)

  return loadSessionForResponse(db, sessionId, ctx.now)
}

// ---------------------------------------------------------------------------
// startPracticeSession — the withIdempotency `execute` callback for
// kind: 'practice'
// ---------------------------------------------------------------------------

interface ExecuteResult {
  readonly resultRef: string
  readonly value: SessionResponseValue
}

async function startPracticeSession(
  tx: AppTransaction,
  ctx: RequestContext,
  body: CreateSessionBodyValue,
): Promise<ExecuteResult> {
  // Ownership 404 (nothing written yet if this throws).
  const program = await loadOwnedProgram(tx, ctx, body.programId)

  // Active-session 409, before any domain 422 check below (fixed check
  // order).
  await assertNoActiveSession(tx, ctx.principalId)

  // Domain 422: a practice body can never carry a benchmark slot.
  if (body.slotId !== undefined) {
    throw new DomainError('benchmark_only_field', 'A practice session cannot use a benchmark slot.', {
      fieldErrors: { slotId: 'is not accepted for practice sessions' },
    })
  }

  // Domain 422: a required, non-blank intended output.
  const intendedOutput = normalizeIntendedOutput(body.intendedOutput)

  const { day, localDate } = currentProgramDay(
    { baselineDate: program.baselineDate, timezone: program.timezone },
    ctx.now,
  )

  const revisions = await tx.select().from(protocolRevisions).where(eq(protocolRevisions.programId, program.id))
  const governingRevision = governingRevisionFor(revisions, day)

  const targetSeconds = body.targetSeconds ?? governingRevision.settings.practiceTargetSeconds

  const insertRow = buildPracticeSessionInsert({
    id: randomUUID(),
    ctx,
    programId: program.id,
    revisionId: governingRevision.id,
    localDate,
    targetSeconds,
    intendedOutput,
  })

  try {
    // A SAVEPOINT (`tx.transaction` on a postgres-js-backed Drizzle
    // transaction) so a 23505 race here leaves the OUTER transaction still
    // usable for the details re-query below — same reasoning as
    // programService.ts's `createProgram`.
    return await tx.transaction(async (tx2) => {
      // Drizzle's insert type wants a mutable `string[]` for
      // `exclusion_reasons`; `insertRow.exclusionReasons` stays `readonly`
      // on `FocusSessionInsertRow` itself for the pure builder's own
      // testability, so this spread is the one place that widens it.
      await tx2.insert(focusSessions).values({ ...insertRow, exclusionReasons: [...insertRow.exclusionReasons] })
      // session_reviews is created at session start, not deferred to
      // recall/finalize (D31); every other column keeps its schema default
      // (SQL NULL for every nullable measurement column — D7.1 — and `[]`
      // for recall_flags via $defaultFn).
      await tx2.insert(sessionReviews).values({
        sessionId: insertRow.id,
        observedConditions: practiceObservedConditions(body.conditions),
      })

      const value = await loadSessionForResponse(tx2, insertRow.id, ctx.now)
      return { resultRef: insertRow.id, value }
    })
  } catch (err) {
    try {
      mapSessionInsertPgError(err)
    } catch (mapped) {
      if (mapped instanceof ConflictError && mapped.code === 'active_session_exists' && mapped.details === undefined) {
        const activeSessionId = await loadActiveSessionId(tx, ctx.principalId)
        throw new ConflictError('active_session_exists', 'A session is already in progress.', {
          details: { activeSessionId },
        })
      }
      throw mapped
    }
  }
}

// ---------------------------------------------------------------------------
// startBenchmarkSession — the withIdempotency `execute` callback for
// kind: 'benchmark' (task 5.1.2)
// ---------------------------------------------------------------------------

async function startBenchmarkSession(
  tx: AppTransaction,
  ctx: RequestContext,
  body: CreateSessionBodyValue,
): Promise<ExecuteResult> {
  // Ownership 404 (nothing written yet if this throws) — program-level,
  // exactly as the practice path.
  const program = await loadOwnedProgram(tx, ctx, body.programId)

  // Active-session 409, before any slot rule (fixed check order — confirmed
  // by 'benchmark start while a practice session is running -> 409
  // active_session_exists before any slot rule').
  await assertNoActiveSession(tx, ctx.principalId)

  // Domain 422s that need no slot lookup at all (mirrors the practice path's
  // slotId-on-practice check, in the opposite direction).
  if (body.slotId === undefined) {
    throw new DomainError('benchmark_only_field', 'A benchmark session requires a slot.', {
      fieldErrors: { slotId: 'is required for benchmark sessions' },
    })
  }
  if (body.intendedOutput !== undefined) {
    throw new DomainError('practice_only_field', 'A benchmark session does not take an intended output.', {
      fieldErrors: { intendedOutput: 'is not accepted for benchmark sessions' },
    })
  }
  if (body.targetSeconds !== undefined && body.targetSeconds !== BENCHMARK_TARGET_SECONDS) {
    throw new DomainError('benchmark_only_field', 'A benchmark session is always 20 minutes.', {
      fieldErrors: { targetSeconds: 'must be 1200 for a benchmark session' },
    })
  }

  // Slot ownership 404: the slot must belong to THIS program (never merely
  // some slot the principal owns via a different program) — `and()` both
  // conditions in one query rather than trusting a bare `slotId` lookup.
  // `FOR UPDATE` locks the row for the rest of this transaction so two
  // concurrent starts against the same slot serialize instead of both
  // reading the same (pre-insert) attempt count.
  const [slot] = await tx
    .select()
    .from(benchmarkSlots)
    .where(and(eq(benchmarkSlots.id, body.slotId), eq(benchmarkSlots.programId, program.id)))
    .limit(1)
    .for('update')
  if (slot === undefined) {
    throw new NotFoundError()
  }

  const { day, localDate } = currentProgramDay(
    { baselineDate: program.baselineDate, timezone: program.timezone },
    ctx.now,
  )

  // Every focus_sessions row referencing this slot, any lifecycle (abandoned
  // included), with each row's `excludedByAmendment` overlay (D32) —
  // `slotAttempts` (4.3.2) is the one owner of this query; not re-derived
  // here (D16).
  const attemptsBySlot = await slotAttempts(tx, [slot.id])
  const attempts = attemptsBySlot.get(slot.id) ?? []

  const check = checkSlotStart({
    todayLocalDate: localDate,
    slotAssignedLocalDate: slot.assignedLocalDate,
    attempts,
    replacementReason: body.replacementReason,
  })
  if (!check.ok) {
    throw new DomainError(check.reason, SLOT_START_FAILURE_MESSAGES[check.reason])
  }

  const revisions = await tx.select().from(protocolRevisions).where(eq(protocolRevisions.programId, program.id))
  const governingRevision = governingRevisionFor(revisions, day)

  // D31: the whole `conditions` object from the body replaces the
  // slot-derived default, never merges with it.
  const observedConditions = body.conditions ?? defaultConditionsFromSlot(slot)

  const insertRow = buildBenchmarkSessionInsert({
    id: randomUUID(),
    ctx,
    programId: program.id,
    revisionId: governingRevision.id,
    slotId: slot.id,
    localDate,
    // A reason supplied on a FIRST attempt is accepted (not an error, see
    // `checkSlotStart`) but is never stored — only the replacement attempt
    // itself carries a reason.
    replacementReason: check.isReplacement ? (body.replacementReason ?? null) : null,
  })

  try {
    // Same SAVEPOINT reasoning as startPracticeSession: a 23505 race here
    // (the two-concurrent-starts backstop behind the slot's own FOR UPDATE
    // lock, and behind assertNoActiveSession's pre-check) must not leave the
    // OUTER transaction aborted before loadActiveSessionId's re-query below.
    return await tx.transaction(async (tx2) => {
      await tx2.insert(focusSessions).values({ ...insertRow, exclusionReasons: [...insertRow.exclusionReasons] })
      await tx2.insert(sessionReviews).values({
        sessionId: insertRow.id,
        observedConditions,
      })
      // 5.1.2 is the sole writer of `frozen_at` — firing once, at the first
      // attempt (D23's isFrozen check in 4.3.2 inspects live focus_sessions
      // rows independently, so the two units agree without reading each
      // other's writes in the same transaction).
      if (slot.frozenAt === null) {
        await tx2.update(benchmarkSlots).set({ frozenAt: ctx.now }).where(eq(benchmarkSlots.id, slot.id))
      }

      const value = await loadSessionForResponse(tx2, insertRow.id, ctx.now)
      return { resultRef: insertRow.id, value }
    })
  } catch (err) {
    try {
      mapSessionInsertPgError(err)
    } catch (mapped) {
      if (mapped instanceof ConflictError && mapped.code === 'active_session_exists' && mapped.details === undefined) {
        const activeSessionId = await loadActiveSessionId(tx, ctx.principalId)
        throw new ConflictError('active_session_exists', 'A session is already in progress.', {
          details: { activeSessionId },
        })
      }
      throw mapped
    }
  }
}

// ---------------------------------------------------------------------------
// startSession (D6, D21): the one idempotency-wrapped entry point every
// POST /sessions body reaches, whatever its kind.
// ---------------------------------------------------------------------------

export interface StartSessionResult {
  /** `true` when an existing live idempotency receipt served this response instead of a fresh write (D21: 200, not 201). */
  readonly replayed: boolean
  readonly session: SessionResponseValue
}

/**
 * `POST /sessions` (design.md D6, D21; tasks 5.1.1 practice, 5.1.2
 * benchmark). Wraps the kind-specific start write in `withIdempotency`
 * (3.4.2): a replay of the same `(principalId, idempotencyKey)` with an
 * identical body re-reads the session's CURRENT state via
 * `loadSessionForResponse` (fresh timing, never a stored response body —
 * D21); the same key with a different body is 409 `idempotency_mismatch`
 * (`withIdempotency` itself, not this function).
 */
export async function startSession(
  db: AppDatabase,
  ctx: RequestContext,
  body: CreateSessionBodyValue,
  idempotencyKey: string,
): Promise<StartSessionResult> {
  const hash = requestHash('session.start', {}, body)

  const { replayed, value } = await withIdempotency<SessionResponseValue>(
    db,
    ctx,
    { key: idempotencyKey, operation: 'session.start', requestHash: hash },
    async (tx) => {
      if (body.kind === 'practice') {
        return startPracticeSession(tx, ctx, body)
      }
      return startBenchmarkSession(tx, ctx, body)
    },
    async (tx, resultRef) => loadSessionForResponse(tx, resultRef, ctx.now),
  )

  return { replayed, session: value }
}

// ---------------------------------------------------------------------------
// appendEvents — POST /sessions/{id}/events (task 5.3.1; D9, D20, D21, D26)
// ---------------------------------------------------------------------------

/** The subset of a `focus_sessions` row `appendEvents` needs — ownership plus everything `deriveTiming` reads. */
interface AppendEventsSessionRow {
  readonly userId: string
  readonly realm: Realm
  readonly lifecycle: SessionLifecycle
  readonly startedAt: Date
  readonly endedAt: Date | null
  readonly targetSeconds: number
  readonly pausedSeconds: number
  readonly currentPauseStartedAt: Date | null
}

/** D21: a session in either of these two TERMINAL lifecycles still stores every submitted event, but flagged (`reconciliation_warning: true`) — never silently dropped, and `session_reviews` is never touched from this path. */
const RECONCILIATION_LIFECYCLES = ['finalized', 'abandoned'] as const satisfies readonly SessionLifecycle[]

export interface AppendEventsResult {
  /** Mutable arrays (not `readonly`): this is the exact `EventsBatchResponseValue` shape the route returns as JSON. */
  readonly accepted: string[]
  readonly duplicates: string[]
}

/**
 * The ONE literal `.insert(sessionEvents)` call site in this codebase —
 * `test/unit/sessionEvents.test.ts`'s own repository guard enforces that no
 * other file under `routes/` or `services/` writes to `session_events`
 * directly (a hidden tab can never create an episode server-side). `rows` is
 * already built via `buildEventInsertRow` (`sessionEvents.ts`); this function
 * only performs the dedupe-safe `ON CONFLICT (session_id, client_event_id) DO
 * NOTHING` insert and reports which ids actually landed (D9's own backstop
 * against a genuine concurrent race between a caller's prior `SELECT` and
 * this `INSERT`). `finalizeSession`'s `lastBatch` application
 * (`services/review.ts`, task 5.8.1) reuses this exported function for its
 * own insert rather than a second `.insert(sessionEvents)` site, per D16 (one
 * owner per shared piece).
 */
export async function insertEventRows(
  db: AppDatabase | AppTransaction,
  rows: readonly EventInsertRow[],
): Promise<ReadonlySet<string>> {
  if (rows.length === 0) return new Set()
  const inserted = await db
    .insert(sessionEvents)
    .values(rows as EventInsertRow[])
    .onConflictDoNothing({ target: [sessionEvents.sessionId, sessionEvents.clientEventId] })
    .returning({ clientEventId: sessionEvents.clientEventId })
  return new Set(inserted.map((r) => r.clientEventId))
}

/**
 * `POST /sessions/{id}/events` (design.md D9, D20, D21, D26; task 5.3.1).
 * Ownership 404 first (same indistinguishable-from-missing shape as
 * `readSession`), then a fixed elapsed-offset ceiling derived from
 * `deriveTiming` (5.2.1 — measured to `ended_at` for an already-ended
 * session, never to `ctx.now`) rejects the WHOLE batch as 422
 * `impossible_offset` before anything is looked up or written; the same is
 * true of a companion-field violation (`agent_check` without
 * `details.alsoOffTask`, `clock_gap` without `details.gapSeconds`) — both are
 * checked, and can both throw, before any row is read or written, so a
 * rejected batch never leaves a partial write behind. Once both checks pass,
 * every clientEventId already stored (or repeated within this same batch) is
 * reported in `duplicates[]` (`partitionBatch`, over a `SELECT` this function
 * runs itself) and every genuinely new one is inserted with
 * `ON CONFLICT (session_id, client_event_id) DO NOTHING` — D9's own dedupe
 * mechanism, the backstop behind `partitionBatch`'s pre-check for a genuine
 * concurrent race between that `SELECT` and this `INSERT`. `session_events`
 * has no `realm` column (D34): every stored row's realm is read through its
 * `focus_sessions` parent, never stamped here.
 */
export async function appendEvents(
  db: AppDatabase,
  ctx: RequestContext,
  sessionId: string,
  events: readonly EventInputValue[],
): Promise<AppendEventsResult> {
  const [session] = await db
    .select({
      userId: focusSessions.userId,
      realm: focusSessions.realm,
      lifecycle: focusSessions.lifecycle,
      startedAt: focusSessions.startedAt,
      endedAt: focusSessions.endedAt,
      targetSeconds: focusSessions.targetSeconds,
      pausedSeconds: focusSessions.pausedSeconds,
      currentPauseStartedAt: focusSessions.currentPauseStartedAt,
    })
    .from(focusSessions)
    .where(eq(focusSessions.id, sessionId))
    .limit(1)
  const row: AppendEventsSessionRow | undefined = session
  if (row === undefined || row.userId !== ctx.principalId) {
    throw new NotFoundError()
  }
  assertOwnRealm(ctx, row.realm)

  // Every whole-batch rejection is collected — and can throw — before any
  // existing-events lookup or write below, so a rejected batch never leaves a
  // partial write behind. D19 has no code dedicated to "this event's
  // companion field is missing for its type" (only `impossible_offset` is
  // named for this route); this unit reuses `impossible_offset` for both
  // failure kinds — recorded as a decision in notes/LIMITATIONS.md, the same
  // treatment 5.3.2 gives its own unnamed-code case (`invalid_transition`) —
  // since `fieldErrors` already disambiguates the real reason per
  // clientEventId, and both are "one or more submitted events could not have
  // happened as described".
  const { elapsedSeconds } = deriveTiming(row, ctx.now)
  const maxAllowedElapsedMs = elapsedSeconds * 1000 + EVENT_OFFSET_TOLERANCE_MS
  const impossibleIds = findImpossibleOffsets(events, maxAllowedElapsedMs)
  const companionErrors = requiredCompanionFieldErrors(events)
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

  const storedRows = await db
    .select({ clientEventId: sessionEvents.clientEventId })
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId))
  const storedClientEventIds = new Set(storedRows.map((r) => r.clientEventId))

  const { accepted: toInsert, duplicates } = partitionBatch(events, storedClientEventIds)

  const reconciliationWarning = (RECONCILIATION_LIFECYCLES as readonly SessionLifecycle[]).includes(
    row.lifecycle,
  )

  const insertRows =
    toInsert.length > 0
      ? toInsert.map((event) => buildEventInsertRow({ sessionId, event, receivedAt: ctx.now, reconciliationWarning }))
      : []
  const insertedIds = await insertEventRows(db, insertRows)

  const accepted: string[] = []
  const finalDuplicates = [...duplicates]
  for (const event of toInsert) {
    if (insertedIds.has(event.clientEventId)) {
      accepted.push(event.clientEventId)
    } else {
      // Genuine race: another concurrent request stored this exact
      // clientEventId between this function's own SELECT and its INSERT.
      finalDuplicates.push(event.clientEventId)
    }
  }

  return { accepted, duplicates: finalDuplicates }
}

// ---------------------------------------------------------------------------
// voidEvent — POST /sessions/{id}/events/{clientEventId}/void (task 5.3.2;
// D9, D19, D28)
// ---------------------------------------------------------------------------

/** The subset of a `focus_sessions` row `voidEvent` needs — ownership plus the finalized-immutability gate. */
interface VoidEventSessionRow {
  readonly userId: string
  readonly realm: Realm
  readonly lifecycle: SessionLifecycle
}

/**
 * `POST /sessions/{id}/events/{clientEventId}/void` (design.md D9, D28; task
 * 5.3.2). Check order, fixed by the task brief: ownership 404 (session
 * missing or not this principal's — identical, indistinguishable shape to
 * every other session route) -> the event row itself by `(session_id,
 * client_event_id)`, a second 404 -> `canVoid(session.lifecycle)`: a
 * `finalized` attempt is immutable, 409 `already_finalized`, `voided_at`
 * left untouched (an `abandoned` session's events stay editable — this is
 * the specific finalized-immutability rule, not a general "session not
 * active" code) -> `isVoidableType(row.type)`: a server-written `pause`/
 * `resume` row can never be voided (voiding one would falsify
 * `paused_seconds` while marking the row undone), 422 `invalid_transition`
 * (D19 names no dedicated code for this; reused here, same treatment 5.3.1
 * gives its own unnamed-code case) -> already voided: idempotent 200
 * returning the stored row completely unchanged, never a fresh `voided_at`
 * -> otherwise `UPDATE ... SET voided_at = ctx.now WHERE id = row.id AND
 * voided_at IS NULL`, so a genuine concurrent double-void race resolves to
 * the same idempotent-replay shape rather than a lost update. Rows are never
 * deleted (D9); no count column, tally or `eventCount` is touched here —
 * undo surfaces only through `deriveTallies`'s own voided-row exclusion
 * (5.2.1) the next time the session is read, and `eventCount` (every stored
 * row, voided included) is unaffected by voiding either way.
 */
export async function voidEvent(
  db: AppDatabase,
  ctx: RequestContext,
  sessionId: string,
  clientEventId: string,
): Promise<EventResponseValue> {
  const [session] = await db
    .select({ userId: focusSessions.userId, realm: focusSessions.realm, lifecycle: focusSessions.lifecycle })
    .from(focusSessions)
    .where(eq(focusSessions.id, sessionId))
    .limit(1)
  const sessionRow: VoidEventSessionRow | undefined = session
  if (sessionRow === undefined || sessionRow.userId !== ctx.principalId) {
    throw new NotFoundError()
  }
  assertOwnRealm(ctx, sessionRow.realm)

  const [row] = await db
    .select()
    .from(sessionEvents)
    .where(and(eq(sessionEvents.sessionId, sessionId), eq(sessionEvents.clientEventId, clientEventId)))
    .limit(1)
  if (row === undefined) {
    throw new NotFoundError()
  }

  if (!canVoid(sessionRow.lifecycle)) {
    throw new ConflictError('already_finalized', 'This attempt is finalized; its events cannot be changed.')
  }

  if (!isVoidableType(row.type)) {
    throw new DomainError(
      'invalid_transition',
      'Pause and resume records reflect a transition and cannot be voided.',
    )
  }

  if (row.voidedAt !== null) {
    // Idempotent replay: the exact same row, completely unchanged.
    return serializeEvent(row)
  }

  const [updated] = await db
    .update(sessionEvents)
    .set({ voidedAt: ctx.now })
    .where(and(eq(sessionEvents.id, row.id), isNull(sessionEvents.voidedAt)))
    .returning()

  if (updated === undefined) {
    // Genuine race: another concurrent void already set voided_at between
    // this function's own SELECT and this UPDATE — re-read and return the
    // now-voided row, the same shape the already-voided branch above returns.
    const [raced] = await db.select().from(sessionEvents).where(eq(sessionEvents.id, row.id)).limit(1)
    if (raced === undefined) {
      throw new Error(`voidEvent: session_events row '${row.id}' vanished after a concurrent void`)
    }
    return serializeEvent(raced)
  }

  return serializeEvent(updated)
}

// ---------------------------------------------------------------------------
// transitionSession — POST /sessions/{id}/transitions (task 5.4.2; design.md
// D18, D19, D20, D24, D29)
// ---------------------------------------------------------------------------

/** The subset of a `focus_sessions` row `transitionSession` needs — ownership plus everything `applyTransition` (5.4.1) reads. */
interface TransitionSessionRow {
  readonly userId: string
  readonly realm: Realm
  readonly kind: SessionKind
  readonly lifecycle: SessionLifecycle
  readonly startedAt: Date
  readonly targetSeconds: number
  readonly pausedSeconds: number
  readonly currentPauseStartedAt: Date | null
  readonly endedAt: Date | null
  readonly completeInterval: boolean | null
  readonly version: number
}

/** Once a session reaches either of these, no further transition is possible — checked before `applyTransition` ever runs (both are terminal; the task brief's own wording). */
const TRANSITION_TERMINAL_LIFECYCLES = ['finalized', 'abandoned'] as const satisfies readonly SessionLifecycle[]

/**
 * `POST /sessions/{id}/transitions` (design.md D18, D19, D20, D24, D29; task
 * 5.4.2). Check order, fixed by the task brief: ownership 404 (missing or not
 * owned — identical, indistinguishable shape to every other session route) ->
 * inside one `SELECT ... FOR UPDATE` transaction, `finalized`/`abandoned` ->
 * 409 `session_not_active` immediately, before `applyTransition` (5.4.1) ever
 * runs (both lifecycles are terminal; the session simply cannot transition
 * again) -> a stale `expectedVersion` -> 409 `stale_version` carrying
 * `details.current`, the freshly re-serialized session (D18: lets a client
 * reconcile without a second GET) -> `applyTransition`: any
 * `invalid_for_kind`/`invalid_from_state` failure -> 422 `invalid_transition`
 * (both reasons collapse to this one D19 code once the terminal-state case
 * above has already been carved out) -> `UPDATE focus_sessions SET <patch>,
 * version = version + 1 WHERE id = :id AND version = :expectedVersion` (zero
 * rows updated is the same 409 `stale_version`, the race backstop behind the
 * row lock already taken above) -> on `pause`/`resume`, exactly one
 * `session_events` row via `buildPauseEventRow` (5.4.2) so paused intervals
 * are stored (a planned break is a pause with `reason: 'planned_break'`,
 * D29) -> 200 `serializeSession` (via `loadSessionForResponse`, D16, D20).
 * `reason` on `end`/`abandon` is accepted by the 2.7 contract but discarded
 * here too — `applyTransition` itself never lets it reach the returned patch
 * or an `eventRow` for those two types (D29). This is the only writer of
 * `session_events` besides `appendEvents` (5.3.1); `GET` stays strictly
 * read-only (D24) — only this route, group 5b's `clock-gap`/`finalize` ever
 * change lifecycle.
 */
export async function transitionSession(
  db: AppDatabase,
  ctx: RequestContext,
  sessionId: string,
  body: TransitionBodyValue,
): Promise<SessionResponseValue> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        userId: focusSessions.userId,
        realm: focusSessions.realm,
        kind: focusSessions.kind,
        lifecycle: focusSessions.lifecycle,
        startedAt: focusSessions.startedAt,
        targetSeconds: focusSessions.targetSeconds,
        pausedSeconds: focusSessions.pausedSeconds,
        currentPauseStartedAt: focusSessions.currentPauseStartedAt,
        endedAt: focusSessions.endedAt,
        completeInterval: focusSessions.completeInterval,
        version: focusSessions.version,
      })
      .from(focusSessions)
      .where(eq(focusSessions.id, sessionId))
      .limit(1)
      .for('update')
    const session: TransitionSessionRow | undefined = row
    if (session === undefined || session.userId !== ctx.principalId) {
      throw new NotFoundError()
    }
    assertOwnRealm(ctx, session.realm)

    if ((TRANSITION_TERMINAL_LIFECYCLES as readonly SessionLifecycle[]).includes(session.lifecycle)) {
      throw new ConflictError('session_not_active', 'This session has already ended.')
    }

    if (session.version !== body.expectedVersion) {
      const current = await loadSessionForResponse(tx, sessionId, ctx.now)
      throw new ConflictError('stale_version', 'This session was already updated.', {
        details: { current },
      })
    }

    const result = applyTransition(
      {
        kind: session.kind,
        lifecycle: session.lifecycle,
        startedAt: session.startedAt,
        targetSeconds: session.targetSeconds,
        pausedSeconds: session.pausedSeconds,
        currentPauseStartedAt: session.currentPauseStartedAt,
        endedAt: session.endedAt,
        completeInterval: session.completeInterval,
      },
      body.type,
      ctx.now,
      body.reason ?? null,
    )

    if (!result.ok) {
      throw new DomainError('invalid_transition', 'This session cannot make that transition right now.')
    }

    const updatedRows = await tx
      .update(focusSessions)
      .set({
        lifecycle: result.patch.lifecycle,
        pausedSeconds: result.patch.pausedSeconds,
        currentPauseStartedAt: result.patch.currentPauseStartedAt,
        endedAt: result.patch.endedAt,
        completeInterval: result.patch.completeInterval,
        version: session.version + 1,
      })
      .where(and(eq(focusSessions.id, sessionId), eq(focusSessions.version, body.expectedVersion)))
      .returning({ id: focusSessions.id })

    if (updatedRows.length === 0) {
      // Race backstop behind the row lock already taken above (mirrors
      // `mapSessionInsertPgError`'s own backstop reasoning elsewhere in this
      // file): re-read and report the same 409 `stale_version` shape.
      const current = await loadSessionForResponse(tx, sessionId, ctx.now)
      throw new ConflictError('stale_version', 'This session was already updated.', {
        details: { current },
      })
    }

    if (result.eventRow !== undefined) {
      const eventInsertRow = buildPauseEventRow(result.eventRow, ctx.now)
      await tx.insert(sessionEvents).values({
        sessionId,
        clientEventId: eventInsertRow.clientEventId,
        type: eventInsertRow.type,
        elapsedMs: eventInsertRow.elapsedMs,
        occurredAt: eventInsertRow.occurredAt,
        receivedAt: eventInsertRow.receivedAt,
        details: eventInsertRow.details,
        voidedAt: null,
      })
    }

    return loadSessionForResponse(tx, sessionId, ctx.now)
  })
}

// ---------------------------------------------------------------------------
// resolveClockGap — POST /sessions/{id}/clock-gap (task 5.5.1; design.md D18,
// D19, D20, D25, D26)
// ---------------------------------------------------------------------------

/** The subset of a `focus_sessions` row `resolveClockGap` needs. */
interface ClockGapSessionRow {
  readonly userId: string
  readonly realm: Realm
  readonly lifecycle: SessionLifecycle
  readonly timerQuality: TimerQuality
  readonly clockGapSeconds: number | null
  readonly pausedSeconds: number
  readonly currentPauseStartedAt: Date | null
  readonly endedAt: Date | null
  readonly completeInterval: boolean | null
  readonly version: number
}

/** A clock-gap resolution may be posted against any of these three (task brief); a terminal lifecycle is 409 `session_not_active` (D19), same code `transitionSession` uses for the identical situation. */
const CLOCK_GAP_ACTIVE_LIFECYCLES = ['running', 'paused', 'awaiting_review'] as const satisfies readonly SessionLifecycle[]

/** The exact `focus_sessions` columns a resolved clock gap changes, whichever resolution was posted. */
export interface ClockGapPatch {
  readonly clockGapSeconds: number
  readonly timerQuality: TimerQuality
  readonly lifecycle: SessionLifecycle
  readonly pausedSeconds: number
  readonly currentPauseStartedAt: Date | null
  readonly endedAt: Date | null
  readonly completeInterval: boolean | null
}

export interface EndSessionPatch {
  readonly pausedSeconds: number
  readonly currentPauseStartedAt: null
  readonly endedAt: Date
}

/**
 * Task 5.5.1 (D25): the same fold-open-pause + `endedAt` mechanics 5.4.1's
 * `applyEnd` (`services/sessionTransitions.ts`) uses for the ordinary `end`
 * transition, extracted into its own named helper so `computeClockGapPatch`'s
 * `save_incomplete` branch reuses the pause-fold arithmetic instead of
 * duplicating it (5.4.2 kept its own inline copy of `applyEnd`'s result,
 * since the ordinary `end` transition only ever starts from `running` or
 * `paused` and always computes its own elapsed-based `completeInterval` —
 * this helper never computes `completeInterval` at all; `save_incomplete`
 * always forces it `false`, decided by `computeClockGapPatch`, never here).
 *
 * When `session.lifecycle` is already `awaiting_review` there is no open
 * pause to fold and no new `endedAt` to record — the task brief's own
 * wording: "if the session is already awaiting_review, only the flags
 * change and ended_at is preserved". This is the one branch with no
 * equivalent in `applyEnd`, which never runs from `awaiting_review` at all.
 */
export function endSession(
  session: Pick<ClockGapSessionRow, 'lifecycle' | 'pausedSeconds' | 'currentPauseStartedAt' | 'endedAt'>,
  now: Date,
): EndSessionPatch {
  if (session.lifecycle === 'awaiting_review') {
    return {
      pausedSeconds: session.pausedSeconds,
      currentPauseStartedAt: null,
      endedAt: session.endedAt ?? now,
    }
  }
  if (session.currentPauseStartedAt === null) {
    return { pausedSeconds: session.pausedSeconds, currentPauseStartedAt: null, endedAt: now }
  }
  const openPauseSeconds = Math.floor(
    (now.getTime() - session.currentPauseStartedAt.getTime()) / 1000,
  )
  return {
    pausedSeconds: session.pausedSeconds + openPauseSeconds,
    currentPauseStartedAt: null,
    endedAt: now,
  }
}

/**
 * Pure decision core of `resolveClockGap` (task 5.5.1; D25, D26), no database
 * import. Common to every resolution: `clockGapSeconds` becomes `gapSeconds`
 * when the stored column is NULL (no gap ever reported) and
 * `session.clockGapSeconds + gapSeconds` otherwise — an explicit NULL branch,
 * never `?? 0` / `COALESCE(...,0)` (D26). `continued` leaves `timerQuality`
 * and every other field exactly as stored (an earlier `uncertain` is never
 * reset back to `ok`). `uncertain` sets `timerQuality` and otherwise leaves
 * the session untouched. `save_incomplete` sets `timerQuality` to
 * `'uncertain'` AND ends the session through `endSession` above, always
 * forcing `completeInterval` to `false` (D25) — even when the fold-derived
 * elapsed time would reach or exceed `target_seconds`, because timer expiry
 * never proves completion; `save_incomplete` never finalizes by itself
 * (finalize, group 5b, remains a separate, later call).
 */
export function computeClockGapPatch(
  session: Pick<
    ClockGapSessionRow,
    | 'lifecycle'
    | 'timerQuality'
    | 'clockGapSeconds'
    | 'pausedSeconds'
    | 'currentPauseStartedAt'
    | 'endedAt'
    | 'completeInterval'
  >,
  gapSeconds: number,
  resolution: ClockGapResolution,
  now: Date,
): ClockGapPatch {
  const clockGapSeconds =
    session.clockGapSeconds === null ? gapSeconds : session.clockGapSeconds + gapSeconds

  if (resolution === 'continued') {
    return {
      clockGapSeconds,
      timerQuality: session.timerQuality,
      lifecycle: session.lifecycle,
      pausedSeconds: session.pausedSeconds,
      currentPauseStartedAt: session.currentPauseStartedAt,
      endedAt: session.endedAt,
      completeInterval: session.completeInterval,
    }
  }

  if (resolution === 'uncertain') {
    return {
      clockGapSeconds,
      timerQuality: 'uncertain',
      lifecycle: session.lifecycle,
      pausedSeconds: session.pausedSeconds,
      currentPauseStartedAt: session.currentPauseStartedAt,
      endedAt: session.endedAt,
      completeInterval: session.completeInterval,
    }
  }

  // save_incomplete (D25): the exhaustiveness of ClockGapResolution's three
  // literal members is enforced by the contract; a TypeBox rejection for
  // anything else never reaches this function.
  const ended = endSession(session, now)
  return {
    clockGapSeconds,
    timerQuality: 'uncertain',
    lifecycle: 'awaiting_review',
    pausedSeconds: ended.pausedSeconds,
    currentPauseStartedAt: ended.currentPauseStartedAt,
    endedAt: ended.endedAt,
    completeInterval: false,
  }
}

/**
 * `POST /sessions/{id}/clock-gap` (design.md D18, D19, D20, D25, D26; task
 * 5.5.1). Check order: ownership 404 (missing or not owned — identical,
 * indistinguishable shape to every other session route) -> inside one
 * `SELECT ... FOR UPDATE` transaction, lifecycle must be
 * `running|paused|awaiting_review` — `finalized`/`abandoned` -> 409
 * `session_not_active` -> `computeClockGapPatch` decides the whole patch ->
 * one `UPDATE` (`version + 1` exactly once, whatever the resolution) -> 200
 * `serializeSession` (via `loadSessionForResponse`, D16, D20). No
 * `session_events` row is written here (D26): the client posts its own
 * `clock_gap` event through 5.3. No `expectedVersion`: the 2.7 `ClockGapBody`
 * contract carries none, so there is no optimistic-lock 409 to raise here —
 * unlike `transitionSession`.
 */
export async function resolveClockGap(
  db: AppDatabase,
  ctx: RequestContext,
  sessionId: string,
  body: ClockGapBodyValue,
): Promise<SessionResponseValue> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        userId: focusSessions.userId,
        realm: focusSessions.realm,
        lifecycle: focusSessions.lifecycle,
        timerQuality: focusSessions.timerQuality,
        clockGapSeconds: focusSessions.clockGapSeconds,
        pausedSeconds: focusSessions.pausedSeconds,
        currentPauseStartedAt: focusSessions.currentPauseStartedAt,
        endedAt: focusSessions.endedAt,
        completeInterval: focusSessions.completeInterval,
        version: focusSessions.version,
      })
      .from(focusSessions)
      .where(eq(focusSessions.id, sessionId))
      .limit(1)
      .for('update')
    const session: ClockGapSessionRow | undefined = row
    if (session === undefined || session.userId !== ctx.principalId) {
      throw new NotFoundError()
    }
    assertOwnRealm(ctx, session.realm)

    if (!(CLOCK_GAP_ACTIVE_LIFECYCLES as readonly SessionLifecycle[]).includes(session.lifecycle)) {
      throw new ConflictError('session_not_active', 'This session has already ended.')
    }

    const patch = computeClockGapPatch(session, body.gapSeconds, body.resolution, ctx.now)

    await tx
      .update(focusSessions)
      .set({
        clockGapSeconds: patch.clockGapSeconds,
        timerQuality: patch.timerQuality,
        lifecycle: patch.lifecycle,
        pausedSeconds: patch.pausedSeconds,
        currentPauseStartedAt: patch.currentPauseStartedAt,
        endedAt: patch.endedAt,
        completeInterval: patch.completeInterval,
        version: session.version + 1,
      })
      .where(eq(focusSessions.id, sessionId))

    return loadSessionForResponse(tx, sessionId, ctx.now)
  })
}

// ---------------------------------------------------------------------------
// putAgentPlan — PUT /sessions/{id}/agent-plan (task 5.6.1; design.md D16,
// D18, D19, D20)
// ---------------------------------------------------------------------------

/** The subset of a `focus_sessions` row `putAgentPlan` needs — ownership, the practice-only kind gate, and the active-lifecycle gate. */
interface AgentPlanSessionRow {
  readonly userId: string
  readonly realm: Realm
  readonly kind: SessionKind
  readonly lifecycle: SessionLifecycle
}

/** An agent plan may be written only while the session is unfinished; a terminal lifecycle (`finalized`/`abandoned`) is 409 `session_not_active` — the same code every other session route uses for the identical situation. */
const AGENT_PLAN_ACTIVE_LIFECYCLES = ['running', 'paused', 'awaiting_review'] as const satisfies readonly SessionLifecycle[]

/** D19 `practice_only`: a benchmark session never has an agent-waiting plan (design.md's "Ownership and de-duplication" — the panel is practice-only). */
export function assertPracticeKind(kind: SessionKind): void {
  if (kind !== 'practice') {
    throw new DomainError('practice_only', 'Agent plans are only available for practice sessions.')
  }
}

/**
 * The exact stored-row shape `decideAgentPlanWrite` reads — deliberately
 * DB-shape-compatible (matches `agent_plans`' own columns, including
 * `sessionId`/`reviewAt` so a `stale` decision's `current` needs no
 * reconstruction to serialize) but importing no DB type, so the function
 * below stays a pure, no-database unit (task 5.6.1 brief: "Unit tests ...
 * apps/api/test/services/agent-plan.unit.test.ts"). The real `agent_plans`
 * row `putAgentPlan` reads is structurally identical, so it is passed
 * straight through with no field-picking.
 */
export interface AgentPlanRowLike {
  readonly sessionId: string
  readonly workstream: string | null
  readonly waitingTask: string | null
  readonly resumeNote: string | null
  readonly reviewCheckpoint: string
  readonly reviewAt: Date | null
  readonly version: number
}

/** The exact `agent_plans` insert row for a first PUT (`expectedVersion: 0`, no row yet). */
export interface AgentPlanInsertValues {
  readonly workstream: string | null
  readonly waitingTask: string | null
  readonly resumeNote: string | null
  readonly reviewCheckpoint: string
  readonly version: 1
}

/** The exact `agent_plans` UPDATE patch for a subsequent PUT against a matching `expectedVersion`. */
export interface AgentPlanUpdatePatch {
  readonly workstream: string | null
  readonly waitingTask: string | null
  readonly resumeNote: string | null
  readonly reviewCheckpoint: string
  readonly version: number
}

export type AgentPlanWriteDecision =
  | { readonly kind: 'insert'; readonly values: AgentPlanInsertValues }
  | { readonly kind: 'update'; readonly patch: AgentPlanUpdatePatch }
  | { readonly kind: 'stale'; readonly current: AgentPlanRowLike | null }

/** The fields a PUT body carries besides `expectedVersion` — a subset of `AgentPlanBodyValue`, named separately so this pure module never has to import the wire contract type. */
export interface AgentPlanWriteFields {
  readonly expectedVersion: number
  readonly workstream?: string
  readonly waitingTask?: string
  readonly reviewCheckpoint?: 'end_of_block'
  readonly resumeNote?: string
}

/**
 * Pure upsert decision (task 5.6.1), no database import: `existing === null`
 * means no `agent_plans` row exists yet for this session — the first PUT
 * must supply `expectedVersion: 0` (else 409 `stale_version`; `current` is
 * `null` since there is no stored plan to report, the same shape `GET`
 * itself returns for `agentPlan` when no row exists). Once a row exists, a
 * mismatched `expectedVersion` is `stale` with `current` the untouched
 * stored row (D18's `details.current`); a match merges only the SUPPLIED
 * fields over the stored ones — an omitted field keeps its stored value,
 * never resets to null ("Unspecified fields keep their stored values", the
 * task brief). `review_checkpoint` defaults to `'end_of_block'` only on
 * insert, when the body omits it; every value the client did supply is
 * still validated by the 2.7 `AgentPlanBody` contract before this function
 * ever runs.
 */
export function decideAgentPlanWrite(
  existing: AgentPlanRowLike | null,
  body: AgentPlanWriteFields,
): AgentPlanWriteDecision {
  if (existing === null) {
    if (body.expectedVersion !== 0) {
      return { kind: 'stale', current: null }
    }
    return {
      kind: 'insert',
      values: {
        workstream: body.workstream ?? null,
        waitingTask: body.waitingTask ?? null,
        resumeNote: body.resumeNote ?? null,
        reviewCheckpoint: body.reviewCheckpoint ?? 'end_of_block',
        version: 1,
      },
    }
  }

  if (existing.version !== body.expectedVersion) {
    return { kind: 'stale', current: existing }
  }

  return {
    kind: 'update',
    patch: {
      workstream: body.workstream !== undefined ? body.workstream : existing.workstream,
      waitingTask: body.waitingTask !== undefined ? body.waitingTask : existing.waitingTask,
      resumeNote: body.resumeNote !== undefined ? body.resumeNote : existing.resumeNote,
      reviewCheckpoint: body.reviewCheckpoint !== undefined ? body.reviewCheckpoint : existing.reviewCheckpoint,
      version: existing.version + 1,
    },
  }
}

/**
 * `PUT /sessions/{id}/agent-plan` (design.md D16, D18, D19, D20; task
 * 5.6.1). Check order: ownership 404 (missing or not owned — identical,
 * indistinguishable shape to every other session route) -> realm guard ->
 * `assertPracticeKind` (422 `practice_only` for a benchmark session) ->
 * `AGENT_PLAN_ACTIVE_LIFECYCLES` (409 `session_not_active` for a finalized
 * or abandoned session) -> `decideAgentPlanWrite`'s pure decision, applied
 * inside one transaction with a race backstop mirroring
 * `transitionSession`'s own: `ON CONFLICT (session_id) DO NOTHING` on the
 * first insert (two concurrent first PUTs both racing `expectedVersion: 0`)
 * and `WHERE session_id = ? AND version = ?` on the update (two concurrent
 * PUTs racing the same `expectedVersion`) — either backstop losing re-reads
 * the now-current row and reports the identical `stale_version` shape the
 * pure decision would have produced had it seen that row first. The
 * `focus_sessions` row itself is never written here: no `version` bump, no
 * lifecycle change, no `session_events` row — "the plan is stored against
 * the session and the session continues uninterrupted" (practice-sessions:
 * Optional agent waiting plan / Save a plan mid-session). `review_at` is
 * left completely untouched either way: the 2.7 contract carries no field
 * for it, and neither branch below ever sets it.
 */
export async function putAgentPlan(
  db: AppDatabase,
  ctx: RequestContext,
  sessionId: string,
  body: AgentPlanBodyValue,
): Promise<AgentPlanResponseValue> {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({
        userId: focusSessions.userId,
        realm: focusSessions.realm,
        kind: focusSessions.kind,
        lifecycle: focusSessions.lifecycle,
      })
      .from(focusSessions)
      .where(eq(focusSessions.id, sessionId))
      .limit(1)
    const row: AgentPlanSessionRow | undefined = session
    if (row === undefined || row.userId !== ctx.principalId) {
      throw new NotFoundError()
    }
    assertOwnRealm(ctx, row.realm)
    assertPracticeKind(row.kind)

    if (!(AGENT_PLAN_ACTIVE_LIFECYCLES as readonly SessionLifecycle[]).includes(row.lifecycle)) {
      throw new ConflictError('session_not_active', 'This session has already ended.')
    }

    const [existing] = await tx.select().from(agentPlans).where(eq(agentPlans.sessionId, sessionId)).limit(1)

    const decision = decideAgentPlanWrite(existing ?? null, body)

    if (decision.kind === 'stale') {
      throw new ConflictError('stale_version', 'This agent plan was already updated.', {
        details: { current: decision.current === null ? null : serializeAgentPlan(decision.current) },
      })
    }

    if (decision.kind === 'insert') {
      const inserted = await tx
        .insert(agentPlans)
        .values({ sessionId, ...decision.values })
        .onConflictDoNothing({ target: agentPlans.sessionId })
        .returning()
      const [plan] = inserted
      if (plan === undefined) {
        // Race backstop: another concurrent first PUT inserted this row
        // between this function's own SELECT and this INSERT.
        const [current] = await tx.select().from(agentPlans).where(eq(agentPlans.sessionId, sessionId)).limit(1)
        if (current === undefined) {
          throw new Error(
            `putAgentPlan: agent_plans row for session '${sessionId}' vanished after a concurrent insert race`,
          )
        }
        throw new ConflictError('stale_version', 'This agent plan was already updated.', {
          details: { current: serializeAgentPlan(current) },
        })
      }
      return serializeAgentPlan(plan)
    }

    // decision.kind === 'update'
    const updated = await tx
      .update(agentPlans)
      .set(decision.patch)
      .where(and(eq(agentPlans.sessionId, sessionId), eq(agentPlans.version, body.expectedVersion)))
      .returning()
    const [plan] = updated
    if (plan === undefined) {
      // Race backstop: a concurrent write already advanced the version
      // between this function's own SELECT and this UPDATE.
      const [current] = await tx.select().from(agentPlans).where(eq(agentPlans.sessionId, sessionId)).limit(1)
      if (current === undefined) {
        throw new Error(
          `putAgentPlan: agent_plans row for session '${sessionId}' vanished after a concurrent update race`,
        )
      }
      throw new ConflictError('stale_version', 'This agent plan was already updated.', {
        details: { current: serializeAgentPlan(current) },
      })
    }
    return serializeAgentPlan(plan)
  })
}
