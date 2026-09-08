/**
 * Session-level DB seed helpers (design.md D16: 5.1.3) — the layer directly
 * above 4.1.1's program/slot helpers (`programs.ts`) and 3.2.1's app
 * foundation (`buildTestApp`/`truncateAll`). This file holds ONLY
 * session-level seeds (`focus_sessions`, `session_reviews`,
 * `session_events`, `session_amendments`, `agent_plans`) plus the
 * `Idempotency-Key` header helper; it never builds an app, truncates a
 * table, seeds a program/slot/principal, or re-implements anything 3.2.1 or
 * 4.1.1 already own. Every 5a/5b integration test composes these with
 * `insertProgram`/`insertSlotSet`/`seedActiveProgram`/`setDemoOffsetSeconds`/
 * `setDemoNow`/`insertOtherPrincipalProgram`/`ensurePrincipalProfile` from
 * `./programs.js` and `buildTestApp`/`truncateAll` from `./buildTestApp.js`.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type {
  BenchmarkPhase,
  ClockGapDetailsValue,
  CountMethod,
  EventDetailsValue,
  EventsBatchBodyValue,
  ExclusionReason,
  FinalizeBodyValue,
  FirstSwitchKind,
  FirstSwitchMethod,
  LocalDate,
  ObservedConditionsValue,
  OutputQuality,
  Realm,
  RecallFlag,
  RecallPointScores,
  RecallPoints,
  RecallScoreValue,
  ReportedCount,
  SessionEventType,
  SessionKind,
  SessionLifecycle,
  SlotLabel,
  TimeSource,
  TimerQuality,
} from '@attention-lab/shared'
import { localDateAt } from '@attention-lab/shared'

import type { AppDatabase } from '../../src/plugins/db.js'
import { LOCAL_DEMO_PRINCIPAL_ID } from '../../src/plugins/identity.js'
import {
  agentPlans,
  focusSessions,
  programs,
  sessionAmendments,
  sessionEvents,
  sessionReviews,
} from '../../src/db/schema/index.js'
import { insertProgram, insertSlotSet, type SlotSetIds } from './programs.js'

/** D31: the empty `ObservedConditions` used when no slot (or override) supplies one. */
const EMPTY_OBSERVED_CONDITIONS: ObservedConditionsValue = {
  deviceFormat: null,
  language: null,
  materialLevel: null,
  accommodations: [],
}

// ---------------------------------------------------------------------------
// seedReview
// ---------------------------------------------------------------------------

export interface SeedReviewOverrides {
  readonly episodeCount?: ReportedCount
  readonly countMethod?: CountMethod | null
  readonly firstSwitchKind?: FirstSwitchKind | null
  readonly firstSwitchSeconds?: ReportedCount
  readonly firstSwitchMethod?: FirstSwitchMethod | null
  readonly externalCount?: ReportedCount
  readonly unplannedAgentChecks?: ReportedCount
  readonly mindWanderingCount?: ReportedCount
  readonly outputQuality?: OutputQuality | null
  readonly outputNote?: string | null
  readonly reviewNote?: string | null
  readonly materiallyDisrupted?: boolean | null
  readonly disruptionNote?: string | null
  readonly recallPoints?: RecallPoints | null
  readonly recallStartedAt?: Date | null
  readonly recallLockedAt?: Date | null
  readonly recallDelaySeconds?: ReportedCount
  readonly recallDurationSeconds?: ReportedCount
  readonly recallFlags?: readonly RecallFlag[]
  readonly recallScores?: readonly RecallScoreValue[] | RecallPointScores | null
  readonly recallScore?: ReportedCount
  readonly observedConditions?: ObservedConditionsValue
  readonly finalizedAt?: Date | null
  readonly version?: number
}

/**
 * Inserts (or, for a row already created by `seedSession`, upserts) a
 * `session_reviews` row: every measurement column defaults to SQL NULL
 * (never `0` — D7.1), `recallFlags` defaults to `[]`, `observedConditions`
 * defaults to the all-null `ObservedConditions`, `finalizedAt` defaults to
 * null and `version` defaults to 1. An override supplied for one field never
 * changes any other field's default.
 */
