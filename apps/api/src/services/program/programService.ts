/**
 * Program service base (design.md D33, D34; task 4.1.1): the owned-row
 * loader every `/programs/{id}` route builds on, the governing-revision
 * rule, revision-1 construction, the DTO mappers for `programs` /
 * `protocol_revisions` / `benchmark_slots`, and the one Postgres
 * constraint-violation mapper this group needs. Routes themselves (create,
 * slots, revisions, today, ...) arrive in 4.1.2 and later.
 */
import { randomUUID } from 'node:crypto'
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import {
  DEFAULT_BAND_CEILINGS,
  checkinStatus,
  currentProgramDay,
  localDateForProgramDay,
  type LocalDate,
} from '@attention-lab/shared'
import type {
  CreateProgramBodyValue,
  CurrentProgramResponseValue,
  FeedRowInput,
  NextActionValue,
  OutputQuality,
  ProgramResponseValue,
  ProgramStatus,
  PutSlotsBodyValue,
  Realm,
  RevisionResponseValue,
  SessionKind,
  SessionLifecycle,
  SlotAttemptValue,
  SlotResponseValue,
  TodayResponseValue,
} from '@attention-lab/shared'

import type { AppDatabase } from '../../plugins/db.js'
import { assertOwnRealm, type RequestContext } from '../../plugins/identity.js'
import { ConflictError, DomainError, NotFoundError } from '../../errors.js'
import { requestHash } from '../../idempotency/requestHash.js'
import { withIdempotency, type AppTransaction } from '../../idempotency/withIdempotency.js'
import { programs } from '../../db/schema/programs.js'
import { protocolRevisions, type ProtocolRevisionSettings } from '../../db/schema/protocolRevisions.js'
import { benchmarkSlots } from '../../db/schema/benchmarkSlots.js'
import { focusSessions } from '../../db/schema/focusSessions.js'
import { sessionReviews } from '../../db/schema/sessionReviews.js'
import { sessionAmendments } from '../../db/schema/sessionAmendments.js'
import { dailyCheckins } from '../../db/schema/dailyCheckins.js'
import { feedUsage } from '../../db/schema/feedUsage.js'
import { frozenFieldsUnchanged, isFrozen, normalizeSlotSet, type MissingSlot } from './readiness.js'
import { deriveBlocks, type Block, type BlockSessionInput } from './blocks.js'
import { deriveNextAction, type SlotState } from './nextAction.js'
import { deriveSuggestion, type SuggestionRow } from './suggestion.js'
import { checkinValuesFrom, toTodayResponse } from './today.js'

// ---------------------------------------------------------------------------
// Owned-row loader
// ---------------------------------------------------------------------------

export interface LoadOwnedProgramOptions {
  /** Adds `FOR UPDATE` — a mutating route locks the row before writing it. */
  readonly forUpdate?: boolean
}

export type ProgramRow = typeof programs.$inferSelect

/**
 * Loads a `programs` row by id, scoped to `ctx.principalId`. A row that
 * genuinely does not exist AND a row that belongs to a different principal
 * are indistinguishable here — the `WHERE user_id = ctx.principalId` clause
 * already excludes the latter, so both surface as the same `NotFoundError`
 * (404, never 403; identity-realm "Every resource is scoped to its owner").
 * A row that IS this principal's own but carries a foreign realm (only
 * reachable by directly mutating the row, since nothing in this codebase
 * ever writes a 'pilot' row while running in local-demo mode) is rejected
 * with `DomainError('realm_mismatch')` (422) via `assertOwnRealm` rather
 * than silently filtered.
 */
export async function loadOwnedProgram(
  db: AppDatabase | AppTransaction,
  ctx: RequestContext,
  programId: string,
  options: LoadOwnedProgramOptions = {},
): Promise<ProgramRow> {
  const whereClause = and(eq(programs.id, programId), eq(programs.userId, ctx.principalId))

  const rows = options.forUpdate
    ? await db.select().from(programs).where(whereClause).limit(1).for('update')
    : await db.select().from(programs).where(whereClause).limit(1)

  const row = rows[0]
  if (row === undefined) {
    throw new NotFoundError()
  }

  assertOwnRealm(ctx, row.realm)

  return row
}

// ---------------------------------------------------------------------------
// Governing revision (D33)
// ---------------------------------------------------------------------------

/** The subset of a `protocol_revisions` row `governingRevisionFor` needs. */
export interface GoverningRevisionCandidate {
  readonly revision: number
  readonly effectiveDay: number
}

/**
 * The revision that governs `day`: the greatest `effectiveDay <= max(day, 0)`,
 * ties broken by the highest `revision` number. Clamping `day` at 0 means a
 * day before Day 0 is governed by revision 1 (D33) rather than throwing or
 * returning nothing. Throws only if `revisions` has no candidate at all with
 * `effectiveDay <= max(day, 0)` — which cannot happen once revision 1
 * (`effectiveDay: 0`) has been inserted, since every program always has one.
 */
export function governingRevisionFor<T extends GoverningRevisionCandidate>(
  revisions: readonly T[],
  day: number,
): T {
  const clampedDay = Math.max(day, 0)
  let best: T | undefined
  for (const candidate of revisions) {
    if (candidate.effectiveDay > clampedDay) continue
    if (
      best === undefined ||
      candidate.effectiveDay > best.effectiveDay ||
      (candidate.effectiveDay === best.effectiveDay && candidate.revision > best.revision)
    ) {
      best = candidate
    }
  }
  if (best === undefined) {
    throw new RangeError(
      `governingRevisionFor: no revision has effectiveDay <= ${clampedDay} (day ${day})`,
    )
  }
  return best
}

// ---------------------------------------------------------------------------
// One open program per user (task 4.1.3; D33; 3.3.1's partial unique index)
// ---------------------------------------------------------------------------

