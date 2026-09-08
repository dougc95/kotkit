/**
 * 5.9.1 — Fastify inject integration tests for
 * `POST /sessions/{id}/amendments`, against the real `attention_lab_test`
 * database via `buildTestApp` (3.2.1). Composes 5.1.3's session seed helpers
 * (plus this task's own `postAmendment` API helper) with 4.1.1's program
 * helpers, per D16 — no lower layer is re-created here. The pure lifecycle
 * gate and the `AmendmentBody` contract are unit tested directly in
 * `test/services/amendments.unit.test.ts`; this file exercises the route's
 * own concerns: append-only behavior, the D20 `amendments[]` wiring on the
 * session response, the absence of any update/delete route, ownership, and
 * log privacy for the reason text (D32, 3.6 harness).
 */
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import { insertOtherPrincipalProgram, insertProgram, insertSlotSet } from '../helpers/programs.js'
import { postAmendment, seedSession } from '../helpers/sessions.js'
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

interface ErrorBody {
  code: string
  message: string
}

interface AmendmentBody {
  id: string
  sessionId: string
  reason: string
  excludeFromReport: boolean
  createdAt: string
}

interface SessionBody {
  id: string
  amendments: AmendmentBody[]
}

async function getSession(testApp: TestApp, sessionId: string) {
  return testApp.app.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}` })
}

async function focusSessionRow(testApp: TestApp, sessionId: string) {
  const [row] = await testApp.db.select().from(focusSessions).where(eq(focusSessions.id, sessionId)).limit(1)
  if (!row) throw new Error(`focusSessionRow: no focus_sessions row for '${sessionId}'`)
  return row
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

/** A finalized benchmark attempt with non-trivial eligibility/review content, so the "byte-identical" check (case 3) is meaningful. */
async function seedFinalizedBenchmark(testApp: TestApp) {
  const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
  const slots = await insertSlotSet(testApp.db, programId)
  const { sessionId } = await seedSession(testApp.db, {
    programId,
    kind: 'benchmark',
    slotId: slots.baselineA,
    targetSeconds: 1200,
    lifecycle: 'finalized',
    startedAt: minutesAgo(40),
    endedAt: minutesAgo(20),
    completeInterval: true,
    eligible: true,
    exclusionReasons: [],
    review: {
      episodeCount: 2,
      countMethod: 'event',
      materiallyDisrupted: false,
      finalizedAt: minutesAgo(18),
    },
  })
  return { programId, sessionId }
}

describe('POST /sessions/{id}/amendments (integration, attention_lab_test)', () => {
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

  it('(1) finalized benchmark -> POST {reason:"wrong material", excludeFromReport:true} -> 201 with id and createdAt', async () => {
    const { sessionId } = await seedFinalizedBenchmark(testApp)

    const res = await postAmendment(testApp.app, sessionId, {
      reason: 'wrong material',
      excludeFromReport: true,
    })

    expect(res.statusCode).toBe(201)
    const body = res.body as AmendmentBody
    expect(body.id).toEqual(expect.any(String))
    expect(body.sessionId).toBe(sessionId)
    expect(body.reason).toBe('wrong material')
    expect(body.excludeFromReport).toBe(true)
    expect(body.createdAt).toEqual(expect.any(String))
  })

  it('(2) second POST {reason:"context", excludeFromReport:false} -> 201, two rows in creation order, the first unchanged', async () => {
    const { sessionId } = await seedFinalizedBenchmark(testApp)

    const first = await postAmendment(testApp.app, sessionId, {
      reason: 'wrong material',
      excludeFromReport: true,
    })
    expect(first.statusCode).toBe(201)
    const firstBody = first.body as AmendmentBody

    const second = await postAmendment(testApp.app, sessionId, { reason: 'context', excludeFromReport: false })
    expect(second.statusCode).toBe(201)
    const secondBody = second.body as AmendmentBody
    expect(secondBody.id).not.toBe(firstBody.id)

    const getRes = await getSession(testApp, sessionId)
    expect(getRes.statusCode).toBe(200)
    const body = getRes.json() as SessionBody
    expect(body.amendments).toHaveLength(2)
    // The first amendment is byte-identical after the second POST — an
    // amendment is append-only, never rewritten by a later one.
    expect(body.amendments[0]).toEqual(firstBody)
    expect(body.amendments[1]).toEqual(secondBody)
  })

  it('(3) after both amendments the session_reviews row and focus_sessions.eligible/exclusion_reasons are byte-identical to before', async () => {
    const { sessionId } = await seedFinalizedBenchmark(testApp)

    const beforeSession = await focusSessionRow(testApp, sessionId)
    const beforeReview = await reviewRow(testApp, sessionId)

    const first = await postAmendment(testApp.app, sessionId, {
      reason: 'wrong material',
      excludeFromReport: true,
    })
    expect(first.statusCode).toBe(201)
    const second = await postAmendment(testApp.app, sessionId, { reason: 'context', excludeFromReport: false })
    expect(second.statusCode).toBe(201)

    const afterSession = await focusSessionRow(testApp, sessionId)
    const afterReview = await reviewRow(testApp, sessionId)

    expect(afterSession).toEqual(beforeSession)
    expect(afterReview).toEqual(beforeReview)
    // Explicit, not just "unchanged": the stored eligibility this fixture
    // seeded is exactly what an amendment must never rewrite (D32).
    expect(afterSession.eligible).toBe(true)
    expect(afterSession.exclusionReasons).toEqual([])
  })

  it('(4) PUT/PATCH/DELETE /sessions/{id}/amendments/{amendmentId} -> 404 not_found (no route)', async () => {
    const { sessionId } = await seedFinalizedBenchmark(testApp)
    const posted = await postAmendment(testApp.app, sessionId, {
      reason: 'wrong material',
      excludeFromReport: true,
    })
    expect(posted.statusCode).toBe(201)
    const amendmentId = (posted.body as AmendmentBody).id

    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      const res = await testApp.app.inject({
        method,
        url: `/api/v1/sessions/${sessionId}/amendments/${amendmentId}`,
        payload: { reason: 'edited' },
      })
      expect(res.statusCode).toBe(404)
      expect((res.json() as ErrorBody).code).toBe('not_found')
    }
  })

  it('(5) empty reason -> 400', async () => {
    const { sessionId } = await seedFinalizedBenchmark(testApp)

    const res = await postAmendment(testApp.app, sessionId, { reason: '', excludeFromReport: false })
    expect(res.statusCode).toBe(400)
    expect((res.body as ErrorBody).code).toBe('malformed_request')
  })

  it('(6) awaiting_review session -> 409 not_finalized', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
      lifecycle: 'awaiting_review',
      endedAt: minutesAgo(5),
      completeInterval: true,
    })

    const res = await postAmendment(testApp.app, sessionId, {
      reason: 'wrong material',
      excludeFromReport: true,
    })
    expect(res.statusCode).toBe(409)
    expect((res.body as ErrorBody).code).toBe('not_finalized')
  })

  it("(7) other principal's session -> 404", async () => {
    const other = await insertOtherPrincipalProgram(testApp.db)
    const otherSlots = await insertSlotSet(testApp.db, other.programId)
    const { sessionId } = await seedSession(testApp.db, {
      userId: other.userId,
      programId: other.programId,
      kind: 'benchmark',
      slotId: otherSlots.baselineA,
      lifecycle: 'finalized',
      targetSeconds: 1200,
      endedAt: minutesAgo(5),
      completeInterval: true,
    })

    const res = await postAmendment(testApp.app, sessionId, {
      reason: 'wrong material',
      excludeFromReport: true,
    })
    expect(res.statusCode).toBe(404)
  })

  it('(8) GET /sessions/{id} lists both amendments in order', async () => {
    const { sessionId } = await seedFinalizedBenchmark(testApp)

    const first = await postAmendment(testApp.app, sessionId, {
      reason: 'wrong material',
      excludeFromReport: true,
    })
    const second = await postAmendment(testApp.app, sessionId, { reason: 'context', excludeFromReport: false })
    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)

    const getRes = await getSession(testApp, sessionId)
    expect(getRes.statusCode).toBe(200)
    const body = getRes.json() as SessionBody
    expect(body.amendments.map((a) => a.reason)).toEqual(['wrong material', 'context'])
    expect(body.amendments.map((a) => a.excludeFromReport)).toEqual([true, false])
  })

  it('(9) log capture (3.6 harness): reason text absent from Pino output', async () => {
    const { sessionId } = await seedFinalizedBenchmark(testApp)

    const reason = 'PRIVATE-AMENDMENT-reason-text'
    const res = await postAmendment(testApp.app, sessionId, { reason, excludeFromReport: true })
    expect(res.statusCode).toBe(201)

    const logText = testApp.logs.text()
    expect(logText).not.toContain(reason)
    expect(JSON.stringify(res.body)).toContain(reason) // sanity: the response itself does carry it
  })
})
