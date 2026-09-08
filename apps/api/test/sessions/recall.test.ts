/**
 * 5.7.2 — Fastify inject integration tests for `POST /sessions/{id}/recall`,
 * against the real `attention_lab_test` database via `buildTestApp` (3.2.1).
 * Composes 5.1.3's session seed helpers (plus this task's own `lockRecall`
 * API helper) with 4.1.1's program helpers, per D16 — no lower layer is
 * re-created here. The pure decision core (`decideRecallLock`) is unit
 * tested directly in `test/services/recall.unit.test.ts`; this file
 * exercises the route's own concerns: ownership, idempotency, the
 * state-based lock independent of the idempotency key, the D20/2.7 response
 * shape, and log privacy for the 409 `recall_locked` response.
 */
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import { insertOtherPrincipalProgram, insertProgram, insertSlotSet } from '../helpers/programs.js'
import { lockRecall, seedSession, withIdempotencyKey } from '../helpers/sessions.js'
import { sessionReviews } from '../../src/db/schema/index.js'

const BASE_PROGRAM = {
  baselineDate: '2026-09-06',
  timezone: 'UTC',
  status: 'active' as const,
  practiceTargetSeconds: 600,
}

function secondsAgo(seconds: number): Date {
  return new Date(Date.now() - seconds * 1000)
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000)
}

interface ErrorBody {
  code: string
  message: string
}

interface ReviewBody {
  sessionId: string
  recallPoints: string[] | null
  recallStartedAt: string | null
  recallLockedAt: string | null
  recallDelaySeconds: number | null
  recallDurationSeconds: number | null
  recallFlags: string[]
  recallScores: (0 | 1)[] | null
  recallScore: number | null
  version: number
}

interface SessionBody {
  id: string
  review: ReviewBody
}

