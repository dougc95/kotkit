/**
 * DB-level seed helpers for the Programs API tests and everything after it
 * (design.md D16: 4.1.1 program seed helpers, 5.1.3 extends these with
 * event/amendment/plan seeds rather than re-creating them). Built directly on
 * `buildTestApp`/`truncateAll` (3.2.1) — this file never builds an app,
 * truncates a table or seeds the principal profile itself; `truncateAll`
 * already re-seeds the fixed `local-demo` row (3.2.3's
 * `ensurePrincipalProfile`) after every truncation.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type {
  CountMethod,
  FeedDevice,
  FeedSource,
  LocalDate,
  MeasurementScope,
  ObservedConditionsValue,
  OutputQuality,
  ProgramResponseValue,
  ProgramStatus,
  Realm,
  ReportedCount,
  RevisionResponseValue,
  SessionKind,
  SessionLifecycle,
} from '@attention-lab/shared'
import { addDays, localDateAt, localDateForProgramDay } from '@attention-lab/shared'

import type { AppDatabase } from '../../src/plugins/db.js'
import { LOCAL_DEMO_PRINCIPAL_ID } from '../../src/plugins/identity.js'
import { DEFAULT_PREFERENCES } from '../../src/preferences.js'
import {
  benchmarkSlots,
  dailyCheckins,
  feedUsage,
  focusSessions,
  programs,
  protocolRevisions,
  sessionReviews,
  userProfiles,
} from '../../src/db/schema/index.js'
import { INITIAL_REVISION, initialRevisionSettings } from '../../src/services/program/programService.js'

const OTHER_PRINCIPAL_ID = 'someone-else'

// ---------------------------------------------------------------------------
// insertProgram
// ---------------------------------------------------------------------------

export interface InsertProgramInput {
  readonly baselineDate: LocalDate
  readonly timezone: string
  readonly status: ProgramStatus
  readonly practiceTargetSeconds: number
  readonly leisureAllowanceMin?: number
  readonly feedEstimateMin?: ReportedCount
  readonly userId?: string
  readonly realm?: Realm
}

export interface InsertProgramResult {
  readonly programId: string
  readonly revisionId: string
}

/** Inserts a `programs` row plus its revision 1 (per `INITIAL_REVISION`) and sets `current_revision_id`. */
export async function insertProgram(
  db: AppDatabase,
  input: InsertProgramInput,
): Promise<InsertProgramResult> {
  const userId = input.userId ?? LOCAL_DEMO_PRINCIPAL_ID
  const realm: Realm = input.realm ?? 'demo'
  const leisureAllowanceMin = input.leisureAllowanceMin ?? 20

  const [program] = await db
    .insert(programs)
    .values({
      userId,
      realm,
      baselineDate: input.baselineDate,
      timezone: input.timezone,
      status: input.status,
      leisureAllowanceMin,
      feedEstimateMin: input.feedEstimateMin ?? null,
    })
    .returning()
  if (!program) {
    throw new Error('insertProgram: programs insert returned no row')
  }

  const [revision] = await db
    .insert(protocolRevisions)
    .values({
      programId: program.id,
      revision: INITIAL_REVISION.revision,
      effectiveDay: INITIAL_REVISION.effectiveDay,
      settings: initialRevisionSettings(input.practiceTargetSeconds, leisureAllowanceMin),
      reason: INITIAL_REVISION.reason,
    })
    .returning()
  if (!revision) {
    throw new Error('insertProgram: protocol_revisions insert returned no row')
  }

  await db
    .update(programs)
    .set({ currentRevisionId: revision.id })
    .where(eq(programs.id, program.id))

  return { programId: program.id, revisionId: revision.id }
}

// ---------------------------------------------------------------------------
// insertSlotSet
// ---------------------------------------------------------------------------

export interface InsertSlotSetOverrides {
  /** Also inserts the (allowed but normally unused) midpoint A/B pair at Day 7. */
  readonly includeMidpoint?: boolean
  readonly materialRef?: string
}

export interface SlotSetIds {
  readonly baselineA: string
  readonly baselineB: string
  readonly finalA: string
  readonly finalB: string
  readonly midpointA?: string
  readonly midpointB?: string
}

/**
 * Inserts the four required `benchmark_slots` rows (baseline A/B at Day 0,
 * final A/B at Day 14), and the midpoint A/B pair at Day 7 when asked, for an
 * already-inserted program. `assignedLocalDate` is derived from the
 * program's own stored `baselineDate` via `localDateForProgramDay` — never
 * recomputed by the caller.
 */
