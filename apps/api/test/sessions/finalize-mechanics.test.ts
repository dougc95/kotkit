/**
 * 5.8.1 — Fastify inject integration tests for `POST /sessions/{id}/finalize`,
 * against the real `attention_lab_test` database via `buildTestApp` (3.2.1).
 * Composes 5.1.3's session seed helpers (plus this task's own `finalizeSession`
 * API helper) with 4.1.1's program helpers, per D16 — no lower layer is
 * re-created here. The kind-independent pure pieces (`assertFinalizableLifecycle`,
 * `planFinalizeLastBatch`, `assertEventCountMatches`) are unit tested directly
 * in `test/services/finalize.unit.test.ts`; this file exercises the route's
 * own concerns: ownership, idempotency, the lifecycle gate, `lastBatch`
 * application, the event-count mismatch, and the D20/2.7 response shape.
 * Kind-specific review rules (5.8.2 practice, 5.8.3 benchmark) and eligibility
 * derivation (5.8.4) are later tasks — this file's own review bodies use
 * `{ outputQuality: 'yes' }` and asserts nothing about `eligible`.
 */
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import { insertOtherPrincipalProgram, insertProgram, insertSlotSet } from '../helpers/programs.js'
import { finalizeSession, seedEvents, seedSession, withIdempotencyKey } from '../helpers/sessions.js'
import { LOCAL_DEMO_PRINCIPAL_ID } from '../../src/plugins/identity.js'
import { focusSessions, mutationReceipts, sessionEvents, sessionReviews } from '../../src/db/schema/index.js'

const BASE_PROGRAM = {
  baselineDate: '2026-09-06',
  timezone: 'UTC',
  status: 'active' as const,
  practiceTargetSeconds: 600,
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000)
}

interface ErrorBody {
  code: string
  message: string
  details?: Record<string, unknown>
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

async function sessionRow(testApp: TestApp, sessionId: string) {
  const [row] = await testApp.db
    .select()
    .from(focusSessions)
    .where(eq(focusSessions.id, sessionId))
    .limit(1)
  if (!row) throw new Error(`sessionRow: no focus_sessions row for '${sessionId}'`)
  return row
}

async function eventCount(testApp: TestApp, sessionId: string): Promise<number> {
  const [row] = await testApp.db
    .select({ count: sql<string>`count(*)` })
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId))
  return Number(row?.count ?? 0)
}

async function receiptCount(testApp: TestApp, key: string): Promise<number> {
  const [row] = await testApp.db
    .select({ count: sql<string>`count(*)` })
    .from(mutationReceipts)
    .where(and(eq(mutationReceipts.userId, LOCAL_DEMO_PRINCIPAL_ID), eq(mutationReceipts.idempotencyKey, key)))
  return Number(row?.count ?? 0)
}

