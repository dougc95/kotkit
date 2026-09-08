/**
 * 4.5.3 — Fastify inject integration tests for `GET /programs/{id}/today`
 * against the real `attention_lab_test` database, via `buildTestApp`
 * (3.2.1). Complements the pure-function unit tests in
 * `src/services/program/today.test.ts` (`toTodayResponse`,
 * `checkinValuesFrom`), which this file never re-tests.
 */
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { localDateAt, localDateForProgramDay } from '@attention-lab/shared'
import type { LocalDate, OutputQuality, ReportedCount } from '@attention-lab/shared'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import {
  insertCheckin,
  insertOtherPrincipalProgram,
  insertSession,
  seedActiveProgram,
  setDemoOffsetSeconds,
} from '../helpers/programs.js'
import { programs } from '../../src/db/schema/index.js'
import type { AppDatabase } from '../../src/plugins/db.js'

interface TodayBlockDto {
  index: 1 | 2
  status: string
  targetSeconds: number
  sessionId: string | null
}

interface TodayCheckinDto {
  status: string
  missing: string[]
  values: { sleepMinutes: number | null; phoneFeedMinutes: number | null; desktopFeedMinutes: number | null }
}

interface TodayBody {
  day: number
  localDate: string
  blocks: TodayBlockDto[]
  checkin: TodayCheckinDto
  suggestion?: { suggestedTargetSeconds: number; qualifiedOn: [string, string] }
  nextAction: { kind: string; slotId?: string; block?: number }
}

interface ErrorBody {
  code: string
  message: string
}

const UTC = 'UTC'