export async function insertSlotSet(
  db: AppDatabase,
  programId: string,
  overrides: InsertSlotSetOverrides = {},
): Promise<SlotSetIds> {
  const [program] = await db
    .select({ baselineDate: programs.baselineDate })
    .from(programs)
    .where(eq(programs.id, programId))
    .limit(1)
  if (!program) {
    throw new Error(`insertSlotSet: no program ${programId}`)
  }
  const baselineDate = program.baselineDate

  const plan: ReadonlyArray<{ key: keyof SlotSetIds; phase: 'baseline' | 'midpoint' | 'final'; label: 'A' | 'B'; day: number }> = [
    { key: 'baselineA', phase: 'baseline', label: 'A', day: 0 },
    { key: 'baselineB', phase: 'baseline', label: 'B', day: 0 },
    { key: 'finalA', phase: 'final', label: 'A', day: 14 },
    { key: 'finalB', phase: 'final', label: 'B', day: 14 },
    ...(overrides.includeMidpoint
      ? ([
          { key: 'midpointA', phase: 'midpoint', label: 'A', day: 7 },
          { key: 'midpointB', phase: 'midpoint', label: 'B', day: 7 },
        ] as const)
      : []),
  ]

  const ids: Record<string, string> = {}
  for (const item of plan) {
    const [row] = await db
      .insert(benchmarkSlots)
      .values({
        programId,
        phase: item.phase,
        label: item.label,
        materialRef: overrides.materialRef ?? `${item.phase} ${item.label} material`,
        assignedLocalDate: localDateForProgramDay(baselineDate, item.day),
      })
      .returning()
    if (!row) {
      throw new Error(`insertSlotSet: insert returned no row for ${item.phase} ${item.label}`)
    }
    ids[item.key] = row.id
  }

  return ids as unknown as SlotSetIds
}

// ---------------------------------------------------------------------------
// insertSession
// ---------------------------------------------------------------------------

export interface InsertSessionReviewInput {
  readonly episodeCount?: ReportedCount
  readonly outputQuality?: OutputQuality
  readonly countMethod?: CountMethod
}

export interface InsertSessionInput {
  readonly programId: string
  readonly kind: SessionKind
  readonly slotId?: string
  readonly lifecycle: SessionLifecycle
  readonly localDate: LocalDate
  readonly startedAt: Date
  readonly endedAt?: Date
  readonly targetSeconds: number
  readonly pausedSeconds?: number
  readonly completeInterval?: boolean | null
  readonly realm?: Realm
  readonly review?: InsertSessionReviewInput
}

export interface InsertSessionResult {
  readonly sessionId: string
}

const EMPTY_OBSERVED_CONDITIONS: ObservedConditionsValue = {
  deviceFormat: null,
  language: null,
  materialLevel: null,
  accommodations: [],
}

/**
 * Inserts one `focus_sessions` row plus its always-present `session_reviews`
 * row (D31). `userId` and `revisionId` are never caller-supplied — they are
 * read off the program itself (`revisionId` = the program's
 * `current_revision_id`), so a session always belongs to its program's own
 * owner and governing revision. `observedConditions` defaults from the
 * slot's own fields for a benchmark session, or the empty
 * `ObservedConditions` otherwise (D31) — never invented. A blank
 * `review.episodeCount` (or no `review` at all) stores SQL NULL, never `0`;
 * an explicit `0` stores `0` (D7.1).
 */
export async function insertSession(
  db: AppDatabase,
  input: InsertSessionInput,
): Promise<InsertSessionResult> {
  const [program] = await db
    .select({ userId: programs.userId, currentRevisionId: programs.currentRevisionId })
    .from(programs)
    .where(eq(programs.id, input.programId))
    .limit(1)
  if (!program) {
    throw new Error(`insertSession: no program ${input.programId}`)
  }
  if (program.currentRevisionId === null) {
    throw new Error(`insertSession: program ${input.programId} has no current_revision_id`)
  }

  let observedConditions: ObservedConditionsValue = EMPTY_OBSERVED_CONDITIONS
  if (input.kind === 'benchmark' && input.slotId !== undefined) {
    const [slot] = await db
      .select({
        deviceFormat: benchmarkSlots.deviceFormat,
        language: benchmarkSlots.language,
        materialLevel: benchmarkSlots.materialLevel,
      })
      .from(benchmarkSlots)
      .where(eq(benchmarkSlots.id, input.slotId))
      .limit(1)
    if (slot) {
      observedConditions = {
        deviceFormat: slot.deviceFormat,
        language: slot.language,
        materialLevel: slot.materialLevel,
        accommodations: [],
      }
    }
  }

  const [session] = await db
    .insert(focusSessions)
    .values({
      userId: program.userId,
      programId: input.programId,
      revisionId: program.currentRevisionId,
      slotId: input.slotId ?? null,
      realm: input.realm ?? 'demo',
      kind: input.kind,
      lifecycle: input.lifecycle,
      targetSeconds: input.targetSeconds,
      startedAt: input.startedAt,
      endedAt: input.endedAt ?? null,
      pausedSeconds: input.pausedSeconds ?? 0,
      localDate: input.localDate,
      timeSource: 'measured',
      timerQuality: 'ok',
      completeInterval: input.completeInterval ?? null,
    })
    .returning()
  if (!session) {
    throw new Error('insertSession: focus_sessions insert returned no row')
  }

  await db.insert(sessionReviews).values({
    sessionId: session.id,
    episodeCount: input.review?.episodeCount ?? null,
    outputQuality: input.review?.outputQuality ?? null,
    countMethod: input.review?.countMethod ?? null,
    observedConditions,
    finalizedAt: input.lifecycle === 'finalized' ? (input.endedAt ?? null) : null,
  })

  return { sessionId: session.id }
}

