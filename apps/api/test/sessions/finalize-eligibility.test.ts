/**
 * 5.8.4 — Fastify inject integration tests for `POST /sessions/{id}/finalize`'s
 * benchmark eligibility/first-switch derivation, against the real
 * `attention_lab_test` database via `buildTestApp` (3.2.1). Composes 5.1.3's
 * session seed helpers (plus 5.8.3's `finalizableBenchmark`/
 * `finalizableIncompleteBenchmark` fixtures) with 4.1.1's program helpers,
 * per D16 — no lower layer is re-created here. `finalize-benchmark.test.ts`
 * (5.8.3) and `finalize-mechanics.test.ts` (5.8.1) already cover the
 * kind-independent mechanics and the benchmark review's own field rules; this
 * file asserts only `eligible`/`exclusionReasons`/`first_switch_*`/
 * `timer_quality`.
 *
 * Every fixture uses `baselineDateDaysAgo(day, tz)` (never a hardcoded
 * calendar date) so a session's own default `local_date` (derived from the
 * real "now" the test runs at) lands exactly on the slot's
 * `assignedLocalDate` unless a case deliberately wants D23's
 * `timing_deviation`.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FirstSwitchValue } from '@attention-lab/shared'
import { addDays } from '@attention-lab/shared'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import { baselineDateDaysAgo, insertProgram, insertSlotSet, type SlotSetIds } from '../helpers/programs.js'
import {
  finalizableBenchmark,
  finalizableIncompleteBenchmark,
  finalizeSession,
  lockRecall,
  seedEvents,
  seedSession,
} from '../helpers/sessions.js'
import { focusSessions, sessionReviews } from '../../src/db/schema/index.js'

interface FinalizeBody {
  session: { lifecycle: string; timerQuality: string }
  review: {
    episodeCount: number | null
    countMethod: string | null
    firstSwitch: FirstSwitchValue | null
    firstSwitchMethod: string | null
    recallScore: number | null
    recallScores: (0 | 1)[] | null
  }
  eligible: boolean | null
  exclusionReasons: string[]
}

interface SessionBody {
  timerQuality: string
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

async function getSession(testApp: TestApp, sessionId: string): Promise<SessionBody> {
  const res = await testApp.app.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}` })
  expect(res.statusCode).toBe(200)
  return res.json() as SessionBody
}

/** A fresh program + its four slots, `baselineDate` anchored `day` calendar days before the real "now" the test runs at. */
async function freshProgramWithSlots(
  testApp: TestApp,
  day: number,
  tz = 'UTC',
): Promise<{ programId: string; slots: SlotSetIds }> {
  const { programId } = await insertProgram(testApp.db, {
    baselineDate: baselineDateDaysAgo(day, tz),
    timezone: tz,
    status: 'active',
    practiceTargetSeconds: 600,
  })
  const slots = await insertSlotSet(testApp.db, programId)
  return { programId, slots }
}

const DEFAULT_RECALL_SCORES: [0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1] = [1, 1, 1, 1, 1]