describe('GET /programs/{id}/today (integration, attention_lab_test)', () => {
  let testApp: TestApp

  async function getTodayResponse(
    app: FastifyInstance,
    programId: string,
  ): Promise<{ statusCode: number; body: TodayBody; headers: Record<string, string | string[] | number | undefined> }> {
    const res = await app.inject({ method: 'GET', url: `/api/v1/programs/${programId}/today` })
    return { statusCode: res.statusCode, body: res.json(), headers: res.headers }
  }

  async function postRevision(app: FastifyInstance, programId: string, payload: Record<string, unknown>) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/programs/${programId}/revisions`,
      payload,
    })
    return { statusCode: res.statusCode, body: res.json() }
  }

  async function baselineDateOf(db: AppDatabase, programId: string): Promise<LocalDate> {
    const [row] = await db.select({ baselineDate: programs.baselineDate }).from(programs).where(eq(programs.id, programId)).limit(1)
    if (!row) throw new Error(`no program ${programId}`)
    return row.baselineDate
  }

  /** Two finalized, complete practice sessions on `localDate` at `targetSeconds` — a qualifying day (progression.ts's `dayQualifies`). */
  async function insertQualifyingDay(
    db: AppDatabase,
    programId: string,
    localDate: LocalDate,
    targetSeconds: number,
    secondBlock: { outputQuality?: OutputQuality; episodeCount?: ReportedCount } = {},
  ): Promise<void> {
    await insertSession(db, {
      programId,
      kind: 'practice',
      lifecycle: 'finalized',
      localDate,
      startedAt: new Date(`${localDate}T08:00:00.000Z`),
      endedAt: new Date(`${localDate}T08:05:00.000Z`),
      targetSeconds,
      completeInterval: true,
      review: { outputQuality: 'yes', episodeCount: 0 },
    })
    await insertSession(db, {
      programId,
      kind: 'practice',
      lifecycle: 'finalized',
      localDate,
      startedAt: new Date(`${localDate}T09:00:00.000Z`),
      endedAt: new Date(`${localDate}T09:05:00.000Z`),
      targetSeconds,
      completeInterval: true,
      review: {
        outputQuality: secondBlock.outputQuality ?? 'yes',
        episodeCount: secondBlock.episodeCount === undefined ? 1 : secondBlock.episodeCount,
      },
    })
  }

  beforeAll(async () => {
    testApp = await buildTestApp()
  })

  beforeEach(async () => {
    await testApp.truncateAll()
  })

  afterAll(async () => {
    await testApp.close()
  })

  it(
    '(1) seedActiveProgram day 4 with one finalized complete practice session today -> blocks [completed, not_started], ' +
      'nextAction practice block 2, blocks[].targetSeconds 900 from revision 1',
    async () => {
      const { programId } = await seedActiveProgram(testApp.db, { day: 4, practiceTargetSeconds: 900 })
      const today = localDateAt(new Date(), UTC)
      await insertSession(testApp.db, {
        programId,
        kind: 'practice',
        lifecycle: 'finalized',
        localDate: today,
        startedAt: new Date(),
        endedAt: new Date(),
        targetSeconds: 900,
        completeInterval: true,
      })

      const { statusCode, body } = await getTodayResponse(testApp.app, programId)
      expect(statusCode).toBe(200)
      expect(body.blocks.map((b) => b.status)).toEqual(['completed', 'not_started'])
      expect(body.nextAction).toEqual({ kind: 'practice', block: 2 })
      expect(body.blocks[0]?.targetSeconds).toBe(900)
      expect(body.blocks[1]?.targetSeconds).toBe(900)
    },
  )

  it('(2) day 6 with no Day 5 sessions -> day 6, both blocks not_started, nextAction practice 1, response keys exactly {day, localDate, blocks, checkin, nextAction}', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 6 })

    const { statusCode, body } = await getTodayResponse(testApp.app, programId)
    expect(statusCode).toBe(200)
    expect(body.day).toBe(6)
    expect(body.blocks.map((b) => b.status)).toEqual(['not_started', 'not_started'])
    expect(body.nextAction).toEqual({ kind: 'practice', block: 1 })
    expect(Object.keys(body).sort()).toEqual(['blocks', 'checkin', 'day', 'localDate', 'nextAction'].sort())
  })

  it("(3) today's check-in inserted with sleep only -> checkin.status 'incomplete', missing ['feed'], values sleepMinutes 420 and feeds null", async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 4 })
    const today = localDateAt(new Date(), UTC)
    await insertCheckin(testApp.db, { programId, localDate: today, sleepMinutes: 420 })

    const { body } = await getTodayResponse(testApp.app, programId)
    expect(body.checkin.status).toBe('incomplete')
    expect(body.checkin.missing).toEqual(['feed'])
    expect(body.checkin.values).toEqual({ sleepMinutes: 420, phoneFeedMinutes: null, desktopFeedMinutes: null })
  })

  it("(4) no check-in -> 'not_reported', missing ['sleep','feed'], values all null", async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 4 })

    const { body } = await getTodayResponse(testApp.app, programId)
    expect(body.checkin.status).toBe('not_reported')
    expect(body.checkin.missing).toEqual(['sleep', 'feed'])
    expect(body.checkin.values).toEqual({ sleepMinutes: null, phoneFeedMinutes: null, desktopFeedMinutes: null })
  })

  it("(5) sleep + explicit-zero phone feed row -> 'complete', missing [], phoneFeedMinutes 0, desktopFeedMinutes null", async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 4 })
    const today = localDateAt(new Date(), UTC)
    await insertCheckin(testApp.db, {
      programId,
      localDate: today,
      sleepMinutes: 420,
      feed: [{ device: 'phone', platform: 'all', minutes: 0, measurementScope: 'feed' }],
    })

    const { body } = await getTodayResponse(testApp.app, programId)
    expect(body.checkin.status).toBe('complete')
    expect(body.checkin.missing).toEqual([])
    expect(body.checkin.values.phoneFeedMinutes).toBe(0)
    expect(body.checkin.values.desktopFeedMinutes).toBeNull()
  })

  it('(6) Days 4-5 qualifying at 900s, request on Day 6 -> no suggestion key (ceiling 900)', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 6, practiceTargetSeconds: 900 })
    const baselineDate = await baselineDateOf(testApp.db, programId)
    await insertQualifyingDay(testApp.db, programId, localDateForProgramDay(baselineDate, 4), 900)
    await insertQualifyingDay(testApp.db, programId, localDateForProgramDay(baselineDate, 5), 900)

    const { body } = await getTodayResponse(testApp.app, programId)
    expect('suggestion' in body).toBe(false)
  })

  it('(7) same rows on Day 8 -> suggestion { suggestedTargetSeconds 1200, qualifiedOn [Day 4 date, Day 5 date] }', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 8, practiceTargetSeconds: 900 })
    const baselineDate = await baselineDateOf(testApp.db, programId)
    const day4Date = localDateForProgramDay(baselineDate, 4)
    const day5Date = localDateForProgramDay(baselineDate, 5)
    await insertQualifyingDay(testApp.db, programId, day4Date, 900)
    await insertQualifyingDay(testApp.db, programId, day5Date, 900)

    const { body } = await getTodayResponse(testApp.app, programId)
    expect(body.suggestion).toEqual({ suggestedTargetSeconds: 1200, qualifiedOn: [day4Date, day5Date] })
  })

  it('(8) one Partly block on Day 5 -> no suggestion', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 8, practiceTargetSeconds: 900 })
    const baselineDate = await baselineDateOf(testApp.db, programId)
    await insertQualifyingDay(testApp.db, programId, localDateForProgramDay(baselineDate, 4), 900)
    await insertQualifyingDay(testApp.db, programId, localDateForProgramDay(baselineDate, 5), 900, { outputQuality: 'partly' })

    const { body } = await getTodayResponse(testApp.app, programId)
    expect('suggestion' in body).toBe(false)
  })

  it('(9) episode_count NULL on one block -> no suggestion (unknown != zero)', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 8, practiceTargetSeconds: 900 })
    const baselineDate = await baselineDateOf(testApp.db, programId)
    await insertQualifyingDay(testApp.db, programId, localDateForProgramDay(baselineDate, 4), 900)
    await insertQualifyingDay(testApp.db, programId, localDateForProgramDay(baselineDate, 5), 900, { episodeCount: null })

    const { body } = await getTodayResponse(testApp.app, programId)
    expect('suggestion' in body).toBe(false)
  })

  it('(10) two consecutive GETs on Day 8 return the identical suggestion (no server-side hold state)', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 8, practiceTargetSeconds: 900 })
    const baselineDate = await baselineDateOf(testApp.db, programId)
    await insertQualifyingDay(testApp.db, programId, localDateForProgramDay(baselineDate, 4), 900)
    await insertQualifyingDay(testApp.db, programId, localDateForProgramDay(baselineDate, 5), 900)

    const first = await getTodayResponse(testApp.app, programId)
    const second = await getTodayResponse(testApp.app, programId)
    expect(first.body.suggestion).toBeDefined()
    expect(second.body.suggestion).toEqual(first.body.suggestion)
  })

  it("(11) accept via POST revisions reason 'progression accepted' 1200 -> next GET has no suggestion and blocks[].targetSeconds 1200", async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 8, practiceTargetSeconds: 900 })
    const baselineDate = await baselineDateOf(testApp.db, programId)
    await insertQualifyingDay(testApp.db, programId, localDateForProgramDay(baselineDate, 4), 900)
    await insertQualifyingDay(testApp.db, programId, localDateForProgramDay(baselineDate, 5), 900)

    const before = await getTodayResponse(testApp.app, programId)
    expect(before.body.suggestion?.suggestedTargetSeconds).toBe(1200)

    const revisionRes = await postRevision(testApp.app, programId, {
      effectiveDay: 8,
      settings: { practiceTargetSeconds: 1200 },
      reason: 'progression accepted',
    })
    expect(revisionRes.statusCode).toBe(201)

    const after = await getTodayResponse(testApp.app, programId)
    expect('suggestion' in after.body).toBe(false)
    expect(after.body.blocks[0]?.targetSeconds).toBe(1200)
    expect(after.body.blocks[1]?.targetSeconds).toBe(1200)
  })

  it('(12) a benchmark session inserted today -> not a block', async () => {
    const { programId, slots } = await seedActiveProgram(testApp.db, { day: 4 })
    const today = localDateAt(new Date(), UTC)
    const { sessionId: benchmarkId } = await insertSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.finalA,
      lifecycle: 'running',
      localDate: today,
      startedAt: new Date(),
      targetSeconds: 1200,
    })

    const { body } = await getTodayResponse(testApp.app, programId)
    expect(body.blocks.map((b) => b.status)).toEqual(['not_started', 'not_started'])
    expect(body.blocks.every((b) => b.sessionId !== benchmarkId)).toBe(true)
  })

  it("(13) a practice row with realm 'pilot' in the suggestion window -> 422 realm_mismatch, not silently filtered", async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 6 })
    const baselineDate = await baselineDateOf(testApp.db, programId)
    const day4Date = localDateForProgramDay(baselineDate, 4)

    await insertSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'finalized',
      localDate: day4Date,
      startedAt: new Date(`${day4Date}T08:00:00.000Z`),
      endedAt: new Date(`${day4Date}T08:15:00.000Z`),
      targetSeconds: 600,
      completeInterval: true,
      realm: 'pilot',
    })

    const { statusCode, body } = await getTodayResponse(testApp.app, programId)
    expect(statusCode).toBe(422)
    const errBody = body as unknown as ErrorBody
    expect(errBody.code).toBe('realm_mismatch')
  })

  it('(14) setDemoOffsetSeconds +4 days on a Day-0 seeded program -> day 4', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 0 })
    await setDemoOffsetSeconds(testApp.db, 4 * 24 * 60 * 60)

    const { body } = await getTodayResponse(testApp.app, programId)
    expect(body.day).toBe(4)
  })

  it('(15) Day 15 with finals pending -> nextAction final A (D23)', async () => {
    const { programId, slots } = await seedActiveProgram(testApp.db, { day: 15 })

    const { body } = await getTodayResponse(testApp.app, programId)
    expect(body.nextAction).toEqual({ kind: 'final', slotId: slots.finalA })
  })

  it('(16) Day 14 -> nextAction final A', async () => {
    const { programId, slots } = await seedActiveProgram(testApp.db, { day: 14 })

    const { body } = await getTodayResponse(testApp.app, programId)
    expect(body.nextAction).toEqual({ kind: 'final', slotId: slots.finalA })
  })

  it(
    '(17) Day 14 with a finalized complete practice session today -> blocks [completed, not_started], nextAction still final A ' +
      '(practice never fills a benchmark slot)',
    async () => {
      const { programId, slots } = await seedActiveProgram(testApp.db, { day: 14 })
      const today = localDateAt(new Date(), UTC)
      await insertSession(testApp.db, {
        programId,
        kind: 'practice',
        lifecycle: 'finalized',
        localDate: today,
        startedAt: new Date(),
        endedAt: new Date(),
        targetSeconds: 600,
        completeInterval: true,
      })

      const { body } = await getTodayResponse(testApp.app, programId)
      expect(body.blocks.map((b) => b.status)).toEqual(['completed', 'not_started'])
      expect(body.nextAction).toEqual({ kind: 'final', slotId: slots.finalA })
    },
  )

  it("(18) another principal's program -> 404", async () => {
    const { programId } = await insertOtherPrincipalProgram(testApp.db)

    const { statusCode } = await getTodayResponse(testApp.app, programId)
    expect(statusCode).toBe(404)
  })

  it('(19) Cache-Control: no-store present', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 4 })

    const { headers } = await getTodayResponse(testApp.app, programId)
    expect(headers['cache-control']).toBe('no-store')
  })

  it('(20) phone app_total 60 alongside phone feed 25 -> phoneFeedMinutes 25 (app totals never summed)', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 4 })
    const today = localDateAt(new Date(), UTC)
    await insertCheckin(testApp.db, {
      programId,
      localDate: today,
      sleepMinutes: 420,
      feed: [
        { device: 'phone', platform: 'all', minutes: 25, measurementScope: 'feed' },
        { device: 'phone', platform: 'browser', minutes: 60, measurementScope: 'app_total', source: 'device_report' },
      ],
    })

    const { body } = await getTodayResponse(testApp.app, programId)
    expect(body.checkin.values.phoneFeedMinutes).toBe(25)
  })
})