export async function seedReview(
  db: AppDatabase,
  sessionId: string,
  overrides: SeedReviewOverrides = {},
): Promise<void> {
  const values = {
    sessionId,
    episodeCount: overrides.episodeCount ?? null,
    countMethod: overrides.countMethod ?? null,
    firstSwitchKind: overrides.firstSwitchKind ?? null,
    firstSwitchSeconds: overrides.firstSwitchSeconds ?? null,
    firstSwitchMethod: overrides.firstSwitchMethod ?? null,
    externalCount: overrides.externalCount ?? null,
    unplannedAgentChecks: overrides.unplannedAgentChecks ?? null,
    mindWanderingCount: overrides.mindWanderingCount ?? null,
    outputQuality: overrides.outputQuality ?? null,
    outputNote: overrides.outputNote ?? null,
    reviewNote: overrides.reviewNote ?? null,
    materiallyDisrupted: overrides.materiallyDisrupted ?? null,
    disruptionNote: overrides.disruptionNote ?? null,
    recallPoints: overrides.recallPoints ?? null,
    recallStartedAt: overrides.recallStartedAt ?? null,
    recallLockedAt: overrides.recallLockedAt ?? null,
    recallDelaySeconds: overrides.recallDelaySeconds ?? null,
    recallDurationSeconds: overrides.recallDurationSeconds ?? null,
    recallFlags: overrides.recallFlags ? [...overrides.recallFlags] : [],
    recallScores: overrides.recallScores ?? null,
    recallScore: overrides.recallScore ?? null,
    observedConditions: overrides.observedConditions ?? EMPTY_OBSERVED_CONDITIONS,
    finalizedAt: overrides.finalizedAt ?? null,
    version: overrides.version ?? 1,
  }

  await db
    .insert(sessionReviews)
    .values(values)
    .onConflictDoUpdate({ target: sessionReviews.sessionId, set: values })
}

// ---------------------------------------------------------------------------
// seedSession
// ---------------------------------------------------------------------------

export interface SeedSessionOverrides {
  readonly userId?: string
  /** No default — every session belongs to a real, already-inserted program (4.1.1's `insertProgram`). */
  readonly programId: string
  /** Defaults to the program's own `current_revision_id`. */
  readonly revisionId?: string
  readonly slotId?: string | null
  readonly realm?: Realm
  readonly kind?: SessionKind
  readonly lifecycle?: SessionLifecycle
  readonly targetSeconds?: number
  readonly startedAt?: Date
  readonly endedAt?: Date | null
  readonly pausedSeconds?: number
  readonly currentPauseStartedAt?: Date | null
  /** Defaults to "today" in the program's own stored timezone, at `startedAt`. */
  readonly localDate?: LocalDate
  readonly intendedOutput?: string | null
  readonly timeSource?: TimeSource
  readonly timerQuality?: TimerQuality
  readonly clockGapSeconds?: ReportedCount
  readonly completeInterval?: boolean | null
  readonly eligible?: boolean | null
  readonly exclusionReasons?: readonly ExclusionReason[]
  readonly replacementReason?: string | null
  readonly version?: number
  /** `false` skips the paired `session_reviews` row entirely; an object (or omission) seeds one via `seedReview`. */
  readonly review?: false | SeedReviewOverrides
}

export interface SeedSessionResult {
  readonly sessionId: string
}

/**
 * Inserts one `focus_sessions` row matching the 3.3 schema's defaults, plus
 * (unless `overrides.review === false`) its paired `session_reviews` row via
 * `seedReview` — the review row exists from session start, never deferred
 * (D31). `revisionId` and `localDate`, when not overridden, are derived from
 * the already-inserted `programId` row (its `current_revision_id` and
 * `timezone`) rather than guessed, mirroring 4.1.1's `insertSession`.
 */
