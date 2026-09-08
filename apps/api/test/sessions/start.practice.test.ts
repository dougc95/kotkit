/**
 * 5.1.1 — Fastify inject integration tests for `POST /sessions`' practice
 * path, against the real `attention_lab_test` database via `buildTestApp`
 * (3.2.1). Composes 5.1.3's session seed helpers with 4.1.1's program
 * helpers, per D16 — no lower layer is re-created here.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { addDays, localDateAt } from '@attention-lab/shared'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import { insertOtherPrincipalProgram, insertProgram, setDemoNow, setDemoOffsetSeconds } from '../helpers/programs.js'
import { seedSession, withIdempotencyKey } from '../helpers/sessions.js'
import { focusSessions, protocolRevisions, sessionReviews } from '../../src/db/schema/index.js'
import { initialRevisionSettings } from '../../src/services/program/programService.js'

const BASE_PROGRAM = {
  baselineDate: '2026-09-06',
  timezone: 'UTC',
  status: 'active' as const,
  practiceTargetSeconds: 600,
}

async function postSession(
  app: FastifyInstance,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    payload,
    headers: { ...withIdempotencyKey(), ...headers },
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
  programId: string
  slotId: string | null
  kind: string
  lifecycle: string
  targetSeconds: number
  startedAt: string
  pausedSeconds: number
  version: number
  realm: string
  timeSource: string
  localDate: string
  serverNow: string
  timing: { elapsedSeconds: number; remainingSeconds: number; deadlineReached: boolean; isPaused: boolean }
  tallies: { offTask: number; external: number; agentChecks: number }
  eventCount: number
  events: unknown[]
  review: { episodeCount: number | null }
  agentPlan: unknown
  amendments: unknown[]
}

describe('POST /sessions — practice start (integration, attention_lab_test)', () => {
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

  it('(1) creates a running practice session with target from the governing revision, lifecycle running, version 1, paused_seconds 0, started_at = ctx.now', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)

    const before = new Date()
    const res = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'Draft the outline' })
    const after = new Date()

    expect(res.statusCode).toBe(201)
    const body = res.json() as SessionBody
    expect(body.targetSeconds).toBe(600)
    expect(body.lifecycle).toBe('running')
    expect(body.version).toBe(1)
    expect(body.pausedSeconds).toBe(0)

    const startedAtMs = new Date(body.startedAt).getTime()
    expect(startedAtMs).toBeGreaterThanOrEqual(before.getTime() - 2000)
    expect(startedAtMs).toBeLessThanOrEqual(after.getTime() + 2000)

    const rows = await testApp.db.select().from(focusSessions).where(eq(focusSessions.id, body.id))
    expect(rows).toHaveLength(1)
  })

  it('(2) 201 body is the D20 shape: serverNow present, timing { elapsedSeconds 0, remainingSeconds = target, deadlineReached false, isPaused false }, tallies { offTask 0, external 0, agentChecks 0 }, eventCount 0, events [], review.episodeCount null, agentPlan null, amendments []', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)

    const res = await postSession(testApp.app, {
      programId,
      kind: 'practice',
      intendedOutput: 'Draft the outline',
      targetSeconds: 900,
    })

    expect(res.statusCode).toBe(201)
    const body = res.json() as SessionBody
    expect(body.serverNow).toBeDefined()
    expect(body.timing).toEqual({ elapsedSeconds: 0, remainingSeconds: 900, deadlineReached: false, isPaused: false })
    expect(body.tallies).toEqual({ offTask: 0, external: 0, agentChecks: 0 })
    expect(body.eventCount).toBe(0)
    expect(body.events).toEqual([])
    expect(body.review.episodeCount).toBeNull()
    expect(body.agentPlan).toBeNull()
    expect(body.amendments).toEqual([])
  })

  it('(3) explicit targetSeconds equal to the current target is stored (hold the target)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const res = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'x', targetSeconds: 600 })
    expect(res.statusCode).toBe(201)
    expect((res.json() as SessionBody).targetSeconds).toBe(600)
  })

  it('(4) explicit targetSeconds 900 on a 600 target is stored as given', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const res = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'x', targetSeconds: 900 })
    expect(res.statusCode).toBe(201)
    expect((res.json() as SessionBody).targetSeconds).toBe(900)
  })

  it('(5) targetSeconds 700 (not a multiple of 300) -> 400, no row', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const res = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'x', targetSeconds: 700 })
    expect(res.statusCode).toBe(400)
    expect(await testApp.db.select().from(focusSessions)).toHaveLength(0)
  })

  it('(6) targetSeconds 1800 (above the 1500 max) -> 400, no row', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const res = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'x', targetSeconds: 1800 })
    expect(res.statusCode).toBe(400)
    expect(await testApp.db.select().from(focusSessions)).toHaveLength(0)
  })

  it('(7) empty or whitespace-only intendedOutput -> 400 naming intendedOutput, no focus_sessions row', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)

    const absent = await postSession(testApp.app, { programId, kind: 'practice' })
    expect(absent.statusCode).toBe(400)
    expect((absent.json() as ErrorBody).fieldErrors?.intendedOutput).toBeDefined()

    const whitespace = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: '   ' })
    expect(whitespace.statusCode).toBe(400)
    expect((whitespace.json() as ErrorBody).fieldErrors?.intendedOutput).toBeDefined()

    expect(await testApp.db.select().from(focusSessions)).toHaveLength(0)
  })

  it('(8) 201-character intendedOutput -> 400 from the contract, no row', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const res = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'a'.repeat(201) })
    expect(res.statusCode).toBe(400)
    expect(await testApp.db.select().from(focusSessions)).toHaveLength(0)
  })

  it('(9) slotId on a practice body -> 422 benchmark_only_field, no row (practice can never become a baseline)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const res = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'x', slotId: randomUUID() })
    expect(res.statusCode).toBe(422)
    expect((res.json() as ErrorBody).code).toBe('benchmark_only_field')
    expect(await testApp.db.select().from(focusSessions)).toHaveLength(0)
  })

  it('(10) body with realm pilot -> 400 and no row (client cannot choose the realm)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const res = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'x', realm: 'pilot' })
    expect(res.statusCode).toBe(400)
    expect(await testApp.db.select().from(focusSessions)).toHaveLength(0)
  })

  it('(11) missing Idempotency-Key -> 400', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      payload: { programId, kind: 'practice', intendedOutput: 'x' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('(12) replay: same key + same body -> 200, same session id, exactly one row, fresh timing', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const key = randomUUID()
    const payload = { programId, kind: 'practice', intendedOutput: 'x' }

    const res1 = await postSession(testApp.app, payload, { 'idempotency-key': key })
    expect(res1.statusCode).toBe(201)
    const body1 = res1.json() as SessionBody

    await setDemoOffsetSeconds(testApp.db, 120)

    const res2 = await postSession(testApp.app, payload, { 'idempotency-key': key })
    expect(res2.statusCode).toBe(200)
    const body2 = res2.json() as SessionBody
    expect(body2.id).toBe(body1.id)
    expect(body2.timing.elapsedSeconds).toBeGreaterThanOrEqual(120)

    expect(await testApp.db.select().from(focusSessions)).toHaveLength(1)
  })

  it('(13) same key + different intendedOutput -> 409 idempotency_mismatch, still one row', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const key = randomUUID()

    const res1 = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'x' }, { 'idempotency-key': key })
    expect(res1.statusCode).toBe(201)

    const res2 = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'y' }, { 'idempotency-key': key })
    expect(res2.statusCode).toBe(409)
    expect((res2.json() as ErrorBody).code).toBe('idempotency_mismatch')

    expect(await testApp.db.select().from(focusSessions)).toHaveLength(1)
  })

  it('(14) second start while a session is running -> 409 active_session_exists with details.activeSessionId', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'running' })

    const res = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'x' })
    expect(res.statusCode).toBe(409)
    const body = res.json() as ErrorBody
    expect(body.code).toBe('active_session_exists')
    expect(body.details?.activeSessionId).toBe(sessionId)
  })

  it('(15) start while a seeded session is awaiting_review -> 409 with that id', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'awaiting_review' })

    const res = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'x' })
    expect(res.statusCode).toBe(409)
    expect((res.json() as ErrorBody).details?.activeSessionId).toBe(sessionId)
  })

  it('(16) start while a seeded session is paused -> 409', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'paused' })

    const res = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'x' })
    expect(res.statusCode).toBe(409)
    expect((res.json() as ErrorBody).details?.activeSessionId).toBe(sessionId)
  })

  it('(17) start after a seeded abandoned session -> 201', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    await seedSession(testApp.db, { programId, lifecycle: 'abandoned' })

    const res = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'x' })
    expect(res.statusCode).toBe(201)
  })

  it('(18) start after a seeded finalized session -> 201', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    await seedSession(testApp.db, { programId, lifecycle: 'finalized' })

    const res = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'x' })
    expect(res.statusCode).toBe(201)
  })

  it('(19) stored realm is demo and user_id is the principal', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const res = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'x' })
    expect(res.statusCode).toBe(201)
    const body = res.json() as SessionBody
    expect(body.realm).toBe('demo')

    const [row] = await testApp.db.select().from(focusSessions).where(eq(focusSessions.id, body.id))
    expect(row?.realm).toBe('demo')
    expect(row?.userId).toBe('local-demo')
  })

  it('(20) demo offset 900 -> time_source demo_clock; offset 0 -> measured', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)

    await setDemoOffsetSeconds(testApp.db, 0)
    const measured = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'x' })
    expect(measured.statusCode).toBe(201)
    expect((measured.json() as SessionBody).timeSource).toBe('measured')

    // No transitions route exists in this task's scope — clear the
    // active-session lock directly so the second start below does not 409.
    await testApp.db
      .update(focusSessions)
      .set({ lifecycle: 'finalized' })
      .where(eq(focusSessions.id, (measured.json() as SessionBody).id))

    await setDemoOffsetSeconds(testApp.db, 900)
    const demoClock = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'y' })
    expect(demoClock.statusCode).toBe(201)
    expect((demoClock.json() as SessionBody).timeSource).toBe('demo_clock')
  })

  it('(21) local_date uses the program timezone: Pacific/Auckland program at 2026-09-06T11:30Z stores 2026-09-06, at 2026-09-06T12:30Z stores 2026-09-07', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: '2026-09-06',
      timezone: 'Pacific/Auckland',
      status: 'active',
      practiceTargetSeconds: 600,
    })

    await setDemoNow(testApp.db, '2026-09-06T11:30:00.000Z')
    const first = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'x' })
    expect(first.statusCode).toBe(201)
    const firstBody = first.json() as SessionBody
    expect(firstBody.localDate).toBe('2026-09-06')

    await testApp.db.update(focusSessions).set({ lifecycle: 'finalized' }).where(eq(focusSessions.id, firstBody.id))

    await setDemoNow(testApp.db, '2026-09-06T12:30:00.000Z')
    const second = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'y' })
    expect(second.statusCode).toBe(201)
    expect((second.json() as SessionBody).localDate).toBe('2026-09-07')
  })

  it('(22) program owned by another principal -> 404, no row', async () => {
    const other = await insertOtherPrincipalProgram(testApp.db)
    const res = await postSession(testApp.app, { programId: other.programId, kind: 'practice', intendedOutput: 'x' })
    expect(res.statusCode).toBe(404)
    expect(await testApp.db.select().from(focusSessions)).toHaveLength(0)
  })

  it('(23) nonexistent programId -> 404 with the identical envelope shape', async () => {
    const res = await postSession(testApp.app, { programId: randomUUID(), kind: 'practice', intendedOutput: 'x' })
    expect(res.statusCode).toBe(404)
    expect((res.json() as ErrorBody).code).toBe('not_found')
  })

  it('(24) session_reviews row exists with episode_count SQL NULL (JSON null, never 0) and all-null observed_conditions with accommodations []', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const res = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'x' })
    expect(res.statusCode).toBe(201)
    const body = res.json() as SessionBody
    expect(body.review.episodeCount).toBeNull()

    const [row] = await testApp.db.select().from(sessionReviews).where(eq(sessionReviews.sessionId, body.id))
    expect(row?.episodeCount).toBeNull()
    expect(row?.observedConditions).toEqual({
      deviceFormat: null,
      language: null,
      materialLevel: null,
      accommodations: [],
    })
  })

  it('(25) revision with effective_day 8 is not used for a Day 7 start and is used for a Day 8 start', async () => {
    const today = localDateAt(new Date(), 'UTC')
    const baselineDate = addDays(today, -7)
    const { programId } = await insertProgram(testApp.db, {
      baselineDate,
      timezone: 'UTC',
      status: 'active',
      practiceTargetSeconds: 600,
    })

    await testApp.db.insert(protocolRevisions).values({
      programId,
      revision: 2,
      effectiveDay: 8,
      settings: initialRevisionSettings(900, 20),
      reason: 'progression accepted',
    })

    const day7 = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'x' })
    expect(day7.statusCode).toBe(201)
    const day7Body = day7.json() as SessionBody
    expect(day7Body.targetSeconds).toBe(600)

    await testApp.db.update(focusSessions).set({ lifecycle: 'finalized' }).where(eq(focusSessions.id, day7Body.id))

    await setDemoOffsetSeconds(testApp.db, 24 * 60 * 60)
    const day8 = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'y' })
    expect(day8.statusCode).toBe(201)
    expect((day8.json() as SessionBody).targetSeconds).toBe(900)
  })

  it('(26) practice started on Day 14 has kind practice and slot_id null', async () => {
    const today = localDateAt(new Date(), 'UTC')
    const baselineDate = addDays(today, -14)
    const { programId } = await insertProgram(testApp.db, {
      baselineDate,
      timezone: 'UTC',
      status: 'active',
      practiceTargetSeconds: 600,
    })

    const res = await postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'x' })
    expect(res.statusCode).toBe(201)
    const body = res.json() as SessionBody
    expect(body.kind).toBe('practice')
    expect(body.slotId).toBeNull()
  })

  it('(27) two concurrent starts with different keys (Promise.all of two injects) -> exactly one 201 and one 409 active_session_exists, one row (unique-index backstop)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)

    const [res1, res2] = await Promise.all([
      postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'x' }),
      postSession(testApp.app, { programId, kind: 'practice', intendedOutput: 'y' }),
    ])

    const statusCodes = [res1.statusCode, res2.statusCode].sort()
    expect(statusCodes).toEqual([201, 409])

    const conflict = res1.statusCode === 409 ? res1 : res2
    expect((conflict.json() as ErrorBody).code).toBe('active_session_exists')

    expect(await testApp.db.select().from(focusSessions)).toHaveLength(1)
  })
})