describe('POST /sessions/{id}/finalize — benchmark eligibility and first-switch (integration, attention_lab_test)', () => {
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

  it('(1) all met (complete_interval true, recall locked, recallScores given, episodeCount 0 countMethod event, materiallyDisrupted false, timer ok, local_date = assigned) → eligible true, exclusionReasons []', async () => {
    const { programId, slots } = await freshProgramWithSlots(testApp, 0)
    const fixture = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineA })

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: {
        materiallyDisrupted: false,
        episodeCount: 0,
        countMethod: 'event',
        recallScores: DEFAULT_RECALL_SCORES,
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.eligible).toBe(true)
    expect(body.exclusionReasons).toEqual([])

    const session = await sessionRow(testApp, fixture.sessionId)
    expect(session.eligible).toBe(true)
    expect(session.exclusionReasons).toEqual([])
  })

  it('(2) blank S → eligible false, [count_unknown], episode_count NULL, DB and response agree', async () => {
    const { programId, slots } = await freshProgramWithSlots(testApp, 0)
    const fixture = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineA })

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false, recallScores: DEFAULT_RECALL_SCORES },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.eligible).toBe(false)
    expect(body.exclusionReasons).toEqual(['count_unknown'])
    expect(body.review.episodeCount).toBeNull()

    const review = await reviewRow(testApp, fixture.sessionId)
    expect(review.episodeCount).toBeNull()
    const session = await sessionRow(testApp, fixture.sessionId)
    expect(session.eligible).toBe(false)
    expect(session.exclusionReasons).toEqual(['count_unknown'])
  })

  it('(3) explicit 0 → eligible true, first_switch_kind none_capped, first_switch_seconds NULL', async () => {
    const { programId, slots } = await freshProgramWithSlots(testApp, 0)
    const fixture = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineA })

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: {
        materiallyDisrupted: false,
        episodeCount: 0,
        countMethod: 'event',
        recallScores: DEFAULT_RECALL_SCORES,
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.eligible).toBe(true)
    expect(body.review.firstSwitch).toEqual({ kind: 'none_capped' })
    expect(body.review.firstSwitchMethod).toBeNull()

    const review = await reviewRow(testApp, fixture.sessionId)
    expect(review.firstSwitchKind).toBe('none_capped')
    expect(review.firstSwitchSeconds).toBeNull()
  })

  it('(4) retrospective S=3 without estimate → first_switch_kind unknown, first_switch_seconds NULL, eligible true', async () => {
    const { programId, slots } = await freshProgramWithSlots(testApp, 0)
    const fixture = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineA })

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: {
        materiallyDisrupted: false,
        episodeCount: 3,
        countMethod: 'retrospective',
        recallScores: DEFAULT_RECALL_SCORES,
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.eligible).toBe(true)
    expect(body.review.firstSwitch).toEqual({ kind: 'unknown' })

    const review = await reviewRow(testApp, fixture.sessionId)
    expect(review.firstSwitchKind).toBe('unknown')
    expect(review.firstSwitchSeconds).toBeNull()
  })

  it('(5) retrospective S=3 with firstSwitchEstimateSeconds 300 → known 300, method estimate', async () => {
    const { programId, slots } = await freshProgramWithSlots(testApp, 0)
    const fixture = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineA })

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: {
        materiallyDisrupted: false,
        episodeCount: 3,
        countMethod: 'retrospective',
        firstSwitchEstimateSeconds: 300,
        recallScores: DEFAULT_RECALL_SCORES,
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.review.firstSwitch).toEqual({ kind: 'known', seconds: 300 })
    expect(body.review.firstSwitchMethod).toBe('estimate')
  })

  it('(6) off_task event at elapsed_ms 370000 → known 370, method event', async () => {
    const { programId, slots } = await freshProgramWithSlots(testApp, 0)
    const fixture = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineA })
    await seedEvents(testApp.db, fixture.sessionId, [{ type: 'off_task', elapsedMs: 370_000 }])

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 1,
      review: {
        materiallyDisrupted: false,
        episodeCount: 1,
        countMethod: 'event',
        recallScores: DEFAULT_RECALL_SCORES,
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.review.firstSwitch).toEqual({ kind: 'known', seconds: 370 })
    expect(body.review.firstSwitchMethod).toBe('event')
  })

  it('(7) voided off_task at 100000 + live off_task at 370000 → known 370; visibility events only with S 0 → none_capped', async () => {
    const { programId, slots } = await freshProgramWithSlots(testApp, 0)

    const withVoided = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineA })
    await seedEvents(testApp.db, withVoided.sessionId, [
      { type: 'off_task', elapsedMs: 100_000, voidedAt: new Date() },
      { type: 'off_task', elapsedMs: 370_000 },
    ])
    const resVoided = await finalizeSession(testApp.app, withVoided.sessionId, {
      expectedEventCount: 2,
      review: {
        materiallyDisrupted: false,
        episodeCount: 1,
        countMethod: 'event',
        recallScores: DEFAULT_RECALL_SCORES,
      },
    })
    expect(resVoided.statusCode).toBe(200)
    expect((resVoided.body as FinalizeBody).review.firstSwitch).toEqual({ kind: 'known', seconds: 370 })

    const visibilityOnly = await finalizableBenchmark(testApp.db, testApp.app, {
      programId,
      slotId: slots.baselineB,
    })
    await seedEvents(testApp.db, visibilityOnly.sessionId, [{ type: 'visibility', elapsedMs: 5_000 }])
    const resVisibility = await finalizeSession(testApp.app, visibilityOnly.sessionId, {
      expectedEventCount: 1,
      review: {
        materiallyDisrupted: false,
        episodeCount: 0,
        countMethod: 'event',
        recallScores: DEFAULT_RECALL_SCORES,
      },
    })
    expect(resVisibility.statusCode).toBe(200)
    expect((resVisibility.body as FinalizeBody).review.firstSwitch).toEqual({ kind: 'none_capped' })
  })

  it('(8) agent_check alsoOffTask at 200000 before off_task at 370000 → known 200, method event (D11)', async () => {
    const { programId, slots } = await freshProgramWithSlots(testApp, 0)
    const fixture = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineA })
    await seedEvents(testApp.db, fixture.sessionId, [
      { type: 'agent_check', elapsedMs: 200_000, details: { alsoOffTask: true } },
      { type: 'off_task', elapsedMs: 370_000 },
    ])

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 2,
      review: {
        materiallyDisrupted: false,
        episodeCount: 2,
        countMethod: 'event',
        recallScores: DEFAULT_RECALL_SCORES,
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.review.firstSwitch).toEqual({ kind: 'known', seconds: 200 })
    expect(body.review.firstSwitchMethod).toBe('event')
  })

  it('(9) stopped early at 14 min + blank S → [interval_incomplete, count_unknown]', async () => {
    const { programId, slots } = await freshProgramWithSlots(testApp, 0)
    const fixture = await finalizableIncompleteBenchmark(testApp.db, { programId, slotId: slots.baselineA })
    const recallRes = await lockRecall(testApp.app, fixture.sessionId, {
      startedAt: new Date(fixture.endedAt.getTime() + 5_000).toISOString(),
    })
    expect(recallRes.statusCode).toBe(200)

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false, recallScores: DEFAULT_RECALL_SCORES },
    })
    expect(res.statusCode).toBe(200)
    expect((res.body as FinalizeBody).exclusionReasons).toEqual(['interval_incomplete', 'count_unknown'])
  })

  it('(10) materiallyDisrupted true → [materially_disrupted]', async () => {
    const { programId, slots } = await freshProgramWithSlots(testApp, 0)
    const fixture = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineA })

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: {
        materiallyDisrupted: true,
        episodeCount: 0,
        countMethod: 'event',
        recallScores: DEFAULT_RECALL_SCORES,
      },
    })
    expect(res.statusCode).toBe(200)
    expect((res.body as FinalizeBody).exclusionReasons).toEqual(['materially_disrupted'])
  })

  it('(11) externalCount 2 + materiallyDisrupted false → no materially_disrupted reason', async () => {
    const { programId, slots } = await freshProgramWithSlots(testApp, 0)
    const fixture = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineA })

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: {
        materiallyDisrupted: false,
        externalCount: 2,
        episodeCount: 0,
        countMethod: 'event',
        recallScores: DEFAULT_RECALL_SCORES,
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.exclusionReasons).not.toContain('materially_disrupted')
    expect(body.eligible).toBe(true)
  })

  it('(12) recall locked but recallScores omitted → [scoring_incomplete]', async () => {
    const { programId, slots } = await freshProgramWithSlots(testApp, 0)
    const fixture = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineA })

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false, episodeCount: 0, countMethod: 'event' },
    })
    expect(res.statusCode).toBe(200)
    expect((res.body as FinalizeBody).exclusionReasons).toEqual(['scoring_incomplete'])
  })

  it('(13) stopped-early benchmark finalized with no recall at all (D25) → [interval_incomplete, recall_missing, scoring_incomplete]', async () => {
    const { programId, slots } = await freshProgramWithSlots(testApp, 0)
    const fixture = await finalizableIncompleteBenchmark(testApp.db, { programId, slotId: slots.baselineA })

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false, episodeCount: 0, countMethod: 'event' },
    })
    expect(res.statusCode).toBe(200)
    expect((res.body as FinalizeBody).exclusionReasons).toEqual([
      'interval_incomplete',
      'recall_missing',
      'scoring_incomplete',
    ])
  })

  it('(14) clock-gap resolved uncertain via 5.5.1 → [timer_uncertain]', async () => {
    const { programId, slots } = await freshProgramWithSlots(testApp, 0)
    const fixture = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineA })

    const gapRes = await testApp.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${fixture.sessionId}/clock-gap`,
      payload: { gapSeconds: 90, resolution: 'uncertain' },
    })
    expect(gapRes.statusCode).toBe(200)

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: {
        materiallyDisrupted: false,
        episodeCount: 0,
        countMethod: 'event',
        recallScores: DEFAULT_RECALL_SCORES,
      },
    })
    expect(res.statusCode).toBe(200)
    expect((res.body as FinalizeBody).exclusionReasons).toEqual(['timer_uncertain'])
  })

  it('(15) save_incomplete (5.5.1) → [interval_incomplete, timer_uncertain]', async () => {
    const { programId, slots } = await freshProgramWithSlots(testApp, 0)
    const fixture = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineA })

    const gapRes = await testApp.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${fixture.sessionId}/clock-gap`,
      payload: { gapSeconds: 90, resolution: 'save_incomplete' },
    })
    expect(gapRes.statusCode).toBe(200)

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: {
        materiallyDisrupted: false,
        episodeCount: 0,
        countMethod: 'event',
        recallScores: DEFAULT_RECALL_SCORES,
      },
    })
    expect(res.statusCode).toBe(200)
    expect((res.body as FinalizeBody).exclusionReasons).toEqual(['interval_incomplete', 'timer_uncertain'])
  })

  it('(16) an unresolved clock_gap event (posted via 5.3, no details.resolution) present at finalize → timer_quality forced uncertain, exclusionReasons includes timer_uncertain, GET /sessions/{id} shows timer_quality uncertain (D26)', async () => {
    const { programId, slots } = await freshProgramWithSlots(testApp, 0)
    const fixture = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineA })

    const eventRes = await testApp.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${fixture.sessionId}/events`,
      payload: {
        events: [
          {
            clientEventId: randomUUID(),
            type: 'clock_gap',
            elapsedMs: 90_000,
            occurredAt: new Date().toISOString(),
            details: { gapSeconds: 90 },
          },
        ],
      },
    })
    expect(eventRes.statusCode).toBe(200)

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 1,
      review: {
        materiallyDisrupted: false,
        episodeCount: 0,
        countMethod: 'event',
        recallScores: DEFAULT_RECALL_SCORES,
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.exclusionReasons).toContain('timer_uncertain')
    expect(body.session.timerQuality).toBe('uncertain')

    const session = await sessionRow(testApp, fixture.sessionId)
    expect(session.timerQuality).toBe('uncertain')

    const getBody = await getSession(testApp, fixture.sessionId)
    expect(getBody.timerQuality).toBe('uncertain')
    expect(getBody.exclusionReasons).toContain('timer_uncertain')
  })

  it('(17) a clock_gap event with details.resolution set does not force timer_quality and contributes no reason by itself', async () => {
    const { programId, slots } = await freshProgramWithSlots(testApp, 0)
    const fixture = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineA })

    const eventRes = await testApp.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${fixture.sessionId}/events`,
      payload: {
        events: [
          {
            clientEventId: randomUUID(),
            type: 'clock_gap',
            elapsedMs: 90_000,
            occurredAt: new Date().toISOString(),
            details: { gapSeconds: 90, resolution: 'continued' },
          },
        ],
      },
    })
    expect(eventRes.statusCode).toBe(200)

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 1,
      review: {
        materiallyDisrupted: false,
        episodeCount: 0,
        countMethod: 'event',
        recallScores: DEFAULT_RECALL_SCORES,
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.exclusionReasons).not.toContain('timer_uncertain')
    expect(body.session.timerQuality).toBe('ok')
  })

  it('(18) baseline B started with the demo clock on Day 1 → [timing_deviation] and GET /sessions/{id} still returns it', async () => {
    const tz = 'UTC'
    const baselineDate = baselineDateDaysAgo(0, tz)
    const { programId, slots } = await freshProgramWithSlots(testApp, 0, tz)

    const startedAt = new Date(Date.now() - 21 * 60_000)
    const endedAt = new Date(startedAt.getTime() + 20 * 60_000)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineB,
      lifecycle: 'awaiting_review',
      startedAt,
      endedAt,
      targetSeconds: 1200,
      completeInterval: true,
      // D8/D35: recorded as if the demo clock had already advanced to Day 1,
      // one calendar day after the slot's own assigned Day 0.
      localDate: addDays(baselineDate, 1),
      timeSource: 'demo_clock',
    })
    const recallRes = await lockRecall(testApp.app, sessionId, {
      startedAt: new Date(endedAt.getTime() + 5_000).toISOString(),
    })
    expect(recallRes.statusCode).toBe(200)

    const res = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 0,
      review: {
        materiallyDisrupted: false,
        episodeCount: 0,
        countMethod: 'event',
        recallScores: DEFAULT_RECALL_SCORES,
      },
    })
    expect(res.statusCode).toBe(200)
    expect((res.body as FinalizeBody).exclusionReasons).toContain('timing_deviation')

    const getBody = await getSession(testApp, sessionId)
    expect(getBody.exclusionReasons).toContain('timing_deviation')
  })

  it('(19) final A finalized on Day 15 → [timing_deviation] and both baseline session_reviews rows are row-for-row identical before and after', async () => {
    const tz = 'UTC'
    // baselineDate = today − 15, so Day 14 (the final slots' assigned date)
    // is yesterday and "now" (real time) is Day 15.
    const { programId, slots } = await freshProgramWithSlots(testApp, 15, tz)

    const baselineA = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineA })
    const resA = await finalizeSession(testApp.app, baselineA.sessionId, {
      expectedEventCount: 0,
      review: {
        materiallyDisrupted: false,
        episodeCount: 1,
        countMethod: 'event',
        recallScores: DEFAULT_RECALL_SCORES,
      },
    })
    expect(resA.statusCode).toBe(200)

    const baselineB = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineB })
    const resB = await finalizeSession(testApp.app, baselineB.sessionId, {
      expectedEventCount: 0,
      review: {
        materiallyDisrupted: false,
        episodeCount: 1,
        countMethod: 'event',
        recallScores: DEFAULT_RECALL_SCORES,
      },
    })
    expect(resB.statusCode).toBe(200)

    const beforeA = await reviewRow(testApp, baselineA.sessionId)
    const beforeB = await reviewRow(testApp, baselineB.sessionId)

    const finalA = await finalizableBenchmark(testApp.db, testApp.app, {
      programId,
      slotId: slots.finalA,
      phase: 'final',
      label: 'A',
    })
    const resFinal = await finalizeSession(testApp.app, finalA.sessionId, {
      expectedEventCount: 0,
      review: {
        materiallyDisrupted: false,
        episodeCount: 0,
        countMethod: 'event',
        recallScores: DEFAULT_RECALL_SCORES,
      },
    })
    expect(resFinal.statusCode).toBe(200)
    expect((resFinal.body as FinalizeBody).exclusionReasons).toContain('timing_deviation')

    expect(await reviewRow(testApp, baselineA.sessionId)).toEqual(beforeA)
    expect(await reviewRow(testApp, baselineB.sessionId)).toEqual(beforeB)
  })

  it('(20) demo realm with demo clock offset (time_source demo_clock) → no simulated_time', async () => {
    const { programId, slots } = await freshProgramWithSlots(testApp, 0)
    const fixture = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineA })
    await testApp.db
      .update(focusSessions)
      .set({ timeSource: 'demo_clock' })
      .where(eq(focusSessions.id, fixture.sessionId))

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: {
        materiallyDisrupted: false,
        episodeCount: 0,
        countMethod: 'event',
        recallScores: DEFAULT_RECALL_SCORES,
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.exclusionReasons).not.toContain('simulated_time')
    expect(body.eligible).toBe(true)
  })

  it('(21) practice finalize (5.8.2) still leaves eligible NULL', async () => {
    const { programId } = await freshProgramWithSlots(testApp, 0)
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'awaiting_review',
      startedAt: new Date(Date.now() - 15 * 60_000),
      endedAt: new Date(Date.now() - 5 * 60_000),
      targetSeconds: 600,
    })

    const res = await finalizeSession(testApp.app, sessionId, {
      expectedEventCount: 0,
      review: { outputQuality: 'yes' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.eligible).toBeNull()
    expect(body.exclusionReasons).toEqual([])

    const session = await sessionRow(testApp, sessionId)
    expect(session.eligible).toBeNull()
    expect(session.exclusionReasons).toEqual([])
  })
})
