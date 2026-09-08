/**
 * 4.2.3 — Fastify inject integration tests for `GET /programs/current`
 * against the real `attention_lab_test` database, via `buildTestApp`
 * (3.2.1). Complements the pure-function unit tests in
 * `src/services/program/programService.test.ts` (`slotAttemptStates`,
 * `guardRealm`, `NO_OPEN_PROGRAM_RESULT`), which this file never re-tests.
 */
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { localDateAt } from '@attention-lab/shared'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import {
  baselineDateDaysAgo,
  insertOtherPrincipalProgram,
  insertProgram,
  insertSession,
  insertSlotSet,
  seedActiveProgram,
  setDemoNow,
  setDemoOffsetSeconds,
} from '../helpers/programs.js'
import { focusSessions, programs, protocolRevisions, sessionAmendments, userProfiles } from '../../src/db/schema/index.js'
import { initialRevisionSettings } from '../../src/services/program/programService.js'

interface AttemptDto {
  sessionId: string
  lifecycle: string
  eligible: boolean | null
  excludedByAmendment: boolean
}

interface SlotDto {
  id: string
  phase: string
  label: string
  attempts: AttemptDto[]
}

interface CurrentProgramBody {
  program: { id: string; status: string; version: number } | null
  revision: { id: string; revision: number; effectiveDay: number } | null
  slots: SlotDto[]
  day: number | null
  nextAction: { kind: string; slotId?: string; block?: number }
}

interface ErrorBody {
  code: string
  message: string
}

const UTC = 'UTC'

