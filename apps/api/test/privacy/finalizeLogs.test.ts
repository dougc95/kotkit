/**
 * 3.6.2 — an end-to-end privacy assertion over the finalize flow, driving the
 * real routes (not seed helpers) so that private free text genuinely travels
 * through request parsing, validation and logging exactly as a real client's
 * would: POST /programs (4.1.2), PUT /programs/{id}/benchmark-slots (4.3.2),
 * POST /demo/clock (3.5.2) to reach the baseline slot date, POST /sessions
 * (5.1.1 practice, 5.1.2 benchmark), `transitions { type: 'end' }` (5.4.2,
 * D24), POST /sessions/{id}/recall (5.7.2), and POST /sessions/{id}/finalize
 * (5.8.1 mechanics, 5.8.2 practice, 5.8.3 benchmark gate). No production
 * change is expected; if a marker leaks, the leaking logger/serializer/error
 * message is fixed in the owning unit and this test re-run.
 *
 * The five cases share one practice session and one benchmark session built
 * as the flow progresses — the shared setup is what "drives the real routes"
 * end to end; each `it` exercises its own finalize call and assertions,
 * matching this codebase's usual one-case-per-`it` convention. Execution
 * order (declaration order, which Vitest preserves within one file) is (a),
 * (b), (e), (c), (d) rather than the brief's own (a)-(e) label order: only
 * one benchmark session can exist per program's baseline-A slot, and
 * "one unfinished session per user" (practice-sessions spec) means a second
 * session cannot start while the first is still `awaiting_review` — so (e)
 * must actually finalize the practice session (freeing that slot) before the
 * benchmark session used by (c)/(d) can be started. The labels below keep
 * the brief's own (a)-(e) naming for traceability.
 *
 * See design.md identity-realm "Private data is never written to logs or
 * stored insecurely" and app-shell "Implementation details are not
 * user-facing".
 */
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import { createProgramViaApi } from '../helpers/programs.js'

const MARKERS = ['PRIVATE-OUTPUT-1b2c', 'PRIVATE-RECALL-5a9c', 'PRIVATE-NOTE-7c1d', 'PRIVATE-DISRUPTION-2e4b'] as const

interface ErrorBody {
  code: string
  message: string
  fieldErrors?: Record<string, string>
  details?: Record<string, unknown>
}

function tomorrowUtc(): string {
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  return d.toISOString().slice(0, 10)
}

/** Matches the POST /demo/clock offset used in setup, so `ctx.now` server-side and any client-computed timestamp (e.g. recall's `startedAt`) agree. */
const DEMO_CLOCK_OFFSET_SECONDS = 86_400

function demoNowIso(): string {
  return new Date(Date.now() + DEMO_CLOCK_OFFSET_SECONDS * 1000).toISOString()
}

async function postSession(app: FastifyInstance, payload: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    payload,
    headers: { 'idempotency-key': randomUUID() },
  })
  return { statusCode: res.statusCode, headers: res.headers, body: res.json() as Record<string, unknown> }
}

async function postTransition(app: FastifyInstance, sessionId: string, body: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/transitions`,
    payload: body,
  })
  return { statusCode: res.statusCode, headers: res.headers, body: res.json() as Record<string, unknown> }
}

async function postRecall(app: FastifyInstance, sessionId: string, payload: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/recall`,
    payload,
    headers: { 'idempotency-key': randomUUID() },
  })
  return { statusCode: res.statusCode, headers: res.headers, body: res.json() as Record<string, unknown> }
}

