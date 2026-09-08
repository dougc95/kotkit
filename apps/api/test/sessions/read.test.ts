/**
 * 5.2.2 — Fastify inject integration tests for `GET /sessions/{id}`, against
 * the real `attention_lab_test` database via `buildTestApp` (3.2.1).
 * Composes 5.1.3's session seed helpers with 4.1.1's program helpers, per
 * D16 — no lower layer is re-created here.
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
import { seedAmendment, seedEvents, seedSession } from '../helpers/sessions.js'
import { focusSessions } from '../../src/db/schema/index.js'

const BASE_PROGRAM = {
  baselineDate: '2026-09-06',
  timezone: 'UTC',
  status: 'active' as const,
  practiceTargetSeconds: 600,
}

async function getSession(app: FastifyInstance, id: string) {
  return app.inject({ method: 'GET', url: `/api/v1/sessions/${id}` })
}

interface ErrorBody {
  code: string
  message: string
  retryable: boolean
  requestId: string
}

interface SessionBody {
  id: string
  lifecycle: string
  serverNow: string
  eligible: boolean | null
  exclusionReasons: readonly string[]
  timing: { elapsedSeconds: number; remainingSeconds: number; deadlineReached: boolean; isPaused: boolean }
  tallies: { offTask: number; external: number; agentChecks: number }
  eventCount: number
  events: Array<{ id: string; type: string; voidedAt: string | null }>
  review: {
    episodeCount: number | null
    externalCount: number | null
    outputQuality: string | null
    finalizedAt: string | null
  }
  agentPlan: unknown
  amendments: Array<{ id: string; reason: string; excludeFromReport: boolean }>
}

describe('GET /sessions/{id} (integration, attention_lab_test)', () => {
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

  it('(1) owner GET -> 200 with serverNow, timing, tallies, eventCount 0, events, review, agentPlan null, amendments []', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId })

    const res = await getSession(testApp.app, sessionId)

    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.id).toBe(sessionId)
    expect(body.serverNow).toBeDefined()
    expect(body.timing).toEqual({
      elapsedSeconds: expect.any(Number),
      remainingSeconds: expect.any(Number),
      deadlineReached: expect.any(Boolean),
      isPaused: false,
    })
    expect(body.tallies).toEqual({ offTask: 0, external: 0, agentChecks: 0 })
    expect(body.eventCount).toBe(0)
    expect(body.events).toEqual([])
    expect(body.review.episodeCount).toBeNull()
    expect(body.agentPlan).toBeNull()
    expect(body.amendments).toEqual([])
  })

  it("(2) session seeded with user_id someone-else -> 404 with no session fields in the body", async () => {
    const other = await insertOtherPrincipalProgram(testApp.db)
    const { sessionId } = await seedSession(testApp.db, { userId: other.userId, programId: other.programId })

    const res = await getSession(testApp.app, sessionId)

    expect(res.statusCode).toBe(404)
    const body = res.json() as Record<string, unknown>
    expect(body.code).toBe('not_found')
    expect(body).not.toHaveProperty('id')
    expect(body).not.toHaveProperty('lifecycle')
    expect(body).not.toHaveProperty('review')
    expect(body).not.toHaveProperty('events')
  })

  it('(3) unknown id -> 404 with the same envelope shape', async () => {
    const res = await getSession(testApp.app, randomUUID())

    expect(res.statusCode).toBe(404)
    const body = res.json() as ErrorBody
    expect(body.code).toBe('not_found')
    expect(body.message).toBe('Not found')
    expect(body.retryable).toBe(false)
    expect(body.requestId).toBeDefined()
  })

  it('(4) practice 900 s with demo offset +360 s -> remainingSeconds 540, elapsedSeconds 360 (refresh during practice)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    // `startedAt` anchored to "now" and the offset applied immediately after
    // (rather than an absolute `setDemoNow` target) so the elapsed-seconds
    // arithmetic is exact regardless of how much real wall-clock time the
    // test harness itself takes between seeding and the request — the same
    // pattern `test/sessions/start.practice.test.ts` uses.
    const startedAt = new Date()
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      lifecycle: 'running',
      targetSeconds: 900,
      startedAt,
    })

    await setDemoOffsetSeconds(testApp.db, 360)

    const res = await getSession(testApp.app, sessionId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.timing.elapsedSeconds).toBe(360)
    expect(body.timing.remainingSeconds).toBe(540)
  })

  it('(5) demo offset +1000 s -> remainingSeconds 0, deadlineReached true, lifecycle still running, review.finalizedAt null, eligible null (timer expiry never proves completion, D24)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const startedAt = new Date()
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      lifecycle: 'running',
      targetSeconds: 600,
      startedAt,
    })

    await setDemoOffsetSeconds(testApp.db, 1000)

    const res = await getSession(testApp.app, sessionId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.timing.remainingSeconds).toBe(0)
    expect(body.timing.deadlineReached).toBe(true)
    expect(body.lifecycle).toBe('running')
    expect(body.review.finalizedAt).toBeNull()
    expect(body.eligible).toBeNull()
  })

  it('(6) benchmark hidden 15 minutes: offset +900 s on a 1200 s benchmark with no events -> remainingSeconds 300 and every tally 0', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const startedAt = new Date()
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      slotId: slots.baselineA,
      kind: 'benchmark',
      lifecycle: 'running',
      targetSeconds: 1200,
      startedAt,
    })

    await setDemoOffsetSeconds(testApp.db, 900)

    const res = await getSession(testApp.app, sessionId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.timing.remainingSeconds).toBe(300)
    expect(body.tallies).toEqual({ offTask: 0, external: 0, agentChecks: 0 })
  })

  it('(7) seeded off_task, agent_check{alsoOffTask:true}, agent_check{alsoOffTask:false}, external -> tallies { offTask 2, external 1, agentChecks 2 }, eventCount 4, and the body has no total key', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId })
    await seedEvents(testApp.db, sessionId, [
      { type: 'off_task', elapsedMs: 1000 },
      { type: 'agent_check', elapsedMs: 2000, details: { alsoOffTask: true } },
      { type: 'agent_check', elapsedMs: 3000, details: { alsoOffTask: false } },
      { type: 'external', elapsedMs: 4000 },
    ])

    const res = await getSession(testApp.app, sessionId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.tallies).toEqual({ offTask: 2, external: 1, agentChecks: 2 })
    expect(body.eventCount).toBe(4)
    expect(body).not.toHaveProperty('total')
    expect(body.tallies).not.toHaveProperty('total')
  })

  it('(8) voided event is listed with voidedAt and excluded from tallies but included in eventCount', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId })
    const voidedAt = new Date('2026-09-06T10:00:00.000Z')
    await seedEvents(testApp.db, sessionId, [{ type: 'off_task', elapsedMs: 1000, voidedAt }])

    const res = await getSession(testApp.app, sessionId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.eventCount).toBe(1)
    expect(body.events).toHaveLength(1)
    expect(body.events[0]?.voidedAt).toBe(voidedAt.toISOString())
    expect(body.tallies).toEqual({ offTask: 0, external: 0, agentChecks: 0 })
  })

  it('(9) review.episodeCount is JSON null for a never-finalized session', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId })

    const res = await getSession(testApp.app, sessionId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.review.episodeCount).toBeNull()
  })

  it('(10) seeded paused session -> isPaused true and remainingSeconds identical after advancing the offset 120 s', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const startedAt = new Date()
    const currentPauseStartedAt = new Date(startedAt.getTime() + 60_000)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      lifecycle: 'paused',
      targetSeconds: 600,
      startedAt,
      currentPauseStartedAt,
    })

    await setDemoOffsetSeconds(testApp.db, 0)
    const first = await getSession(testApp.app, sessionId)
    expect(first.statusCode).toBe(200)
    const firstBody = first.json() as SessionBody
    expect(firstBody.timing.isPaused).toBe(true)

    await setDemoOffsetSeconds(testApp.db, 120)
    const second = await getSession(testApp.app, sessionId)
    expect(second.statusCode).toBe(200)
    const secondBody = second.json() as SessionBody
    expect(secondBody.timing.isPaused).toBe(true)
    expect(secondBody.timing.remainingSeconds).toBe(firstBody.timing.remainingSeconds)
  })

  it("(11) seeded amendment on a finalized session -> amendments[] contains it with reason and excludeFromReport, and the session's stored eligible/exclusionReasons are unchanged (D32: amendments never rewrite stored fields)", async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      lifecycle: 'finalized',
      eligible: true,
      exclusionReasons: [],
    })
    await seedAmendment(testApp.db, sessionId, {
      reason: 'Reported a materially disrupted attempt in error',
      excludeFromReport: true,
    })

    const res = await getSession(testApp.app, sessionId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.amendments).toHaveLength(1)
    expect(body.amendments[0]?.reason).toBe('Reported a materially disrupted attempt in error')
    expect(body.amendments[0]?.excludeFromReport).toBe(true)

    const [row] = await testApp.db.select().from(focusSessions).where(eq(focusSessions.id, sessionId))
    expect(row?.eligible).toBe(true)
    expect(row?.exclusionReasons).toEqual([])
  })

  it('(12) response carries Cache-Control: no-store', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId })

    const res = await getSession(testApp.app, sessionId)
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('(13) seeded finalized session is readable with its review values intact', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const finalizedAt = new Date('2026-09-06T10:30:00.000Z')
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      lifecycle: 'finalized',
      eligible: true,
      review: {
        episodeCount: 3,
        externalCount: 1,
        outputQuality: 'yes',
        finalizedAt,
      },
    })

    const res = await getSession(testApp.app, sessionId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.review.episodeCount).toBe(3)
    expect(body.review.externalCount).toBe(1)
    expect(body.review.outputQuality).toBe('yes')
    expect(body.review.finalizedAt).toBe(finalizedAt.toISOString())
  })

  it('(14) a GET against a session past its deadline makes zero writes: SELECT version before and after is unchanged', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const startedAt = new Date()
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      lifecycle: 'running',
      targetSeconds: 600,
      startedAt,
    })

    await setDemoOffsetSeconds(testApp.db, 1800) // well past the deadline

    const [before] = await testApp.db.select().from(focusSessions).where(eq(focusSessions.id, sessionId))

    const res = await getSession(testApp.app, sessionId)
    expect(res.statusCode).toBe(200)
    expect((res.json() as SessionBody).timing.deadlineReached).toBe(true)

    const [after] = await testApp.db.select().from(focusSessions).where(eq(focusSessions.id, sessionId))
    expect(after?.version).toBe(before?.version)
    expect(after?.lifecycle).toBe(before?.lifecycle)
  })
})
