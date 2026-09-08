/**
 * 5.1.2 — Fastify inject integration tests for `POST /sessions`' benchmark
 * path, against the real `attention_lab_test` database via `buildTestApp`
 * (3.2.1). Composes 5.1.3's session seed helpers with 4.1.1's program
 * helpers, per D16 — no lower layer is re-created here.
 */
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { addDays } from '@attention-lab/shared'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import {
  baselineDateDaysAgo,
  insertOtherPrincipalProgram,
  insertProgram,
  insertSlotSet,
  type InsertProgramInput,
} from '../helpers/programs.js'
import { seedAmendment, seedSession, withIdempotencyKey } from '../helpers/sessions.js'
import { benchmarkSlots, focusSessions, sessionReviews } from '../../src/db/schema/index.js'

/** An `active` program whose baseline slots are assigned `baselineDate` (Day 0). */
function programInput(baselineDate: string, practiceTargetSeconds = 600): InsertProgramInput {
  return { baselineDate, timezone: 'UTC', status: 'active', practiceTargetSeconds }
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
  localDate: string
  eligible: boolean | null
  replacementReason: string | null
  version: number
  realm: string
  timeSource: string
  review: {
    conditions: {
      deviceFormat: string | null
      language: string | null
      materialLevel: string | null
      accommodations: readonly string[]
    }
  }
}