/** The three non-terminal statuses that block a second program for the same user (3.3.1's partial unique index). */
export const OPEN_PROGRAM_STATUSES = [
  'draft',
  'baseline_ready',
  'active',
] as const satisfies readonly ProgramStatus[]

/** True for 'draft' | 'baseline_ready' | 'active'; false for 'completed' | 'archived' (which never block creation). */
export function isOpenStatus(status: ProgramStatus): boolean {
  return (OPEN_PROGRAM_STATUSES as readonly ProgramStatus[]).includes(status)
}

// ---------------------------------------------------------------------------
// Revision 1 construction (D33)
// ---------------------------------------------------------------------------

/** The fixed shape of revision 1, created inside the same transaction as its `programs` row. */
export const INITIAL_REVISION = {
  revision: 1,
  effectiveDay: 0,
  reason: 'initial plan',
} as const

/**
 * `settings.bandCeilings` is always the protocol's `DEFAULT_BAND_CEILINGS` —
 * this is the exact value the design doc says must be kept in sync by hand
 * with `packages/shared/src/domain/progression.ts` if either ever changes.
 */
export function initialRevisionSettings(
  practiceTargetSeconds: number,
  leisureAllowanceMin: number,
): ProtocolRevisionSettings {
  return {
    practiceTargetSeconds,
    bandCeilings: DEFAULT_BAND_CEILINGS,
    leisureAllowanceMin,
  }
}

// ---------------------------------------------------------------------------
// DTO mappers (2.7.3 contract shapes)
// ---------------------------------------------------------------------------

/**
 * Maps a `programs` row to the wire `ProgramResponse` shape. `feedEstimateMin`
 * NULL becomes `null`, never omitted and never `0` (D7.1); the output never
 * carries `userId`/`user_id` (identity-realm "Client cannot choose the
 * realm" — the same discipline applies to never disclosing it either).
 * Throws if `currentRevisionId` is NULL: every caller of this mapper only
 * ever sees a program after the same transaction that creates revision 1 and
 * sets this column has committed, so a NULL here is a server bug, not a
 * state to render.
 */
export function toProgramDto(row: ProgramRow): ProgramResponseValue {
  if (row.currentRevisionId === null) {
    throw new Error(`toProgramDto: programs.${row.id} has no current_revision_id set`)
  }
  return {
    id: row.id,
    realm: row.realm,
    status: row.status,
    baselineDate: row.baselineDate,
    timezone: row.timezone,
    leisureAllowanceMinutes: row.leisureAllowanceMin,
    feedEstimateMinutes: row.feedEstimateMin,
    currentRevisionId: row.currentRevisionId,
    version: row.version,
  }
}

export type RevisionRow = typeof protocolRevisions.$inferSelect

/** Maps a `protocol_revisions` row to the wire `RevisionResponse` shape. */
export function toRevisionDto(row: RevisionRow): RevisionResponseValue {
  return {
    id: row.id,
    revision: row.revision,
    effectiveDay: row.effectiveDay,
    settings: {
      practiceTargetSeconds: row.settings.practiceTargetSeconds,
      bandCeilings: row.settings.bandCeilings.map((band) => ({ ...band })),
      leisureAllowanceMin: row.settings.leisureAllowanceMin,
    },
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  }
}

export type SlotRow = typeof benchmarkSlots.$inferSelect

/**
 * Maps one `benchmark_slots` row plus its already-built attempt summaries
 * (D22: `{ sessionId, lifecycle, eligible, excludedByAmendment }`, `eligible`
 * the stored value — `null` until finalized) to the wire `SlotResponse`
 * shape. `plannedLocalTime` NULL -> `null`; `frozenAt` -> an ISO string or
 * `null`.
 */
export function toSlotDto(row: SlotRow, attempts: readonly SlotAttemptValue[]): SlotResponseValue {
  return {
    id: row.id,
    phase: row.phase,
    label: row.label,
    materialRef: row.materialRef,
    language: row.language,
    deviceFormat: row.deviceFormat,
    materialLevel: row.materialLevel,
    plannedLocalTime: row.plannedLocalTime,
    assignedLocalDate: row.assignedLocalDate,
    frozenAt: row.frozenAt === null ? null : row.frozenAt.toISOString(),
    attempts: attempts.map((attempt) => ({ ...attempt })),
  }
}

// ---------------------------------------------------------------------------
// Postgres error mapping
// ---------------------------------------------------------------------------

/**
 * Exported (task 5.1.1) so `services/session.ts`'s own insert-time race
 * backstop (`focus_sessions_one_active_per_user`, mirroring this module's
 * `programs_one_open_per_user` handling below) can reuse the exact same
 * Drizzle/postgres-js error-unwrapping instead of duplicating it — D16, one
 * owner per shared piece.
 */
export interface PgErrorLike {
  readonly code: string
  readonly constraintName: string | undefined
}

/**
 * Unwraps a Postgres SQLSTATE and constraint name from `err`, checking the
 * error itself first and then, one level down, `.cause` — Drizzle wraps
 * every driver error in its own `DrizzleQueryError`, whose own `.code` is
 * undefined; the real `postgres-js` `PostgresError`, with `.code` and
 * `.constraint_name`, lives at `.cause` (same unwrapping `errors.ts`'s
 * `extractSqlstate` uses for the log sanitizer).
 */
export function extractPgError(err: unknown): PgErrorLike | undefined {
  if (err !== null && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      const constraintName = (err as { constraint_name?: unknown }).constraint_name
      return { code, constraintName: typeof constraintName === 'string' ? constraintName : undefined }
    }
  }
  if (err instanceof Error && err.cause !== undefined) {
    return extractPgError(err.cause)
  }
  return undefined
}

