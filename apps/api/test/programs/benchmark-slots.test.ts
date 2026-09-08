/**
 * 4.3.2 — Fastify inject integration tests for `PUT
 * /programs/{id}/benchmark-slots` against the real `attention_lab_test`
 * database, via `buildTestApp` (3.2.1). Complements the pure-function unit
 * tests in `src/services/program/readiness.test.ts` (4.3.1, extended by
 * 4.3.2 with `isFrozen`/`frozenFieldsUnchanged`), which this file never
 * re-tests.
 */
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import {
  insertOtherPrincipalProgram,
  insertProgram,
  insertSession,
  insertSlotSet,
  seedActiveProgram,
} from '../helpers/programs.js'
import { benchmarkSlots, focusSessions, programs } from '../../src/db/schema/index.js'

interface ErrorBody {
  code: string
  message: string
  fieldErrors?: Record<string, string>
  details?: Record<string, unknown>
}

interface SlotDto {
  id: string
  phase: string
  label: string
  materialRef: string
  plannedLocalTime: string | null
  assignedLocalDate: string
  attempts: Array<{ sessionId: string; lifecycle: string; eligible: boolean | null; excludedByAmendment: boolean }>
}

interface PutSlotsResponseBody {
  program: { id: string; status: string; version: number }
  slots: SlotDto[]
  missing: Array<{ phase: string; label: string; fields: string[] }>
}

const BASELINE_DATE = '2026-09-06'

/** The four required slots, unmodified defaults matching `insertSlotSet`'s own naming. */
function fullBody(overrides: {
  expectedVersion?: number
  slots?: Array<Record<string, unknown>>
} = {}) {
  return {
    expectedVersion: overrides.expectedVersion ?? 1,
    slots:
      overrides.slots ?? [
        { phase: 'baseline', label: 'A', materialRef: 'baseline A material', plannedLocalTime: '09:00' },
        { phase: 'baseline', label: 'B', materialRef: 'baseline B material', plannedLocalTime: '10:00' },
        { phase: 'final', label: 'A', materialRef: 'final A material' },
        { phase: 'final', label: 'B', materialRef: 'final B material' },
      ],
  }
}