export async function seedSession(
  db: AppDatabase,
  overrides: SeedSessionOverrides,
): Promise<SeedSessionResult> {
  const [program] = await db
    .select({ timezone: programs.timezone, currentRevisionId: programs.currentRevisionId })
    .from(programs)
    .where(eq(programs.id, overrides.programId))
    .limit(1)
  if (!program) {
    throw new Error(`seedSession: no program ${overrides.programId}`)
  }

  const revisionId = overrides.revisionId ?? program.currentRevisionId
  if (revisionId === null || revisionId === undefined) {
    throw new Error(
      `seedSession: program ${overrides.programId} has no current_revision_id and no revisionId override was given`,
    )
  }

  const startedAt = overrides.startedAt ?? new Date()
  const localDate = overrides.localDate ?? localDateAt(startedAt, program.timezone)

  const [row] = await db
    .insert(focusSessions)
    .values({
      id: randomUUID(),
      userId: overrides.userId ?? LOCAL_DEMO_PRINCIPAL_ID,
      programId: overrides.programId,
      revisionId,
      slotId: overrides.slotId ?? null,
      realm: overrides.realm ?? 'demo',
      kind: overrides.kind ?? 'practice',
      lifecycle: overrides.lifecycle ?? 'running',
      targetSeconds: overrides.targetSeconds ?? 600,
      startedAt,
      endedAt: overrides.endedAt ?? null,
      pausedSeconds: overrides.pausedSeconds ?? 0,
      currentPauseStartedAt: overrides.currentPauseStartedAt ?? null,
      localDate,
      intendedOutput:
        overrides.intendedOutput === undefined ? 'seeded output' : overrides.intendedOutput,
      timeSource: overrides.timeSource ?? 'measured',
      timerQuality: overrides.timerQuality ?? 'ok',
      clockGapSeconds: overrides.clockGapSeconds ?? null,
      completeInterval: overrides.completeInterval ?? null,
      eligible: overrides.eligible ?? null,
      exclusionReasons: overrides.exclusionReasons ? [...overrides.exclusionReasons] : [],
      replacementReason: overrides.replacementReason ?? null,
      version: overrides.version ?? 1,
    })
    .returning()
  if (!row) {
    throw new Error('seedSession: focus_sessions insert returned no row')
  }

  if (overrides.review !== false) {
    await seedReview(db, row.id, overrides.review === undefined ? {} : overrides.review)
  }

  return { sessionId: row.id }
}

// ---------------------------------------------------------------------------
// seedEvents
// ---------------------------------------------------------------------------

export interface SeedEventRowInput {
  readonly clientEventId?: string
  readonly type: SessionEventType
  readonly elapsedMs?: number | null
  readonly occurredAt?: Date
  readonly receivedAt?: Date
  readonly details?: EventDetailsValue | ClockGapDetailsValue
  readonly voidedAt?: Date | null
}

export interface SeedEventResult {
  readonly id: string
  readonly clientEventId: string
}

/**
 * Inserts one or more `session_events` rows for `sessionId`. Each row
 * defaults `clientEventId` to a fresh UUID, `occurredAt`/`receivedAt` to the
 * same "now" (a per-call instant, not per-row, so a batch reads as
 * simultaneous unless a row overrides it), `details` to `{}` and `voidedAt`
 * to null — matching the 3.3 `session_events` schema exactly.
 */
export async function seedEvents(
  db: AppDatabase,
  sessionId: string,
  rows: readonly SeedEventRowInput[],
): Promise<readonly SeedEventResult[]> {
  if (rows.length === 0) return []

  const now = new Date()
  const values = rows.map((row) => ({
    sessionId,
    clientEventId: row.clientEventId ?? randomUUID(),
    type: row.type,
    elapsedMs: row.elapsedMs ?? null,
    occurredAt: row.occurredAt ?? now,
    receivedAt: row.receivedAt ?? now,
    details: row.details ?? {},
    voidedAt: row.voidedAt ?? null,
  }))

  const inserted = await db.insert(sessionEvents).values(values).returning()
  return inserted.map((row) => ({ id: row.id, clientEventId: row.clientEventId }))
}

// ---------------------------------------------------------------------------
// seedAmendment
// ---------------------------------------------------------------------------

export interface SeedAmendmentInput {
  readonly reason: string
  readonly excludeFromReport: boolean
  readonly userId?: string
  readonly createdAt?: Date
}

export interface SeedAmendmentResult {
  readonly amendmentId: string
}

