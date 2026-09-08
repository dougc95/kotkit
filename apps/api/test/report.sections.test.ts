/**
 * Task 6.2.4 — integration tests for the report's `practice[]` and `days[]`
 * sections (`GET /api/v1/programs/{id}/report`) against the real
 * `attention_lab_test` database. Follows `report.core.test.ts`'s (6.2.1) own
 * conventions: precise fixtures via `insertProgram`/`insertSlotSet`/
 * `seedSession`/`insertCheckin`, and the real demo scenario
 * (`comparable-change`) via `POST /demo/scenarios/{name}/load` for the two
 * cases that need a full comparison already encoded.
 */
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { ReportResponseValue } from '@attention-lab/shared'
import { localDateForProgramDay } from '@attention-lab/shared'

import type { AppDatabase } from '../src/plugins/db.js'
import { dailyCheckins } from '../src/db/schema/dailyCheckins.js'
import { programs } from '../src/db/schema/programs.js'
import { buildTestApp, type TestApp } from './helpers/buildTestApp.js'
import { baselineDateDaysAgo, insertCheckin, insertProgram, insertSlotSet } from './helpers/programs.js'
import { seedSession } from './helpers/sessions.js'

const TZ = 'UTC'

async function getReport(app: FastifyInstance, programId: string) {
  return app.inject({ method: 'GET', url: `/api/v1/programs/${programId}/report` })
}

async function loadScenarioViaRoute(app: FastifyInstance, name: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: `/api/v1/demo/scenarios/${name}/load` })
  expect(res.statusCode).toBe(200)
  const body = res.json() as { programId: string | null }
  if (body.programId === null) {
    throw new Error(`loadScenarioViaRoute: scenario "${name}" produced no program`)
  }
  return body.programId
}

async function loadBaselineDate(db: AppDatabase, programId: string): Promise<string> {
  const [row] = await db
    .select({ baselineDate: programs.baselineDate })
    .from(programs)
    .where(eq(programs.id, programId))
    .limit(1)
  if (!row) throw new Error(`loadBaselineDate: no program ${programId}`)
  return row.baselineDate
}