// ---------------------------------------------------------------------------
// seedActiveProgram
// ---------------------------------------------------------------------------

export interface SeedActiveProgramInput {
  readonly day: number
  readonly tz?: string
  readonly practiceTargetSeconds?: number
}

export interface SeedActiveProgramResult {
  readonly programId: string
  readonly revisionId: string
  readonly slots: SlotSetIds
  readonly baselineSessionIds: readonly [string, string]
}

/**
 * A program at Day `day`: `status: 'active'`, its four slots, and one
 * finalized benchmark attempt per baseline slot with `local_date` = Day 0 —
 * the minimum fixture most later report/eligibility tests build on.
 */
export async function seedActiveProgram(
  db: AppDatabase,
  input: SeedActiveProgramInput,
): Promise<SeedActiveProgramResult> {
  const tz = input.tz ?? 'UTC'
  const today = localDateAt(new Date(), tz)
  const baselineDate = addDays(today, -input.day)

  const { programId, revisionId } = await insertProgram(db, {
    baselineDate,
    timezone: tz,
    status: 'active',
    practiceTargetSeconds: input.practiceTargetSeconds ?? 600,
  })

  const slots = await insertSlotSet(db, programId)

  const dayZeroDate = localDateForProgramDay(baselineDate, 0)

  const { sessionId: baselineA } = await insertSession(db, {
    programId,
    kind: 'benchmark',
    slotId: slots.baselineA,
    lifecycle: 'finalized',
    localDate: dayZeroDate,
    startedAt: new Date(`${dayZeroDate}T09:00:00.000Z`),
    endedAt: new Date(`${dayZeroDate}T09:20:00.000Z`),
    targetSeconds: 1200,
    completeInterval: true,
  })
  const { sessionId: baselineB } = await insertSession(db, {
    programId,
    kind: 'benchmark',
    slotId: slots.baselineB,
    lifecycle: 'finalized',
    localDate: dayZeroDate,
    startedAt: new Date(`${dayZeroDate}T09:30:00.000Z`),
    endedAt: new Date(`${dayZeroDate}T09:50:00.000Z`),
    targetSeconds: 1200,
    completeInterval: true,
  })

  return { programId, revisionId, slots, baselineSessionIds: [baselineA, baselineB] }
}

// ---------------------------------------------------------------------------
// Small standalone helpers
// ---------------------------------------------------------------------------

/** `today (in tz) - n` calendar days — the `baselineDate` for a program `n` days old. */
export function baselineDateDaysAgo(n: number, tz: string): LocalDate {
  const today = localDateAt(new Date(), tz)
  return addDays(today, -n)
}

/** Writes `user_profiles.demo_clock_offset_seconds` directly for the fixed `local-demo` principal (D8). */
export async function setDemoOffsetSeconds(db: AppDatabase, seconds: number): Promise<void> {
  await db
    .update(userProfiles)
    .set({ demoClockOffsetSeconds: seconds })
    .where(eq(userProfiles.id, LOCAL_DEMO_PRINCIPAL_ID))
}

/** Sets the demo clock so `realNow + offset` lands on `isoInstant`, rounded to the nearest second. */
export async function setDemoNow(db: AppDatabase, isoInstant: string): Promise<void> {
  const offsetSeconds = Math.round((new Date(isoInstant).getTime() - Date.now()) / 1000)
  await setDemoOffsetSeconds(db, offsetSeconds)
}

export interface InsertOtherPrincipalProgramResult {
  readonly userId: string
  readonly programId: string
  readonly revisionId: string
}

/**
 * A second principal (`user_id` 'someone-else', its own `user_profiles`
 * row) with one open program — the fixture `loadOwnedProgram`'s ownership
 * tests load against to prove another principal's row is invisible, not a
 * 403.
 */