/**
 * Turns the one Postgres constraint violation this group's writes can hit
 * (`23505` on `programs_one_open_per_user`, 3.3.1) into `ConflictError`
 * `program_exists` (409; D19). Every other error — a different constraint, a
 * different SQLSTATE, or anything that isn't a Postgres error at all — is
 * rethrown completely unchanged (same reference), never wrapped or altered:
 * 4.1.3 relies on catching this exact rethrow to decide whether to re-query
 * and attach `details`.
 */
export function mapPgError(err: unknown): never {
  const pgError = extractPgError(err)
  if (pgError?.code === '23505' && pgError.constraintName === 'programs_one_open_per_user') {
    throw new ConflictError('program_exists', 'A program is already open.')
  }
  throw err
}

// ---------------------------------------------------------------------------
// POST /programs (task 4.1.2)
// ---------------------------------------------------------------------------

/**
 * The exact row `createProgram` inserts into `programs`. `id` is generated
 * by the caller (not left to the column's `defaultRandom()`) so this stays a
 * pure function the unit tests can call without a database.
 */
export interface ProgramInsertRow {
  readonly id: string
  readonly userId: string
  readonly realm: Realm
  readonly baselineDate: string
  readonly timezone: string
  readonly status: 'draft'
  readonly leisureAllowanceMin: number
  readonly feedEstimateMin: number | null
  readonly version: number
}

/**
 * Pure: the `programs` insert row for a brand-new program. `userId` and
 * `realm` always come from `ctx`, never from `body` — even a caller that
 * hands in a `body` object carrying extra `realm`/`userId` keys (the wire
 * schema's `additionalProperties: false` would already reject those before
 * this ever runs) has them ignored here, never read (identity-realm "Client
 * cannot choose the realm"). `leisureAllowanceMinutes` omitted -> 20 (a goal
 * default, never a measurement); `feedEstimateMinutes` omitted -> `null`
 * ("not reported"), and an explicit `0` survives as `0` distinct from `null`
 * (D7.1 — unknown != zero).
 */
export function buildProgramInsert(
  ctx: Pick<RequestContext, 'principalId' | 'realm'>,
  body: CreateProgramBodyValue,
  id: string,
): ProgramInsertRow {
  return {
    id,
    userId: ctx.principalId,
    realm: ctx.realm,
    baselineDate: body.baselineDate,
    timezone: body.timezone,
    status: 'draft',
    leisureAllowanceMin: body.leisureAllowanceMinutes ?? 20,
    feedEstimateMin: body.feedEstimateMinutes ?? null,
    version: 1,
  }
}

/** The exact row `createProgram` inserts into `protocol_revisions` for revision 1. */
export interface InitialRevisionInsertRow {
  readonly programId: string
  readonly revision: number
  readonly effectiveDay: number
  readonly settings: ProtocolRevisionSettings
  readonly reason: string
}

/**
 * Pure: the revision-1 insert row, assembled from `INITIAL_REVISION` (D33)
 * and `initialRevisionSettings` (4.1.1) — the same two pieces
 * `test/helpers/programs.ts`'s `insertProgram` already combines by hand for
 * seeded fixtures, kept in exact sync here for the real create route.
 */
export function buildInitialRevisionInsert(
  programId: string,
  body: Pick<CreateProgramBodyValue, 'practiceTargetSeconds'>,
  leisureAllowanceMin: number,
): InitialRevisionInsertRow {
  return {
    programId,
    revision: INITIAL_REVISION.revision,
    effectiveDay: INITIAL_REVISION.effectiveDay,
    settings: initialRevisionSettings(body.practiceTargetSeconds, leisureAllowanceMin),
    reason: INITIAL_REVISION.reason,
  }
}

export interface CreateProgramResult {
  /** `true` when a live idempotency receipt served this response instead of a fresh write (D21: 200, not 201). */
  readonly replayed: boolean
  readonly program: ProgramResponseValue
  readonly revision: RevisionResponseValue
}

/** The D18 `details` payload for a `program_exists` conflict (task 4.1.3). */
export interface ProgramExistsDetails {
  readonly existingProgramId: string
  readonly existingStatus: ProgramStatus
}

/**
 * Re-reads `userId`'s own open (non-terminal) program to fill a
 * `program_exists` conflict's `details`. Used twice: the pre-check in
 * `createProgram` reads the row itself (no extra query needed to build
 * `details`), and the `23505` race path below — where the pre-check found
 * nothing but another concurrent transaction committed one first — calls
 * this to fill `details` after `mapPgError` has already confirmed the
 * conflict, so a race never surfaces without the same `details` a
 * non-racing conflict gets. Throws if, impossibly, no open row is found —
 * the `23505` on `programs_one_open_per_user` that triggered this call is
 * proof one exists.
 */
async function loadOpenProgramDetails(
  tx: AppTransaction,
  userId: string,
): Promise<ProgramExistsDetails> {
  const [row] = await tx
    .select({ id: programs.id, status: programs.status })
    .from(programs)
    .where(and(eq(programs.userId, userId), inArray(programs.status, OPEN_PROGRAM_STATUSES)))
    .limit(1)
  if (!row) {
    throw new Error(
      `createProgram: expected an open program for user '${userId}' after a program_exists race, found none`,
    )
  }
  return { existingProgramId: row.id, existingStatus: row.status }
}

/**
 * Re-reads the program plus its current revision for an idempotent replay
 * (`withIdempotency`'s `load`, D21) — this runs before any other check the
 * fresh path might make, so a replay of the same key+body never becomes a
 * 409 (design.md's own text for this task).
 */
