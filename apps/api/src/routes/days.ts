/**
 * `/programs/{id}/days/{date}` route group (design.md's API contracts
 * table). Task `6.1.1` registered `GET`; `6.1.2` adds `PUT` in this same
 * file.
 *
 * `GET` is strictly read-only: loads the owned program (`loadOwnedProgram`,
 * 4.1.1 — 404 for a missing or not-owned program, 422 `realm_mismatch` for
 * one of the caller's own rows carrying a foreign realm), resolves `:date`
 * to a program day and 404s outside 0..14 (the day is not a resource of
 * this program at all, same treatment as any other day-scoped lookup),
 * loads the day's `daily_checkins` row (if any) plus its `feed_usage`
 * children, realm-checks that row too, and hands everything to
 * `buildCheckinView` (`checkinView.ts`, D16) for the D22 empty-shell /
 * populated response shape. `Cache-Control: no-store` is applied
 * automatically by the 3.2.2 `noStore` plugin (every `/api/v1` route is
 * private by default) — nothing here sets it explicitly.
 *
 * `PUT` is the atomic write path (task 6.1.2): the handler stays thin,
 * delegating the whole transaction — ownership/terminal-status/day-window
 * gates, the D36 feed-row validation, the `expectedVersion` conflict check
 * and the atomic upsert-plus-replace — to `saveCheckin` (`services/
 * checkin.ts`). `PutDayBody`'s `Obj(...)` (D22) already rejects a
 * client-supplied `realm` field (or any other unknown key) as 400
 * `malformed_request` with `fieldErrors.realm` before this handler ever
 * runs.
 *
 * `:date` is shaped `YYYY-MM-DD` by the `DayParams` schema (2.7.5) before
 * either handler ever runs (a malformed shape like `2026-9-1` is a 400 from
 * AJV directly), but the schema's regex alone accepts a shape with an
 * impossible calendar value (`2026-13-01`) — `isValidLocalDate` is the
 * explicit second gate for that, thrown as the same `malformed_request`
 * rather than left to surface as an uncaught `RangeError` out of
 * `programDayForLocalDate`.
 */
import { and, eq } from 'drizzle-orm'
import type { FastifyPluginAsync } from 'fastify'
import {
  DayParams,
  DayResponse,
  PutDayBody,
  isValidLocalDate,
  isWithinProgram,
  programDayForLocalDate,
  type DayParamsValue,
  type DayResponseValue,
  type FeedRowInput,
  type PutDayBodyValue,
} from '@attention-lab/shared'

import { MalformedError, NotFoundError } from '../errors.js'
import { dailyCheckins } from '../db/schema/dailyCheckins.js'
import { feedUsage } from '../db/schema/feedUsage.js'
import { assertOwnRealm } from '../plugins/identity.js'
import { loadOwnedProgram } from '../services/program/programService.js'
import { buildCheckinView, type CheckinRowInput } from '../services/checkinView.js'
import { saveCheckin } from '../services/checkin.js'

const daysRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: DayParamsValue; Reply: DayResponseValue }>(
    '/programs/:id/days/:date',
    {
      schema: {
        params: DayParams,
        response: { 200: DayResponse },
      },
    },
    async (request) => {
      const { ctx } = request
      const { id: programId, date } = request.params

      if (!isValidLocalDate(date)) {
        throw new MalformedError('The request could not be validated.', {
          date: 'must be a real calendar date',
        })
      }

      const program = await loadOwnedProgram(app.db, ctx, programId)

      const day = programDayForLocalDate(program.baselineDate, date)
      if (!isWithinProgram(day)) {
        throw new NotFoundError()
      }

      const [checkinRow] = await app.db
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
        .where(and(eq(dailyCheckins.programId, program.id), eq(dailyCheckins.localDate, date)))
        .limit(1)

      let checkinInput: CheckinRowInput | null = null
      let feedRows: FeedRowInput[] = []

      if (checkinRow !== undefined) {
        // Reachable only by directly mutating the database (never by
        // anything this codebase itself writes, per D34) — guarded exactly
        // like every other loaded row, never silently trusted because it
        // joined through an already-owned program.
        assertOwnRealm(ctx, checkinRow.realm)

        checkinInput = {
          sleepMinutes: checkinRow.sleepMinutes,
          stress: checkinRow.stress,
          mindfulnessMinutes: checkinRow.mindfulnessMinutes,
          note: checkinRow.note,
          version: checkinRow.version,
        }

        feedRows = await app.db
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
      }

      return buildCheckinView(checkinInput, feedRows, date)
    },
  )

  /**
   * `PUT /programs/{id}/days/{date}` (design.md D18, D19, D22, D34, D36;
   * task 6.1.2). No `Idempotency-Key` (not marked (IK) in the API contracts
   * table — a retried PUT with the same body and a now-stale
   * `expectedVersion` simply 409s, the intended behavior for a
   * version-guarded save). `saveCheckin` (`services/checkin.ts`) does every
   * check — ownership, terminal status, the day window, feed-row
   * validation, the version conflict — inside its own transaction; the
   * handler here only resolves the same `isValidLocalDate` gate `GET` uses
   * before ever calling it.
   */
  app.put<{ Params: DayParamsValue; Body: PutDayBodyValue; Reply: DayResponseValue }>(
    '/programs/:id/days/:date',
    {
      schema: {
        params: DayParams,
        body: PutDayBody,
        response: { 200: DayResponse },
      },
    },
    async (request) => {
      const { ctx } = request
      const { id: programId, date } = request.params

      if (!isValidLocalDate(date)) {
        throw new MalformedError('The request could not be validated.', {
          date: 'must be a real calendar date',
        })
      }

      return saveCheckin(app.db, ctx, programId, date, request.body)
    },
  )
}

export default daysRoutes
