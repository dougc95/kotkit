/**
 * `PUT /programs/{id}/days/{date}` — the atomic check-in write path (task
 * 6.1.2; design.md D18, D19, D22, D34, D36; specs/daily-checkin). One
 * transaction, run in the order design.md's own brief fixes:
 *
 *  1. lock the owned program (`loadOwnedProgram`, `forUpdate`, 4.1.1) — 404
 *     for a missing/not-owned program; `completed`/`archived` → 409
 *     `program_terminal` (check-ins are editable until the program is
 *     completed); the requested date resolved to a program day outside
 *     0..14 → 404 `not_found` (the day is not a resource of this program);
 *  2. validate the submitted feed rows as a set (`validateFeedRows`,
 *     `domain/feed.ts`, 2.6.1/D36) — BEFORE the existing row is even looked
 *     up, so a rejected batch never also triggers a spurious version
 *     conflict on top of its own 422;
 *  3. lock the day's existing `daily_checkins` row (if any) and check
 *     `expectedVersion` against it — a mismatch is 409 `stale_version`
 *     carrying the CURRENT view (`details.current`, D18), built by the
 *     exact same `buildCheckinView` (6.1.1) the successful response uses;
 *  4. upsert the row (`realm` stamped from `ctx.realm` on create, D34; an
 *     absent optional field writes SQL NULL, never 0) and atomically
 *     replace its `feed_usage` children (delete every existing row, insert
 *     the submitted set — an explicit `minutes: 0` row is written like any
 *     other, and `feed: []` with no sleep is a valid, savable state at any
 *     level of completeness; over-allowance minutes save with no warning or
 *     blocking field; a save for a later day with no earlier day's row
 *     succeeds);
 *  5. return `buildCheckinView(...)` — the same shape `GET` returns.
 *
 * Every pure piece below (`normalizeCheckinFields`, `toFeedInsertRow`,
 * `feedValidationDomainError`, `checkVersion`) is unit-tested without a
 * database in `test/unit/checkin.write.test.ts`; `saveCheckin` itself is
 * covered end to end in `test/days.put.test.ts`. No `?? 0` and no SQL
 * coalesce-to-zero anywhere in this file (2.9.1 guard) — a stored/derived
 * version number that
 * does not yet exist is `0` via an explicit `=== undefined ? 0 :` ternary,
 * never a nullish-coalesce, and every optional wire field is normalized with
 * `?? null` (substituting only for `undefined`, never zeroing a reported
 * value).
 */
import { and, eq } from 'drizzle-orm'
import {
  isWithinProgram,
  programDayForLocalDate,
  validateFeedRows,
  type DayResponseValue,
  type FeedRowInput,
  type FeedRowValue,
  type FeedValidationError,
  type FeedValidationResult,
  type LocalDate,
  type PutDayBodyValue,
  type ReportedCount,
} from '@attention-lab/shared'

import type { AppDatabase } from '../plugins/db.js'
import type { AppTransaction } from '../idempotency/withIdempotency.js'
import { assertOwnRealm, type RequestContext } from '../plugins/identity.js'
import { ConflictError, DomainError, NotFoundError } from '../errors.js'
import { dailyCheckins } from '../db/schema/dailyCheckins.js'
import { feedUsage } from '../db/schema/feedUsage.js'
import { loadOwnedProgram } from './program/programService.js'
import { buildCheckinView, type CheckinRowInput } from './checkinView.js'

// ---------------------------------------------------------------------------
// normalizeCheckinFields (pure)
// ---------------------------------------------------------------------------

export interface CheckinWriteFields {
  readonly sleepMinutes: ReportedCount
  readonly stress: number | null
  readonly mindfulnessMinutes: ReportedCount
  readonly note: string | null
}

/**
 * A field the client omitted (`undefined`) maps to `null` — "not reported",
 * never `0` (D7.1); an explicit value, including an explicit `0`, passes
 * through unchanged. `note` has no `null` member on the wire (`PutDayBody`
 * only ever accepts a string or omission), so `?? null` only ever
 * substitutes for `undefined` there too.
 */
export function normalizeCheckinFields(
  body: Pick<PutDayBodyValue, 'sleepMinutes' | 'stress' | 'mindfulnessMinutes' | 'note'>,
): CheckinWriteFields {
  return {
    sleepMinutes: body.sleepMinutes ?? null,
    stress: body.stress ?? null,
    mindfulnessMinutes: body.mindfulnessMinutes ?? null,
    note: body.note ?? null,
  }
}

// ---------------------------------------------------------------------------
// normalizeFeedRow / toFeedInsertRow (pure)
// ---------------------------------------------------------------------------