async function loadCreatedProgram(
  tx: AppTransaction,
  resultRef: string,
): Promise<{ program: ProgramResponseValue; revision: RevisionResponseValue }> {
  const [row] = await tx.select().from(programs).where(eq(programs.id, resultRef)).limit(1)
  if (!row) {
    throw new Error(`createProgram: no programs row for id '${resultRef}' on idempotent replay`)
  }
  // toProgramDto itself throws if current_revision_id is NULL — unreachable
  // once the fresh path below has committed, so a throw here is a server bug.
  const program = toProgramDto(row)

  const [revisionRow] = await tx
    .select()
    .from(protocolRevisions)
    .where(eq(protocolRevisions.id, program.currentRevisionId))
    .limit(1)
  if (!revisionRow) {
    throw new Error(`createProgram: no protocol_revisions row for id '${program.currentRevisionId}'`)
  }

  return { program, revision: toRevisionDto(revisionRow) }
}

/**
 * `POST /programs` (design.md D6, D21, D33; task 4.1.2). Wraps one write —
 * insert `programs`, insert revision 1, stamp `current_revision_id` — in a
 * single `withIdempotency` (3.4.2) transaction: a replay of the same
 * `(principalId, idempotencyKey)` with an identical body re-reads the stored
 * program via `loadCreatedProgram` instead of re-running the insert; the
 * same key with a different body is 409 `idempotency_mismatch`
 * (`withIdempotency` itself, not this function). Any Postgres error raised
 * inside the transaction — including a `23505` on `programs_one_open_per_user`
 * from a genuine race with another open program (4.1.3 adds the pre-check
 * this is the backstop for) — passes through `mapPgError`.
 */
export async function createProgram(
  db: AppDatabase,
  ctx: RequestContext,
  body: CreateProgramBodyValue,
  idempotencyKey: string,
): Promise<CreateProgramResult> {
  const hash = requestHash('program.create', {}, body)

  const { replayed, value } = await withIdempotency<{
    program: ProgramResponseValue
    revision: RevisionResponseValue
  }>(
    db,
    ctx,
    { key: idempotencyKey, operation: 'program.create', requestHash: hash },
    async (tx) => {
      // 4.1.3: after the idempotency lookup (this callback only runs when
      // withIdempotency found no live receipt) and before inserting, check
      // for an open program of this principal's own. `FOR UPDATE` locks any
      // row found so a second concurrent request that also finds it waits
      // behind this transaction rather than racing the SELECT; when nothing
      // is found there is (yet) no row to lock, so the `23505` catch below
      // is still the backstop for a genuine concurrent insert.
      const openRows = await tx
        .select({ id: programs.id, status: programs.status })
        .from(programs)
        .where(and(eq(programs.userId, ctx.principalId), inArray(programs.status, OPEN_PROGRAM_STATUSES)))
        .limit(1)
        .for('update')

      const openRow = openRows[0]
      if (openRow !== undefined) {
        throw new ConflictError('program_exists', 'A program is already open.', {
          details: { existingProgramId: openRow.id, existingStatus: openRow.status },
        })
      }

      try {
        // The insert sequence runs inside its own SAVEPOINT (`tx.transaction`
        // on a Postgres.js-backed Drizzle transaction issues one — see
        // node_modules/drizzle-orm/postgres-js/session.js), not directly on
        // `tx`: a `23505` here would otherwise leave the *outer* transaction
        // aborted (Postgres refuses every further statement on an aborted
        // transaction until ROLLBACK), which would turn the `loadOpenProgramDetails`
        // re-query below into a second, unrelated failure instead of filling
        // `details` on the conflict this catch already knows about. The
        // savepoint rolls back to just before this block and rethrows the
        // original error, leaving `tx` itself still usable.
        return await tx.transaction(async (tx2) => {
          const programId = randomUUID()
          const insertRow = buildProgramInsert(ctx, body, programId)
          await tx2.insert(programs).values(insertRow)

          const revisionInsert = buildInitialRevisionInsert(programId, body, insertRow.leisureAllowanceMin)
          const [revisionRow] = await tx2.insert(protocolRevisions).values(revisionInsert).returning()
          if (!revisionRow) {
            throw new Error('createProgram: protocol_revisions insert returned no row')
          }

          await tx2.update(programs).set({ currentRevisionId: revisionRow.id }).where(eq(programs.id, programId))

          const programRow: ProgramRow = { ...insertRow, currentRevisionId: revisionRow.id }

          return {
            resultRef: programId,
            value: { program: toProgramDto(programRow), revision: toRevisionDto(revisionRow) },
          }
        })
      } catch (err) {
        try {
          mapPgError(err)
        } catch (mapped) {
          // The pre-check above found nothing, yet the insert still hit
          // `23505` on `programs_one_open_per_user`: a genuine concurrent
          // race. `mapPgError` has already turned this into the same
          // `ConflictError('program_exists', ...)` a non-racing conflict
          // gets, but without `details` (it only sees the Postgres error,
          // never the DB) — re-query here so the race never surfaces
          // without `existingProgramId`/`existingStatus`, and never as a 500.
          if (mapped instanceof ConflictError && mapped.code === 'program_exists' && mapped.details === undefined) {
            const details = await loadOpenProgramDetails(tx, ctx.principalId)
            throw new ConflictError('program_exists', 'A program is already open.', { details: { ...details } })
          }
          throw mapped
        }
      }
    },
    loadCreatedProgram,
  )

  return { replayed, ...value }
}

// ---------------------------------------------------------------------------
// slotAttempts (tasks 4.3.2, reused by 4.2.3 per D16 — no unit re-creates a
// lower layer)
// ---------------------------------------------------------------------------

/**
 * Loads every `focus_sessions` row referencing any of `slotIds` (all
 * lifecycles, including `abandoned` — D22's slot `attempts` list is never
 * filtered down to only-finalized), ordered by `started_at`, and groups them
 * per slot into the exact D22 attempt shape:
 * `{ sessionId, lifecycle, eligible, excludedByAmendment }`. `eligible` is
 * the stored column value verbatim (`null` until finalize sets it — never
 * coalesced). `excludedByAmendment` is `true` when at least one
 * `session_amendments` row for the session has `exclude_from_report = true`
 * (D32: the overlay is read here, never by rewriting the session's own
 * stored `eligible`/`exclusion_reasons`). A slot with no attempts is simply
 * absent from the returned map — callers read it with `.get(slotId) ?? []`.
 */
