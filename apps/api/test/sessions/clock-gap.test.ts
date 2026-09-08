/**
 * 5.5.1 — Fastify inject integration tests for
 * `POST /sessions/{id}/clock-gap`, against the real `attention_lab_test`
 * database via `buildTestApp` (3.2.1). Composes 5.1.3's session seed helpers
 * with 4.1.1's program helpers (D16) — no lower layer is re-created here.
 * The pure decision core (`computeClockGapPatch`, `endSession`) is unit
 * tested directly in `test/services/clock-gap.unit.test.ts` (5.5.1); this
 * file exercises the route's own concerns: ownership, the terminal-lifecycle
 * 409, the D20 response shape, and that finalize's own fields
 * (`session_reviews.finalized_at`, `eligible`) are never touched here.
 */
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import { insertOtherPrincipalProgram, insertProgram, insertSlotSet } from '../helpers/programs.js'
import { seedSession } from '../helpers/sessions.js'
import { focusSessions, sessionReviews } from '../../src/db/schema/index.js'

const BASE_PROGRAM = {
  baselineDate: '2026-09-06',
  timezone: 'UTC',
  status: 'active' as const,
  practiceTargetSeconds: 600,
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000)
}

function secondsAgo(seconds: number): Date {
  return new Date(Date.now() - seconds * 1000)
}

async function postClockGap(app: FastifyInstance, sessionId: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/clock-gap`,
    payload: body,
  })
}

async function postTransition(app: FastifyInstance, sessionId: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/transitions`,
    payload: body,
  })
}

