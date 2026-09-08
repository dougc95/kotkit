/**
 * 5.8.3 — Fastify inject integration tests for `POST /sessions/{id}/finalize`'s
 * benchmark branch, against the real `attention_lab_test` database via
 * `buildTestApp` (3.2.1). Composes 5.1.3's session seed helpers (plus this
 * task's own `finalizableBenchmark`/`finalizableIncompleteBenchmark`
 * fixtures) with 4.1.1's program helpers, per D16 — no lower layer is
 * re-created here. The kind-independent mechanics (idempotency, event-count
 * mismatch, ownership, ...) are covered in
 * `test/sessions/finalize-mechanics.test.ts`; this file exercises only the
 * benchmark review's own field rules: the D25 recall gate, self-scoring
 * through the shared `scoreRecall`, the disruption attestation, conditions,
 * the practice-only-field rejection, and the D33
 * `baseline_ready -> active` auto-activation. Eligibility/first-switch
 * derivation (5.8.4) is a later task — this file asserts nothing about
 * `eligible`/`exclusionReasons`.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ObservedConditionsValue } from '@attention-lab/shared'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import { baselineDateDaysAgo, insertProgram, insertSlotSet } from '../helpers/programs.js'
import {
  finalizableBenchmark,
  finalizableIncompleteBenchmark,
  finalizeSession,
  lockRecall,
} from '../helpers/sessions.js'
import { focusSessions, programs, sessionEvents, sessionReviews } from '../../src/db/schema/index.js'

interface ErrorBody {
  code: string
  message: string
  fieldErrors?: Record<string, string>
}

interface FinalizeBody {
  session: { lifecycle: string; version: number }
  review: {
    recallLockedAt: string | null
    recallScore: number | null
    recallScores: (0 | 1)[] | null
    recallPoints: string[] | null
    materiallyDisrupted: boolean | null
    disruptionNote: string | null
    externalCount: number | null
    unplannedAgentChecks: number | null
    episodeCount: number | null
    countMethod: string | null
    conditions: ObservedConditionsValue
    reviewNote: string | null
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

async function eventCount(testApp: TestApp, sessionId: string): Promise<number> {
  const rows = await testApp.db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId))
  return rows.length
}

async function programRow(testApp: TestApp, programId: string) {
  const [row] = await testApp.db.select().from(programs).where(eq(programs.id, programId)).limit(1)
  if (!row) throw new Error(`programRow: no programs row for '${programId}'`)
  return row
}

describe('POST /sessions/{id}/finalize — benchmark (integration, attention_lab_test)', () => {
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

  it('(1) complete benchmark awaiting_review without recall → finalize with recallScores → 422 recall_not_locked; without recallScores → same 422; review row unchanged and session_events count unchanged (no lastBatch applied)', async () => {
    const fixture = await finalizableBenchmark(testApp.db, testApp.app, {
      completeInterval: true,
      lockRecall: false,
    })
    const before = await reviewRow(testApp, fixture.sessionId)

    const withScores = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false, recallScores: [1, 1, 1, 1, 1] },
      lastBatch: {
        events: [
          { clientEventId: randomUUID(), type: 'off_task', elapsedMs: 60_000, occurredAt: new Date().toISOString() },
        ],
      },
    })
    expect(withScores.statusCode).toBe(422)
    expect((withScores.body as ErrorBody).code).toBe('recall_not_locked')

    const withoutScores = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false },
    })
    expect(withoutScores.statusCode).toBe(422)
    expect((withoutScores.body as ErrorBody).code).toBe('recall_not_locked')

    const after = await reviewRow(testApp, fixture.sessionId)
    expect(after).toEqual(before)
    expect(await eventCount(testApp, fixture.sessionId)).toBe(0)
    const session = await sessionRow(testApp, fixture.sessionId)
    expect(session.lifecycle).toBe('awaiting_review')
  })

  it('(2) stopped-early benchmark (complete_interval false) finalized without any recall → 200, recall_locked_at null, recall_score null, recall_scores null, lifecycle finalized (D25)', async () => {
    const fixture = await finalizableIncompleteBenchmark(testApp.db)

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.review.recallLockedAt).toBeNull()
    expect(body.review.recallScore).toBeNull()
    expect(body.review.recallScores).toBeNull()
    expect(body.session.lifecycle).toBe('finalized')

    const session = await sessionRow(testApp, fixture.sessionId)
    expect(session.lifecycle).toBe('finalized')
    expect(session.completeInterval).toBe(false)
  })

  it('(3) stopped-early benchmark finalized with recallScores in the body but no recall lock → 422 recall_not_locked', async () => {
    const fixture = await finalizableIncompleteBenchmark(testApp.db)

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false, recallScores: [1, 1, 1, 1, 1] },
    })
    expect(res.statusCode).toBe(422)
    expect((res.body as ErrorBody).code).toBe('recall_not_locked')
  })

  it('(4) stopped-early benchmark that DID lock recall before stopping, then finalized with recallScores → 200, scored normally', async () => {
    const fixture = await finalizableIncompleteBenchmark(testApp.db)
    const recallRes = await lockRecall(testApp.app, fixture.sessionId, {
      startedAt: new Date(fixture.endedAt.getTime() + 5_000).toISOString(),
    })
    expect(recallRes.statusCode).toBe(200)

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false, recallScores: [1, 1, 1, 1, 1] },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.review.recallScore).toBe(5)
    expect(body.review.recallScores).toEqual([1, 1, 1, 1, 1])
  })

  it('(5) after 5.7.2 lock on a complete benchmark, body without materiallyDisrupted → 400 fieldErrors.materiallyDisrupted, not finalized', async () => {
    const fixture = await finalizableBenchmark(testApp.db, testApp.app)

    const res = await finalizeSession(testApp.app, fixture.sessionId, { expectedEventCount: 0, review: {} })
    expect(res.statusCode).toBe(400)
    expect((res.body as ErrorBody).fieldErrors).toEqual({ materiallyDisrupted: 'required' })

    const session = await sessionRow(testApp, fixture.sessionId)
    expect(session.lifecycle).toBe('awaiting_review')
  })

  it("(6) points [a,b,c,'',''] locked + recallScores [1,1,1,1,1] → recall_score 3, recall_scores [1,1,1,0,0]", async () => {
    const fixture = await finalizableBenchmark(testApp.db, testApp.app, { lockRecall: false })
    const recallRes = await lockRecall(testApp.app, fixture.sessionId, {
      points: ['a', 'b', 'c', '', ''],
      startedAt: new Date(fixture.endedAt.getTime() + 5_000).toISOString(),
    })
    expect(recallRes.statusCode).toBe(200)

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false, recallScores: [1, 1, 1, 1, 1] },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.review.recallScore).toBe(3)
    expect(body.review.recallScores).toEqual([1, 1, 1, 0, 0])
  })

  it('(7) recallScores omitted while locked → recall_score NULL and recall_scores NULL', async () => {
    const fixture = await finalizableBenchmark(testApp.db, testApp.app)

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.review.recallScore).toBeNull()
    expect(body.review.recallScores).toBeNull()

    const review = await reviewRow(testApp, fixture.sessionId)
    expect(review.recallScore).toBeNull()
    expect(review.recallScores).toBeNull()
  })

  it("(8) recallScores [1,1,null,0,0] with point 3 non-blank → recall_score NULL, recall_scores NULL", async () => {
    // Default recall points are all non-blank ('point one' .. 'point five'),
    // so index 2 ('point three') is left unscored (null) here.
    const fixture = await finalizableBenchmark(testApp.db, testApp.app)

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false, recallScores: [1, 1, null, 0, 0] },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.review.recallScore).toBeNull()
    expect(body.review.recallScores).toBeNull()
  })

  it('(9) materiallyDisrupted true + disruptionNote → both stored', async () => {
    const fixture = await finalizableBenchmark(testApp.db, testApp.app)

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: true, disruptionNote: 'construction noise outside' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.review.materiallyDisrupted).toBe(true)
    expect(body.review.disruptionNote).toBe('construction noise outside')

    const review = await reviewRow(testApp, fixture.sessionId)
    expect(review.materiallyDisrupted).toBe(true)
    expect(review.disruptionNote).toBe('construction noise outside')
  })

  it('(10) externalCount 2 + materiallyDisrupted false → stored, materially_disrupted false', async () => {
    const fixture = await finalizableBenchmark(testApp.db, testApp.app)

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false, externalCount: 2 },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.review.externalCount).toBe(2)
    expect(body.review.materiallyDisrupted).toBe(false)

    const review = await reviewRow(testApp, fixture.sessionId)
    expect(review.externalCount).toBe(2)
    expect(review.materiallyDisrupted).toBe(false)
  })

  it('(11) paper tally: no events, episodeCount 4, countMethod retrospective → episode_count 4, count_method retrospective', async () => {
    const fixture = await finalizableBenchmark(testApp.db, testApp.app)

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false, episodeCount: 4, countMethod: 'retrospective' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.review.episodeCount).toBe(4)
    expect(body.review.countMethod).toBe('retrospective')

    const review = await reviewRow(testApp, fixture.sessionId)
    expect(review.episodeCount).toBe(4)
    expect(review.countMethod).toBe('retrospective')
  })

  it('(12) unplannedAgentChecks 1 on a benchmark → stored 1, off-task columns untouched', async () => {
    const fixture = await finalizableBenchmark(testApp.db, testApp.app)

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false, unplannedAgentChecks: 1 },
    })
    expect(res.statusCode).toBe(200)
    const body = res.body as FinalizeBody
    expect(body.review.unplannedAgentChecks).toBe(1)
    expect(body.review.episodeCount).toBeNull()

    const review = await reviewRow(testApp, fixture.sessionId)
    expect(review.unplannedAgentChecks).toBe(1)
    expect(review.episodeCount).toBeNull()
  })

  it('(13) conditions with accommodations [increased_font_size] on a final slot (baseline_date seeded 14 days before ctx.now) → observed_conditions stores it; omitted → slot-defaulted conditions remain', async () => {
    const tz = 'UTC'
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: baselineDateDaysAgo(14, tz),
      timezone: tz,
      status: 'active',
      practiceTargetSeconds: 600,
    })
    const slots = await insertSlotSet(testApp.db, programId)

    const withReplacement = await finalizableBenchmark(testApp.db, testApp.app, {
      programId,
      slotId: slots.finalA,
    })
    const replaced: ObservedConditionsValue = {
      deviceFormat: null,
      language: null,
      materialLevel: null,
      accommodations: ['increased_font_size'],
    }
    const resReplaced = await finalizeSession(testApp.app, withReplacement.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false, conditions: replaced },
    })
    expect(resReplaced.statusCode).toBe(200)
    expect((await reviewRow(testApp, withReplacement.sessionId)).observedConditions).toEqual(replaced)

    const slotDefaulted: ObservedConditionsValue = {
      deviceFormat: 'desktop',
      language: 'en',
      materialLevel: 'B1',
      accommodations: [],
    }
    const kept = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.finalB })
    await testApp.db
      .update(sessionReviews)
      .set({ observedConditions: slotDefaulted })
      .where(eq(sessionReviews.sessionId, kept.sessionId))

    const resKept = await finalizeSession(testApp.app, kept.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false },
    })
    expect(resKept.statusCode).toBe(200)
    expect((await reviewRow(testApp, kept.sessionId)).observedConditions).toEqual(slotDefaulted)
  })

  it("(14) reviewNote 'felt distracted by noise' → session_reviews.review_note stores it verbatim; omitted → NULL", async () => {
    // Both attempts share one program (two labels, A and B) — a second
    // `insertProgram` call for the same `local-demo` principal would violate
    // `programs_one_open_per_user`.
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: '2026-09-06',
      timezone: 'UTC',
      status: 'active',
      practiceTargetSeconds: 600,
    })
    const slots = await insertSlotSet(testApp.db, programId)

    const withNote = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineA })
    const resWithNote = await finalizeSession(testApp.app, withNote.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false, reviewNote: 'felt distracted by noise' },
    })
    expect(resWithNote.statusCode).toBe(200)
    expect((await reviewRow(testApp, withNote.sessionId)).reviewNote).toBe('felt distracted by noise')

    const withoutNote = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineB })
    const resWithoutNote = await finalizeSession(testApp.app, withoutNote.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false },
    })
    expect(resWithoutNote.statusCode).toBe(200)
    expect((await reviewRow(testApp, withoutNote.sessionId)).reviewNote).toBeNull()
  })

  it('(15) outputQuality on benchmark → 422 practice_only_field', async () => {
    const fixture = await finalizableBenchmark(testApp.db, testApp.app)

    const res = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false, outputQuality: 'yes' },
    })
    expect(res.statusCode).toBe(422)
    expect((res.body as ErrorBody).code).toBe('practice_only_field')

    const session = await sessionRow(testApp, fixture.sessionId)
    expect(session.lifecycle).toBe('awaiting_review')
  })

  it('(16) body with points → 400 and stored recall_points unchanged', async () => {
    const fixture = await finalizableBenchmark(testApp.db, testApp.app)
    const before = await reviewRow(testApp, fixture.sessionId)

    const res = await testApp.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${fixture.sessionId}/finalize`,
      headers: { 'idempotency-key': randomUUID() },
      payload: {
        expectedEventCount: 0,
        review: { materiallyDisrupted: false, points: ['x', 'x', 'x', 'x', 'x'] },
      },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as ErrorBody).code).toBe('malformed_request')

    const after = await reviewRow(testApp, fixture.sessionId)
    expect(after.recallPoints).toEqual(before.recallPoints)
  })

  it('(17) replay same key → 200 same review, recall fields unchanged', async () => {
    const fixture = await finalizableBenchmark(testApp.db, testApp.app)
    const key = randomUUID()
    const overrides = { expectedEventCount: 0, review: { materiallyDisrupted: false } }

    const first = await finalizeSession(testApp.app, fixture.sessionId, overrides, key)
    expect(first.statusCode).toBe(200)
    const second = await finalizeSession(testApp.app, fixture.sessionId, overrides, key)
    expect(second.statusCode).toBe(200)

    const stripServerNow = (body: unknown) => {
      const clone = structuredClone(body) as { session: { serverNow?: unknown } }
      delete clone.session.serverNow
      return clone
    }
    expect(stripServerNow(second.body)).toEqual(stripServerNow(first.body))

    const firstBody = first.body as FinalizeBody
    const secondBody = second.body as FinalizeBody
    expect(secondBody.review.recallLockedAt).toBe(firstBody.review.recallLockedAt)
    expect(secondBody.review.recallScore).toBe(firstBody.review.recallScore)
    expect(secondBody.review.recallScores).toEqual(firstBody.review.recallScores)
  })

  it('(18) unknown key on finalized → 409 already_finalized', async () => {
    const fixture = await finalizableBenchmark(testApp.db, testApp.app)
    const first = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false },
    })
    expect(first.statusCode).toBe(200)

    const second = await finalizeSession(testApp.app, fixture.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false },
    })
    expect(second.statusCode).toBe(409)
    expect((second.body as ErrorBody).code).toBe('already_finalized')
  })

  it('(19) finalizing baseline B when baseline A is already finalized → programs.status becomes active and programs.version increments (D33)', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: '2026-09-06',
      timezone: 'UTC',
      status: 'baseline_ready',
      practiceTargetSeconds: 600,
    })
    const slots = await insertSlotSet(testApp.db, programId)

    const a = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineA })
    const resA = await finalizeSession(testApp.app, a.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false },
    })
    expect(resA.statusCode).toBe(200)
    expect((await programRow(testApp, programId)).status).toBe('baseline_ready')

    const b = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineB })
    const resB = await finalizeSession(testApp.app, b.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false },
    })
    expect(resB.statusCode).toBe(200)

    const after = await programRow(testApp, programId)
    expect(after.status).toBe('active')
    expect(after.version).toBe(2)
  })

  it('(20) finalizing baseline A first (B not yet attempted) → programs.status stays baseline_ready', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: '2026-09-06',
      timezone: 'UTC',
      status: 'baseline_ready',
      practiceTargetSeconds: 600,
    })
    const slots = await insertSlotSet(testApp.db, programId)

    const a = await finalizableBenchmark(testApp.db, testApp.app, { programId, slotId: slots.baselineA })
    const res = await finalizeSession(testApp.app, a.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false },
    })
    expect(res.statusCode).toBe(200)

    const after = await programRow(testApp, programId)
    expect(after.status).toBe('baseline_ready')
    expect(after.version).toBe(1)
  })

  it('(21) finalizing a final-phase benchmark never touches programs.status', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: '2026-09-06',
      timezone: 'UTC',
      status: 'active',
      practiceTargetSeconds: 600,
    })
    const slots = await insertSlotSet(testApp.db, programId)

    const finalA = await finalizableBenchmark(testApp.db, testApp.app, {
      programId,
      slotId: slots.finalA,
      phase: 'final',
      label: 'A',
    })
    const res = await finalizeSession(testApp.app, finalA.sessionId, {
      expectedEventCount: 0,
      review: { materiallyDisrupted: false },
    })
    expect(res.statusCode).toBe(200)

    const after = await programRow(testApp, programId)
    expect(after.status).toBe('active')
    expect(after.version).toBe(1)
  })
})