/** Inserts one `session_amendments` row (D32: append-only), `createdAt` defaulting to now. */
export async function seedAmendment(
  db: AppDatabase,
  sessionId: string,
  input: SeedAmendmentInput,
): Promise<SeedAmendmentResult> {
  const [row] = await db
    .insert(sessionAmendments)
    .values({
      sessionId,
      userId: input.userId ?? LOCAL_DEMO_PRINCIPAL_ID,
      reason: input.reason,
      excludeFromReport: input.excludeFromReport,
      createdAt: input.createdAt ?? new Date(),
    })
    .returning()
  if (!row) {
    throw new Error('seedAmendment: session_amendments insert returned no row')
  }
  return { amendmentId: row.id }
}

// ---------------------------------------------------------------------------
// seedAgentPlan
// ---------------------------------------------------------------------------

export interface SeedAgentPlanOverrides {
  readonly workstream?: string | null
  readonly waitingTask?: string | null
  readonly resumeNote?: string | null
  readonly reviewCheckpoint?: string
  readonly reviewAt?: Date | null
  readonly version?: number
}

/**
 * Inserts one `agent_plans` row for `sessionId` (new helper: 5.1.3 creates
 * this so group 5b's agent-plan unit does not recreate it), defaults
 * matching the 3.3 schema: all-null `workstream`/`waitingTask`/`resumeNote`,
 * `reviewCheckpoint` 'end_of_block', `reviewAt` null, `version` 1.
 */
export async function seedAgentPlan(
  db: AppDatabase,
  sessionId: string,
  overrides: SeedAgentPlanOverrides = {},
): Promise<void> {
  await db.insert(agentPlans).values({
    sessionId,
    workstream: overrides.workstream ?? null,
    waitingTask: overrides.waitingTask ?? null,
    resumeNote: overrides.resumeNote ?? null,
    reviewCheckpoint: overrides.reviewCheckpoint ?? 'end_of_block',
    reviewAt: overrides.reviewAt ?? null,
    version: overrides.version ?? 1,
  })
}

// ---------------------------------------------------------------------------
// withIdempotencyKey
// ---------------------------------------------------------------------------

/** A fresh `Idempotency-Key` header pair, ready to spread into an `app.inject` headers object. */
export function withIdempotencyKey(): { 'idempotency-key': string } {
  return { 'idempotency-key': randomUUID() }
}

// ---------------------------------------------------------------------------
// lockRecall (task 5.7.2) — exercises the real POST /sessions/{id}/recall
// route through `app.inject`, mirroring `programs.ts`'s own
// `createProgramViaApi` (D16): every field has a default that passes
// `RecallBody` as-is; a fresh `Idempotency-Key` is generated per call unless
// the caller supplies one (to exercise replay or a deliberate mismatch).
// Returns the raw status code and parsed body rather than throwing on a
// non-2xx response, so a caller testing a rejection path can assert on it
// directly.
// ---------------------------------------------------------------------------

export interface LockRecallOverrides {
  readonly points?: RecallPoints
  /** Defaults to `new Date().toISOString()` — a caller testing D27's range checks supplies its own. */
  readonly startedAt?: string
  readonly durationSeconds?: number
}

export interface LockRecallResult {
  readonly statusCode: number
  readonly body: unknown
}

const DEFAULT_RECALL_POINTS: RecallPoints = [
  'point one',
  'point two',
  'point three',
  'point four',
  'point five',
]