async function getSession(app: FastifyInstance, sessionId: string) {
  return app.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}` })
}

interface ErrorBody {
  code: string
  message: string
}

interface SessionBody {
  id: string
  lifecycle: string
  version: number
  pausedSeconds: number
  currentPauseStartedAt: string | null
  endedAt: string | null
  completeInterval: boolean | null
  eligible: boolean | null
  timerQuality: string
  clockGapSeconds: number | null
  review: { finalizedAt: string | null }
}

async function reviewRow(testApp: TestApp, sessionId: string) {
  const [row] = await testApp.db.select().from(sessionReviews).where(eq(sessionReviews.sessionId, sessionId)).limit(1)
  if (!row) throw new Error(`reviewRow: no session_reviews row for '${sessionId}'`)
  return row
}

async function loadFocusSessionRow(testApp: TestApp, sessionId: string) {
  const [row] = await testApp.db.select().from(focusSessions).where(eq(focusSessions.id, sessionId)).limit(1)
  if (!row) throw new Error(`loadFocusSessionRow: no focus_sessions row for '${sessionId}'`)
  return row
}

describe('POST /sessions/{id}/clock-gap (integration, attention_lab_test)', () => {
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

  it('(1) benchmark running + continued 300 -> 200, timer_quality ok, clock_gap_seconds 300, version+1, lifecycle running, eligible null', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'running',
    })

    const res = await postClockGap(testApp.app, sessionId, { gapSeconds: 300, resolution: 'continued' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.timerQuality).toBe('ok')
    expect(body.clockGapSeconds).toBe(300)
    expect(body.version).toBe(2)
    expect(body.lifecycle).toBe('running')
    expect(body.eligible).toBeNull()
  })

  it('(2) benchmark running + uncertain -> timer_quality uncertain, lifecycle running, finalized_at null', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'running',
    })

    const res = await postClockGap(testApp.app, sessionId, { gapSeconds: 90, resolution: 'uncertain' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.timerQuality).toBe('uncertain')
    expect(body.lifecycle).toBe('running')
    expect(body.review.finalizedAt).toBeNull()
  })

  it('(3) practice paused + uncertain -> timer_quality uncertain only: lifecycle paused, eligible null, exclusion_reasons empty, session_events count unchanged', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      lifecycle: 'paused',
      targetSeconds: 600,
      currentPauseStartedAt: secondsAgo(30),
    })

    const res = await postClockGap(testApp.app, sessionId, { gapSeconds: 20, resolution: 'uncertain' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.timerQuality).toBe('uncertain')
    expect(body.lifecycle).toBe('paused')
    expect(body.eligible).toBeNull()

    const row = await loadFocusSessionRow(testApp, sessionId)
    expect(row.exclusionReasons).toEqual([])

    const getBody = (await getSession(testApp.app, sessionId)).json() as SessionBody & { eventCount: number }
    expect(getBody.eventCount).toBe(0)
  })

  it('(4) benchmark running whose target passed during the gap (started_at 25 min ago) + continued 600 -> still running, no session_reviews.finalized_at; the following end transition yields awaiting_review, completeInterval true, still not finalized', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'running',
      startedAt: minutesAgo(25),
    })

    const gapRes = await postClockGap(testApp.app, sessionId, { gapSeconds: 600, resolution: 'continued' })
    expect(gapRes.statusCode).toBe(200)
    const gapBody = gapRes.json() as SessionBody
    expect(gapBody.lifecycle).toBe('running')
    expect(gapBody.review.finalizedAt).toBeNull()
    expect(gapBody.version).toBe(2)

    const endRes = await postTransition(testApp.app, sessionId, { expectedVersion: 2, type: 'end' })
    expect(endRes.statusCode).toBe(200)
    const endBody = endRes.json() as SessionBody
    expect(endBody.lifecycle).toBe('awaiting_review')
    expect(endBody.completeInterval).toBe(true)
    expect(endBody.lifecycle).not.toBe('finalized')
  })

  it('(5) benchmark running at 14 min -> save_incomplete -> 200 awaiting_review, ended_at = ctx.now, complete_interval false, timer_quality uncertain, clock_gap_seconds recorded, no session_reviews.finalized_at', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const startedAt = minutesAgo(14)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'running',
      startedAt,
    })

    const before = Date.now()
    const res = await postClockGap(testApp.app, sessionId, { gapSeconds: 120, resolution: 'save_incomplete' })
    const after = Date.now()
    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.lifecycle).toBe('awaiting_review')
    expect(body.completeInterval).toBe(false)
    expect(body.timerQuality).toBe('uncertain')
    expect(body.clockGapSeconds).toBe(120)
    expect(body.review.finalizedAt).toBeNull()
    expect(body.endedAt).not.toBeNull()
    const endedAtMs = new Date(body.endedAt!).getTime()
    expect(endedAtMs).toBeGreaterThanOrEqual(before - 1000)
    expect(endedAtMs).toBeLessThanOrEqual(after + 1000)
  })

  it('(6) practice paused for 240 s -> save_incomplete -> awaiting_review, paused_seconds 240, current_pause_started_at null', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      lifecycle: 'paused',
      targetSeconds: 600,
      pausedSeconds: 0,
      currentPauseStartedAt: secondsAgo(240),
    })

    const res = await postClockGap(testApp.app, sessionId, { gapSeconds: 15, resolution: 'save_incomplete' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.lifecycle).toBe('awaiting_review')
    expect(body.pausedSeconds).toBe(240)
    expect(body.currentPauseStartedAt).toBeNull()
  })

  it('(7) benchmark running with started_at seeded 25 min ago -> save_incomplete -> complete_interval false', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'running',
      startedAt: minutesAgo(25),
    })

    const res = await postClockGap(testApp.app, sessionId, { gapSeconds: 300, resolution: 'save_incomplete' })
    expect(res.statusCode).toBe(200)
    expect((res.json() as SessionBody).completeInterval).toBe(false)
  })

  it('(8) benchmark already awaiting_review -> save_incomplete -> ended_at unchanged, timer_quality uncertain', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const startedAt = minutesAgo(25)
    const endedAt = minutesAgo(5)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'awaiting_review',
      startedAt,
      endedAt,
      completeInterval: true,
    })

    const res = await postClockGap(testApp.app, sessionId, { gapSeconds: 30, resolution: 'save_incomplete' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.lifecycle).toBe('awaiting_review')
    expect(new Date(body.endedAt!).toISOString()).toBe(endedAt.toISOString())
    expect(body.timerQuality).toBe('uncertain')
  })

  it('(9) GET /sessions/{id} after save_incomplete shows lifecycle awaiting_review and timerQuality uncertain', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      lifecycle: 'running',
      targetSeconds: 600,
    })

    const gapRes = await postClockGap(testApp.app, sessionId, { gapSeconds: 60, resolution: 'save_incomplete' })
    expect(gapRes.statusCode).toBe(200)

    const getRes = await getSession(testApp.app, sessionId)
    expect(getRes.statusCode).toBe(200)
    const body = getRes.json() as SessionBody
    expect(body.lifecycle).toBe('awaiting_review')
    expect(body.timerQuality).toBe('uncertain')
  })

  it('(10) finalized session -> 409 session_not_active', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'finalized', targetSeconds: 600 })

    const res = await postClockGap(testApp.app, sessionId, { gapSeconds: 60, resolution: 'continued' })
    expect(res.statusCode).toBe(409)
    expect((res.json() as ErrorBody).code).toBe('session_not_active')
  })

  it('(11) abandoned session -> 409 session_not_active', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'abandoned', targetSeconds: 600 })

    const res = await postClockGap(testApp.app, sessionId, { gapSeconds: 60, resolution: 'uncertain' })
    expect(res.statusCode).toBe(409)
    expect((res.json() as ErrorBody).code).toBe('session_not_active')
  })

  it("(12) another principal's session -> 404", async () => {
    const other = await insertOtherPrincipalProgram(testApp.db)
    const { sessionId } = await seedSession(testApp.db, {
      userId: other.userId,
      programId: other.programId,
      lifecycle: 'running',
      targetSeconds: 600,
    })

    const res = await postClockGap(testApp.app, sessionId, { gapSeconds: 60, resolution: 'continued' })
    expect(res.statusCode).toBe(404)
  })

  it('(13) extra body field -> 400', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'running', targetSeconds: 600 })

    const res = await postClockGap(testApp.app, sessionId, {
      gapSeconds: 60,
      resolution: 'continued',
      expectedVersion: 1,
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as ErrorBody).code).toBe('malformed_request')
  })
})