/**
 * The wire `FeedRowValue` (`shortVideoMinutes`/`plannedWindow` optional,
 * D22) to the domain `FeedRowInput` `validateFeedRows` (2.6.1) and
 * `buildCheckinView` (6.1.1) both take (the same two fields required, but
 * nullable): `minutes` is required on the wire so an explicit `0` simply
 * passes through untouched; the two genuinely optional fields get the same
 * `undefined -> null` treatment as `normalizeCheckinFields`.
 */
export function normalizeFeedRow(row: FeedRowValue): FeedRowInput {
  return {
    device: row.device,
    platform: row.platform,
    minutes: row.minutes,
    shortVideoMinutes: row.shortVideoMinutes ?? null,
    measurementScope: row.measurementScope,
    source: row.source,
    plannedWindow: row.plannedWindow ?? null,
  }
}

/** One `feed_usage` insert row; `checkinId` is supplied by the caller (the row does not exist until the upsert above has run). */
export interface FeedInsertRow extends FeedRowInput {
  readonly checkinId: string
}

export function toFeedInsertRow(checkinId: string, row: FeedRowValue): FeedInsertRow {
  return { checkinId, ...normalizeFeedRow(row) }
}

// ---------------------------------------------------------------------------
// feedValidationDomainError (pure)
// ---------------------------------------------------------------------------

/** Where each `validateFeedRows` error code's `fieldErrors` key lands on the wire (task 6.1.2's own D19 mapping). */
function fieldKeyForFeedError(error: FeedValidationError): string {
  switch (error.code) {
    case 'feed_subset_violation':
      return `feed[${error.index}].shortVideoMinutes`
    case 'duplicate_feed_row':
      return `feed[${error.index}]`
    case 'feed_platform_conflict':
      return `feed[${error.index}].platform`
  }
}

const FEED_ERROR_FIELD_MESSAGE: Record<FeedValidationError['code'], string> = {
  feed_subset_violation: 'must not exceed minutes',
  duplicate_feed_row: 'duplicate device, platform and scope',
  feed_platform_conflict: 'device has both an all row and platform rows',
}

/**
 * `null` when every row is valid; otherwise a `DomainError` whose `code` is
 * the FIRST error's code (task 6.1.2's brief) and whose `fieldErrors` names
 * every offending row. The thrown error never carries a value echo or note
 * text — only a fixed field key and a fixed field message per row.
 */
export function feedValidationDomainError(result: FeedValidationResult): DomainError | null {
  if (result.ok) return null

  const fieldErrors: Record<string, string> = {}
  for (const error of result.errors) {
    fieldErrors[fieldKeyForFeedError(error)] = FEED_ERROR_FIELD_MESSAGE[error.code]
  }

  const first = result.errors[0]
  if (first === undefined) {
    throw new Error('feedValidationDomainError: FeedValidationResult.ok is false with an empty errors array')
  }

  return new DomainError(first.code, 'One or more feed rows could not be saved as given.', { fieldErrors })
}

// ---------------------------------------------------------------------------
// checkVersion (pure)
// ---------------------------------------------------------------------------

export type CheckVersionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly current: DayResponseValue }

/**
 * D22: a day with no `daily_checkins` row is version 0 — the value the
 * first `PUT` for that date must send as `expectedVersion`. `current` (used
 * as `stale_version`'s `details.current`, D18) is built by the exact same
 * `buildCheckinView` (6.1.1) the successful response uses, so a client that
 * loses a race sees the same shape a fresh `GET` would have returned.
 */