export async function slotAttempts(
  db: AppDatabase | AppTransaction,
  slotIds: readonly string[],
): Promise<Map<string, readonly SlotAttemptValue[]>> {
  const result = new Map<string, SlotAttemptValue[]>()
  if (slotIds.length === 0) return result

  // A `session_amendments` row for `sessionId`, deduped with `selectDistinct`
  // (a session can carry more than one amendment) and pre-filtered to
  // `exclude_from_report = true`, joined against `focus_sessions` below via
  // drizzle's own `eq()` — never a raw `sql` template correlating
  // `${sessionAmendments.sessionId} = ${focusSessions.id}` by column name
  // alone: both tables carry an unrelated `id` column, so an unqualified
  // reference inside a raw-SQL correlated subquery resolves to the
  // subquery's OWN `id` (Postgres innermost-scope name resolution), never
  // the outer `focus_sessions.id` — silently comparing `session_id = id`
  // within `session_amendments` itself and reporting every amendment as not
  // matching. `leftJoin` + `eq()` lets drizzle qualify both sides by their
  // actual table, so this never regresses the same way.
  const amendedSessions = db
    .selectDistinct({ sessionId: sessionAmendments.sessionId })
    .from(sessionAmendments)
    .where(eq(sessionAmendments.excludeFromReport, true))
    .as('amended_sessions')

  const rows = await db
    .select({
      slotId: focusSessions.slotId,
      sessionId: focusSessions.id,
      lifecycle: focusSessions.lifecycle,
      eligible: focusSessions.eligible,
      excludedByAmendment: sql<boolean>`${amendedSessions.sessionId} is not null`,
    })
    .from(focusSessions)
    .leftJoin(amendedSessions, eq(amendedSessions.sessionId, focusSessions.id))
    .where(inArray(focusSessions.slotId, slotIds))
    .orderBy(focusSessions.startedAt)

  for (const row of rows) {
    // The `focus_sessions_benchmark_has_slot` CHECK constraint guarantees
    // every row this query can return (matched by `slot_id IN (...)`) has a
    // non-null `slot_id`; the null check is TypeScript narrowing only.
    if (row.slotId === null) continue
    const list = result.get(row.slotId) ?? []
    list.push({
      sessionId: row.sessionId,
      lifecycle: row.lifecycle,
      eligible: row.eligible,
      excludedByAmendment: row.excludedByAmendment,
    })
    result.set(row.slotId, list)
  }

  return result
}

// ---------------------------------------------------------------------------
// PUT /programs/{id}/benchmark-slots (task 4.3.2)
// ---------------------------------------------------------------------------

/**
 * A stored `time` column round-trips through Postgres/postgres-js as
 * `HH:MM:SS` (`toSlotDto`, task 4.1.1, deliberately keeps that raw string —
 * see its own unit test), while the wire contract's `plannedLocalTime` is
 * always `HH:MM` (2.7.3's pattern). Comparing a stored value against an
 * incoming, freshly-normalized one (the frozen-fields check below) would
 * therefore see every unchanged time as "changed" without this — truncating
 * to the first five characters is the one place that reconciliation happens;
 * it never touches what `toSlotDto` sends back to the client.
 */
function storedTimeToPlannedLocalTime(value: string | null): string | null {
  return value === null ? null : value.slice(0, 5)
}

/** The wire shape of one `missing` entry (2.7.3's `PutSlotsResponse`) — `MissingSlot`'s `fields` widened from `readonly [...]` to a plain array. */
export interface MissingSlotDto {
  readonly phase: MissingSlot['phase']
  readonly label: MissingSlot['label']
  readonly fields: string[]
}

export interface ReplaceBenchmarkSlotsResult {
  readonly program: ProgramResponseValue
  readonly slots: SlotResponseValue[]
  readonly missing: MissingSlotDto[]
}

/**
 * `PUT /programs/{id}/benchmark-slots` (design.md D19, D22, D34; specs/
 * program-setup "Readiness step assigns materials and benchmark times",
 * "Saving never starts a timer", "Benchmark slots freeze once attempted").
 * One transaction, atomic replace: every check below runs — and can throw —
 * before any `benchmark_slots` or `programs` row is written, so a rejected
 * request (stale version, a terminal program, a malformed or too-close-times
 * body, a frozen-slot violation, or a readiness regression) never leaves a
 * partial write behind.
 *
 * The incoming body is treated as the complete replacement set for whatever
 * slots it names (the route's own "atomic replace"): an existing, unfrozen
 * slot whose `(phase, label)` is not present in `body.slots` is deleted, not
 * left alone — the Readiness screen always resubmits its full local form
 * state. A frozen slot's `(phase, label)` MUST be present and unchanged,
 * never merely "not mentioned".
 */