export async function lockRecall(
  app: FastifyInstance,
  sessionId: string,
  overrides: LockRecallOverrides = {},
  idempotencyKey?: string,
): Promise<LockRecallResult> {
  const payload = {
    points: overrides.points ?? DEFAULT_RECALL_POINTS,
    startedAt: overrides.startedAt ?? new Date().toISOString(),
    durationSeconds: overrides.durationSeconds ?? 60,
  }

  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/recall`,
    headers: { 'idempotency-key': idempotencyKey ?? randomUUID() },
    payload,
  })

  return { statusCode: res.statusCode, body: res.json() }
}

// ---------------------------------------------------------------------------
// finalizeSession (task 5.8.1) — exercises the real
// `POST /sessions/{id}/finalize` route through `app.inject`, mirroring
// `lockRecall` above (D16): every field has a default that passes
// `FinalizeBody` as-is (`expectedEventCount: 0`, an empty `review`); a fresh
// `Idempotency-Key` is generated per call unless the caller supplies one (to
// exercise replay or a deliberate mismatch). Returns the raw status code and
// parsed body rather than throwing on a non-2xx response, so a caller testing
// a rejection path can assert on it directly. Named to match
// `services/review.ts`'s own `finalizeSession` — the two never collide since
// no file imports both.
// ---------------------------------------------------------------------------

export interface FinalizeSessionOverrides {
  readonly expectedEventCount?: number
  readonly lastBatch?: EventsBatchBodyValue
  readonly review?: FinalizeBodyValue['review']
}

export interface FinalizeSessionResult {
  readonly statusCode: number
  readonly body: unknown
}

export async function finalizeSession(
  app: FastifyInstance,
  sessionId: string,
  overrides: FinalizeSessionOverrides = {},
  idempotencyKey?: string,
): Promise<FinalizeSessionResult> {
  const payload: Record<string, unknown> = {
    expectedEventCount: overrides.expectedEventCount ?? 0,
    review: overrides.review ?? {},
  }
  if (overrides.lastBatch !== undefined) {
    payload.lastBatch = overrides.lastBatch
  }

  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/finalize`,
    headers: { 'idempotency-key': idempotencyKey ?? randomUUID() },
    payload,
  })

  return { statusCode: res.statusCode, body: res.json() }
}

// ---------------------------------------------------------------------------
// finalizableBenchmark / finalizableIncompleteBenchmark (task 5.8.3) — the
// benchmark-finalize fixture composing 4.1.1's `insertProgram`/`insertSlotSet`
// with this file's own `seedSession` and `lockRecall` (D16: never
// re-implements either, only calls them) so 5.8.3's own tests never hand-roll
// "a program with slots and an ended benchmark attempt" from scratch. Reuses
// an already-inserted `programId`/`slotId` when given (so a caller can build
// two attempts — e.g. baseline A then B — on the SAME program, the shape
// D33's auto-activation tests need).
// ---------------------------------------------------------------------------

function slotIdFor(slots: SlotSetIds, phase: BenchmarkPhase, label: SlotLabel): string {
  if (phase === 'baseline') return label === 'A' ? slots.baselineA : slots.baselineB
  if (phase === 'final') return label === 'A' ? slots.finalA : slots.finalB
  const id = label === 'A' ? slots.midpointA : slots.midpointB
  if (id === undefined) {
    throw new Error('slotIdFor: midpoint slots were not inserted for this program')
  }
  return id
}

export interface FinalizableBenchmarkOverrides {
  /** Reuse an already-inserted program (e.g. to finalize baseline A then B on the same one) rather than creating a fresh one. */
  readonly programId?: string
  /** Reuse an already-inserted slot rather than deriving one from `phase`/`label`. */
  readonly slotId?: string
  readonly phase?: BenchmarkPhase
  readonly label?: SlotLabel
  /** Defaults to `true` — a complete 20-minute interval. */
  readonly completeInterval?: boolean
  /** Whether to lock recall (via the real `POST /sessions/{id}/recall` route) before returning. Defaults to `true`. */
  readonly lockRecall?: boolean
  readonly tz?: string
}

export interface FinalizableBenchmarkResult {
  readonly programId: string
  readonly slotId: string
  readonly sessionId: string
  readonly endedAt: Date
}

async function resolveProgramAndSlot(
  db: AppDatabase,
  overrides: Pick<FinalizableBenchmarkOverrides, 'programId' | 'slotId' | 'phase' | 'label' | 'tz'>,
): Promise<{ programId: string; slotId: string }> {
  const phase = overrides.phase ?? 'baseline'
  const label = overrides.label ?? 'A'

  let programId = overrides.programId
  if (programId === undefined) {
    const inserted = await insertProgram(db, {
      baselineDate: '2026-09-06',
      timezone: overrides.tz ?? 'UTC',
      status: 'active',
      practiceTargetSeconds: 600,
    })
    programId = inserted.programId
  }

  let slotId = overrides.slotId
  if (slotId === undefined) {
    const slots = await insertSlotSet(db, programId)
    slotId = slotIdFor(slots, phase, label)
  }

  return { programId, slotId }
}

