/**
 * 5.3.1 — Fastify inject integration tests for `POST /sessions/{id}/events`,
 * against the real `attention_lab_test` database via `buildTestApp` (3.2.1).
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
import { seedSession } from '../helpers/sessions.js'
import { focusSessions, sessionEvents } from '../../src/db/schema/index.js'

const BASE_PROGRAM = {
  baselineDate: '2026-09-06',
  timezone: 'UTC',
  status: 'active' as const,
  practiceTargetSeconds: 600,
}

async function postEvents(app: FastifyInstance, sessionId: string, events: readonly unknown[]) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/events`,
    payload: { events },
  })
}

async function getSession(app: FastifyInstance, sessionId: string) {
  return app.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}` })
}

function event(
  clientEventId: string,
  type: string,
  elapsedMs = 0,
  details?: Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    clientEventId,
    type,
    elapsedMs,
    occurredAt: '2026-09-10T09:00:00.000Z',
  }
  if (details !== undefined) base.details = details
  return base
}

interface ErrorBody {
  code: string
  message: string
  fieldErrors?: Record<string, string>
}

interface BatchResponseBody {
  accepted: string[]
  duplicates: string[]
}

interface SessionBody {
  eventCount: number
  tallies: { offTask: number; external: number; agentChecks: number }
  review: { episodeCount: number | null; version: number; finalizedAt: string | null }
  events: Array<{ clientEventId: string; elapsedMs: number | null; details: Record<string, unknown> }>
}

async function storedCount(testApp: TestApp, sessionId: string): Promise<number> {
  const rows = await testApp.db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId))
  return rows.length
}

describe('POST /sessions/{id}/events (integration, attention_lab_test)', () => {
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

  it('(1) one off_task at elapsedMs 462000 -> accepted; GET shows the event with elapsedMs 462000 and tallies.offTask 1 (record after returning)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const startedAt = new Date()
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      startedAt,
    })
    // 470 s of server-side offset gives ample room above the 462 s report.
    await setDemoOffsetSeconds(testApp.db, 470)

    const id = randomUUID()
    const res = await postEvents(testApp.app, sessionId, [event(id, 'off_task', 462000)])
    expect(res.statusCode).toBe(200)
    expect(res.json() as BatchResponseBody).toEqual({ accepted: [id], duplicates: [] })

    const getRes = await getSession(testApp.app, sessionId)
    const body = getRes.json() as SessionBody
    expect(body.events.find((e) => e.clientEventId === id)?.elapsedMs).toBe(462000)
    expect(body.tallies.offTask).toBe(1)
  })

  it('(2) the same batch sent twice -> second response accepted [] and duplicates listing every id; SELECT count(*) unchanged between calls (batch retried)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId })
    const idA = randomUUID()
    const idB = randomUUID()
    const batch = [event(idA, 'off_task'), event(idB, 'external')]

    const first = await postEvents(testApp.app, sessionId, batch)
    expect(first.statusCode).toBe(200)
    expect(first.json() as BatchResponseBody).toEqual({ accepted: [idA, idB], duplicates: [] })
    const countAfterFirst = await storedCount(testApp, sessionId)

    const second = await postEvents(testApp.app, sessionId, batch)
    expect(second.statusCode).toBe(200)
    const secondBody = second.json() as BatchResponseBody
    expect(secondBody.accepted).toEqual([])
    expect(secondBody.duplicates.sort()).toEqual([idA, idB].sort())

    const countAfterSecond = await storedCount(testApp, sessionId)
    expect(countAfterSecond).toBe(countAfterFirst)
    expect(countAfterSecond).toBe(2)
  })

  it('(3) a batch with an internal duplicate id -> one row, one duplicate', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId })
    const id = randomUUID()

    const res = await postEvents(testApp.app, sessionId, [event(id, 'off_task', 1000), event(id, 'off_task', 2000)])
    expect(res.statusCode).toBe(200)
    const body = res.json() as BatchResponseBody
    expect(body.accepted).toEqual([id])
    expect(body.duplicates).toEqual([id])
    expect(await storedCount(testApp, sessionId)).toBe(1)
  })

  it('(4) an offset beyond elapsed + 5000 ms -> 422 impossible_offset naming the clientEventId and zero rows stored, including the valid events of that batch', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, startedAt: new Date() })
    const validId = randomUUID()
    const invalidId = randomUUID()

    const res = await postEvents(testApp.app, sessionId, [
      event(validId, 'off_task', 0),
      event(invalidId, 'off_task', 50_000),
    ])
    expect(res.statusCode).toBe(422)
    const body = res.json() as ErrorBody
    expect(body.code).toBe('impossible_offset')
    expect(body.fieldErrors).toHaveProperty(invalidId)
    expect(body.fieldErrors).not.toHaveProperty(validId)

    expect(await storedCount(testApp, sessionId)).toBe(0)
  })

  it('(5) 101 events -> 400; 100 events -> 200', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId })

    const tooMany = Array.from({ length: 101 }, () => event(randomUUID(), 'off_task', 0))
    const tooManyRes = await postEvents(testApp.app, sessionId, tooMany)
    expect(tooManyRes.statusCode).toBe(400)

    const exactly100 = Array.from({ length: 100 }, () => event(randomUUID(), 'off_task', 0))
    const okRes = await postEvents(testApp.app, sessionId, exactly100)
    expect(okRes.statusCode).toBe(200)
  })

  it('(6) agent_check without details.alsoOffTask -> 422', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId })
    const id = randomUUID()

    const res = await postEvents(testApp.app, sessionId, [event(id, 'agent_check', 0)])
    expect(res.statusCode).toBe(422)
    const body = res.json() as ErrorBody
    expect(body.fieldErrors).toHaveProperty(id)
  })

  it('(7) type pause in a client batch -> 400 from the contract', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId })

    const res = await postEvents(testApp.app, sessionId, [event(randomUUID(), 'pause', 0)])
    expect(res.statusCode).toBe(400)
    expect((res.json() as ErrorBody).code).toBe('malformed_request')
  })

  it('(8) one off_task after five app visits -> exactly one row and tallies.offTask 1 (one departure, five apps)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId })
    const id = randomUUID()

    const res = await postEvents(testApp.app, sessionId, [event(id, 'off_task', 0)])
    expect(res.statusCode).toBe(200)

    const getRes = await getSession(testApp.app, sessionId)
    const body = getRes.json() as SessionBody
    expect(body.eventCount).toBe(1)
    expect(body.tallies.offTask).toBe(1)
  })

  it('(9) a visibility event -> accepted and stored, tallies all still zero (hidden page creates nothing)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId })
    const id = randomUUID()

    const res = await postEvents(testApp.app, sessionId, [event(id, 'visibility', 0)])
    expect(res.statusCode).toBe(200)
    expect((res.json() as BatchResponseBody).accepted).toEqual([id])

    const getRes = await getSession(testApp.app, sessionId)
    const body = getRes.json() as SessionBody
    expect(body.eventCount).toBe(1)
    expect(body.tallies).toEqual({ offTask: 0, external: 0, agentChecks: 0 })
  })

  it('(10) a clock_gap event with details {gapSeconds: 90} and no resolution -> accepted, GET shows the event with no resolution key (unresolved, D26)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId })
    const id = randomUUID()

    const res = await postEvents(testApp.app, sessionId, [event(id, 'clock_gap', 0, { gapSeconds: 90 })])
    expect(res.statusCode).toBe(200)

    const getRes = await getSession(testApp.app, sessionId)
    const body = getRes.json() as SessionBody
    const stored = body.events.find((e) => e.clientEventId === id)
    expect(stored?.details).toEqual({ gapSeconds: 90 })
    expect(stored?.details).not.toHaveProperty('resolution')
  })

  it('(11) a clock_gap event with details {gapSeconds: 90, resolution: "continued"} -> accepted and stored with resolution present', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId })
    const id = randomUUID()

    const res = await postEvents(testApp.app, sessionId, [
      event(id, 'clock_gap', 0, { gapSeconds: 90, resolution: 'continued' }),
    ])
    expect(res.statusCode).toBe(200)

    const getRes = await getSession(testApp.app, sessionId)
    const body = getRes.json() as SessionBody
    const stored = body.events.find((e) => e.clientEventId === id)
    expect(stored?.details).toEqual({ gapSeconds: 90, resolution: 'continued' })
  })

  it('(12) clock_gap without details.gapSeconds -> 422', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId })
    const id = randomUUID()

    const res = await postEvents(testApp.app, sessionId, [event(id, 'clock_gap', 0, { resolution: 'continued' })])
    expect(res.statusCode).toBe(422)
    const body = res.json() as ErrorBody
    expect(body.fieldErrors).toHaveProperty(id)
  })

  it("(13) another principal's session -> 404, nothing stored", async () => {
    const other = await insertOtherPrincipalProgram(testApp.db)
    const { sessionId } = await seedSession(testApp.db, { userId: other.userId, programId: other.programId })

    const res = await postEvents(testApp.app, sessionId, [event(randomUUID(), 'off_task', 0)])
    expect(res.statusCode).toBe(404)
    expect(await storedCount(testApp, sessionId)).toBe(0)
  })

  it('(14) seeded finalized session (review episode_count 3, finalized_at set, version 1): a late off_task -> accepted with details.reconciliation_warning true; review.episodeCount still 3, review.version still 1, finalizedAt unchanged (late event)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const startedAt = new Date('2026-09-06T09:00:00.000Z')
    const endedAt = new Date('2026-09-06T09:20:00.000Z')
    const finalizedAt = new Date('2026-09-06T09:25:00.000Z')
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      lifecycle: 'finalized',
      targetSeconds: 1200,
      startedAt,
      endedAt,
      review: { episodeCount: 3, version: 1, finalizedAt },
    })
    const id = randomUUID()

    const res = await postEvents(testApp.app, sessionId, [event(id, 'off_task', 1000)])
    expect(res.statusCode).toBe(200)
    expect((res.json() as BatchResponseBody).accepted).toEqual([id])

    const getRes = await getSession(testApp.app, sessionId)
    const body = getRes.json() as SessionBody
    const stored = body.events.find((e) => e.clientEventId === id)
    expect(stored?.details).toEqual({ reconciliation_warning: true })
    expect(body.review.episodeCount).toBe(3)
    expect(body.review.version).toBe(1)
    expect(body.review.finalizedAt).toBe(finalizedAt.toISOString())
  })

  it('(15) events on an awaiting_review session -> accepted without reconciliation_warning (last batch before finalize)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const startedAt = new Date('2026-09-06T09:00:00.000Z')
    const endedAt = new Date('2026-09-06T09:10:00.000Z')
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      lifecycle: 'awaiting_review',
      startedAt,
      endedAt,
    })
    const id = randomUUID()

    const res = await postEvents(testApp.app, sessionId, [event(id, 'off_task', 1000)])
    expect(res.statusCode).toBe(200)

    const getRes = await getSession(testApp.app, sessionId)
    const body = getRes.json() as SessionBody
    const stored = body.events.find((e) => e.clientEventId === id)
    expect(stored?.details).toEqual({})
  })

  it('(16) events on a seeded abandoned session -> stored with reconciliation_warning true', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const startedAt = new Date('2026-09-06T09:00:00.000Z')
    const endedAt = new Date('2026-09-06T09:05:00.000Z')
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      lifecycle: 'abandoned',
      startedAt,
      endedAt,
    })
    const id = randomUUID()

    const res = await postEvents(testApp.app, sessionId, [event(id, 'off_task', 1000)])
    expect(res.statusCode).toBe(200)

    const getRes = await getSession(testApp.app, sessionId)
    const body = getRes.json() as SessionBody
    const stored = body.events.find((e) => e.clientEventId === id)
    expect(stored?.details).toEqual({ reconciliation_warning: true })
  })

  it('(17) stored rows join to a focus_sessions row with realm demo (no session_events.realm column exists)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, realm: 'demo' })
    const id = randomUUID()

    const res = await postEvents(testApp.app, sessionId, [event(id, 'off_task', 0)])
    expect(res.statusCode).toBe(200)

    const rows = await testApp.db
      .select({ realm: focusSessions.realm })
      .from(sessionEvents)
      .innerJoin(focusSessions, eq(focusSessions.id, sessionEvents.sessionId))
      .where(eq(sessionEvents.sessionId, sessionId))

    expect(rows).toHaveLength(1)
    expect(rows[0]?.realm).toBe('demo')
    expect(sessionEvents).not.toHaveProperty('realm')
  })
})