export async function replaceBenchmarkSlots(
  db: AppDatabase,
  ctx: RequestContext,
  programId: string,
  body: PutSlotsBodyValue,
): Promise<ReplaceBenchmarkSlotsResult> {
  return db.transaction(async (tx) => {
    const program = await loadOwnedProgram(tx, ctx, programId, { forUpdate: true })

    if (body.expectedVersion !== program.version) {
      throw new ConflictError(
        'stale_version',
        'The program has changed since it was last loaded.',
        { details: { current: toProgramDto(program) } },
      )
    }

    if (program.status === 'completed' || program.status === 'archived') {
      throw new ConflictError('program_terminal', 'This program has ended and can no longer be changed.')
    }

    // Throws MalformedError (duplicate slot) or DomainError
    // ('baseline_times_too_close') before anything below ever runs.
    const { slots: normalized, missing, complete } = normalizeSlotSet(body.slots, {
      baselineDate: program.baselineDate,
    })
    const incomingByKey = new Map(normalized.map((slot) => [`${slot.phase}:${slot.label}`, slot]))

    const existingRows = await tx
      .select()
      .from(benchmarkSlots)
      .where(eq(benchmarkSlots.programId, programId))
    const existingAttempts = await slotAttempts(tx, existingRows.map((row) => row.id))

    for (const existing of existingRows) {
      // `(existingAttempts.get(existing.id) ?? []).length`, not
      // `existingAttempts.get(existing.id)?.length ?? 0`: the latter is a
      // `<nullable number> ?? 0` shape indistinguishable, to the
      // measurement-integrity guard (packages/shared's `noCoalesce.test.ts`),
      // from coalescing an unreported count to zero — even though this is a
      // derived attempt count, never a `ReportedCount`.
      const attemptCount = (existingAttempts.get(existing.id) ?? []).length
      if (!isFrozen(existing, attemptCount)) continue

      const key = `${existing.phase}:${existing.label}`
      const incoming = incomingByKey.get(key)
      const unchanged =
        incoming !== undefined &&
        frozenFieldsUnchanged(
          {
            materialRef: existing.materialRef,
            plannedLocalTime: storedTimeToPlannedLocalTime(existing.plannedLocalTime),
            language: existing.language,
            deviceFormat: existing.deviceFormat,
            materialLevel: existing.materialLevel,
          },
          incoming,
        )
      if (!unchanged) {
        throw new ConflictError(
          'slot_frozen',
          'This benchmark slot has an attempt and can no longer be changed.',
          { details: { phase: existing.phase, label: existing.label } },
        )
      }
    }

    // D38 keeps `/setup/readiness` reachable while draft, baseline_ready or
    // active; a program already past draft must never lose completeness —
    // status never falls back to draft, so this is a hard rejection, not a
    // silent downgrade. Checked before any write below (rows unchanged).
    if (program.status !== 'draft' && !complete) {
      throw new DomainError('readiness_regression', 'Benchmark slots are no longer complete.')
    }

    // Every check above has passed — perform the atomic replace.
    const existingByKey = new Map(existingRows.map((row) => [`${row.phase}:${row.label}`, row]))
    for (const incoming of normalized) {
      const key = `${incoming.phase}:${incoming.label}`
      const existing = existingByKey.get(key)
      const values = {
        materialRef: incoming.materialRef,
        language: incoming.language,
        deviceFormat: incoming.deviceFormat,
        materialLevel: incoming.materialLevel,
        plannedLocalTime: incoming.plannedLocalTime,
        assignedLocalDate: incoming.assignedLocalDate,
      }
      if (existing !== undefined) {
        await tx.update(benchmarkSlots).set(values).where(eq(benchmarkSlots.id, existing.id))
      } else {
        // No `realm` column on `benchmark_slots` (D34) — child rows inherit
        // the program's realm, never carry their own.
        await tx.insert(benchmarkSlots).values({ programId, phase: incoming.phase, label: incoming.label, ...values })
      }
    }
    for (const existing of existingRows) {
      const key = `${existing.phase}:${existing.label}`
      if (!incomingByKey.has(key)) {
        await tx.delete(benchmarkSlots).where(eq(benchmarkSlots.id, existing.id))
      }
    }

    const nextStatus: ProgramStatus = program.status === 'draft' && complete ? 'baseline_ready' : program.status
    const [updatedProgram] = await tx
      .update(programs)
      .set({ status: nextStatus, version: program.version + 1 })
      .where(eq(programs.id, programId))
      .returning()
    if (!updatedProgram) {
      throw new Error(`replaceBenchmarkSlots: programs update returned no row for ${programId}`)
    }

    const finalRows = await tx
      .select()
      .from(benchmarkSlots)
      .where(eq(benchmarkSlots.programId, programId))
    const finalAttempts = await slotAttempts(tx, finalRows.map((row) => row.id))
    const slots = finalRows.map((row) => toSlotDto(row, finalAttempts.get(row.id) ?? []))

    return {
      program: toProgramDto(updatedProgram),
      slots,
      missing: missing.map((m) => ({ phase: m.phase, label: m.label, fields: [...m.fields] })),
    }
  })
}

// ---------------------------------------------------------------------------
// GET /programs/current (task 4.2.3)
// ---------------------------------------------------------------------------

/**
 * Pure (no DB): derives a slot's `hasFinalizedAttempt` from its already-loaded
 * `attempts` list. Split out of `loadProgramSnapshot` so it is unit-testable
 * without a database — `attempts` is exactly `slotAttempts`'s (4.3.2)
 * per-slot output, so this never re-derives what that query already read.
 */
export interface SlotAttemptState {
  readonly hasFinalizedAttempt: boolean
  readonly attempts: readonly SlotAttemptValue[]
}

export function slotAttemptStates(attempts: readonly SlotAttemptValue[]): SlotAttemptState {
  return {
    hasFinalizedAttempt: attempts.some((attempt) => attempt.lifecycle === 'finalized'),
    attempts,
  }
}

/**
 * Pure (no DB): identity-realm's guard applied to every loaded session and
 * attempt row in one pass, rather than filtering a mixed-realm row out
 * silently — the very first foreign row throws `DomainError('realm_mismatch')`
 * (422, the fixed D19 message) via `assertOwnRealm`. An empty list never
 * throws (nothing loaded, nothing to guard).
 */
export function guardRealm(ctx: Pick<RequestContext, 'realm'>, rows: readonly { readonly realm: Realm }[]): void {
  for (const row of rows) {
    assertOwnRealm(ctx as RequestContext, row.realm)
  }
}

/** The D22 shape `GET /programs/current` returns when the principal has no open program. */
export const NO_OPEN_PROGRAM_RESULT: CurrentProgramResponseValue = {
  program: null,
  revision: null,
  slots: [],
  day: null,
  nextAction: { kind: 'setup' },
}