describe('GET /programs/current (integration, attention_lab_test)', () => {
  let testApp: TestApp

  async function getCurrent(app: FastifyInstance): Promise<{ statusCode: number; body: CurrentProgramBody; headers: Record<string, string | string[] | number | undefined> }> {
    const res = await app.inject({ method: 'GET', url: '/api/v1/programs/current' })
    return { statusCode: res.statusCode, body: res.json(), headers: res.headers }
  }

  async function putSlots(app: FastifyInstance, programId: string, payload: Record<string, unknown>) {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/programs/${programId}/benchmark-slots`,
      payload,
    })
    return { statusCode: res.statusCode, body: res.json() as { slots: SlotDto[] } }
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

  it('(1) no program -> 200, program null, revision null, day null, slots [], nextAction setup', async () => {
    const { statusCode, body } = await getCurrent(testApp.app)
    expect(statusCode).toBe(200)
    expect(body).toEqual({
      program: null,
      revision: null,
      slots: [],
      day: null,
      nextAction: { kind: 'setup' },
    })
  })

  it('(2) draft program -> readiness, day computed', async () => {
    await insertProgram(testApp.db, {
      baselineDate: baselineDateDaysAgo(0, UTC),
      timezone: UTC,
      status: 'draft',
      practiceTargetSeconds: 600,
    })

    const { statusCode, body } = await getCurrent(testApp.app)
    expect(statusCode).toBe(200)
    expect(body.nextAction).toEqual({ kind: 'readiness' })
    expect(typeof body.day).toBe('number')
  })

  it("(3) complete four-slot PUT on a draft with baselineDate = today -> 200, then GET current -> status baseline_ready, day 0, nextAction benchmark with slot A's id, slots length 4 each with attempts: [], focus_sessions count 0", async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: baselineDateDaysAgo(0, UTC),
      timezone: UTC,
      status: 'draft',
      practiceTargetSeconds: 600,
    })

    const putRes = await putSlots(testApp.app, programId, {
      expectedVersion: 1,
      slots: [
        { phase: 'baseline', label: 'A', materialRef: 'baseline A material', plannedLocalTime: '09:00' },
        { phase: 'baseline', label: 'B', materialRef: 'baseline B material', plannedLocalTime: '10:00' },
        { phase: 'final', label: 'A', materialRef: 'final A material' },
        { phase: 'final', label: 'B', materialRef: 'final B material' },
      ],
    })
    expect(putRes.statusCode).toBe(200)
    const slotA = putRes.body.slots.find((s) => s.phase === 'baseline' && s.label === 'A')!

    const { statusCode, body } = await getCurrent(testApp.app)
    expect(statusCode).toBe(200)
    expect(body.program?.status).toBe('baseline_ready')
    expect(body.day).toBe(0)
    expect(body.nextAction).toEqual({ kind: 'benchmark', slotId: slotA.id })
    expect(body.slots).toHaveLength(4)
    for (const slot of body.slots) {
      expect(slot.attempts).toEqual([])
    }

    const sessions = await testApp.db.select().from(focusSessions).where(eq(focusSessions.programId, programId))
    expect(sessions).toHaveLength(0)
  })

  it("(4) plus insertSession finalized benchmark on slot A -> nextAction benchmark B and slot A attempts = [{ sessionId, lifecycle 'finalized', eligible equal to the stored value, excludedByAmendment false }]", async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: baselineDateDaysAgo(0, UTC),
      timezone: UTC,
      status: 'draft',
      practiceTargetSeconds: 600,
    })
    const putRes = await putSlots(testApp.app, programId, {
      expectedVersion: 1,
      slots: [
        { phase: 'baseline', label: 'A', materialRef: 'baseline A material', plannedLocalTime: '09:00' },
        { phase: 'baseline', label: 'B', materialRef: 'baseline B material', plannedLocalTime: '10:00' },
        { phase: 'final', label: 'A', materialRef: 'final A material' },
        { phase: 'final', label: 'B', materialRef: 'final B material' },
      ],
    })
    const slotA = putRes.body.slots.find((s) => s.phase === 'baseline' && s.label === 'A')!
    const slotB = putRes.body.slots.find((s) => s.phase === 'baseline' && s.label === 'B')!

    const today = baselineDateDaysAgo(0, UTC)
    const { sessionId } = await insertSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slotA.id,
      lifecycle: 'finalized',
      localDate: today,
      startedAt: new Date(`${today}T09:00:00.000Z`),
      endedAt: new Date(`${today}T09:20:00.000Z`),
      targetSeconds: 1200,
      completeInterval: true,
    })

    const { statusCode, body } = await getCurrent(testApp.app)
    expect(statusCode).toBe(200)
    expect(body.nextAction).toEqual({ kind: 'benchmark', slotId: slotB.id })
    const returnedSlotA = body.slots.find((s) => s.id === slotA.id)!
    expect(returnedSlotA.attempts).toEqual([
      { sessionId, lifecycle: 'finalized', eligible: null, excludedByAmendment: false },
    ])
  })

  it('(5) seedActiveProgram day 4 -> day 4, nextAction practice block 1', async () => {
    await seedActiveProgram(testApp.db, { day: 4 })

    const { statusCode, body } = await getCurrent(testApp.app)
    expect(statusCode).toBe(200)
    expect(body.day).toBe(4)
    expect(body.nextAction).toEqual({ kind: 'practice', block: 1 })
  })

  it('(6) plus a finalized complete practice session today -> practice block 2', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 4 })
    const today = localDateAt(new Date(), UTC)

    await insertSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'finalized',
      localDate: today,
      startedAt: new Date(),
      endedAt: new Date(),
      targetSeconds: 600,
      completeInterval: true,
    })

    const { body } = await getCurrent(testApp.app)
    expect(body.nextAction).toEqual({ kind: 'practice', block: 2 })
  })

  it("(7) seedActiveProgram day 14 -> nextAction final A with final A's slotId", async () => {
    const { slots } = await seedActiveProgram(testApp.db, { day: 14 })

    const { body } = await getCurrent(testApp.app)
    expect(body.nextAction).toEqual({ kind: 'final', slotId: slots.finalA })
  })

  it('(8) day 15 with both finals pending -> final A; with final A finalized -> final B (D23)', async () => {
    const { programId, slots } = await seedActiveProgram(testApp.db, { day: 15 })

    const first = await getCurrent(testApp.app)
    expect(first.body.nextAction).toEqual({ kind: 'final', slotId: slots.finalA })

    const today = localDateAt(new Date(), UTC)
    await insertSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.finalA,
      lifecycle: 'finalized',
      localDate: today,
      startedAt: new Date(),
      endedAt: new Date(),
      targetSeconds: 1200,
      completeInterval: true,
    })

    const second = await getCurrent(testApp.app)
    expect(second.body.nextAction).toEqual({ kind: 'final', slotId: slots.finalB })
  })

  it('(9) day 15 with both finals finalized -> progress', async () => {
    const { programId, slots } = await seedActiveProgram(testApp.db, { day: 15 })
    const today = localDateAt(new Date(), UTC)

    for (const slotId of [slots.finalA, slots.finalB]) {
      await insertSession(testApp.db, {
        programId,
        kind: 'benchmark',
        slotId,
        lifecycle: 'finalized',
        localDate: today,
        startedAt: new Date(),
        endedAt: new Date(),
        targetSeconds: 1200,
        completeInterval: true,
      })
    }

    const { body } = await getCurrent(testApp.app)
    expect(body.nextAction).toEqual({ kind: 'progress' })
  })

  it('(10) program status set to completed directly -> program null / setup', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 4 })
    await testApp.db.update(programs).set({ status: 'completed' }).where(eq(programs.id, programId))

    const { body } = await getCurrent(testApp.app)
    expect(body.program).toBeNull()
    expect(body.nextAction).toEqual({ kind: 'setup' })
  })

  it("(11) another principal's open program is invisible -> program null", async () => {
    await insertOtherPrincipalProgram(testApp.db)

    const { body } = await getCurrent(testApp.app)
    expect(body.program).toBeNull()
    expect(body.nextAction).toEqual({ kind: 'setup' })
  })

  it("(12) user_profiles.timezone changed to 'Pacific/Kiritimati' on a program stored in 'America/Bogota' -> day and localDate unchanged", async () => {
    await insertProgram(testApp.db, {
      baselineDate: baselineDateDaysAgo(2, 'America/Bogota'),
      timezone: 'America/Bogota',
      status: 'active',
      practiceTargetSeconds: 600,
    })

    const before = await getCurrent(testApp.app)

    await testApp.db.update(userProfiles).set({ timezone: 'Pacific/Kiritimati' }).where(eq(userProfiles.id, 'local-demo'))

    const after = await getCurrent(testApp.app)
    expect(after.body.day).toBe(before.body.day)
  })

  it(
    "(13) DST: program tz 'America/New_York', baselineDate 2026-10-28 -> setDemoNow 2026-11-02T04:30Z gives day 4 / localDate 2026-11-01 (23:30 EST; a UTC-4 bug would give Day 5), setDemoNow 2026-11-02T05:30Z gives day 5 / localDate 2026-11-02",
    async () => {
      await insertProgram(testApp.db, {
        baselineDate: '2026-10-28',
        timezone: 'America/New_York',
        status: 'active',
        practiceTargetSeconds: 600,
      })

      await setDemoNow(testApp.db, '2026-11-02T04:30:00.000Z')
      const first = await getCurrent(testApp.app)
      expect(first.body.day).toBe(4)

      await setDemoNow(testApp.db, '2026-11-02T05:30:00.000Z')
      const second = await getCurrent(testApp.app)
      expect(second.body.day).toBe(5)
    },
  )

  it('(14) setDemoOffsetSeconds +4 days on a seeded Day-0 active program -> day 4 (server-side clock, D8)', async () => {
    await seedActiveProgram(testApp.db, { day: 0 })
    await setDemoOffsetSeconds(testApp.db, 4 * 24 * 60 * 60)

    const { body } = await getCurrent(testApp.app)
    expect(body.day).toBe(4)
  })

  it('(15) Cache-Control: no-store present', async () => {
    const { headers } = await getCurrent(testApp.app)
    expect(headers['cache-control']).toBe('no-store')
  })

  it('(16) revision is the governing one: with revision 2 effective_day 8 inserted directly, Day 4 returns revision 1 and Day 9 returns revision 2', async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 4, practiceTargetSeconds: 600 })

    await testApp.db.insert(protocolRevisions).values({
      programId,
      revision: 2,
      effectiveDay: 8,
      settings: initialRevisionSettings(900, 20),
      reason: 'more time',
    })

    const day4 = await getCurrent(testApp.app)
    expect(day4.body.revision?.revision).toBe(1)

    await setDemoOffsetSeconds(testApp.db, 5 * 24 * 60 * 60)
    const day9 = await getCurrent(testApp.app)
    expect(day9.body.day).toBe(9)
    expect(day9.body.revision?.revision).toBe(2)
  })

  it("(17) a practice session inserted today with realm 'pilot' -> 422 realm_mismatch whose message contains neither 'demo' nor 'pilot'", async () => {
    const { programId } = await seedActiveProgram(testApp.db, { day: 4 })
    const today = localDateAt(new Date(), UTC)

    await insertSession(testApp.db, {
      programId,
      kind: 'practice',
      lifecycle: 'running',
      localDate: today,
      startedAt: new Date(),
      targetSeconds: 600,
      realm: 'pilot',
    })

    const { statusCode, body } = await getCurrent(testApp.app)
    expect(statusCode).toBe(422)
    const errBody = body as unknown as ErrorBody
    expect(errBody.code).toBe('realm_mismatch')
    expect(errBody.message.toLowerCase()).not.toContain('demo')
    expect(errBody.message.toLowerCase()).not.toContain('pilot')
  })

  it('(18) baseline_ready program on Day 2 with baseline B never attempted -> nextAction benchmark B', async () => {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: baselineDateDaysAgo(2, UTC),
      timezone: UTC,
      status: 'baseline_ready',
      practiceTargetSeconds: 600,
    })
    const slots = await insertSlotSet(testApp.db, programId)
    const dayZeroDate = baselineDateDaysAgo(2, UTC)

    await insertSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      lifecycle: 'finalized',
      localDate: dayZeroDate,
      startedAt: new Date(`${dayZeroDate}T09:00:00.000Z`),
      endedAt: new Date(`${dayZeroDate}T09:20:00.000Z`),
      targetSeconds: 1200,
      completeInterval: true,
    })

    const { body } = await getCurrent(testApp.app)
    expect(body.nextAction).toEqual({ kind: 'benchmark', slotId: slots.baselineB })
  })

  it(
    '(19) an abandoned attempt on slot A plus a finalized attempt with a session_amendments row ' +
      '(exclude_from_report true) inserted directly -> slot A attempts list both, the abandoned one with ' +
      'eligible null and the finalized one with excludedByAmendment true, and nextAction is benchmark B',
    async () => {
      const { programId } = await insertProgram(testApp.db, {
        baselineDate: baselineDateDaysAgo(4, UTC),
        timezone: UTC,
        status: 'active',
        practiceTargetSeconds: 600,
      })
      const slots = await insertSlotSet(testApp.db, programId)
      const dayZeroDate = baselineDateDaysAgo(4, UTC)

      const { sessionId: abandonedId } = await insertSession(testApp.db, {
        programId,
        kind: 'benchmark',
        slotId: slots.baselineA,
        lifecycle: 'abandoned',
        localDate: dayZeroDate,
        startedAt: new Date(`${dayZeroDate}T09:00:00.000Z`),
        targetSeconds: 1200,
      })
      const { sessionId: finalizedId } = await insertSession(testApp.db, {
        programId,
        kind: 'benchmark',
        slotId: slots.baselineA,
        lifecycle: 'finalized',
        localDate: dayZeroDate,
        startedAt: new Date(`${dayZeroDate}T10:00:00.000Z`),
        endedAt: new Date(`${dayZeroDate}T10:20:00.000Z`),
        targetSeconds: 1200,
        completeInterval: true,
      })
      await testApp.db.insert(sessionAmendments).values({
        sessionId: finalizedId,
        userId: 'local-demo',
        reason: 'Excluding due to a disruption noticed after the fact',
        excludeFromReport: true,
      })

      const { body } = await getCurrent(testApp.app)
      const slotA = body.slots.find((s) => s.id === slots.baselineA)!
      const byId = new Map(slotA.attempts.map((a) => [a.sessionId, a]))
      expect(byId.get(abandonedId)).toEqual({
        sessionId: abandonedId,
        lifecycle: 'abandoned',
        eligible: null,
        excludedByAmendment: false,
      })
      expect(byId.get(finalizedId)?.excludedByAmendment).toBe(true)
      expect(body.nextAction).toEqual({ kind: 'benchmark', slotId: slots.baselineB })
    },
  )
})
