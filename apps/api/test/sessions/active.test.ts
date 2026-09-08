/**
 * 5.2.3 — Fastify inject integration tests for `GET /sessions/active`,
 * against the real `attention_lab_test` database via `buildTestApp` (3.2.1).
 * Composes 5.1.3's session seed helpers with 4.1.1's program helpers, per
 * D16 — no lower layer is re-created here. `loadSessionForResponse` itself
 * (timing/tallies/eventCount/review/agentPlan/amendments serialization) is
 * already covered by 5.2.2's `serializeSession.test.ts` and `read.test.ts`;
 * these cases only exercise the route's own selection and 204/200 behavior.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import { insertOtherPrincipalProgram, insertProgram } from '../helpers/programs.js'
import { seedEvents, seedSession } from '../helpers/sessions.js'

const BASE_PROGRAM = {
  baselineDate: '2026-09-06',
  timezone: 'UTC',
  status: 'active' as const,
  practiceTargetSeconds: 600,
}

async function getActive(app: FastifyInstance) {
  return app.inject({ method: 'GET', url: '/api/v1/sessions/active' })
}

interface SessionBody {
  id: string
  lifecycle: string
  serverNow: string
  timing: { elapsedSeconds: number; remainingSeconds: number; deadlineReached: boolean; isPaused: boolean }
  tallies: { offTask: number; external: number; agentChecks: number }
  eventCount: number
  amendments: readonly unknown[]
}

describe('GET /sessions/active (integration, attention_lab_test)', () => {
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

  it('(1) no sessions -> 204 with empty body', async () => {
    const res = await getActive(testApp.app)

    expect(res.statusCode).toBe(204)
    expect(res.body).toBe('')
  })

  it('(2) running practice -> 200 with serverNow, timing and tallies', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'running' })

    const res = await getActive(testApp.app)

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
  })

  it('(3) paused session -> 200 with isPaused true', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const startedAt = new Date()
    const currentPauseStartedAt = new Date(startedAt.getTime() + 30_000)
    await seedSession(testApp.db, {
      programId,
      lifecycle: 'paused',
      startedAt,
      currentPauseStartedAt,
    })

    const res = await getActive(testApp.app)

    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.lifecycle).toBe('paused')
    expect(body.timing.isPaused).toBe(true)
  })

  it('(4) awaiting_review session -> 200 (the pending review is what is offered)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'awaiting_review' })

    const res = await getActive(testApp.app)

    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.id).toBe(sessionId)
    expect(body.lifecycle).toBe('awaiting_review')
  })

  it('(5) only finalized and abandoned sessions -> 204', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    await seedSession(testApp.db, { programId, lifecycle: 'finalized', eligible: true })
    await seedSession(testApp.db, { programId, lifecycle: 'abandoned' })

    const res = await getActive(testApp.app)

    expect(res.statusCode).toBe(204)
    expect(res.body).toBe('')
  })

  it("(6) another principal's running session (seeded user_id someone-else) -> 204", async () => {
    const other = await insertOtherPrincipalProgram(testApp.db)
    await seedSession(testApp.db, { userId: other.userId, programId: other.programId, lifecycle: 'running' })

    const res = await getActive(testApp.app)

    expect(res.statusCode).toBe(204)
    expect(res.body).toBe('')
  })

  it('(7) two consecutive GETs return the same id (second tab)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'running' })

    const first = await getActive(testApp.app)
    const second = await getActive(testApp.app)

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect((first.json() as SessionBody).id).toBe(sessionId)
    expect((second.json() as SessionBody).id).toBe(sessionId)
  })

  it('(8) running session with two events (one voided) -> eventCount 2, amendments [] (amendments belong only to their own finalized session)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'running' })
    await seedEvents(testApp.db, sessionId, [
      { type: 'off_task', elapsedMs: 1000 },
      { type: 'external', elapsedMs: 2000, voidedAt: new Date() },
    ])

    const res = await getActive(testApp.app)

    expect(res.statusCode).toBe(200)
    const body = res.json() as SessionBody
    expect(body.eventCount).toBe(2)
    expect(body.amendments).toEqual([])
  })

  it('(9) response carries Cache-Control: no-store', async () => {
    const res = await getActive(testApp.app)

    expect(res.statusCode).toBe(204)
    expect(res.headers['cache-control']).toBe('no-store')
  })
})