export async function insertOtherPrincipalProgram(
  db: AppDatabase,
): Promise<InsertOtherPrincipalProgramResult> {
  await db
    .insert(userProfiles)
    .values({ id: OTHER_PRINCIPAL_ID, timezone: 'UTC', preferences: DEFAULT_PREFERENCES })
    .onConflictDoNothing({ target: userProfiles.id })

  const { programId, revisionId } = await insertProgram(db, {
    baselineDate: '2026-09-06',
    timezone: 'UTC',
    status: 'draft',
    practiceTargetSeconds: 600,
    userId: OTHER_PRINCIPAL_ID,
  })

  return { userId: OTHER_PRINCIPAL_ID, programId, revisionId }
}

// ---------------------------------------------------------------------------
// insertCheckin
// ---------------------------------------------------------------------------

export interface InsertCheckinFeedRowInput {
  readonly device: FeedDevice
  readonly platform: string
  readonly minutes: number
  readonly measurementScope: MeasurementScope
  readonly source?: FeedSource
}

export interface InsertCheckinInput {
  readonly programId: string
  readonly localDate: LocalDate
  readonly sleepMinutes?: ReportedCount
  readonly feed?: readonly InsertCheckinFeedRowInput[]
}

export interface InsertCheckinResult {
  readonly checkinId: string
}

/** Inserts one `daily_checkins` row (`realm` inherited from its program) plus any `feed_usage` rows given. */
export async function insertCheckin(
  db: AppDatabase,
  input: InsertCheckinInput,
): Promise<InsertCheckinResult> {
  const [program] = await db
    .select({ realm: programs.realm })
    .from(programs)
    .where(eq(programs.id, input.programId))
    .limit(1)
  if (!program) {
    throw new Error(`insertCheckin: no program ${input.programId}`)
  }

  const [checkin] = await db
    .insert(dailyCheckins)
    .values({
      programId: input.programId,
      realm: program.realm,
      localDate: input.localDate,
      sleepMinutes: input.sleepMinutes ?? null,
    })
    .returning()
  if (!checkin) {
    throw new Error('insertCheckin: daily_checkins insert returned no row')
  }

  if (input.feed !== undefined && input.feed.length > 0) {
    await db.insert(feedUsage).values(
      input.feed.map((row) => ({
        checkinId: checkin.id,
        device: row.device,
        platform: row.platform,
        minutes: row.minutes,
        measurementScope: row.measurementScope,
        source: row.source ?? 'estimate',
      })),
    )
  }

  return { checkinId: checkin.id }
}

// ---------------------------------------------------------------------------
// createProgramViaApi (4.1.2)
// ---------------------------------------------------------------------------

export interface CreateProgramViaApiOverrides {
  readonly baselineDate?: LocalDate
  readonly timezone?: string
  readonly practiceTargetSeconds?: number
  readonly leisureAllowanceMinutes?: number
  readonly feedEstimateMinutes?: ReportedCount
}

export interface CreateProgramViaApiResult {
  readonly statusCode: number
  readonly body: { program: ProgramResponseValue; revision: RevisionResponseValue }
}

/**
 * Exercises the real `POST /programs` route (4.1.2) through `app.inject`
 * rather than seeding rows directly — for a test in this or a later group
 * that wants a genuine program created through the HTTP/idempotency layer
 * without re-typing the request body and header each time. Every field has a
 * default that passes `CreateProgramBody` as-is; a fresh `Idempotency-Key` is
 * generated per call unless the caller supplies one (to exercise replay).
 * Returns the raw status code and parsed body rather than throwing on a
 * non-2xx response, so a caller testing a rejection path (a bad timezone, a
 * missing header, ...) can assert on it directly.
 */
export async function createProgramViaApi(
  app: FastifyInstance,
  overrides: CreateProgramViaApiOverrides = {},
  idempotencyKey?: string,
): Promise<CreateProgramViaApiResult> {
  const payload: Record<string, unknown> = {
    baselineDate: overrides.baselineDate ?? '2026-09-06',
    timezone: overrides.timezone ?? 'UTC',
    practiceTargetSeconds: overrides.practiceTargetSeconds ?? 600,
  }
  if (overrides.leisureAllowanceMinutes !== undefined) {
    payload.leisureAllowanceMinutes = overrides.leisureAllowanceMinutes
  }
  if (overrides.feedEstimateMinutes !== undefined) {
    payload.feedEstimateMinutes = overrides.feedEstimateMinutes
  }

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/programs',
    headers: { 'idempotency-key': idempotencyKey ?? randomUUID() },
    payload,
  })

  return { statusCode: res.statusCode, body: res.json() }
}