/**
 * A benchmark attempt seeded straight into `awaiting_review` — already
 * ended, `complete_interval` set as asked, and (by default) recall already
 * locked through the real `/recall` route — so a 5.8.3 test can call
 * `finalizeSession` against it directly. Pass `lockRecall: false` for the
 * "complete interval, recall never locked" fixtures the D25 gate tests need.
 */
export async function finalizableBenchmark(
  db: AppDatabase,
  app: FastifyInstance,
  overrides: FinalizableBenchmarkOverrides = {},
): Promise<FinalizableBenchmarkResult> {
  const completeInterval = overrides.completeInterval ?? true
  const { programId, slotId } = await resolveProgramAndSlot(db, overrides)

  const startedAt = new Date(Date.now() - 21 * 60_000)
  const endedAt = completeInterval
    ? new Date(startedAt.getTime() + 20 * 60_000)
    : new Date(startedAt.getTime() + 14 * 60_000)

  const { sessionId } = await seedSession(db, {
    programId,
    kind: 'benchmark',
    slotId,
    lifecycle: 'awaiting_review',
    startedAt,
    endedAt,
    targetSeconds: 1200,
    completeInterval,
  })

  const shouldLockRecall = overrides.lockRecall ?? true
  if (shouldLockRecall) {
    const res = await lockRecall(app, sessionId, {
      startedAt: new Date(endedAt.getTime() + 5_000).toISOString(),
    })
    if (res.statusCode !== 200) {
      throw new Error(`finalizableBenchmark: lockRecall failed with status ${res.statusCode}`)
    }
  }

  return { programId, slotId, sessionId, endedAt }
}

/**
 * A benchmark attempt stopped early (`complete_interval: false`) and never
 * offered recall at all — the D25 "incomplete, no recall step attempted"
 * fixture. No `app` parameter: unlike `finalizableBenchmark`, this one never
 * calls the recall route.
 */
export async function finalizableIncompleteBenchmark(
  db: AppDatabase,
  overrides: Pick<FinalizableBenchmarkOverrides, 'programId' | 'slotId' | 'phase' | 'label' | 'tz'> = {},
): Promise<FinalizableBenchmarkResult> {
  const { programId, slotId } = await resolveProgramAndSlot(db, overrides)

  // `endedAt` sits 30 s in the past (never exactly "now") so a caller who
  // locks recall afterwards with `startedAt: endedAt + a few seconds` (the
  // convention every other fixture/test in this file uses) still lands
  // safely before the real `now` the recall route checks against — not a
  // few seconds ahead of it, which `assertRecallLockedForFinalize`'s sibling
  // route rejects as 422 `recall_before_interval_end`.
  const startedAt = new Date(Date.now() - 14 * 60_000 - 30_000)
  const endedAt = new Date(Date.now() - 30_000)

  const { sessionId } = await seedSession(db, {
    programId,
    kind: 'benchmark',
    slotId,
    lifecycle: 'awaiting_review',
    startedAt,
    endedAt,
    targetSeconds: 1200,
    completeInterval: false,
  })

  return { programId, slotId, sessionId, endedAt }
}

// ---------------------------------------------------------------------------
// postAmendment (task 5.9.1) — exercises the real
// `POST /sessions/{id}/amendments` route through `app.inject`, mirroring
// `lockRecall`/`finalizeSession` above (D16): no `Idempotency-Key` header
// (the route carries none). Returns the raw status code and parsed body
// rather than throwing on a non-2xx response, so a caller testing a
// rejection path can assert on it directly.
// ---------------------------------------------------------------------------

export interface PostAmendmentInput {
  readonly reason: string
  readonly excludeFromReport: boolean
}

export interface PostAmendmentResult {
  readonly statusCode: number
  readonly body: unknown
}

export async function postAmendment(
  app: FastifyInstance,
  sessionId: string,
  input: PostAmendmentInput,
): Promise<PostAmendmentResult> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/amendments`,
    payload: { reason: input.reason, excludeFromReport: input.excludeFromReport },
  })

  return { statusCode: res.statusCode, body: res.json() }
}