describe('PUT /programs/{id}/benchmark-slots (integration, attention_lab_test)', () => {
  let testApp: TestApp

  async function putSlots(
    app: FastifyInstance,
    programId: string,
    payload: Record<string, unknown>,
  ): Promise<{ statusCode: number; body: unknown }> {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/programs/${programId}/benchmark-slots`,
      payload,
    })
    return { statusCode: res.statusCode, body: res.json() }
  }

  beforeAll(async () => {
    testApp = await buildTestApp()
  })

  beforeEach(async () => {
    await testApp.truncateAll()
  })

  afterAll(async () => {
    await testApp.close()
  })

  it("(1) complete four-slot body on a draft -> 200, status 'baseline_ready', version 2, four rows, finals' planned_local_time equal the baselines', baseline assigned_local_date = Day 0 and finals = Day 14, every slot's attempts is []", async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })

    const res = await putSlots(testApp.app, programId, fullBody())
    expect(res.statusCode).toBe(200)

    const body = res.body as PutSlotsResponseBody
    expect(body.program.status).toBe('baseline_ready')
    expect(body.program.version).toBe(2)
    expect(body.slots).toHaveLength(4)

    const byKey = new Map(body.slots.map((s) => [`${s.phase}:${s.label}`, s]))
    const baselineA = byKey.get('baseline:A')!
    const baselineB = byKey.get('baseline:B')!
    const finalA = byKey.get('final:A')!
    const finalB = byKey.get('final:B')!

    expect(finalA.plannedLocalTime).toBe(baselineA.plannedLocalTime)
    expect(finalB.plannedLocalTime).toBe(baselineB.plannedLocalTime)
    expect(baselineA.assignedLocalDate).toBe('2026-09-06')
    expect(baselineB.assignedLocalDate).toBe('2026-09-06')
    expect(finalA.assignedLocalDate).toBe('2026-09-20')
    expect(finalB.assignedLocalDate).toBe('2026-09-20')

    for (const slot of body.slots) {
      expect(slot.attempts).toEqual([])
    }
  })

  it("(2) three references -> 200, status stays 'draft', missing = [{ phase: 'final', label: 'B', fields: ['materialRef'] }]", async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })

    const res = await putSlots(
      testApp.app,
      programId,
      fullBody({
        slots: [
          { phase: 'baseline', label: 'A', materialRef: 'baseline A material', plannedLocalTime: '09:00' },
          { phase: 'baseline', label: 'B', materialRef: 'baseline B material', plannedLocalTime: '10:00' },
          { phase: 'final', label: 'A', materialRef: 'final A material' },
        ],
      }),
    )

    expect(res.statusCode).toBe(200)
    const body = res.body as PutSlotsResponseBody
    expect(body.program.status).toBe('draft')
    expect(body.missing).toEqual([{ phase: 'final', label: 'B', fields: ['materialRef'] }])
  })

  it("(3) baseline 09:00/09:45 -> 422 baseline_times_too_close, message contains 'one hour', no rows written", async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })

    const res = await putSlots(
      testApp.app,
      programId,
      fullBody({
        slots: [
          { phase: 'baseline', label: 'A', materialRef: 'baseline A material', plannedLocalTime: '09:00' },
          { phase: 'baseline', label: 'B', materialRef: 'baseline B material', plannedLocalTime: '09:45' },
        ],
      }),
    )

    expect(res.statusCode).toBe(422)
    const body = res.body as ErrorBody
    expect(body.code).toBe('baseline_times_too_close')
    expect(body.message.toLowerCase()).toContain('one hour')

    const rows = await testApp.db.select().from(benchmarkSlots).where(eq(benchmarkSlots.programId, programId))
    expect(rows).toHaveLength(0)

    const [program] = await testApp.db.select().from(programs).where(eq(programs.id, programId))
    expect(program?.version).toBe(1)
  })

  it('(4) wrong expectedVersion -> 409 stale_version with details.current.version equal to the stored version', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })

    const res = await putSlots(testApp.app, programId, fullBody({ expectedVersion: 5 }))

    expect(res.statusCode).toBe(409)
    const body = res.body as ErrorBody
    expect(body.code).toBe('stale_version')
    expect((body.details?.current as { version: number } | undefined)?.version).toBe(1)
  })

  it("(5) insertSession finalized benchmark on baseline A + changed materialRef -> 409 slot_frozen with details { phase: 'baseline', label: 'A' } and rows unchanged", async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })
    const slots = await insertSlotSet(testApp.db, programId)
    await insertSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      lifecycle: 'finalized',
      localDate: BASELINE_DATE,
      startedAt: new Date(`${BASELINE_DATE}T09:00:00.000Z`),
      endedAt: new Date(`${BASELINE_DATE}T09:20:00.000Z`),
      targetSeconds: 1200,
      completeInterval: true,
    })

    const res = await putSlots(
      testApp.app,
      programId,
      fullBody({
        slots: [
          { phase: 'baseline', label: 'A', materialRef: 'changed material' },
          { phase: 'baseline', label: 'B', materialRef: 'baseline B material' },
          { phase: 'final', label: 'A', materialRef: 'final A material' },
          { phase: 'final', label: 'B', materialRef: 'final B material' },
        ],
      }),
    )

    expect(res.statusCode).toBe(409)
    const body = res.body as ErrorBody
    expect(body.code).toBe('slot_frozen')
    expect(body.details).toEqual({ phase: 'baseline', label: 'A' })

    const [row] = await testApp.db.select().from(benchmarkSlots).where(eq(benchmarkSlots.id, slots.baselineA))
    expect(row?.materialRef).toBe('baseline A material')
    const [program] = await testApp.db.select().from(programs).where(eq(programs.id, programId))
    expect(program?.version).toBe(1)
  })

  it('(6) frozen A unchanged + final B time changed before Day 14 -> 200 and final B updated (edit an unattempted final slot)', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })
    const slots = await insertSlotSet(testApp.db, programId)
    await insertSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      lifecycle: 'finalized',
      localDate: BASELINE_DATE,
      startedAt: new Date(`${BASELINE_DATE}T09:00:00.000Z`),
      endedAt: new Date(`${BASELINE_DATE}T09:20:00.000Z`),
      targetSeconds: 1200,
      completeInterval: true,
    })

    const res = await putSlots(
      testApp.app,
      programId,
      fullBody({
        slots: [
          { phase: 'baseline', label: 'A', materialRef: 'baseline A material' },
          { phase: 'baseline', label: 'B', materialRef: 'baseline B material' },
          { phase: 'final', label: 'A', materialRef: 'final A material' },
          { phase: 'final', label: 'B', materialRef: 'final B material', plannedLocalTime: '15:00' },
        ],
      }),
    )

    expect(res.statusCode).toBe(200)
    const body = res.body as PutSlotsResponseBody
    const finalB = body.slots.find((s) => s.phase === 'final' && s.label === 'B')!
    // `plannedLocalTime` round-trips a stored Postgres `time` column as
    // `HH:MM:SS` (toSlotDto, 4.1.1, keeps that raw string on purpose).
    expect(finalB.plannedLocalTime).toBe('15:00:00')
  })

  it('(7) frozen slot omitted from body -> 409 slot_frozen', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })
    const slots = await insertSlotSet(testApp.db, programId)
    await insertSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      lifecycle: 'finalized',
      localDate: BASELINE_DATE,
      startedAt: new Date(`${BASELINE_DATE}T09:00:00.000Z`),
      endedAt: new Date(`${BASELINE_DATE}T09:20:00.000Z`),
      targetSeconds: 1200,
      completeInterval: true,
    })

    const res = await putSlots(
      testApp.app,
      programId,
      fullBody({
        slots: [
          { phase: 'baseline', label: 'B', materialRef: 'baseline B material' },
          { phase: 'final', label: 'A', materialRef: 'final A material' },
          { phase: 'final', label: 'B', materialRef: 'final B material' },
        ],
      }),
    )

    expect(res.statusCode).toBe(409)
    const body = res.body as ErrorBody
    expect(body.code).toBe('slot_frozen')
    expect(body.details).toEqual({ phase: 'baseline', label: 'A' })
  })

  it('(8) frozen_at set with no session row -> also frozen', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })
    const slots = await insertSlotSet(testApp.db, programId)
    await testApp.db
      .update(benchmarkSlots)
      .set({ frozenAt: new Date() })
      .where(eq(benchmarkSlots.id, slots.finalA))

    const res = await putSlots(
      testApp.app,
      programId,
      fullBody({
        slots: [
          { phase: 'baseline', label: 'A', materialRef: 'baseline A material' },
          { phase: 'baseline', label: 'B', materialRef: 'baseline B material' },
          { phase: 'final', label: 'A', materialRef: 'changed final A material' },
          { phase: 'final', label: 'B', materialRef: 'final B material' },
        ],
      }),
    )

    expect(res.statusCode).toBe(409)
    const body = res.body as ErrorBody
    expect(body.code).toBe('slot_frozen')
    expect(body.details).toEqual({ phase: 'final', label: 'A' })
  })

  it('(9) a slot with a realm property -> 400, no rows changed', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })

    const res = await putSlots(
      testApp.app,
      programId,
      fullBody({
        slots: [
          { phase: 'baseline', label: 'A', materialRef: 'baseline A material', realm: 'pilot' },
          { phase: 'baseline', label: 'B', materialRef: 'baseline B material' },
          { phase: 'final', label: 'A', materialRef: 'final A material' },
          { phase: 'final', label: 'B', materialRef: 'final B material' },
        ],
      }),
    )

    expect(res.statusCode).toBe(400)

    const rows = await testApp.db.select().from(benchmarkSlots).where(eq(benchmarkSlots.programId, programId))
    expect(rows).toHaveLength(0)
    const [program] = await testApp.db.select().from(programs).where(eq(programs.id, programId))
    expect(program?.version).toBe(1)
  })

  it("(10) another principal's program -> 404", async () => {
    const other = await insertOtherPrincipalProgram(testApp.db)

    const res = await putSlots(testApp.app, other.programId, fullBody())

    expect(res.statusCode).toBe(404)
  })

  it('(11) after a successful save focus_sessions count is 0 (saving never starts a timer)', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })

    const res = await putSlots(testApp.app, programId, fullBody())
    expect(res.statusCode).toBe(200)

    const sessions = await testApp.db.select().from(focusSessions)
    expect(sessions).toHaveLength(0)
  })

  it("(12) duplicate (baseline, A) in body -> 400 malformed_request with fieldErrors 'slots[1]'", async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })

    const res = await putSlots(
      testApp.app,
      programId,
      fullBody({
        slots: [
          { phase: 'baseline', label: 'A', materialRef: 'x' },
          { phase: 'baseline', label: 'A', materialRef: 'y' },
        ],
      }),
    )

    expect(res.statusCode).toBe(400)
    const body = res.body as ErrorBody
    expect(body.code).toBe('malformed_request')
    expect(body.fieldErrors).toEqual({ 'slots[1]': 'duplicate slot' })
  })

  it("(13) seedActiveProgram then a body with three references -> 422 readiness_regression, rows unchanged, status still 'active'", async () => {
    const { programId, slots } = await seedActiveProgram(testApp.db, { day: 4 })

    const res = await putSlots(
      testApp.app,
      programId,
      fullBody({
        slots: [
          { phase: 'baseline', label: 'A', materialRef: 'baseline A material' },
          { phase: 'baseline', label: 'B', materialRef: 'baseline B material' },
          { phase: 'final', label: 'A', materialRef: 'final A material' },
        ],
      }),
    )

    expect(res.statusCode).toBe(422)
    const body = res.body as ErrorBody
    expect(body.code).toBe('readiness_regression')

    const [finalBRow] = await testApp.db.select().from(benchmarkSlots).where(eq(benchmarkSlots.id, slots.finalB))
    expect(finalBRow?.materialRef).toBe('final B material')
    const [program] = await testApp.db.select().from(programs).where(eq(programs.id, programId))
    expect(program?.status).toBe('active')
    expect(program?.version).toBe(1)
  })

  it("(14) after (5), the response of a valid save lists slot A's attempt as { lifecycle 'finalized', excludedByAmendment: false }", async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })
    const slots = await insertSlotSet(testApp.db, programId)
    const { sessionId } = await insertSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      lifecycle: 'finalized',
      localDate: BASELINE_DATE,
      startedAt: new Date(`${BASELINE_DATE}T09:00:00.000Z`),
      endedAt: new Date(`${BASELINE_DATE}T09:20:00.000Z`),
      targetSeconds: 1200,
      completeInterval: true,
    })

    const res = await putSlots(
      testApp.app,
      programId,
      fullBody({
        slots: [
          { phase: 'baseline', label: 'A', materialRef: 'baseline A material' },
          { phase: 'baseline', label: 'B', materialRef: 'baseline B material' },
          { phase: 'final', label: 'A', materialRef: 'final A material' },
          { phase: 'final', label: 'B', materialRef: 'final B material' },
        ],
      }),
    )

    expect(res.statusCode).toBe(200)
    const body = res.body as PutSlotsResponseBody
    const baselineA = body.slots.find((s) => s.phase === 'baseline' && s.label === 'A')!
    expect(baselineA.attempts).toEqual([
      { sessionId, lifecycle: 'finalized', eligible: null, excludedByAmendment: false },
    ])
  })
})