export interface ProgramSnapshotSlot {
  readonly row: SlotRow
  readonly attempts: readonly SlotAttemptValue[]
  readonly hasFinalizedAttempt: boolean
}

/** One row of `loadProgramSnapshot`'s `todaySessions` — today's practice sessions, joined to their review's `outputQuality`, plus `realm` for `guardRealm`. */
export interface TodaySessionRow {
  readonly id: string
  readonly kind: SessionKind
  readonly lifecycle: SessionLifecycle
  readonly startedAt: Date
  readonly completeInterval: boolean | null
  readonly outputQuality: OutputQuality | null
  readonly realm: Realm
}

export interface ProgramSnapshot {
  readonly localDate: LocalDate
  readonly day: number
  readonly revisions: readonly RevisionRow[]
  readonly governingRevision: RevisionRow
  readonly slots: readonly ProgramSnapshotSlot[]
  readonly todaySessions: readonly TodaySessionRow[]
  readonly blocks: readonly [Block, Block]
}

/**
 * Assembles everything `GET /programs/current` (this task) and `GET
 * /programs/{id}/today` (4.5.3) both need from an already-loaded, already
 * realm-checked `programs` row: the program's local day (from the program's
 * OWN stored timezone, never `user_profiles.timezone` — "Program calendar
 * uses stored timezone and local dates" / "Profile timezone changed
 * mid-program"), the governing revision (D33), every benchmark slot with its
 * attempts and `hasFinalizedAttempt`, today's practice sessions (for
 * `deriveBlocks`, 4.2.1) and the derived blocks themselves. Every loaded
 * session and attempt row is realm-guarded (`guardRealm`) before any of it is
 * used — a foreign-realm row is never silently dropped from the day's slots
 * or blocks.
 */
export async function loadProgramSnapshot(
  db: AppDatabase | AppTransaction,
  ctx: RequestContext,
  program: ProgramRow,
): Promise<ProgramSnapshot> {
  const { day, localDate } = currentProgramDay(
    { baselineDate: program.baselineDate, timezone: program.timezone },
    ctx.now,
  )

  const revisions = await db
    .select()
    .from(protocolRevisions)
    .where(eq(protocolRevisions.programId, program.id))
  const governingRevision = governingRevisionFor(revisions, day)

  const slotRows = await db.select().from(benchmarkSlots).where(eq(benchmarkSlots.programId, program.id))
  const slotIds = slotRows.map((row) => row.id)
  const attemptsBySlot = await slotAttempts(db, slotIds)
  const attemptRealmRows =
    slotIds.length === 0
      ? []
      : await db.select({ realm: focusSessions.realm }).from(focusSessions).where(inArray(focusSessions.slotId, slotIds))

  const todaySessions: TodaySessionRow[] = await db
    .select({
      id: focusSessions.id,
      kind: focusSessions.kind,
      lifecycle: focusSessions.lifecycle,
      startedAt: focusSessions.startedAt,
      completeInterval: focusSessions.completeInterval,
      outputQuality: sessionReviews.outputQuality,
      realm: focusSessions.realm,
    })
    .from(focusSessions)
    .leftJoin(sessionReviews, eq(sessionReviews.sessionId, focusSessions.id))
    .where(
      and(
        eq(focusSessions.programId, program.id),
        eq(focusSessions.kind, 'practice'),
        eq(focusSessions.localDate, localDate),
      ),
    )
    .orderBy(focusSessions.startedAt)

  // Every session and attempt row this snapshot will use, checked in one
  // pass before any of it feeds `deriveBlocks`/`deriveNextAction` — a foreign
  // row throws, it is never quietly excluded from the day's picture.
  guardRealm(ctx, [...attemptRealmRows, ...todaySessions])

  const slots: ProgramSnapshotSlot[] = slotRows.map((row) => {
    const attempts = attemptsBySlot.get(row.id) ?? []
    return { row, ...slotAttemptStates(attempts) }
  })

  const blockSessions: BlockSessionInput[] = todaySessions
  const blocks = deriveBlocks({
    sessions: blockSessions,
    targetSeconds: governingRevision.settings.practiceTargetSeconds,
  })

  return { localDate, day, revisions, governingRevision, slots, todaySessions, blocks }
}

/**
 * Pure (no DB): the `nextAction` (4.2.2) for an already-loaded snapshot,
 * shared verbatim by `getCurrentProgram` (this task) and `getToday` (4.5.3)
 * so the two routes can never disagree about which action Today points at —
 * D16, no unit re-derives this from the slots list a second way.
 */
function nextActionForSnapshot(
  program: Pick<ProgramRow, 'status'>,
  snapshot: Pick<ProgramSnapshot, 'day' | 'slots' | 'blocks'>,
): NextActionValue {
  const slotStates: SlotState[] = snapshot.slots.map((slot) => ({
    id: slot.row.id,
    phase: slot.row.phase,
    label: slot.row.label,
    hasFinalizedAttempt: slot.hasFinalizedAttempt,
  }))

  return deriveNextAction({
    program: { status: program.status },
    day: snapshot.day,
    slots: slotStates,
    blocks: snapshot.blocks,
  })
}

/**
 * `GET /programs/current` (design.md D22, D23, D33, D34; task 4.2.3).
 * Strictly read-only: no row is written, no lifecycle changes. The
 * principal's own open (draft | baseline_ready | active) program, or the
 * fixed D22 no-program shape when none exists — completed and archived
 * programs are never "open" and never surface here, matching `nextAction`
 * `{ kind: 'setup' }` in that case too.
 */