describe('GET /api/v1/programs/{id}/report — practice[] and days[] (6.2.4, integration, attention_lab_test)', () => {
  let testApp: TestApp
  let app: FastifyInstance
  let db: AppDatabase

  beforeAll(async () => {
    testApp = await buildTestApp()
    app = testApp.app
    db = testApp.db
  })

  afterAll(async () => {
    await testApp.close()
  })

  beforeEach(async () => {
    await testApp.truncateAll()
  })

  it('practice growth: sessions with target 600, 900, 1500 s across days → practice[].targetSeconds ascending and comparison/resultState identical to the report taken before the practice rows were inserted', async () => {
    const programId = await loadScenarioViaRoute(app, 'comparable-change')

    const before = await getReport(app, programId)
    expect(before.statusCode).toBe(200)
    const beforeBody = before.json() as ReportResponseValue

    const baselineDate = await loadBaselineDate(db, programId)
    const plan: ReadonlyArray<{ day: number; targetSeconds: number }> = [
      { day: 2, targetSeconds: 600 },
      { day: 5, targetSeconds: 900 },
      { day: 8, targetSeconds: 1500 },
    ]
    for (const { day, targetSeconds } of plan) {
      const localDate = localDateForProgramDay(baselineDate, day)
      await seedSession(db, {
        programId,
        kind: 'practice',
        lifecycle: 'finalized',
        localDate,
        startedAt: new Date(`${localDate}T09:00:00.000Z`),
        endedAt: new Date(`${localDate}T09:${String(Math.floor(targetSeconds / 60)).padStart(2, '0')}:00.000Z`),
        targetSeconds,
        review: { episodeCount: 1, countMethod: 'event' },
      })
    }

    const after = await getReport(app, programId)
    expect(after.statusCode).toBe(200)
    const afterBody = after.json() as ReportResponseValue

    expect(afterBody.practice.map((row) => row.targetSeconds)).toEqual([600, 900, 1500])
    expect(afterBody.comparison).toEqual(beforeBody.comparison)
    expect(afterBody.resultState).toBe(beforeBody.resultState)
  })

  it("Day 9 with no check-in → days[9] is not_reported while days[10] is present", async () => {
    const baselineDate = baselineDateDaysAgo(10, TZ)
    const { programId } = await insertProgram(db, {
      baselineDate,
      timezone: TZ,
      status: 'active',
      practiceTargetSeconds: 600,
    })
    const day10Date = localDateForProgramDay(baselineDate, 10)
    await insertCheckin(db, { programId, localDate: day10Date, sleepMinutes: 420 })

    const res = await getReport(app, programId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as ReportResponseValue

    const day9 = body.days.find((row) => row.day === 9)
    const day10 = body.days.find((row) => row.day === 10)
    expect(day9).toBeDefined()
    expect(day9?.status).toBe('not_reported')
    expect(day9?.sleepMinutes).toBeNull()
    expect(day10).toBeDefined()
    expect(day10?.status).toBe('incomplete')
    expect(day10?.sleepMinutes).toBe(420)
  })

  it('benchmark attempts never appear in practice[] and practice sessions never appear in attempts[]', async () => {
    const { programId } = await insertProgram(db, {
      baselineDate: '2026-01-01',
      timezone: TZ,
      status: 'active',
      practiceTargetSeconds: 600,
    })
    const slots = await insertSlotSet(db, programId)

    const { sessionId: benchmarkId } = await seedSession(db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      lifecycle: 'finalized',
      localDate: '2026-01-01',
      startedAt: new Date('2026-01-01T09:00:00.000Z'),
      endedAt: new Date('2026-01-01T09:20:00.000Z'),
      targetSeconds: 1200,
      completeInterval: true,
      eligible: true,
      exclusionReasons: [],
      review: { episodeCount: 4, recallScore: 4, countMethod: 'event' },
    })
    const { sessionId: practiceId } = await seedSession(db, {
      programId,
      kind: 'practice',
      lifecycle: 'finalized',
      localDate: '2026-01-02',
      startedAt: new Date('2026-01-02T09:00:00.000Z'),
      endedAt: new Date('2026-01-02T09:10:00.000Z'),
      targetSeconds: 600,
      review: { episodeCount: 1, countMethod: 'event' },
    })

    const res = await getReport(app, programId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as ReportResponseValue

    expect(body.attempts.some((attempt) => attempt.attemptId === benchmarkId)).toBe(true)
    expect(body.attempts.some((attempt) => attempt.attemptId === practiceId)).toBe(false)
    expect(body.practice.some((row) => row.sessionId === practiceId)).toBe(true)
    expect(body.practice.some((row) => row.sessionId === benchmarkId)).toBe(false)
  })

  it('practice review with blank S → episodeCount null in practice[]', async () => {
    const { programId } = await insertProgram(db, {
      baselineDate: '2026-01-01',
      timezone: TZ,
      status: 'active',
      practiceTargetSeconds: 600,
    })
    const { sessionId } = await seedSession(db, {
      programId,
      kind: 'practice',
      lifecycle: 'finalized',
      localDate: '2026-01-01',
      startedAt: new Date('2026-01-01T09:00:00.000Z'),
      endedAt: new Date('2026-01-01T09:10:00.000Z'),
      targetSeconds: 600,
      review: { episodeCount: null },
    })

    const res = await getReport(app, programId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as ReportResponseValue

    const row = body.practice.find((entry) => entry.sessionId === sessionId)
    expect(row?.episodeCount).toBeNull()
  })

  it('finalized practice session on Day 14 of the comparable-change scenario → appears in practice[] with day 14 and comparison/resultState unchanged', async () => {
    const programId = await loadScenarioViaRoute(app, 'comparable-change')

    const before = await getReport(app, programId)
    expect(before.statusCode).toBe(200)
    const beforeBody = before.json() as ReportResponseValue

    const baselineDate = await loadBaselineDate(db, programId)
    const day14Date = localDateForProgramDay(baselineDate, 14)
    const { sessionId } = await seedSession(db, {
      programId,
      kind: 'practice',
      lifecycle: 'finalized',
      localDate: day14Date,
      startedAt: new Date(`${day14Date}T09:00:00.000Z`),
      endedAt: new Date(`${day14Date}T09:10:00.000Z`),
      targetSeconds: 600,
      review: { episodeCount: 1, countMethod: 'event' },
    })

    const after = await getReport(app, programId)
    expect(after.statusCode).toBe(200)
    const afterBody = after.json() as ReportResponseValue

    const row = afterBody.practice.find((entry) => entry.sessionId === sessionId)
    expect(row?.day).toBe(14)
    expect(afterBody.comparison).toEqual(beforeBody.comparison)
    expect(afterBody.resultState).toBe(beforeBody.resultState)
  })

  it('pilot-realm daily_checkins row under the demo program → 422 realm_mismatch', async () => {
    const programId = await loadScenarioViaRoute(app, 'comparable-change')

    await db.insert(dailyCheckins).values({
      programId,
      realm: 'pilot',
      localDate: '2026-01-01',
      sleepMinutes: 420,
    })

    const res = await getReport(app, programId)
    expect(res.statusCode).toBe(422)
    const body = res.json() as { code: string; message: string }
    expect(body.code).toBe('realm_mismatch')
    expect(body.message).toBe('Simulated and real results are never combined.')
  })
})