describe('POST /sessions/{id}/finalize — mechanics (integration, attention_lab_test)', () => {
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

  it('(1) practice awaiting_review with 4 stored events, expectedEventCount 5 -> 409 event_count_mismatch, details {expected:5, stored:4}, no session_reviews.finalized_at, lifecycle still awaiting_review, no mutation_receipts row for this key (D21)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(15),
      endedAt: minutesAgo(5),
      targetSeconds: 600,
    })
    await seedEvents(testApp.db, sessionId, [
      { type: 'off_task', elapsedMs: 60_000 },
      { type: 'off_task', elapsedMs: 120_000 },
      { type: 'external', elapsedMs: 180_000 },
      { type: 'external', elapsedMs: 240_000 },
    ])

    const key = randomUUID()
    const res = await finalizeSession(
      testApp.app,
      sessionId,
      { expectedEventCount: 5, review: { outputQuality: 'yes' } },
      key,
    )

    expect(res.statusCode).toBe(409)
    const body = res.body as ErrorBody
    expect(body.code).toBe('event_count_mismatch')
    expect(body.details).toEqual({ expected: 5, stored: 4 })

    const review = await reviewRow(testApp, sessionId)
    expect(review.finalizedAt).toBeNull()
    const session = await sessionRow(testApp, sessionId)
    expect(session.lifecycle).toBe('awaiting_review')

    expect(await receiptCount(testApp, key)).toBe(0)
  })

  it('(2) retry the identical key after posting the missing event -> 200, one review row, lifecycle finalized, finalized_at set, version+1', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(15),
      endedAt: minutesAgo(5),
      targetSeconds: 600,
    })
    await seedEvents(testApp.db, sessionId, [
      { type: 'off_task', elapsedMs: 60_000 },
      { type: 'off_task', elapsedMs: 120_000 },
      { type: 'external', elapsedMs: 180_000 },
      { type: 'external', elapsedMs: 240_000 },
    ])

    const key = randomUUID()
    const overrides = { expectedEventCount: 5, review: { outputQuality: 'yes' as const } }
    const first = await finalizeSession(testApp.app, sessionId, overrides, key)
    expect(first.statusCode).toBe(409)

    await seedEvents(testApp.db, sessionId, [{ type: 'external', elapsedMs: 300_000 }])

    const second = await finalizeSession(testApp.app, sessionId, overrides, key)
    expect(second.statusCode).toBe(200)

    expect(await reviewRowCount(testApp, sessionId)).toBe(1)
    const session = await sessionRow(testApp, sessionId)
    expect(session.lifecycle).toBe('finalized')
    expect(session.version).toBe(2)
    const review = await reviewRow(testApp, sessionId)
    expect(review.finalizedAt).not.toBeNull()
  })

  it('(3) lastBatch carrying the missing event with expectedEventCount 5 -> 200 in one call', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(15),
      endedAt: minutesAgo(5),
      targetSeconds: 600,
    })
    await seedEvents(testApp.db, sessionId, [
      { type: 'off_task', elapsedMs: 60_000 },
      { type: 'off_task', elapsedMs: 120_000 },
      { type: 'external', elapsedMs: 180_000 },
      { type: 'external', elapsedMs: 240_000 },
    ])

    const res = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 5,
      review: { outputQuality: 'yes' },
      lastBatch: {
        events: [
          { clientEventId: randomUUID(), type: 'external', elapsedMs: 250_000, occurredAt: new Date().toISOString() },
        ],
      },
    })

    expect(res.statusCode).toBe(200)
    expect(await eventCount(testApp, sessionId)).toBe(5)
  })

  it('(4) lastBatch re-sending an already-stored client_event_id -> deduped, count unchanged', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(15),
      endedAt: minutesAgo(5),
      targetSeconds: 600,
    })
    const [existing] = await seedEvents(testApp.db, sessionId, [{ type: 'off_task', elapsedMs: 60_000 }])
    await seedEvents(testApp.db, sessionId, [
      { type: 'off_task', elapsedMs: 120_000 },
      { type: 'external', elapsedMs: 180_000 },
    ])
    if (!existing) throw new Error('seedEvents returned no row')

    const res = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 3,
      review: { outputQuality: 'yes' },
      lastBatch: {
        events: [
          {
            clientEventId: existing.clientEventId,
            type: 'off_task',
            elapsedMs: 60_000,
            occurredAt: new Date().toISOString(),
          },
        ],
      },
    })

    expect(res.statusCode).toBe(200)
    expect(await eventCount(testApp, sessionId)).toBe(3)
  })

  it('(5) voided event still counts toward stored: 5 rows with 1 voided -> expectedEventCount 5 -> 200, expectedEventCount 4 -> 409', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)

    async function seedFiveWithOneVoided(): Promise<string> {
      const { sessionId } = await seedSession(testApp.db, {
        programId,
        kind: 'practice',
        lifecycle: 'awaiting_review',
        startedAt: minutesAgo(15),
        endedAt: minutesAgo(5),
        targetSeconds: 600,
      })
      await seedEvents(testApp.db, sessionId, [
        { type: 'off_task', elapsedMs: 10_000 },
        { type: 'off_task', elapsedMs: 20_000, voidedAt: new Date() },
        { type: 'external', elapsedMs: 30_000 },
        { type: 'external', elapsedMs: 40_000 },
        { type: 'external', elapsedMs: 50_000 },
      ])
      return sessionId
    }

    const sessionOk = await seedFiveWithOneVoided()
    const resOk = await finalizeSession(testApp.app, sessionOk, {
      expectedEventCount: 5,
      review: { outputQuality: 'yes' },
    })
    expect(resOk.statusCode).toBe(200)

    const sessionMismatch = await seedFiveWithOneVoided()
    const resMismatch = await finalizeSession(testApp.app, sessionMismatch, {
      expectedEventCount: 4,
      review: { outputQuality: 'yes' },
    })
    expect(resMismatch.statusCode).toBe(409)
    expect((resMismatch.body as ErrorBody).code).toBe('event_count_mismatch')
  })

  it('(6) replay same key + same body -> 200 deep-equal result, one review row, session version unchanged', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(15),
      endedAt: minutesAgo(5),
      targetSeconds: 600,
    })

    const key = randomUUID()
    const overrides = { expectedEventCount: 0, review: { outputQuality: 'yes' as const } }
    const first = await finalizeSession(testApp.app, sessionId, overrides, key)
    expect(first.statusCode).toBe(200)
    const versionAfterFirst = (await sessionRow(testApp, sessionId)).version

    const second = await finalizeSession(testApp.app, sessionId, overrides, key)
    expect(second.statusCode).toBe(200)
    // `serverNow` is `ctx.now.toISOString()`, freshly derived on every call
    // (D21: a replay re-reads CURRENT state, never a stashed response body)
    // — it alone may legitimately differ between the two calls, so it is
    // excluded from this otherwise-exact comparison.
    const stripServerNow = (body: unknown) => {
      const clone = structuredClone(body) as { session: { serverNow?: unknown } }
      delete clone.session.serverNow
      return clone
    }
    expect(stripServerNow(second.body)).toEqual(stripServerNow(first.body))

    expect(await reviewRowCount(testApp, sessionId)).toBe(1)
    const versionAfterSecond = (await sessionRow(testApp, sessionId)).version
    expect(versionAfterSecond).toBe(versionAfterFirst)
  })

  it('(7) same key + different body -> 409 idempotency_mismatch', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(15),
      endedAt: minutesAgo(5),
      targetSeconds: 600,
    })

    const key = randomUUID()
    const first = await finalizeSession(
      testApp.app,
      sessionId,
      { expectedEventCount: 0, review: { outputQuality: 'yes' } },
      key,
    )
    expect(first.statusCode).toBe(200)

    const second = await finalizeSession(
      testApp.app,
      sessionId,
      { expectedEventCount: 0, review: { outputQuality: 'no' } },
      key,
    )
    expect(second.statusCode).toBe(409)
    expect((second.body as ErrorBody).code).toBe('idempotency_mismatch')
  })

  it('(8) new key on a finalized session -> 409 already_finalized', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(15),
      endedAt: minutesAgo(5),
      targetSeconds: 600,
    })

    const first = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 0,
      review: { outputQuality: 'yes' },
    })
    expect(first.statusCode).toBe(200)

    const second = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 0,
      review: { outputQuality: 'yes' },
    })
    expect(second.statusCode).toBe(409)
    expect((second.body as ErrorBody).code).toBe('already_finalized')
  })

  it('(9) running practice -> 409 session_not_ended', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'running',
      targetSeconds: 600,
    })

    const res = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 0,
      review: { outputQuality: 'yes' },
    })
    expect(res.statusCode).toBe(409)
    expect((res.body as ErrorBody).code).toBe('session_not_ended')
  })

  it('(10) paused practice -> 409 session_not_ended', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'paused',
      targetSeconds: 600,
      currentPauseStartedAt: minutesAgo(1),
    })

    const res = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 0,
      review: { outputQuality: 'yes' },
    })
    expect(res.statusCode).toBe(409)
    expect((res.body as ErrorBody).code).toBe('session_not_ended')
  })

  it('(11) benchmark running with started_at seeded 25 min before ctx.now (target passed) -> 409 session_not_ended and nothing finalized', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      lifecycle: 'running',
      startedAt: minutesAgo(25),
      targetSeconds: 1200,
    })

    const res = await finalizeSession(testApp.app, sessionId, { expectedEventCount: 0, review: {} })
    expect(res.statusCode).toBe(409)
    expect((res.body as ErrorBody).code).toBe('session_not_ended')

    const session = await sessionRow(testApp, sessionId)
    expect(session.lifecycle).toBe('running')
  })

  it('(12) abandoned -> 409 session_not_active', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'abandoned',
      targetSeconds: 600,
      endedAt: minutesAgo(5),
    })

    const res = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 0,
      review: { outputQuality: 'yes' },
    })
    expect(res.statusCode).toBe(409)
    expect((res.body as ErrorBody).code).toBe('session_not_active')
  })

  it('(13) missing Idempotency-Key -> 400', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      endedAt: minutesAgo(5),
      targetSeconds: 600,
    })

    const res = await testApp.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/finalize`,
      payload: { expectedEventCount: 0, review: { outputQuality: 'yes' } },
    })
    expect(res.statusCode).toBe(400)
  })

  it('(14) expectedEventCount omitted -> 400', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      endedAt: minutesAgo(5),
      targetSeconds: 600,
    })

    const res = await testApp.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/finalize`,
      headers: withIdempotencyKey(),
      payload: { review: { outputQuality: 'yes' } },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as ErrorBody).code).toBe('malformed_request')
  })

  it('(15) body containing eligible or exclusionReasons -> 400', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      endedAt: minutesAgo(5),
      targetSeconds: 600,
    })

    const withEligible = await testApp.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/finalize`,
      headers: withIdempotencyKey(),
      payload: { expectedEventCount: 0, review: { outputQuality: 'yes' }, eligible: true },
    })
    expect(withEligible.statusCode).toBe(400)
    expect((withEligible.json() as ErrorBody).code).toBe('malformed_request')

    const withExclusionReasons = await testApp.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/finalize`,
      headers: withIdempotencyKey(),
      payload: { expectedEventCount: 0, review: { outputQuality: 'yes' }, exclusionReasons: [] },
    })
    expect(withExclusionReasons.statusCode).toBe(400)
    expect((withExclusionReasons.json() as ErrorBody).code).toBe('malformed_request')
  })

  it("(16) another principal's session -> 404", async () => {
    const other = await insertOtherPrincipalProgram(testApp.db)
    const { sessionId } = await seedSession(testApp.db, {
      userId: other.userId,
      programId: other.programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      endedAt: minutesAgo(5),
      targetSeconds: 600,
    })

    const res = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 0,
      review: { outputQuality: 'yes' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('(17) late event after finalize is accepted with reconciliation_warning (5.3) and the session_reviews row is byte-identical before and after', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(15),
      endedAt: minutesAgo(5),
      targetSeconds: 600,
    })

    const finalizeRes = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 0,
      review: { outputQuality: 'yes', episodeCount: 2, countMethod: 'event' },
    })
    expect(finalizeRes.statusCode).toBe(200)

    const before = await reviewRow(testApp, sessionId)

    const clientEventId = randomUUID()
    const eventRes = await testApp.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/events`,
      payload: {
        events: [{ clientEventId, type: 'off_task', elapsedMs: 400_000, occurredAt: new Date().toISOString() }],
      },
    })
    expect(eventRes.statusCode).toBe(200)
    expect(eventRes.json()).toMatchObject({ accepted: [clientEventId], duplicates: [] })

    const getRes = await testApp.app.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}` })
    expect(getRes.statusCode).toBe(200)
    const lateEvent = (getRes.json().events as Array<{ clientEventId: string; details: Record<string, unknown> }>).find(
      (event) => event.clientEventId === clientEventId,
    )
    expect(lateEvent?.details.reconciliation_warning).toBe(true)

    const after = await reviewRow(testApp, sessionId)
    expect(after).toEqual(before)
  })
})
