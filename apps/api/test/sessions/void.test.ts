/**
 * 5.3.2 — Fastify inject integration tests for `POST
 * /sessions/{id}/events/{clientEventId}/void`, against the real
 * `attention_lab_test` database via `buildTestApp` (3.2.1). Composes 5.1.3's
 * session seed helpers with 4.1.1's program helpers, per D16 — no lower layer
 * is re-created here.
 */
import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import { insertOtherPrincipalProgram, insertProgram } from '../helpers/programs.js'
import { seedEvents, seedSession } from '../helpers/sessions.js'
import { sessionEvents } from '../../src/db/schema/index.js'

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

async function postVoid(app: FastifyInstance, sessionId: string, clientEventId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/events/${clientEventId}/void`,
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

interface EventBody {
  id: string
  clientEventId: string
  type: string
  elapsedMs: number | null
  voidedAt: string | null
}

interface SessionBody {
  eventCount: number
  tallies: { offTask: number; external: number; agentChecks: number }
  events: Array<{ clientEventId: string; voidedAt: string | null }>
}

async function countEvents(testApp: TestApp, sessionId: string): Promise<number> {
  const rows = await testApp.db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId))
  return rows.length
}

async function countUnvoidedEvents(testApp: TestApp, sessionId: string): Promise<number> {
  const rows = await testApp.db
    .select()
    .from(sessionEvents)
    .where(and(eq(sessionEvents.sessionId, sessionId), isNull(sessionEvents.voidedAt)))
  return rows.length
}

async function loadVoidedAt(testApp: TestApp, clientEventId: string): Promise<Date | null> {
  const [row] = await testApp.db
    .select({ voidedAt: sessionEvents.voidedAt })
    .from(sessionEvents)
    .where(eq(sessionEvents.clientEventId, clientEventId))
    .limit(1)
  return row?.voidedAt ?? null
}

describe('POST /sessions/{id}/events/{clientEventId}/void (integration, attention_lab_test)', () => {
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

  it('(1) record off_task twice, void the second -> GET tallies.offTask 1 and eventCount 2, both rows still present, one with voidedAt (undo accidental duplicate)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId })
    const idA = randomUUID()
    const idB = randomUUID()

    const postRes = await postEvents(testApp.app, sessionId, [event(idA, 'off_task'), event(idB, 'off_task')])
    expect(postRes.statusCode).toBe(200)

    const voidRes = await postVoid(testApp.app, sessionId, idB)
    expect(voidRes.statusCode).toBe(200)
    const voidBody = voidRes.json() as EventBody
    expect(voidBody.clientEventId).toBe(idB)
    expect(voidBody.voidedAt).not.toBeNull()

    const getRes = await getSession(testApp.app, sessionId)
    const body = getRes.json() as SessionBody
    expect(body.tallies.offTask).toBe(1)
    expect(body.eventCount).toBe(2)
    expect(body.events.find((e) => e.clientEventId === idA)?.voidedAt).toBeNull()
    expect(body.events.find((e) => e.clientEventId === idB)?.voidedAt).not.toBeNull()

    expect(await countEvents(testApp, sessionId)).toBe(2)
    expect(await countUnvoidedEvents(testApp, sessionId)).toBe(1)
  })

  it('(2) void on a seeded finalized session -> 409 already_finalized and voided_at still null', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, lifecycle: 'finalized' })
    const clientEventId = randomUUID()
    await seedEvents(testApp.db, sessionId, [{ clientEventId, type: 'off_task', elapsedMs: 1000 }])

    const res = await postVoid(testApp.app, sessionId, clientEventId)
    expect(res.statusCode).toBe(409)
    expect((res.json() as ErrorBody).code).toBe('already_finalized')

    expect(await loadVoidedAt(testApp, clientEventId)).toBeNull()
  })

  it('(3) void an unknown clientEventId -> 404', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId })

    const res = await postVoid(testApp.app, sessionId, randomUUID())
    expect(res.statusCode).toBe(404)
  })

  it("(4) void on another principal's session -> 404", async () => {
    const other = await insertOtherPrincipalProgram(testApp.db)
    const { sessionId } = await seedSession(testApp.db, { userId: other.userId, programId: other.programId })
    const clientEventId = randomUUID()
    await seedEvents(testApp.db, sessionId, [{ clientEventId, type: 'off_task', elapsedMs: 0 }])

    const res = await postVoid(testApp.app, sessionId, clientEventId)
    expect(res.statusCode).toBe(404)

    expect(await loadVoidedAt(testApp, clientEventId)).toBeNull()
  })

  it('(5) void the same event twice -> second call 200 with the same voidedAt', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId })
    const clientEventId = randomUUID()
    await seedEvents(testApp.db, sessionId, [{ clientEventId, type: 'off_task', elapsedMs: 0 }])

    const first = await postVoid(testApp.app, sessionId, clientEventId)
    expect(first.statusCode).toBe(200)
    const firstVoidedAt = (first.json() as EventBody).voidedAt
    expect(firstVoidedAt).not.toBeNull()

    const second = await postVoid(testApp.app, sessionId, clientEventId)
    expect(second.statusCode).toBe(200)
    const secondVoidedAt = (second.json() as EventBody).voidedAt

    expect(secondVoidedAt).toBe(firstVoidedAt)
  })

  it('(6) void an agent_check with alsoOffTask true -> offTask and agentChecks each drop by exactly one', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId })
    const id = randomUUID()

    const postRes = await postEvents(testApp.app, sessionId, [event(id, 'agent_check', 0, { alsoOffTask: true })])
    expect(postRes.statusCode).toBe(200)

    const beforeRes = await getSession(testApp.app, sessionId)
    const before = beforeRes.json() as SessionBody
    expect(before.tallies).toEqual({ offTask: 1, external: 0, agentChecks: 1 })

    const voidRes = await postVoid(testApp.app, sessionId, id)
    expect(voidRes.statusCode).toBe(200)

    const afterRes = await getSession(testApp.app, sessionId)
    const after = afterRes.json() as SessionBody
    expect(after.tallies).toEqual({ offTask: 0, external: 0, agentChecks: 0 })
  })

  it('(7) void on an awaiting_review session -> 200 (unfinalized events stay undoable)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const startedAt = new Date('2026-09-06T09:00:00.000Z')
    const endedAt = new Date('2026-09-06T09:10:00.000Z')
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      lifecycle: 'awaiting_review',
      startedAt,
      endedAt,
    })
    const clientEventId = randomUUID()
    await seedEvents(testApp.db, sessionId, [{ clientEventId, type: 'off_task', elapsedMs: 1000 }])

    const res = await postVoid(testApp.app, sessionId, clientEventId)
    expect(res.statusCode).toBe(200)
    expect((res.json() as EventBody).voidedAt).not.toBeNull()
  })

  it('(8) void a seeded pause row -> 422 invalid_transition, voided_at null', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, { programId, kind: 'practice' })
    const clientEventId = randomUUID()
    await seedEvents(testApp.db, sessionId, [
      { clientEventId, type: 'pause', elapsedMs: 1000, details: { reason: 'planned_break' } },
    ])

    const res = await postVoid(testApp.app, sessionId, clientEventId)
    expect(res.statusCode).toBe(422)
    expect((res.json() as ErrorBody).code).toBe('invalid_transition')

    expect(await loadVoidedAt(testApp, clientEventId)).toBeNull()
  })

  it('(9) void on a seeded abandoned session -> 200 (abandoned attempts stay editable at the event level, only finalized ones freeze)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const startedAt = new Date('2026-09-06T09:00:00.000Z')
    const endedAt = new Date('2026-09-06T09:05:00.000Z')
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      lifecycle: 'abandoned',
      startedAt,
      endedAt,
    })
    const clientEventId = randomUUID()
    await seedEvents(testApp.db, sessionId, [{ clientEventId, type: 'off_task', elapsedMs: 1000 }])

    const res = await postVoid(testApp.app, sessionId, clientEventId)
    expect(res.statusCode).toBe(200)
    expect((res.json() as EventBody).voidedAt).not.toBeNull()
  })
})