async function postFinalize(app: FastifyInstance, sessionId: string, payload: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/finalize`,
    payload,
    headers: { 'idempotency-key': randomUUID() },
  })
  return { statusCode: res.statusCode, headers: res.headers, body: res.json() as Record<string, unknown> }
}

/**
 * Asserts none of the four private markers reached any captured log entry —
 * the universal guarantee this whole test proves, checked after every call
 * regardless of whether it succeeded or failed.
 */
function expectNoMarkersInLogs(testApp: TestApp) {
  const logsText = testApp.logs.text()
  for (const marker of MARKERS) {
    expect(logsText).not.toContain(marker)
  }
}

/**
 * Asserts none of the four private markers reached the response body either
 * — only for the four error-response cases (a)-(d), where nothing submitted
 * should ever be echoed back (3.2.4: "validation -> fieldErrors without
 * echoing values"). A successful response ((e)'s own finalize, or any of the
 * setup calls) legitimately echoes back what was just saved, by design — see
 * (e) below, which asserts only about the log entry, not the response body.
 */
function expectNoMarkersInErrorResponse(testApp: TestApp, res: { body: unknown }) {
  const bodyText = JSON.stringify(res.body)
  for (const marker of MARKERS) {
    expect(bodyText).not.toContain(marker)
  }
  expectNoMarkersInLogs(testApp)
}

describe('finalize log-privacy (3.6.2, integration against attention_lab_test, real routes end to end)', () => {
  let testApp: TestApp
  let programId: string
  let baselineASlotId: string
  let practiceId: string
  let benchmarkId: string

  beforeAll(async () => {
    testApp = await buildTestApp()
    await testApp.truncateAll()

    // --- a program with complete benchmark slots, clocked to Day 0 ---
    const created = await createProgramViaApi(testApp.app, { baselineDate: tomorrowUtc(), timezone: 'UTC' })
    expect(created.statusCode).toBe(201)
    programId = created.body.program.id

    const slotsRes = await testApp.app.inject({
      method: 'PUT',
      url: `/api/v1/programs/${programId}/benchmark-slots`,
      payload: {
        expectedVersion: 1,
        slots: [
          { phase: 'baseline', label: 'A', materialRef: 'baseline A material', plannedLocalTime: '09:00' },
          { phase: 'baseline', label: 'B', materialRef: 'baseline B material', plannedLocalTime: '10:00' },
          { phase: 'final', label: 'A', materialRef: 'final A material' },
          { phase: 'final', label: 'B', materialRef: 'final B material' },
        ],
      },
    })
    expect(slotsRes.statusCode).toBe(200)
    const slotsBody = slotsRes.json() as { slots: Array<{ id: string; phase: string; label: string }> }
    const baselineA = slotsBody.slots.find((s) => s.phase === 'baseline' && s.label === 'A')
    if (!baselineA) throw new Error('baseline A slot not found in PUT benchmark-slots response')
    baselineASlotId = baselineA.id

    const clockRes = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/demo/clock',
      payload: { offsetSeconds: DEMO_CLOCK_OFFSET_SECONDS },
    })
    expect(clockRes.statusCode).toBe(200)

    // --- practice session, started and ended: (a)/(b)/(e) finalize it below.
    // The benchmark session (c)/(d) use is NOT started here — practice-sessions'
    // "one unfinished session per user" would reject it while this one is
    // still awaiting_review; (e) starts it once practice is finalized. ---
    const practiceStart = await postSession(testApp.app, {
      programId,
      kind: 'practice',
      intendedOutput: 'PRIVATE-OUTPUT-1b2c',
    })
    expect(practiceStart.statusCode).toBe(201)
    practiceId = practiceStart.body.id as string

    const practiceEnd = await postTransition(testApp.app, practiceId, { expectedVersion: 1, type: 'end' })
    expect(practiceEnd.statusCode).toBe(200)

    expectNoMarkersInLogs(testApp)
  })

  afterAll(async () => {
    await testApp.close()
  })

  it('(a) count mismatch 409 details carry only expected/stored, no marker in body or logs', async () => {
    const mismatch = await postFinalize(testApp.app, practiceId, {
      expectedEventCount: 5,
      review: { outputQuality: 'yes', outputNote: 'PRIVATE-NOTE-7c1d' },
    })
    expect(mismatch.statusCode).toBe(409)
    const body = mismatch.body as unknown as ErrorBody
    expect(body.code).toBe('event_count_mismatch')
    expect(body.details).toEqual({ expected: 5, stored: 0 })
    expectNoMarkersInErrorResponse(testApp, mismatch)
  })

  it("(b) episodeCount typed as a string -> 400 fieldErrors['review.episodeCount'], no marker in body or logs", async () => {
    const badType = await postFinalize(testApp.app, practiceId, {
      expectedEventCount: 0,
      review: { episodeCount: 'three', outputNote: 'PRIVATE-NOTE-7c1d' },
    })
    expect(badType.statusCode).toBe(400)
    const body = badType.body as unknown as ErrorBody
    expect(body.fieldErrors?.['review.episodeCount']).toBeDefined()
    expectNoMarkersInErrorResponse(testApp, badType)
  })

  it('(e) a successful practice finalize with outputNote returns 200, and its completion log entry carries no marker', async () => {
    const success = await postFinalize(testApp.app, practiceId, {
      expectedEventCount: 0,
      review: { outputQuality: 'yes', outputNote: 'PRIVATE-NOTE-7c1d' },
    })
    expect(success.statusCode).toBe(200)
    expectNoMarkersInLogs(testApp)

    const reqId = success.headers['x-request-id'] as string
    const completion = testApp.logs.entriesWith(reqId).find((entry) => entry.msg === 'request completed')
    expect(completion).toBeDefined()
    expect(JSON.stringify(completion)).not.toContain('PRIVATE-NOTE-7c1d')

    // Practice is now finalized, freeing the "one unfinished session" slot
    // (c)/(d) below need — start and end the benchmark session here.
    const benchmarkStart = await postSession(testApp.app, {
      programId,
      kind: 'benchmark',
      slotId: baselineASlotId,
    })
    expect(benchmarkStart.statusCode).toBe(201)
    benchmarkId = benchmarkStart.body.id as string

    const benchmarkEnd = await postTransition(testApp.app, benchmarkId, { expectedVersion: 1, type: 'end' })
    expect(benchmarkEnd.statusCode).toBe(200)

    expectNoMarkersInLogs(testApp)
  })

  it('(c) benchmark finalize before the recall lock -> 422 recall_not_locked, no marker in body or logs', async () => {
    // recallScores supplied forces the gate regardless of completeInterval.
    const beforeLock = await postFinalize(testApp.app, benchmarkId, {
      expectedEventCount: 0,
      review: {
        materiallyDisrupted: false,
        disruptionNote: 'PRIVATE-DISRUPTION-2e4b',
        recallScores: [1, 1, 1, 1, 1],
      },
    })
    expect(beforeLock.statusCode).toBe(422)
    expect((beforeLock.body as unknown as ErrorBody).code).toBe('recall_not_locked')
    expectNoMarkersInErrorResponse(testApp, beforeLock)
  })

  it('(d) benchmark finalize after the recall lock without materiallyDisrupted -> 400 fieldErrors.materiallyDisrupted, no marker in body or logs', async () => {
    const recall = await postRecall(testApp.app, benchmarkId, {
      points: ['point one', 'point two', 'point three', 'point four', 'PRIVATE-RECALL-5a9c'],
      startedAt: demoNowIso(),
      durationSeconds: 60,
    })
    expect(recall.statusCode).toBe(200)
    expectNoMarkersInLogs(testApp)

    const afterLock = await postFinalize(testApp.app, benchmarkId, {
      expectedEventCount: 0,
      review: { disruptionNote: 'PRIVATE-DISRUPTION-2e4b' },
    })
    expect(afterLock.statusCode).toBe(400)
    expect((afterLock.body as unknown as ErrorBody).fieldErrors?.materiallyDisrupted).toBe('required')
    expectNoMarkersInErrorResponse(testApp, afterLock)

    // Whole-run assertion: no marker anywhere in the captured logs, across every case above.
    const fullLogText = testApp.logs.text()
    for (const marker of MARKERS) {
      expect(fullLogText).not.toContain(marker)
    }
  })
})