describe('POST /sessions — benchmark start (integration, attention_lab_test)', () => {
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

  it('(1) slot A on its assigned date -> 201, kind benchmark, target_seconds 1200, slot_id set, benchmark_slots.frozen_at now set', async () => {
    const baselineDate = baselineDateDaysAgo(0, 'UTC')
    const { programId } = await insertProgram(testApp.db, programInput(baselineDate))
    const slots = await insertSlotSet(testApp.db, programId)

    const before = new Date()
    const res = await postSession(testApp.app, { programId, kind: 'benchmark', slotId: slots.baselineA })
    const after = new Date()

    expect(res.statusCode).toBe(201)
    const body = res.json() as SessionBody
    expect(body.kind).toBe('benchmark')
    expect(body.targetSeconds).toBe(1200)
    expect(body.slotId).toBe(slots.baselineA)

    const [slot] = await testApp.db.select().from(benchmarkSlots).where(eq(benchmarkSlots.id, slots.baselineA))
    expect(slot?.frozenAt).not.toBeNull()
    const frozenAtMs = slot!.frozenAt!.getTime()
    expect(frozenAtMs).toBeGreaterThanOrEqual(before.getTime() - 2000)
    expect(frozenAtMs).toBeLessThanOrEqual(after.getTime() + 2000)
  })

  it('(2) observed_conditions defaulted from the slot with accommodations []', async () => {
    const baselineDate = baselineDateDaysAgo(0, 'UTC')
    const { programId } = await insertProgram(testApp.db, programInput(baselineDate))
    const slots = await insertSlotSet(testApp.db, programId)
    await testApp.db
      .update(benchmarkSlots)
      .set({ deviceFormat: 'laptop', language: 'en', materialLevel: 'intermediate' })
      .where(eq(benchmarkSlots.id, slots.baselineA))

    const res = await postSession(testApp.app, { programId, kind: 'benchmark', slotId: slots.baselineA })
    expect(res.statusCode).toBe(201)
    const body = res.json() as SessionBody
    expect(body.review.conditions).toEqual({
      deviceFormat: 'laptop',
      language: 'en',
      materialLevel: 'intermediate',
      accommodations: [],
    })
  })

  it('(3) body conditions with accommodations [increased_font_size] stored on the review', async () => {
    const baselineDate = baselineDateDaysAgo(0, 'UTC')
    const { programId } = await insertProgram(testApp.db, programInput(baselineDate))
    const slots = await insertSlotSet(testApp.db, programId)
    await testApp.db
      .update(benchmarkSlots)
      .set({ deviceFormat: 'laptop', language: 'en', materialLevel: 'intermediate' })
      .where(eq(benchmarkSlots.id, slots.baselineA))

    const conditions = {
      deviceFormat: 'tablet',
      language: null,
      materialLevel: null,
      accommodations: ['increased_font_size'],
    }
    const res = await postSession(testApp.app, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      conditions,
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as SessionBody
    expect(body.review.conditions).toEqual(conditions)
  })

  it('(4) slot assigned tomorrow -> 422 before_slot_date, no row, frozen_at still null', async () => {
    const tomorrow = addDays(baselineDateDaysAgo(0, 'UTC'), 1)
    const { programId } = await insertProgram(testApp.db, programInput(tomorrow))
    const slots = await insertSlotSet(testApp.db, programId)

    const res = await postSession(testApp.app, { programId, kind: 'benchmark', slotId: slots.baselineA })
    expect(res.statusCode).toBe(422)
    expect((res.json() as ErrorBody).code).toBe('before_slot_date')

    expect(await testApp.db.select().from(focusSessions)).toHaveLength(0)
    const [slot] = await testApp.db.select().from(benchmarkSlots).where(eq(benchmarkSlots.id, slots.baselineA))
    expect(slot?.frozenAt).toBeNull()
  })

  it('(5) baseline B started on Day 1 with no attempts -> 201 without a reason, local_date = the Day 1 date, eligible null (D23: late start recorded, timing_deviation is 5.8s job)', async () => {
    const baselineDate = baselineDateDaysAgo(1, 'UTC')
    const { programId } = await insertProgram(testApp.db, programInput(baselineDate))
    const slots = await insertSlotSet(testApp.db, programId)

    const res = await postSession(testApp.app, { programId, kind: 'benchmark', slotId: slots.baselineB })
    expect(res.statusCode).toBe(201)
    const body = res.json() as SessionBody
    expect(body.replacementReason).toBeNull()
    expect(body.localDate).toBe(baselineDateDaysAgo(0, 'UTC'))
    expect(body.eligible).toBeNull()
  })

  it('(6) final A started the day after Day 14 -> 201 with local_date = the Day 15 date; seeded earlier sessions and reviews unchanged', async () => {
    const baselineDate = baselineDateDaysAgo(15, 'UTC')
    const { programId } = await insertProgram(testApp.db, programInput(baselineDate))
    const slots = await insertSlotSet(testApp.db, programId)

    const { sessionId: baselineASessionId } = await seedSession(testApp.db, {
      programId,
      slotId: slots.baselineA,
      kind: 'benchmark',
      lifecycle: 'finalized',
      eligible: true,
    })
    const { sessionId: baselineBSessionId } = await seedSession(testApp.db, {
      programId,
      slotId: slots.baselineB,
      kind: 'benchmark',
      lifecycle: 'finalized',
      eligible: true,
    })
    const seededIds = [baselineASessionId, baselineBSessionId]

    const beforeSessions = await testApp.db.select().from(focusSessions).where(inArray(focusSessions.id, seededIds))
    const beforeReviews = await testApp.db
      .select()
      .from(sessionReviews)
      .where(inArray(sessionReviews.sessionId, seededIds))

    const res = await postSession(testApp.app, { programId, kind: 'benchmark', slotId: slots.finalA })
    expect(res.statusCode).toBe(201)
    const body = res.json() as SessionBody
    expect(body.localDate).toBe(baselineDateDaysAgo(0, 'UTC'))

    const afterSessions = await testApp.db.select().from(focusSessions).where(inArray(focusSessions.id, seededIds))
    const afterReviews = await testApp.db
      .select()
      .from(sessionReviews)
      .where(inArray(sessionReviews.sessionId, seededIds))
    expect(afterSessions).toEqual(beforeSessions)
    expect(afterReviews).toEqual(beforeReviews)
  })

  it('(7) slotId missing on a benchmark body -> 422 benchmark_only_field', async () => {
    const baselineDate = baselineDateDaysAgo(0, 'UTC')
    const { programId } = await insertProgram(testApp.db, programInput(baselineDate))
    await insertSlotSet(testApp.db, programId)

    const res = await postSession(testApp.app, { programId, kind: 'benchmark' })
    expect(res.statusCode).toBe(422)
    expect((res.json() as ErrorBody).code).toBe('benchmark_only_field')
    expect(await testApp.db.select().from(focusSessions)).toHaveLength(0)
  })

  it('(8) intendedOutput on a benchmark body -> 422 practice_only_field', async () => {
    const baselineDate = baselineDateDaysAgo(0, 'UTC')
    const { programId } = await insertProgram(testApp.db, programInput(baselineDate))
    const slots = await insertSlotSet(testApp.db, programId)

    const res = await postSession(testApp.app, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      intendedOutput: 'x',
    })
    expect(res.statusCode).toBe(422)
    expect((res.json() as ErrorBody).code).toBe('practice_only_field')
    expect(await testApp.db.select().from(focusSessions)).toHaveLength(0)
  })

  it('(9) targetSeconds 1500 -> 422 benchmark_only_field; omitted -> 1200; a governing revision with practiceTargetSeconds 900 still yields 1200', async () => {
    const baselineDate = baselineDateDaysAgo(0, 'UTC')
    const { programId } = await insertProgram(testApp.db, programInput(baselineDate, 900))
    const slots = await insertSlotSet(testApp.db, programId)

    const tooHigh = await postSession(testApp.app, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1500,
    })
    expect(tooHigh.statusCode).toBe(422)
    expect((tooHigh.json() as ErrorBody).code).toBe('benchmark_only_field')
    expect(await testApp.db.select().from(focusSessions)).toHaveLength(0)

    const omitted = await postSession(testApp.app, { programId, kind: 'benchmark', slotId: slots.baselineA })
    expect(omitted.statusCode).toBe(201)
    expect((omitted.json() as SessionBody).targetSeconds).toBe(1200)
  })

  it('(10) second attempt without replacementReason -> 422 replacement_reason_required', async () => {
    const baselineDate = baselineDateDaysAgo(0, 'UTC')
    const { programId } = await insertProgram(testApp.db, programInput(baselineDate))
    const slots = await insertSlotSet(testApp.db, programId)
    await seedSession(testApp.db, {
      programId,
      slotId: slots.baselineA,
      kind: 'benchmark',
      lifecycle: 'finalized',
      eligible: false,
    })

    const res = await postSession(testApp.app, { programId, kind: 'benchmark', slotId: slots.baselineA })
    expect(res.statusCode).toBe(422)
    expect((res.json() as ErrorBody).code).toBe('replacement_reason_required')
  })

  it('(11) second attempt after a seeded finalized attempt with eligible false and exclusion_reasons [materially_disrupted] + reason -> 201, both rows present, replacement_reason stored on the second only', async () => {
    const baselineDate = baselineDateDaysAgo(0, 'UTC')
    const { programId } = await insertProgram(testApp.db, programInput(baselineDate))
    const slots = await insertSlotSet(testApp.db, programId)
    const { sessionId: firstId } = await seedSession(testApp.db, {
      programId,
      slotId: slots.baselineA,
      kind: 'benchmark',
      lifecycle: 'finalized',
      eligible: false,
      exclusionReasons: ['materially_disrupted'],
    })

    const res = await postSession(testApp.app, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      replacementReason: 'Was materially disrupted, retaking',
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as SessionBody
    expect(body.replacementReason).toBe('Was materially disrupted, retaking')

    const rows = await testApp.db.select().from(focusSessions).where(eq(focusSessions.slotId, slots.baselineA))
    expect(rows).toHaveLength(2)
    const first = rows.find((r) => r.id === firstId)
    const second = rows.find((r) => r.id === body.id)
    expect(first?.replacementReason).toBeNull()
    expect(second?.replacementReason).toBe('Was materially disrupted, retaking')
  })

  it('(12) second attempt after a seeded abandoned first attempt + reason -> 201', async () => {
    const baselineDate = baselineDateDaysAgo(0, 'UTC')
    const { programId } = await insertProgram(testApp.db, programInput(baselineDate))
    const slots = await insertSlotSet(testApp.db, programId)
    await seedSession(testApp.db, {
      programId,
      slotId: slots.baselineA,
      kind: 'benchmark',
      lifecycle: 'abandoned',
    })

    const res = await postSession(testApp.app, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      replacementReason: 'Abandoned last time, retaking',
    })
    expect(res.statusCode).toBe(201)
  })

  it('(13) second attempt when the first is eligible true -> 422 eligible_attempt_not_retaken, still one row', async () => {
    const baselineDate = baselineDateDaysAgo(0, 'UTC')
    const { programId } = await insertProgram(testApp.db, programInput(baselineDate))
    const slots = await insertSlotSet(testApp.db, programId)
    await seedSession(testApp.db, {
      programId,
      slotId: slots.baselineA,
      kind: 'benchmark',
      lifecycle: 'finalized',
      eligible: true,
    })

    const res = await postSession(testApp.app, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      replacementReason: 'Trying again',
    })
    expect(res.statusCode).toBe(422)
    expect((res.json() as ErrorBody).code).toBe('eligible_attempt_not_retaken')

    const rows = await testApp.db.select().from(focusSessions).where(eq(focusSessions.slotId, slots.baselineA))
    expect(rows).toHaveLength(1)
  })

  it('(14) second attempt when the first is eligible true but has an excluding amendment -> 201', async () => {
    const baselineDate = baselineDateDaysAgo(0, 'UTC')
    const { programId } = await insertProgram(testApp.db, programInput(baselineDate))
    const slots = await insertSlotSet(testApp.db, programId)
    const { sessionId: firstId } = await seedSession(testApp.db, {
      programId,
      slotId: slots.baselineA,
      kind: 'benchmark',
      lifecycle: 'finalized',
      eligible: true,
    })
    await seedAmendment(testApp.db, firstId, { reason: 'Excluding this attempt', excludeFromReport: true })

    const res = await postSession(testApp.app, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      replacementReason: 'Retaking after exclusion',
    })
    expect(res.statusCode).toBe(201)
  })

  it('(15) third attempt -> 422 slot_full, count stays 2', async () => {
    const baselineDate = baselineDateDaysAgo(0, 'UTC')
    const { programId } = await insertProgram(testApp.db, programInput(baselineDate))
    const slots = await insertSlotSet(testApp.db, programId)
    await seedSession(testApp.db, {
      programId,
      slotId: slots.baselineA,
      kind: 'benchmark',
      lifecycle: 'finalized',
      eligible: false,
    })
    await seedSession(testApp.db, {
      programId,
      slotId: slots.baselineA,
      kind: 'benchmark',
      lifecycle: 'abandoned',
    })

    const res = await postSession(testApp.app, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      replacementReason: 'One more try please',
    })
    expect(res.statusCode).toBe(422)
    expect((res.json() as ErrorBody).code).toBe('slot_full')

    const rows = await testApp.db.select().from(focusSessions).where(eq(focusSessions.slotId, slots.baselineA))
    expect(rows).toHaveLength(2)
  })

  it("(16) slot in another principal's program -> 404, no row", async () => {
    const other = await insertOtherPrincipalProgram(testApp.db)
    const otherSlots = await insertSlotSet(testApp.db, other.programId)

    const res = await postSession(testApp.app, {
      programId: other.programId,
      kind: 'benchmark',
      slotId: otherSlots.baselineA,
    })
    expect(res.statusCode).toBe(404)
    expect(await testApp.db.select().from(focusSessions)).toHaveLength(0)
  })

  it('(17) slotId from a different program of the same principal -> 404', async () => {
    const baselineDate = baselineDateDaysAgo(0, 'UTC')
    const { programId: otherOwnProgramId } = await insertProgram(
      testApp.db,
      { ...programInput(baselineDate), status: 'completed' },
    )
    const otherOwnSlots = await insertSlotSet(testApp.db, otherOwnProgramId)

    const { programId } = await insertProgram(testApp.db, programInput(baselineDate))
    await insertSlotSet(testApp.db, programId)

    const res = await postSession(testApp.app, {
      programId,
      kind: 'benchmark',
      slotId: otherOwnSlots.baselineA,
    })
    expect(res.statusCode).toBe(404)
    expect(await testApp.db.select().from(focusSessions)).toHaveLength(0)
  })

  it('(18) a seeded practice session on the slot date does not count as a slot attempt', async () => {
    const baselineDate = baselineDateDaysAgo(0, 'UTC')
    const { programId } = await insertProgram(testApp.db, programInput(baselineDate))
    const slots = await insertSlotSet(testApp.db, programId)
    await seedSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'finalized',
      localDate: baselineDate,
    })

    const res = await postSession(testApp.app, { programId, kind: 'benchmark', slotId: slots.baselineA })
    expect(res.statusCode).toBe(201)
    const body = res.json() as SessionBody
    expect(body.replacementReason).toBeNull()
  })

  it('(19) benchmark start while a practice session is running -> 409 active_session_exists before any slot rule', async () => {
    const baselineDate = baselineDateDaysAgo(0, 'UTC')
    const { programId } = await insertProgram(testApp.db, programInput(baselineDate))
    await insertSlotSet(testApp.db, programId)
    const { sessionId } = await seedSession(testApp.db, { programId, kind: 'practice', lifecycle: 'running' })

    // slotId omitted entirely — normally 422 benchmark_only_field — proving
    // the active-session check runs first, before any slot rule.
    const res = await postSession(testApp.app, { programId, kind: 'benchmark' })
    expect(res.statusCode).toBe(409)
    const body = res.json() as ErrorBody
    expect(body.code).toBe('active_session_exists')
    expect(body.details?.activeSessionId).toBe(sessionId)
  })

  it('(20) idempotent replay -> 200, returns the same benchmark session id and adds no second attempt', async () => {
    const baselineDate = baselineDateDaysAgo(0, 'UTC')
    const { programId } = await insertProgram(testApp.db, programInput(baselineDate))
    const slots = await insertSlotSet(testApp.db, programId)
    const key = randomUUID()
    const payload = { programId, kind: 'benchmark', slotId: slots.baselineA }

    const res1 = await postSession(testApp.app, payload, { 'idempotency-key': key })
    expect(res1.statusCode).toBe(201)
    const body1 = res1.json() as SessionBody

    const res2 = await postSession(testApp.app, payload, { 'idempotency-key': key })
    expect(res2.statusCode).toBe(200)
    const body2 = res2.json() as SessionBody
    expect(body2.id).toBe(body1.id)

    const rows = await testApp.db.select().from(focusSessions).where(eq(focusSessions.slotId, slots.baselineA))
    expect(rows).toHaveLength(1)
  })

  it('(21) replacementReason supplied on a first attempt -> 201, replacement_reason column stays null (accepted but not stored)', async () => {
    const baselineDate = baselineDateDaysAgo(0, 'UTC')
    const { programId } = await insertProgram(testApp.db, programInput(baselineDate))
    const slots = await insertSlotSet(testApp.db, programId)

    const res = await postSession(testApp.app, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      replacementReason: 'Not needed yet',
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as SessionBody
    expect(body.replacementReason).toBeNull()

    const [row] = await testApp.db.select().from(focusSessions).where(eq(focusSessions.id, body.id))
    expect(row?.replacementReason).toBeNull()
  })
})