export async function getCurrentProgram(
  db: AppDatabase,
  ctx: RequestContext,
): Promise<CurrentProgramResponseValue> {
  const rows = await db
    .select()
    .from(programs)
    .where(and(eq(programs.userId, ctx.principalId), inArray(programs.status, OPEN_PROGRAM_STATUSES)))
    .limit(1)
  const program = rows[0]
  if (program === undefined) {
    return NO_OPEN_PROGRAM_RESULT
  }

  assertOwnRealm(ctx, program.realm)

  const snapshot = await loadProgramSnapshot(db, ctx, program)

  const nextAction = nextActionForSnapshot(program, snapshot)

  return {
    program: toProgramDto(program),
    revision: toRevisionDto(snapshot.governingRevision),
    slots: snapshot.slots.map((slot) => toSlotDto(slot.row, slot.attempts)),
    day: snapshot.day,
    nextAction,
  }
}

// ---------------------------------------------------------------------------
// GET /programs/{id}/today (task 4.5.3)
// ---------------------------------------------------------------------------

/** One `feed_usage` row as loaded for `getToday`, mapped 1:1 onto the shared `FeedRowInput` shape. */
interface FeedUsageRow {
  readonly device: FeedRowInput['device']
  readonly platform: string
  readonly minutes: number
  readonly shortVideoMinutes: number | null
  readonly measurementScope: FeedRowInput['measurementScope']
  readonly source: FeedRowInput['source']
  readonly plannedWindow: boolean | null
}

function toFeedRowInput(row: FeedUsageRow): FeedRowInput {
  return {
    device: row.device,
    platform: row.platform,
    minutes: row.minutes,
    shortVideoMinutes: row.shortVideoMinutes,
    measurementScope: row.measurementScope,
    source: row.source,
    plannedWindow: row.plannedWindow,
  }
}

/**
 * `GET /programs/{id}/today` (design.md D22; task 4.5.3). Strictly
 * read-only. Assembles: `loadProgramSnapshot`'s day/blocks/slots/governing
 * revision (4.2.3), today's check-in completeness and values (`checkinStatus`
 * / `checkinValuesFrom`, feed.ts D16), the progression suggestion
 * (`deriveSuggestion`, 4.5.1) over Days 1..day-1 of this program's own
 * practice sessions, and `nextAction` (shared with `getCurrentProgram` via
 * `nextActionForSnapshot`) — then hands all of it to `toTodayResponse`
 * (today.ts) to build the wire shape.
 */
export async function getToday(
  db: AppDatabase,
  ctx: RequestContext,
  programId: string,
): Promise<TodayResponseValue> {
  const program = await loadOwnedProgram(db, ctx, programId)
  const snapshot = await loadProgramSnapshot(db, ctx, program)

  // --- check-in: today's row (if any) plus its feed rows -------------------
  const [checkinRow] = await db
    .select({ id: dailyCheckins.id, realm: dailyCheckins.realm, sleepMinutes: dailyCheckins.sleepMinutes })
    .from(dailyCheckins)
    .where(and(eq(dailyCheckins.programId, program.id), eq(dailyCheckins.localDate, snapshot.localDate)))
    .limit(1)

  let feedRows: FeedRowInput[] = []
  if (checkinRow !== undefined) {
    // The checked row is this principal's own program's child, but a row
    // reachable only by directly mutating the database (never by anything
    // this codebase itself writes, per D34) could still carry a foreign
    // realm — guarded exactly like every other loaded row in this snapshot,
    // never silently trusted because it joined through an owned program.
    assertOwnRealm(ctx, checkinRow.realm)

    const rawFeedRows = await db
      .select({
        device: feedUsage.device,
        platform: feedUsage.platform,
        minutes: feedUsage.minutes,
        shortVideoMinutes: feedUsage.shortVideoMinutes,
        measurementScope: feedUsage.measurementScope,
        source: feedUsage.source,
        plannedWindow: feedUsage.plannedWindow,
      })
      .from(feedUsage)
      .where(eq(feedUsage.checkinId, checkinRow.id))
    feedRows = rawFeedRows.map(toFeedRowInput)
  }

  const checkinSleep = checkinRow === undefined ? null : { sleepMinutes: checkinRow.sleepMinutes }
  const { status, missing } = checkinStatus(checkinSleep, feedRows)
  const values = checkinValuesFrom(checkinSleep, feedRows)

  // --- progression suggestion: Days 1..day-1 of this program's practice ---
  const day1Date = localDateForProgramDay(program.baselineDate, 1)
  const dayMinusOneDate = localDateForProgramDay(program.baselineDate, snapshot.day - 1)

  const suggestionRows: SuggestionRow[] = await db
    .select({
      id: focusSessions.id,
      realm: focusSessions.realm,
      kind: focusSessions.kind,
      lifecycle: focusSessions.lifecycle,
      localDate: focusSessions.localDate,
      startedAt: focusSessions.startedAt,
      targetSeconds: focusSessions.targetSeconds,
      completeInterval: focusSessions.completeInterval,
      outputQuality: sessionReviews.outputQuality,
      episodeCount: sessionReviews.episodeCount,
    })
    .from(focusSessions)
    .leftJoin(sessionReviews, eq(sessionReviews.sessionId, focusSessions.id))
    .where(
      and(
        eq(focusSessions.programId, program.id),
        eq(focusSessions.kind, 'practice'),
        gte(focusSessions.localDate, day1Date),
        lte(focusSessions.localDate, dayMinusOneDate),
      ),
    )
    .orderBy(focusSessions.startedAt)

  const suggestion = deriveSuggestion({
    day: snapshot.day,
    currentTargetSeconds: snapshot.governingRevision.settings.practiceTargetSeconds,
    rows: suggestionRows,
    realm: ctx.realm,
  })

  const nextAction = nextActionForSnapshot(program, snapshot)

  return toTodayResponse({
    day: snapshot.day,
    localDate: snapshot.localDate,
    blocks: snapshot.blocks,
    checkin: { status, missing, values },
    suggestion,
    nextAction,
  })
}
