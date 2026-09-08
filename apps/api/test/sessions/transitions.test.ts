/**
 * 5.4.2 — Fastify inject integration tests for
 * `POST /sessions/{id}/transitions`, against the real `attention_lab_test`
 * database via `buildTestApp` (3.2.1). Composes 5.1.3's session seed helpers
 * with 4.1.1's program helpers, per D16 — no lower layer is re-created here.
 * Pure transition-table coverage (the 40-row matrix and the named
 * patch/eventRow scenarios) lives in `test/unit/sessionTransitions.test.ts`
 * (5.4.1); this file exercises the route's own concerns: ownership,
 * optimistic `expectedVersion` locking, the terminal-lifecycle 409, the
 * pause/resume event write, and the D20 response shape.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import {
  insertOtherPrincipalProgram,
  insertProgram,
  insertSlotSet,
  setDemoOffsetSeconds,
} from '../helpers/programs.js'
import { seedSession, withIdempotencyKey } from '../helpers/sessions.js'
import { focusSessions, sessionEvents } from '../../src/db/schema/index.js'

const BASE_PROGRAM = {
  baselineDate: '2026-09-06',
  timezone: 'UTC',
  status: 'active' as const,
  practiceTargetSeconds: 600,
}

async function postTransition(
  app: FastifyInstance,
  sessionId: string,
  body: Record<string, unknown>,
) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/transitions`,
    payload: body,
  })
}

async function getSession(app: FastifyInstance, sessionId: string) {
  return app.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}` })
}

async function getActive(app: FastifyInstance) {
  return app.inject({ method: 'GET', url: '/api/v1/sessions/active' })
}

async function postSession(
  app: FastifyInstance,
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    payload,
    headers: withIdempotencyKey(),
  })
}

interface ErrorBody {
  code: string
  message: string
  fieldErrors?: Record<string, string>
  details?: Record<string, unknown>
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
  timing: { elapsedSeconds: number; remainingSeconds: number; deadlineReached: boolean; isPaused: boolean }
  tallies: { offTask: number; external: number; agentChecks: number }
  eventCount: number
  events: Array<{ type: string; details: Record<string, unknown> }>
  review: { finalizedAt: string | null }
}

async function eventCountFor(testApp: TestApp, sessionId: string): Promise<number> {
  const rows = await testApp.db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId))
  return rows.length
}

async function loadFocusSessionRow(testApp: TestApp, sessionId: string) {
  const [row] = await testApp.db.select().from(focusSessions).where(eq(focusSessions.id, sessionId)).limit(1)
  if (!row) throw new Error(`loadFocusSessionRow: no focus_sessions row for '${sessionId}'`)
  return row
}

describe('POST /sessions/{id}/transitions (integration, attention_lab_test)', () => {
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

  it('(1) benchmark pause -> 422 invalid_transition, lifecycle running, version unchanged, no pause event', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'running',
    })

    const res = await postTransition(testApp.app, sessionId, { expectedVersion: 1, type: 'pause' })
    expect(res.statusCode).toBe(422)
    expect((res.json() as ErrorBody).code).toBe('invalid_transition')

    const row = await loadFocusSessionRow(testApp, sessionId)
    expect(row.lifecycle).toBe('running')
    expect(row.version).toBe(1)
    expect(await eventCountFor(testApp, sessionId)).toBe(0)
  })

  it('(2) benchmark resume -> 422 invalid_transition', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'running',
    })

    const res = await postTransition(testApp.app, sessionId, { expectedVersion: 1, type: 'resume' })
    expect(res.statusCode).toBe(422)
    expect((res.json() as ErrorBody).code).toBe('invalid_transition')
  })

  it('(3) practice pause with reason planned_break -> 200 paused, version 2, one pause event with details.reason planned_break; GET timing.isPaused true and remainingSeconds identical after +120 s offset (planned break)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const startedAt = new Date()
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      lifecycle: 'running',
      targetSeconds: 900,
      startedAt,
    })

    const pauseRes = await postTransition(testApp.app, sessionId, {
      expectedVersion: 1,
      type: 'pause',
      reason: 'planned_break',
    })
    expect(pauseRes.statusCode).toBe(200)
    const pauseBody = pauseRes.json() as SessionBody
    expect(pauseBody.lifecycle).toBe('paused')
    expect(pauseBody.version).toBe(2)
    expect(pauseBody.timing.isPaused).toBe(true)

    expect(await eventCountFor(testApp, sessionId)).toBe(1)
    const [eventRow] = await testApp.db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId))
    expect(eventRow?.type).toBe('pause')
    expect(eventRow?.details).toEqual({ reason: 'planned_break' })

    const remainingAtPause = pauseBody.timing.remainingSeconds

    // Remaining time is frozen while paused: the elapsed formula's `now`
    // terms cancel algebraically once `currentPauseStartedAt` is set, so this
    // is exact regardless of demo-clock drift, not merely approximate.
    await setDemoOffsetSeconds(testApp.db, 120)
    const getRes = await getSession(testApp.app, sessionId)
    const getBody = getRes.json() as SessionBody
    expect(getBody.timing.isPaused).toBe(true)
    expect(getBody.timing.remainingSeconds).toBe(remainingAtPause)
  })

  it('(4) 240 paused seconds: start a 900 s practice, pause at +300 s, resume at +540 s -> pausedSeconds 240; GET at +1140 s wall -> elapsedSeconds 900, deadlineReached true; end -> awaiting_review, completeInterval true, endedAt = start + 1140 s (paused seconds excluded)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const startedAt = new Date()
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      lifecycle: 'running',
      targetSeconds: 900,
      startedAt,
    })

    await setDemoOffsetSeconds(testApp.db, 300)
    const pauseRes = await postTransition(testApp.app, sessionId, { expectedVersion: 1, type: 'pause' })
    expect(pauseRes.statusCode).toBe(200)
    expect((pauseRes.json() as SessionBody).version).toBe(2)

    await setDemoOffsetSeconds(testApp.db, 540)
    const resumeRes = await postTransition(testApp.app, sessionId, { expectedVersion: 2, type: 'resume' })
    expect(resumeRes.statusCode).toBe(200)
    const resumeBody = resumeRes.json() as SessionBody
    expect(resumeBody.version).toBe(3)
    expect(resumeBody.pausedSeconds).toBe(240)

    await setDemoOffsetSeconds(testApp.db, 1140)
    const getRes = await getSession(testApp.app, sessionId)
    const getBody = getRes.json() as SessionBody
    expect(getBody.timing.elapsedSeconds).toBe(900)
    expect(getBody.timing.deadlineReached).toBe(true)

    const endRes = await postTransition(testApp.app, sessionId, { expectedVersion: 3, type: 'end' })
    expect(endRes.statusCode).toBe(200)
    const endBody = endRes.json() as SessionBody
    expect(endBody.lifecycle).toBe('awaiting_review')
    expect(endBody.completeInterval).toBe(true)
    expect(endBody.pausedSeconds).toBe(240)
    expect(endBody.endedAt).not.toBeNull()
    const expectedEndedAtMs = startedAt.getTime() + 1140_000
    expect(Math.abs(new Date(endBody.endedAt!).getTime() - expectedEndedAtMs)).toBeLessThan(2000)
  })

  it('(5) end at +480 s of 900 -> awaiting_review, completeInterval false, timing.elapsedSeconds 480 (early finish)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const startedAt = new Date()
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      lifecycle: 'running',
      targetSeconds: 900,
      startedAt,
    })

    await setDemoOffsetSeconds(testApp.db, 480)
    const res = await postTransition(testApp.app, sessionId, { expectedVersion: 1, type: 'end' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.lifecycle).toBe('awaiting_review')
    expect(body.completeInterval).toBe(false)
    expect(body.timing.elapsedSeconds).toBe(480)
  })

  it('(6) benchmark end at +840 s -> awaiting_review, completeInterval false, exactly one focus_sessions row for the slot and GET /sessions/active returns it as awaiting_review (stop early never starts a new attempt)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const startedAt = new Date()
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'running',
      startedAt,
    })

    await setDemoOffsetSeconds(testApp.db, 840)
    const res = await postTransition(testApp.app, sessionId, { expectedVersion: 1, type: 'end' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.lifecycle).toBe('awaiting_review')
    expect(body.completeInterval).toBe(false)

    const slotRows = await testApp.db.select().from(focusSessions).where(eq(focusSessions.slotId, slots.baselineA))
    expect(slotRows).toHaveLength(1)

    const activeRes = await getActive(testApp.app)
    expect(activeRes.statusCode).toBe(200)
    const activeBody = activeRes.json() as SessionBody
    expect(activeBody.id).toBe(sessionId)
    expect(activeBody.lifecycle).toBe('awaiting_review')
  })

  it('(7) benchmark end at +1200 s -> completeInterval true, review.finalizedAt null, eligible null (interval reached, nothing finalized)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const startedAt = new Date()
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'running',
      startedAt,
    })

    await setDemoOffsetSeconds(testApp.db, 1200)
    const res = await postTransition(testApp.app, sessionId, { expectedVersion: 1, type: 'end' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.completeInterval).toBe(true)
    expect(body.review.finalizedAt).toBeNull()
    expect(body.eligible).toBeNull()
  })

  it('(8) practice end at +900 s of 900 -> awaiting_review, completeInterval true, review.finalizedAt null (target reached, no completion recorded)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const startedAt = new Date()
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      lifecycle: 'running',
      targetSeconds: 900,
      startedAt,
    })

    await setDemoOffsetSeconds(testApp.db, 900)
    const res = await postTransition(testApp.app, sessionId, { expectedVersion: 1, type: 'end' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.lifecycle).toBe('awaiting_review')
    expect(body.completeInterval).toBe(true)
    expect(body.review.finalizedAt).toBeNull()
  })

  it('(9) end during a pause -> awaiting_review with the open pause counted in pausedSeconds', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const startedAt = new Date()
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      lifecycle: 'running',
      targetSeconds: 900,
      startedAt,
    })

    await setDemoOffsetSeconds(testApp.db, 100)
    const pauseRes = await postTransition(testApp.app, sessionId, { expectedVersion: 1, type: 'pause' })
    expect(pauseRes.statusCode).toBe(200)

    await setDemoOffsetSeconds(testApp.db, 400)
    const endRes = await postTransition(testApp.app, sessionId, { expectedVersion: 2, type: 'end' })
    expect(endRes.statusCode).toBe(200)
    const body = endRes.json() as SessionBody
    expect(body.lifecycle).toBe('awaiting_review')
    expect(body.pausedSeconds).toBe(300)
    expect(body.currentPauseStartedAt).toBeNull()
  })

  it('(10) two end requests with the same expectedVersion -> first 200 with version 2, second 409 stale_version carrying details.current with lifecycle awaiting_review and version 2; endedAt unchanged and version still 2 (two tabs end a session)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'running', targetSeconds: 900 })

    const first = await postTransition(testApp.app, sessionId, { expectedVersion: 1, type: 'end' })
    expect(first.statusCode).toBe(200)
    const firstBody = first.json() as SessionBody
    expect(firstBody.version).toBe(2)
    const endedAtAfterFirst = firstBody.endedAt

    const second = await postTransition(testApp.app, sessionId, { expectedVersion: 1, type: 'end' })
    expect(second.statusCode).toBe(409)
    const secondBody = second.json() as ErrorBody
    expect(secondBody.code).toBe('stale_version')
    const current = secondBody.details?.current as SessionBody
    expect(current.lifecycle).toBe('awaiting_review')
    expect(current.version).toBe(2)

    const row = await loadFocusSessionRow(testApp, sessionId)
    expect(row.version).toBe(2)
    expect(row.endedAt?.toISOString()).toBe(endedAtAfterFirst)
  })

  it('(11) stale expectedVersion on pause -> 409 stale_version, lifecycle unchanged', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'running', targetSeconds: 900 })

    const res = await postTransition(testApp.app, sessionId, { expectedVersion: 2, type: 'pause' })
    expect(res.statusCode).toBe(409)
    const body = res.json() as ErrorBody
    expect(body.code).toBe('stale_version')
    const current = body.details?.current as SessionBody
    expect(current.lifecycle).toBe('running')

    const row = await loadFocusSessionRow(testApp, sessionId)
    expect(row.lifecycle).toBe('running')
    expect(row.version).toBe(1)
  })

  it('(12) abandon from running -> abandoned, endedAt set, eligible null, review.finalizedAt null, still readable by GET /sessions/{id}; a following POST /sessions -> 201', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'running', targetSeconds: 900 })

    const res = await postTransition(testApp.app, sessionId, { expectedVersion: 1, type: 'abandon' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.lifecycle).toBe('abandoned')
    expect(body.endedAt).not.toBeNull()
    expect(body.eligible).toBeNull()
    expect(body.review.finalizedAt).toBeNull()

    const getRes = await getSession(testApp.app, sessionId)
    expect(getRes.statusCode).toBe(200)
    expect((getRes.json() as SessionBody).lifecycle).toBe('abandoned')

    const startRes = await postSession(testApp.app, {
      programId,
      kind: 'practice',
      intendedOutput: 'A fresh start after abandoning',
    })
    expect(startRes.statusCode).toBe(201)
  })

  it('(13) abandon from paused -> abandoned with the open pause closed into pausedSeconds (D29: paused -> abandoned allowed)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const startedAt = new Date()
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      lifecycle: 'running',
      targetSeconds: 900,
      startedAt,
    })

    await setDemoOffsetSeconds(testApp.db, 100)
    const pauseRes = await postTransition(testApp.app, sessionId, { expectedVersion: 1, type: 'pause' })
    expect(pauseRes.statusCode).toBe(200)

    await setDemoOffsetSeconds(testApp.db, 250)
    const abandonRes = await postTransition(testApp.app, sessionId, { expectedVersion: 2, type: 'abandon' })
    expect(abandonRes.statusCode).toBe(200)
    const body = abandonRes.json() as SessionBody
    expect(body.lifecycle).toBe('abandoned')
    expect(body.pausedSeconds).toBe(150)
    expect(body.currentPauseStartedAt).toBeNull()
  })

  it('(14) abandon from awaiting_review -> abandoned', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'running', targetSeconds: 900 })

    const endRes = await postTransition(testApp.app, sessionId, { expectedVersion: 1, type: 'end' })
    expect(endRes.statusCode).toBe(200)

    const abandonRes = await postTransition(testApp.app, sessionId, { expectedVersion: 2, type: 'abandon' })
    expect(abandonRes.statusCode).toBe(200)
    expect((abandonRes.json() as SessionBody).lifecycle).toBe('abandoned')
  })

  it('(15) transition on a seeded finalized session -> 409 session_not_active', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'finalized', targetSeconds: 900 })

    const res = await postTransition(testApp.app, sessionId, { expectedVersion: 1, type: 'end' })
    expect(res.statusCode).toBe(409)
    expect((res.json() as ErrorBody).code).toBe('session_not_active')
  })

  it('(16) transition on a seeded abandoned session -> 409 session_not_active', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'abandoned', targetSeconds: 900 })

    const res = await postTransition(testApp.app, sessionId, { expectedVersion: 1, type: 'pause' })
    expect(res.statusCode).toBe(409)
    expect((res.json() as ErrorBody).code).toBe('session_not_active')
  })

  it("(17) transition on another principal's session -> 404", async () => {
    const other = await insertOtherPrincipalProgram(testApp.db)
    const { sessionId } = await seedSession(testApp.db, {
      userId: other.userId,
      programId: other.programId,
      lifecycle: 'running',
      targetSeconds: 900,
    })

    const res = await postTransition(testApp.app, sessionId, { expectedVersion: 1, type: 'end' })
    expect(res.statusCode).toBe(404)
  })

  it('(18) resume while running -> 422 invalid_transition (not a terminal-state 409, since the session is still active)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'running', targetSeconds: 900 })

    const res = await postTransition(testApp.app, sessionId, { expectedVersion: 1, type: 'resume' })
    expect(res.statusCode).toBe(422)
    expect((res.json() as ErrorBody).code).toBe('invalid_transition')
  })

  it('(19) pause and resume rows appear in events[] but never in tallies, and both add to eventCount', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'running', targetSeconds: 900 })

    const pauseRes = await postTransition(testApp.app, sessionId, { expectedVersion: 1, type: 'pause' })
    expect(pauseRes.statusCode).toBe(200)
    const resumeRes = await postTransition(testApp.app, sessionId, { expectedVersion: 2, type: 'resume' })
    expect(resumeRes.statusCode).toBe(200)

    const getRes = await getSession(testApp.app, sessionId)
    const body = getRes.json() as SessionBody
    expect(body.eventCount).toBe(2)
    expect(body.events.map((e) => e.type).sort()).toEqual(['pause', 'resume'])
    expect(body.tallies).toEqual({ offTask: 0, external: 0, agentChecks: 0 })
  })

  it('(20) reason sent on an end body is accepted by the contract and discarded: no session_events row is written for the end and no column stores it', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'running', targetSeconds: 900 })

    const res = await postTransition(testApp.app, sessionId, {
      expectedVersion: 1,
      type: 'end',
      reason: 'a reason that should be discarded',
    })
    expect(res.statusCode).toBe(200)
    expect(await eventCountFor(testApp, sessionId)).toBe(0)
  })

  it('(21) version increments by exactly one per successful transition (pause 2, resume 3, end 4)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'running', targetSeconds: 900 })

    const pauseRes = await postTransition(testApp.app, sessionId, { expectedVersion: 1, type: 'pause' })
    expect((pauseRes.json() as SessionBody).version).toBe(2)

    const resumeRes = await postTransition(testApp.app, sessionId, { expectedVersion: 2, type: 'resume' })
    expect((resumeRes.json() as SessionBody).version).toBe(3)

    const endRes = await postTransition(testApp.app, sessionId, { expectedVersion: 3, type: 'end' })
    expect((endRes.json() as SessionBody).version).toBe(4)
  })
})