export function checkVersion(
  row: CheckinRowInput | null,
  feedRows: readonly FeedRowInput[],
  localDate: LocalDate,
  expectedVersion: number,
): CheckVersionResult {
  const storedVersion = row === null ? 0 : row.version
  if (storedVersion !== expectedVersion) {
    return { ok: false, current: buildCheckinView(row, feedRows, localDate) }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// saveCheckin — PUT /programs/{id}/days/{date} (task 6.1.2)
// ---------------------------------------------------------------------------

/** The columns `saveCheckin` loads off an existing `daily_checkins` row — `id`/`realm` are consumed here; the rest is exactly `CheckinRowInput`. */
interface ExistingCheckinRow extends CheckinRowInput {
  readonly id: string
  readonly realm: RequestContext['realm']
}

async function loadExistingCheckinRow(
  tx: AppDatabase | AppTransaction,
  programId: string,
  localDate: LocalDate,
): Promise<ExistingCheckinRow | undefined> {
  const [row] = await tx
    .select({
      id: dailyCheckins.id,
      realm: dailyCheckins.realm,
      sleepMinutes: dailyCheckins.sleepMinutes,
      stress: dailyCheckins.stress,
      mindfulnessMinutes: dailyCheckins.mindfulnessMinutes,
      note: dailyCheckins.note,
      version: dailyCheckins.version,
    })
    .from(dailyCheckins)
    .where(and(eq(dailyCheckins.programId, programId), eq(dailyCheckins.localDate, localDate)))
    .limit(1)
    .for('update')
  return row
}

async function loadFeedRows(
  tx: AppDatabase | AppTransaction,
  checkinId: string,
): Promise<FeedRowInput[]> {
  return tx
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
    .where(eq(feedUsage.checkinId, checkinId))
}

/**
 * `PUT /programs/{id}/days/{date}` (design.md's API contracts table; task
 * 6.1.2). See the module doc above for the fixed five-step order; every
 * check that can reject the request runs — and can throw — before any row
 * is written, so a rejected request (stale version, a terminal program, an
 * out-of-window date, or an invalid feed set) never leaves a partial write
 * behind.
 */
export async function saveCheckin(
  db: AppDatabase,
  ctx: RequestContext,
  programId: string,
  localDate: LocalDate,
  body: PutDayBodyValue,
): Promise<DayResponseValue> {
  return db.transaction(async (tx) => {
    const program = await loadOwnedProgram(tx, ctx, programId, { forUpdate: true })

    if (program.status === 'completed' || program.status === 'archived') {
      throw new ConflictError('program_terminal', 'This program has ended and can no longer be changed.')
    }

    const day = programDayForLocalDate(program.baselineDate, localDate)
    if (!isWithinProgram(day)) {
      throw new NotFoundError()
    }

    const validationError = feedValidationDomainError(validateFeedRows(body.feed.map(normalizeFeedRow)))
    if (validationError !== null) {
      throw validationError
    }

    const existing = await loadExistingCheckinRow(tx, program.id, localDate)
    if (existing !== undefined) {
      // Reachable only by directly mutating the database (never by anything
      // this codebase itself writes, per D34) — guarded exactly like every
      // other loaded row, same treatment as the GET route (6.1.1).
      assertOwnRealm(ctx, existing.realm)
    }

    const existingFeedRows = existing === undefined ? [] : await loadFeedRows(tx, existing.id)
    const existingInput: CheckinRowInput | null = existing === undefined ? null : existing

    const versionCheck = checkVersion(existingInput, existingFeedRows, localDate, body.expectedVersion)
    if (!versionCheck.ok) {
      throw new ConflictError(
        'stale_version',
        'This check-in has changed since it was last loaded.',
        { details: { current: versionCheck.current } },
      )
    }

    const fields = normalizeCheckinFields(body)
    const storedVersion = existing === undefined ? 0 : existing.version
    const newVersion = storedVersion + 1

    let checkinId: string
    if (existing === undefined) {
      const [inserted] = await tx
        .insert(dailyCheckins)
        .values({
          programId: program.id,
          realm: ctx.realm,
          localDate,
          sleepMinutes: fields.sleepMinutes,
          stress: fields.stress,
          mindfulnessMinutes: fields.mindfulnessMinutes,
          note: fields.note,
          version: newVersion,
        })
        .returning({ id: dailyCheckins.id })
      if (inserted === undefined) {
        throw new Error(`saveCheckin: daily_checkins insert returned no row for program '${program.id}'`)
      }
      checkinId = inserted.id
    } else {
      await tx
        .update(dailyCheckins)
        .set({
          sleepMinutes: fields.sleepMinutes,
          stress: fields.stress,
          mindfulnessMinutes: fields.mindfulnessMinutes,
          note: fields.note,
          version: newVersion,
        })
        .where(eq(dailyCheckins.id, existing.id))
      checkinId = existing.id
    }

    // Atomic replace (D22/D36): every existing feed_usage row for this
    // check-in is deleted and the submitted set inserted in its place, even
    // when that set is empty — `feed: []` with no sleep is a valid, savable
    // state at any level of completeness.
    await tx.delete(feedUsage).where(eq(feedUsage.checkinId, checkinId))
    const insertRows = body.feed.map((row) => toFeedInsertRow(checkinId, row))
    if (insertRows.length > 0) {
      await tx.insert(feedUsage).values(insertRows)
    }

    return buildCheckinView(
      {
        sleepMinutes: fields.sleepMinutes,
        stress: fields.stress,
        mindfulnessMinutes: fields.mindfulnessMinutes,
        note: fields.note,
        version: newVersion,
      },
      insertRows,
      localDate,
    )
  })
}
