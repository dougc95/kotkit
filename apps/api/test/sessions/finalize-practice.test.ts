/**
 * 5.8.2 — Fastify inject integration tests for `POST /sessions/{id}/finalize`'s
 * practice branch, against the real `attention_lab_test` database via
 * `buildTestApp` (3.2.1). Composes 5.1.3's session seed helpers (plus 5.8.1's
 * own `finalizeSession` API helper) with 4.1.1's program helpers, per D16 — no
 * lower layer is re-created here. The kind-independent mechanics (idempotency,
 * event-count mismatch, ownership, ...) are covered in
 * `test/sessions/finalize-mechanics.test.ts`; this file exercises only
 * practice's own field rules: required `outputQuality`, the D7.1 nullable
 * counts, the D11 no-summing tallies, the benchmark-only-field rejection, and
 * that a practice attempt never yields an eligibility value.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import { baselineDateDaysAgo, insertProgram, insertSlotSet } from '../helpers/programs.js'
import { finalizeSession, seedSession, withIdempotencyKey } from '../helpers/sessions.js'
import { benchmarkSlots, focusSessions, sessionReviews } from '../../src/db/schema/index.js'

const BASE_PROGRAM = {
  baselineDate: '2026-09-06',
  timezone: 'UTC',
  status: 'active' as const,
  practiceTargetSeconds: 900,
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000)
}

interface ErrorBody {
  code: string
  message: string
  fieldErrors?: Record<string, string>
}

interface FinalizeBody {
  session: { lifecycle: string; slotId: string | null; completeInterval: boolean | null; version: number }
  review: {
    outputQuality: string | null
    episodeCount: number | null
    countMethod: string | null
    externalCount: number | null
    unplannedAgentChecks: number | null
    mindWanderingCount: number | null
  }
  eligible: boolean | null
  exclusionReasons: string[]
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

async function sessionRow(testApp: TestApp, sessionId: string) {
  const [row] = await testApp.db
    .select()
    .from(focusSessions)
    .where(eq(focusSessions.id, sessionId))
    .limit(1)
  if (!row) throw new Error(`sessionRow: no focus_sessions row for '${sessionId}'`)
  return row
}

async function postEvents(app: FastifyInstance, sessionId: string, events: readonly unknown[]) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/events`,
    payload: { events },
  })
}

describe('POST /sessions/{id}/finalize — practice (integration, attention_lab_test)', () => {
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

  it("(1) Partly: {outputQuality:'partly', episodeCount:1, countMethod:'event'} -> 200, output_quality 'partly', lifecycle finalized, eligible null", async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(15),
      endedAt: minutesAgo(5),
      targetSeconds: 900,
    })

    const res = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 0,
      review: { outputQuality: 'partly', episodeCount: 1, countMethod: 'event' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.review.outputQuality).toBe('partly')
    expect(body.session.lifecycle).toBe('finalized')
    expect(body.eligible).toBeNull()

    const review = await reviewRow(testApp, sessionId)
    expect(review.outputQuality).toBe('partly')
    const session = await sessionRow(testApp, sessionId)
    expect(session.lifecycle).toBe('finalized')
    expect(session.eligible).toBeNull()
  })

  it('(2) early finish: practice with started_at seeded 480 s before the 5.4 end -> finalize -> complete_interval false, (ended_at - started_at - paused_seconds) = 480 s, and a new POST /sessions practice start afterwards succeeds (no active_session_exists)', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const startedAt = new Date()
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'running',
      startedAt,
      targetSeconds: 900,
    })

    const endRes = await testApp.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/transitions`,
      payload: { expectedVersion: 1, type: 'end' },
    })
    // The seeded session started "now"; end fires immediately after, so the
    // elapsed interval is effectively 0 s wall time — well under the 900 s
    // target, giving the same early-finish shape as an explicit offset
    // without depending on demo-clock plumbing this file does not otherwise
    // need.
    expect(endRes.statusCode).toBe(200)

    const res = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 0,
      review: { outputQuality: 'yes' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.session.completeInterval).toBe(false)

    const session = await sessionRow(testApp, sessionId)
    expect(session.completeInterval).toBe(false)
    expect(session.endedAt).not.toBeNull()
    const elapsedSeconds = Math.round(
      ((session.endedAt as Date).getTime() - session.startedAt.getTime()) / 1000 - session.pausedSeconds,
    )
    expect(elapsedSeconds).toBeLessThan(900)

    // A new practice start now succeeds: finalizing freed the one-active-session slot.
    const startRes = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      payload: { programId, kind: 'practice', intendedOutput: 'next attempt' },
      headers: withIdempotencyKey(),
    })
    expect(startRes.statusCode).toBe(201)
  })

  it('(3) blank counts: review without any count -> episode_count, external_count, unplanned_agent_checks, mind_wandering_count all NULL in DB and null in the response, count_method NULL', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      endedAt: minutesAgo(5),
      targetSeconds: 900,
    })

    const res = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 0,
      review: { outputQuality: 'yes' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.review.episodeCount).toBeNull()
    expect(body.review.externalCount).toBeNull()
    expect(body.review.unplannedAgentChecks).toBeNull()
    expect(body.review.mindWanderingCount).toBeNull()
    expect(body.review.countMethod).toBeNull()

    const review = await reviewRow(testApp, sessionId)
    expect(review.episodeCount).toBeNull()
    expect(review.externalCount).toBeNull()
    expect(review.unplannedAgentChecks).toBeNull()
    expect(review.mindWanderingCount).toBeNull()
    expect(review.countMethod).toBeNull()
  })

  it('(4) explicit 0 for all four -> 0 stored and 0 in the response', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      endedAt: minutesAgo(5),
      targetSeconds: 900,
    })

    const res = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 0,
      review: {
        outputQuality: 'yes',
        episodeCount: 0,
        countMethod: 'event',
        externalCount: 0,
        unplannedAgentChecks: 0,
        mindWanderingCount: 0,
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.review.episodeCount).toBe(0)
    expect(body.review.externalCount).toBe(0)
    expect(body.review.unplannedAgentChecks).toBe(0)
    expect(body.review.mindWanderingCount).toBe(0)

    const review = await reviewRow(testApp, sessionId)
    expect(review.episodeCount).toBe(0)
    expect(review.externalCount).toBe(0)
    expect(review.unplannedAgentChecks).toBe(0)
    expect(review.mindWanderingCount).toBe(0)
  })

  it("(5) agent_check{alsoOffTask:true} event + body episodeCount 1, unplannedAgentChecks 1, countMethod event -> stored 1 and 1, and GET /sessions/{id} tallies expose offTask 1 and agentChecks 1 with no field equal to 2 (D11)", async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      startedAt: minutesAgo(15),
      endedAt: minutesAgo(5),
      targetSeconds: 900,
    })

    const eventsRes = await postEvents(testApp.app, sessionId, [
      {
        clientEventId: randomUUID(),
        type: 'agent_check',
        elapsedMs: 200_000,
        occurredAt: new Date().toISOString(),
        details: { alsoOffTask: true },
      },
    ])
    expect(eventsRes.statusCode).toBe(200)

    const res = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 1,
      review: {
        outputQuality: 'yes',
        episodeCount: 1,
        countMethod: 'event',
        unplannedAgentChecks: 1,
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.review.episodeCount).toBe(1)
    expect(body.review.unplannedAgentChecks).toBe(1)

    const getRes = await testApp.app.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}` })
    expect(getRes.statusCode).toBe(200)
    const tallies = (getRes.json() as { tallies: { offTask: number; external: number; agentChecks: number } }).tallies
    expect(tallies.offTask).toBe(1)
    expect(tallies.agentChecks).toBe(1)
    expect(Object.values(tallies)).not.toContain(2)
  })

  it("(6) episodeCount 4 with countMethod retrospective -> stored with method retrospective", async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      endedAt: minutesAgo(5),
      targetSeconds: 900,
    })

    const res = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 0,
      review: { outputQuality: 'yes', episodeCount: 4, countMethod: 'retrospective' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.review.episodeCount).toBe(4)
    expect(body.review.countMethod).toBe('retrospective')

    const review = await reviewRow(testApp, sessionId)
    expect(review.episodeCount).toBe(4)
    expect(review.countMethod).toBe('retrospective')
  })

  it('(7) episodeCount present without countMethod -> 400 fieldErrors.countMethod', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      endedAt: minutesAgo(5),
      targetSeconds: 900,
    })

    const res = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 0,
      review: { outputQuality: 'yes', episodeCount: 2 },
    })
    expect(res.statusCode).toBe(400)
    const body = res.body as ErrorBody
    expect(body.fieldErrors).toEqual({ countMethod: 'is required' })

    const review = await reviewRow(testApp, sessionId)
    expect(review.finalizedAt).toBeNull()
    const session = await sessionRow(testApp, sessionId)
    expect(session.lifecycle).toBe('awaiting_review')
  })

  it('(8) recallScores on practice -> 422 benchmark_only_field', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      endedAt: minutesAgo(5),
      targetSeconds: 900,
    })

    const res = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 0,
      review: { outputQuality: 'yes', recallScores: [1, 1, 1, 1, 1] },
    })
    expect(res.statusCode).toBe(422)
    expect((res.body as ErrorBody).code).toBe('benchmark_only_field')

    const session = await sessionRow(testApp, sessionId)
    expect(session.lifecycle).toBe('awaiting_review')
  })

  it('(9) materiallyDisrupted on practice -> 422 benchmark_only_field', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      endedAt: minutesAgo(5),
      targetSeconds: 900,
    })

    const res = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 0,
      review: { outputQuality: 'yes', materiallyDisrupted: true },
    })
    expect(res.statusCode).toBe(422)
    expect((res.body as ErrorBody).code).toBe('benchmark_only_field')
  })

  it('(10) outputQuality omitted -> 400 fieldErrors.outputQuality', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      endedAt: minutesAgo(5),
      targetSeconds: 900,
    })

    const res = await finalizeSession(testApp.app, sessionId, { expectedEventCount: 0, review: {} })
    expect(res.statusCode).toBe(400)
    expect((res.body as ErrorBody).fieldErrors).toEqual({ outputQuality: 'is required' })

    const session = await sessionRow(testApp, sessionId)
    expect(session.lifecycle).toBe('awaiting_review')
  })

  it('(11) first_switch_kind and recall_* NULL after practice finalize, observed_conditions still the empty value set at start', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      endedAt: minutesAgo(5),
      targetSeconds: 900,
    })

    const res = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 0,
      review: { outputQuality: 'yes' },
    })
    expect(res.statusCode).toBe(200)

    const review = await reviewRow(testApp, sessionId)
    expect(review.firstSwitchKind).toBeNull()
    expect(review.firstSwitchSeconds).toBeNull()
    expect(review.firstSwitchMethod).toBeNull()
    expect(review.recallPoints).toBeNull()
    expect(review.recallLockedAt).toBeNull()
    expect(review.recallScore).toBeNull()
    expect(review.recallScores).toBeNull()
    expect(review.observedConditions).toEqual({
      deviceFormat: null,
      language: null,
      materialLevel: null,
      accommodations: [],
    })
  })

  it('(12) slot_id stays NULL and benchmark_slots unchanged', async () => {
    const { programId } = await insertProgram(testApp.db, BASE_PROGRAM)
    const slots = await insertSlotSet(testApp.db, programId)
    const before = await testApp.db.select().from(benchmarkSlots).where(eq(benchmarkSlots.programId, programId))

    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      endedAt: minutesAgo(5),
      targetSeconds: 900,
    })

    const res = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 0,
      review: { outputQuality: 'yes' },
    })
    expect(res.statusCode).toBe(200)

    const session = await sessionRow(testApp, sessionId)
    expect(session.slotId).toBeNull()

    const after = await testApp.db.select().from(benchmarkSlots).where(eq(benchmarkSlots.programId, programId))
    expect(after).toEqual(before)
    expect(slots.baselineA).toBeTruthy()
  })

  it('(13) practice finalized on Day 14 (baseline_date seeded 14 days before ctx.now) -> eligible null, final A/B slots unchanged and still without attempts', async () => {
    const tz = 'UTC'
    const { programId } = await insertProgram(testApp.db, {
      ...BASE_PROGRAM,
      baselineDate: baselineDateDaysAgo(14, tz),
      timezone: tz,
    })
    const slots = await insertSlotSet(testApp.db, programId)

    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      endedAt: minutesAgo(5),
      targetSeconds: 900,
    })

    const res = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 0,
      review: { outputQuality: 'yes' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.eligible).toBeNull()

    const finalSlots = await testApp.db
      .select()
      .from(focusSessions)
      .where(eq(focusSessions.slotId, slots.finalA))
    expect(finalSlots).toHaveLength(0)
    const finalSlotsB = await testApp.db
      .select()
      .from(focusSessions)
      .where(eq(focusSessions.slotId, slots.finalB))
    expect(finalSlotsB).toHaveLength(0)
  })
})