async function getSession(testApp: TestApp, sessionId: string) {
  return testApp.app.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}` })
}

async function reviewRow(testApp: TestApp, sessionId: string) {
  const [row] = await testApp.db
    .select()
    .from(sessionReviews)
    .where(eq(sessionReviews.sessionId, sessionId))
    .limit(1)
  if (!row) throw new Error(`reviewRow: no session_reviews row for '${sessionId}'`)
  return row
}

async function reviewRowCount(testApp: TestApp, sessionId: string): Promise<number> {
  const [row] = await testApp.db
    .select({ count: sql<string>`count(*)` })
    .from(sessionReviews)
    .where(eq(sessionReviews.sessionId, sessionId))
  return Number(row?.count ?? 0)
}

describe('POST /sessions/{id}/recall (integration, attention_lab_test)', () => {
  let testApp: TestApp

  beforeAll(async () => {
    testApp = await buildTestApp()
  })

  beforeEach(async () => {
    await testApp.truncateAll()
  })

  afterAll(async () => {
    await testApp.close()
  })

  it('(1) benchmark ended 40 s ago -> 200, recall_delay_seconds 40, recall_flags [], recall_locked_at = ctx.now', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const now = new Date()
    const endedAt = new Date(now.getTime() - 40_000)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(21),
      endedAt,
      completeInterval: true,
    })

    const before = Date.now()
    const res = await lockRecall(testApp.app, sessionId, {
      startedAt: now.toISOString(),
      durationSeconds: 30,
    })
    const after = Date.now()

    expect(res.statusCode).toBe(200)
    const body = res.body as ReviewBody
    expect(body.recallDelaySeconds).toBe(40)
    expect(body.recallFlags).toEqual([])
    expect(body.recallLockedAt).not.toBeNull()
    const lockedAtMs = new Date(body.recallLockedAt!).getTime()
    expect(lockedAtMs).toBeGreaterThanOrEqual(before - 1000)
    expect(lockedAtMs).toBeLessThanOrEqual(after + 1000)
  })

  it("(2) ended 1500 s ago -> 200 with recall_flags ['recall_delayed'] (deviation, not rejection)", async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const now = new Date()
    const endedAt = new Date(now.getTime() - 1500_000)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'awaiting_review',
      startedAt: new Date(endedAt.getTime() - 20 * 60_000),
      endedAt,
      completeInterval: true,
    })

    const res = await lockRecall(testApp.app, sessionId, {
      startedAt: now.toISOString(),
      durationSeconds: 30,
    })

    expect(res.statusCode).toBe(200)
    const body = res.body as ReviewBody
    expect(body.recallDelaySeconds).toBe(1500)
    expect(body.recallFlags).toEqual(['recall_delayed'])
  })

  it("(3) durationSeconds 230 -> ['recall_overrun']", async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const now = new Date()
    const endedAt = new Date(now.getTime() - 20_000)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(21),
      endedAt,
      completeInterval: true,
    })

    const res = await lockRecall(testApp.app, sessionId, {
      startedAt: now.toISOString(),
      durationSeconds: 230,
    })

    expect(res.statusCode).toBe(200)
    const body = res.body as ReviewBody
    expect(body.recallFlags).toEqual(['recall_overrun'])
  })

  it('(4) same key + same body -> 200 identical review, one session_reviews row, recall_locked_at unchanged', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const endedAt = secondsAgo(60)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(21),
      endedAt,
      completeInterval: true,
    })

    const key = randomUUID()
    const overrides = { startedAt: new Date().toISOString(), durationSeconds: 30 }

    const first = await lockRecall(testApp.app, sessionId, overrides, key)
    expect(first.statusCode).toBe(200)
    const second = await lockRecall(testApp.app, sessionId, overrides, key)
    expect(second.statusCode).toBe(200)

    expect(second.body).toEqual(first.body)
    expect(await reviewRowCount(testApp, sessionId)).toBe(1)
    const firstBody = first.body as ReviewBody
    const secondBody = second.body as ReviewBody
    expect(secondBody.recallLockedAt).toBe(firstBody.recallLockedAt)
  })

  it('(5) new key + same points -> 200 unchanged', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    // A wide gap between endedAt and now so the second call's later
    // startedAt (900 s after endedAt) still lands at or before now.
    const endedAt = secondsAgo(1000)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(41),
      endedAt,
      completeInterval: true,
    })

    const points: [string, string, string, string, string] = ['a', 'b', 'c', 'd', 'e']
    const first = await lockRecall(testApp.app, sessionId, {
      points,
      startedAt: new Date(endedAt.getTime() + 10_000).toISOString(),
      durationSeconds: 30,
    })
    expect(first.statusCode).toBe(200)
    const firstBody = first.body as ReviewBody

    // A brand new idempotency key, the same points, but a DIFFERENT
    // startedAt/duration that would compute a flagged, different delay if it
    // were ever recomputed -- the state-based lock must ignore all of that
    // and return the ORIGINAL stored review untouched.
    const second = await lockRecall(testApp.app, sessionId, {
      points,
      startedAt: new Date(endedAt.getTime() + 900_000).toISOString(),
      durationSeconds: 999,
    })
    expect(second.statusCode).toBe(200)
    const secondBody = second.body as ReviewBody

    expect(secondBody.recallLockedAt).toBe(firstBody.recallLockedAt)
    expect(secondBody.recallDelaySeconds).toBe(firstBody.recallDelaySeconds)
    expect(secondBody.recallDurationSeconds).toBe(firstBody.recallDurationSeconds)
    expect(secondBody.recallFlags).toEqual(firstBody.recallFlags)
  })

  it('(6) new key + different point 3 -> 409 recall_locked and stored points unchanged', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const endedAt = secondsAgo(60)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(21),
      endedAt,
      completeInterval: true,
    })

    const points: [string, string, string, string, string] = ['a', 'b', 'c', 'd', 'e']
    const first = await lockRecall(testApp.app, sessionId, {
      points,
      startedAt: new Date(endedAt.getTime() + 10_000).toISOString(),
      durationSeconds: 30,
    })
    expect(first.statusCode).toBe(200)

    const changed: [string, string, string, string, string] = ['a', 'b', 'DIFFERENT', 'd', 'e']
    const second = await lockRecall(testApp.app, sessionId, {
      points: changed,
      startedAt: new Date(endedAt.getTime() + 10_000).toISOString(),
      durationSeconds: 30,
    })
    expect(second.statusCode).toBe(409)
    expect((second.body as ErrorBody).code).toBe('recall_locked')

    const row = await reviewRow(testApp, sessionId)
    expect(row.recallPoints).toEqual(points)
  })

  it('(7) same key + different body -> 409 idempotency_mismatch', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const endedAt = secondsAgo(60)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(21),
      endedAt,
      completeInterval: true,
    })

    const key = randomUUID()
    const first = await lockRecall(
      testApp.app,
      sessionId,
      { startedAt: new Date(endedAt.getTime() + 10_000).toISOString(), durationSeconds: 30 },
      key,
    )
    expect(first.statusCode).toBe(200)

    const second = await lockRecall(
      testApp.app,
      sessionId,
      { startedAt: new Date(endedAt.getTime() + 10_000).toISOString(), durationSeconds: 999 },
      key,
    )
    expect(second.statusCode).toBe(409)
    expect((second.body as ErrorBody).code).toBe('idempotency_mismatch')
  })

  it('(8) practice awaiting_review -> 422 benchmark_only', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      targetSeconds: 600,
      lifecycle: 'awaiting_review',
      endedAt: secondsAgo(30),
    })

    const res = await lockRecall(testApp.app, sessionId)
    expect(res.statusCode).toBe(422)
    expect((res.body as ErrorBody).code).toBe('benchmark_only')
  })

  it('(9) benchmark still running -> 409 interval_not_ended', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'running',
    })

    const res = await lockRecall(testApp.app, sessionId)
    expect(res.statusCode).toBe(409)
    expect((res.body as ErrorBody).code).toBe('interval_not_ended')
  })

  it('(10) finalized -> 409 session_not_active', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'finalized',
      endedAt: secondsAgo(500),
      completeInterval: true,
    })

    const res = await lockRecall(testApp.app, sessionId)
    expect(res.statusCode).toBe(409)
    expect((res.body as ErrorBody).code).toBe('session_not_active')
  })

  it('(11) missing Idempotency-Key -> 400', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'awaiting_review',
      endedAt: secondsAgo(60),
      completeInterval: true,
    })

    const res = await testApp.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/recall`,
      payload: {
        points: ['a', 'b', 'c', 'd', 'e'],
        startedAt: new Date().toISOString(),
        durationSeconds: 30,
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('(12) points array of length 4 -> 400', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'awaiting_review',
      endedAt: secondsAgo(60),
      completeInterval: true,
    })

    const res = await testApp.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/recall`,
      headers: withIdempotencyKey(),
      payload: {
        points: ['a', 'b', 'c', 'd'],
        startedAt: new Date().toISOString(),
        durationSeconds: 30,
      },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as ErrorBody).code).toBe('malformed_request')
  })

  it("(13) two blank points -> 200 with '' preserved", async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const endedAt = secondsAgo(60)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(21),
      endedAt,
      completeInterval: true,
    })

    const points: [string, string, string, string, string] = ['a', '', 'c', '', 'e']
    const res = await lockRecall(testApp.app, sessionId, {
      points,
      startedAt: new Date(endedAt.getTime() + 10_000).toISOString(),
      durationSeconds: 30,
    })

    expect(res.statusCode).toBe(200)
    expect((res.body as ReviewBody).recallPoints).toEqual(points)
  })

  it('(14) early-stopped benchmark (complete_interval false) -> 200 (recall on an incomplete benchmark is allowed, D25)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const endedAt = secondsAgo(30)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(14),
      endedAt,
      completeInterval: false,
    })

    const res = await lockRecall(testApp.app, sessionId, {
      startedAt: new Date(endedAt.getTime() + 5_000).toISOString(),
      durationSeconds: 30,
    })
    expect(res.statusCode).toBe(200)
  })

  it('(15) startedAt before ended_at -> 422 recall_before_interval_end', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const endedAt = secondsAgo(30)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(21),
      endedAt,
      completeInterval: true,
    })

    const res = await lockRecall(testApp.app, sessionId, {
      startedAt: new Date(endedAt.getTime() - 5_000).toISOString(),
      durationSeconds: 30,
    })
    expect(res.statusCode).toBe(422)
    expect((res.body as ErrorBody).code).toBe('recall_before_interval_end')
  })

  it('(16) startedAt after ctx.now -> 422 recall_before_interval_end', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const endedAt = secondsAgo(30)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(21),
      endedAt,
      completeInterval: true,
    })

    const res = await lockRecall(testApp.app, sessionId, {
      startedAt: new Date(Date.now() + 3_600_000).toISOString(),
      durationSeconds: 30,
    })
    expect(res.statusCode).toBe(422)
    expect((res.body as ErrorBody).code).toBe('recall_before_interval_end')
  })

  it('(17) GET /sessions/{id} shows recallPoints, recallFlags, recallLockedAt, recallDelaySeconds', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    // Wide enough gap that endedAt + 700s still lands at or before now.
    const endedAt = secondsAgo(1000)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(41),
      endedAt,
      completeInterval: true,
    })

    const points: [string, string, string, string, string] = ['a', 'b', 'c', 'd', 'e']
    const lockRes = await lockRecall(testApp.app, sessionId, {
      points,
      startedAt: new Date(endedAt.getTime() + 700_000).toISOString(),
      durationSeconds: 30,
    })
    expect(lockRes.statusCode).toBe(200)

    const getRes = await getSession(testApp, sessionId)
    expect(getRes.statusCode).toBe(200)
    const body = getRes.json() as SessionBody
    expect(body.review.recallPoints).toEqual(points)
    expect(body.review.recallFlags).toEqual(['recall_delayed'])
    expect(body.review.recallLockedAt).not.toBeNull()
    expect(body.review.recallDelaySeconds).toBe(700)
  })

  it("(18) another principal's session -> 404", async () => {
    const other = await insertOtherPrincipalProgram(testApp.db)
    const otherSlots = await insertSlotSet(testApp.db, other.programId)
    const { sessionId } = await seedSession(testApp.db, {
      userId: other.userId,
      programId: other.programId,
      kind: 'benchmark',
      slotId: otherSlots.baselineA,
      lifecycle: 'running',
      targetSeconds: 1200,
    })

    const res = await lockRecall(testApp.app, sessionId)
    expect(res.statusCode).toBe(404)
  })

  it('(19) log capture: point texts absent from Pino output for the 409 recall_locked response', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const endedAt = secondsAgo(60)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(21),
      endedAt,
      completeInterval: true,
    })

    const originalPoints: [string, string, string, string, string] = [
      'PRIVATE-RECALL-orig-1',
      'PRIVATE-RECALL-orig-2',
      'PRIVATE-RECALL-orig-3',
      'PRIVATE-RECALL-orig-4',
      'PRIVATE-RECALL-orig-5',
    ]
    const first = await lockRecall(testApp.app, sessionId, {
      points: originalPoints,
      startedAt: new Date(endedAt.getTime() + 10_000).toISOString(),
      durationSeconds: 30,
    })
    expect(first.statusCode).toBe(200)

    const conflictingPoints: [string, string, string, string, string] = [
      'PRIVATE-RECALL-orig-1',
      'PRIVATE-RECALL-conflict-2',
      'PRIVATE-RECALL-orig-3',
      'PRIVATE-RECALL-orig-4',
      'PRIVATE-RECALL-orig-5',
    ]
    const second = await lockRecall(testApp.app, sessionId, {
      points: conflictingPoints,
      startedAt: new Date(endedAt.getTime() + 10_000).toISOString(),
      durationSeconds: 30,
    })
    expect(second.statusCode).toBe(409)
    expect((second.body as ErrorBody).code).toBe('recall_locked')

    const logText = testApp.logs.text()
    for (const point of originalPoints) {
      expect(logText).not.toContain(point)
    }
    for (const point of conflictingPoints) {
      expect(logText).not.toContain(point)
    }
    expect(JSON.stringify(second.body)).not.toContain('PRIVATE-RECALL')
  })
})
