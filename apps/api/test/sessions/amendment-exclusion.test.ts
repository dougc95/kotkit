/**
 * Task 5.9.3 — Fastify inject integration tests confirming, against the real
 * `attention_lab_test` database, that the report (`GET
 * /programs/{id}/report`, 6.2.1) and the benchmark replacement rule (`POST
 * /sessions`, 5.1.2) both honor the D32 amendment-exclusion overlay
 * end-to-end through the real `POST /sessions/{id}/amendments` route
 * (5.9.1), composing 4.1.1's program helpers with 5.1.3's session seed
 * helpers per D16 — no lower layer is re-created here. The row-fixture
 * confirmation that the two call sites agree with each other is
 * `test/services/report-amendments.unit.test.ts`.
 */
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ReportResponseValue } from '@attention-lab/shared'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import { baselineDateDaysAgo, insertProgram, insertSlotSet } from '../helpers/programs.js'
import { postAmendment, seedSession, withIdempotencyKey } from '../helpers/sessions.js'
import { focusSessions, programs } from '../../src/db/schema/index.js'

const TZ = 'UTC'
const DAY_ZERO_DATE = '2026-01-01'

interface ErrorBody {
  code: string
}

async function insertBasicProgram(testApp: TestApp) {
  return insertProgram(testApp.db, {
    baselineDate: DAY_ZERO_DATE,
    timezone: TZ,
    status: 'active',
    practiceTargetSeconds: 600,
  })
}

async function getReport(app: FastifyInstance, programId: string) {
  const res = await app.inject({ method: 'GET', url: `/api/v1/programs/${programId}/report` })
  expect(res.statusCode).toBe(200)
  return res.json() as ReportResponseValue
}

async function postSession(app: FastifyInstance, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    payload,
    headers: withIdempotencyKey(),
  })
}

describe('Amendment exclusion is honored by the report and the replacement rule (integration, attention_lab_test)', () => {
  let testApp: TestApp
  let app: FastifyInstance

  beforeAll(async () => {
    testApp = await buildTestApp()
    app = testApp.app
  })

  beforeEach(async () => {
    await testApp.truncateAll()
  })

  afterAll(async () => {
    await testApp.close()
  })

  it('eligible baseline A and B (S 4 and 6, recall 4); amend B excludeFromReport true → report lists B excluded, counts untouched, samples 1 of 2, DB unchanged', async () => {
    const { programId } = await insertBasicProgram(testApp)
    const slots = await insertSlotSet(testApp.db, programId)

    await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      lifecycle: 'finalized',
      localDate: DAY_ZERO_DATE,
      startedAt: new Date(`${DAY_ZERO_DATE}T09:00:00.000Z`),
      endedAt: new Date(`${DAY_ZERO_DATE}T09:20:00.000Z`),
      targetSeconds: 1200,
      completeInterval: true,
      eligible: true,
      exclusionReasons: [],
      review: {
        episodeCount: 4,
        recallScore: 4,
        countMethod: 'event',
        firstSwitchKind: 'known',
        firstSwitchSeconds: 250,
        firstSwitchMethod: 'event',
      },
    })
    const { sessionId: bSessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineB,
      lifecycle: 'finalized',
      localDate: DAY_ZERO_DATE,
      startedAt: new Date(`${DAY_ZERO_DATE}T09:30:00.000Z`),
      endedAt: new Date(`${DAY_ZERO_DATE}T09:50:00.000Z`),
      targetSeconds: 1200,
      completeInterval: true,
      eligible: true,
      exclusionReasons: [],
      review: {
        episodeCount: 6,
        recallScore: 4,
        countMethod: 'event',
        firstSwitchKind: 'known',
        firstSwitchSeconds: 300,
        firstSwitchMethod: 'event',
      },
    })

    const amendRes = await postAmendment(app, bSessionId, {
      reason: 'Construction noise outside during this attempt.',
      excludeFromReport: true,
    })
    expect(amendRes.statusCode).toBe(201)

    const body = await getReport(app, programId)
    const b = body.attempts.find((attempt) => attempt.phase === 'baseline' && attempt.label === 'B')
    expect(b?.eligible).toBe(false)
    expect(b?.exclusionReasons).toEqual(['excluded_by_amendment'])
    expect(b?.excludedByAmendment).toBe(true)
    expect(b?.episodeCount).toBe(6)
    expect(b?.recallScore).toBe(4)
    expect(b?.firstSwitch).toEqual({ kind: 'known', seconds: 300 })
    expect(body.samples.baselineEligible).toBe(1)

    const [row] = await testApp.db.select().from(focusSessions).where(eq(focusSessions.id, bSessionId))
    expect(row?.eligible).toBe(true)
    expect(row?.exclusionReasons).toEqual([])
  })

  it('explaining amendment (excludeFromReport false) → B still eligible in the report', async () => {
    const { programId } = await insertBasicProgram(testApp)
    const slots = await insertSlotSet(testApp.db, programId)

    const { sessionId: bSessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineB,
      lifecycle: 'finalized',
      localDate: DAY_ZERO_DATE,
      startedAt: new Date(`${DAY_ZERO_DATE}T09:30:00.000Z`),
      endedAt: new Date(`${DAY_ZERO_DATE}T09:50:00.000Z`),
      targetSeconds: 1200,
      completeInterval: true,
      eligible: true,
      exclusionReasons: [],
      review: { episodeCount: 6, recallScore: 4, countMethod: 'event' },
    })

    const amendRes = await postAmendment(app, bSessionId, {
      reason: 'Kept for context; the count itself is trustworthy.',
      excludeFromReport: false,
    })
    expect(amendRes.statusCode).toBe(201)

    const body = await getReport(app, programId)
    const b = body.attempts.find((attempt) => attempt.phase === 'baseline' && attempt.label === 'B')
    expect(b?.eligible).toBe(true)
    expect(b?.exclusionReasons).toEqual([])
    expect(b?.excludedByAmendment).toBe(false)
  })

  it("excluding an already-ineligible attempt with ['count_unknown'] → report shows ['count_unknown','excluded_by_amendment'], DB exclusion_reasons unchanged", async () => {
    const { programId } = await insertBasicProgram(testApp)
    const slots = await insertSlotSet(testApp.db, programId)

    const { sessionId: bSessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineB,
      lifecycle: 'finalized',
      localDate: DAY_ZERO_DATE,
      startedAt: new Date(`${DAY_ZERO_DATE}T09:30:00.000Z`),
      endedAt: new Date(`${DAY_ZERO_DATE}T09:50:00.000Z`),
      targetSeconds: 1200,
      completeInterval: true,
      eligible: false,
      exclusionReasons: ['count_unknown'],
      review: {},
    })

    const amendRes = await postAmendment(app, bSessionId, {
      reason: 'Also wrong material; excluding entirely.',
      excludeFromReport: true,
    })
    expect(amendRes.statusCode).toBe(201)

    const body = await getReport(app, programId)
    const b = body.attempts.find((attempt) => attempt.phase === 'baseline' && attempt.label === 'B')
    expect(b?.eligible).toBe(false)
    expect(b?.exclusionReasons).toEqual(['count_unknown', 'excluded_by_amendment'])

    const [row] = await testApp.db.select().from(focusSessions).where(eq(focusSessions.id, bSessionId))
    expect(row?.exclusionReasons).toEqual(['count_unknown'])
  })

  it('after excluding eligible baseline A, POST /sessions replacement for slot A with replacementReason → 201 and both attempts appear in the report; without the amendment the same start → 422 eligible_attempt_not_retaken', async () => {
    const baselineDate = baselineDateDaysAgo(0, TZ)

    // Program 1: the eligible attempt IS amended -> replacement is allowed.
    const { programId: amendedProgramId } = await insertProgram(testApp.db, {
      baselineDate,
      timezone: TZ,
      status: 'active',
      practiceTargetSeconds: 600,
    })
    const amendedSlots = await insertSlotSet(testApp.db, amendedProgramId)
    const { sessionId: firstId } = await seedSession(testApp.db, {
      programId: amendedProgramId,
      kind: 'benchmark',
      slotId: amendedSlots.baselineA,
      lifecycle: 'finalized',
      eligible: true,
      exclusionReasons: [],
    })
    const amendRes = await postAmendment(app, firstId, {
      reason: 'Wrong material used; excluding and retaking.',
      excludeFromReport: true,
    })
    expect(amendRes.statusCode).toBe(201)

    const replacementRes = await postSession(app, {
      programId: amendedProgramId,
      kind: 'benchmark',
      slotId: amendedSlots.baselineA,
      replacementReason: 'Retaking after exclusion',
    })
    expect(replacementRes.statusCode).toBe(201)

    const amendedReport = await getReport(app, amendedProgramId)
    const amendedAttemptsA = amendedReport.attempts.filter(
      (attempt) => attempt.phase === 'baseline' && attempt.label === 'A',
    )
    expect(amendedAttemptsA).toHaveLength(2)

    // The replacement attempt is still `running` (D6: one active session per
    // user, globally) — abandon it before program 2 starts its own session,
    // exactly as any real journey would leave a session before moving on.
    const replacementBody = replacementRes.json() as { id: string; version: number }
    const abandonRes = await app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${replacementBody.id}/transitions`,
      payload: { expectedVersion: replacementBody.version, type: 'abandon' },
    })
    expect(abandonRes.statusCode).toBe(200)

    // Only one non-terminal program per user is allowed
    // (`programs_one_open_per_user`, the partial unique index over
    // draft/baseline_ready/active) — this program's own report/replacement
    // checks are already done, so it is archived before the second program
    // (same fixed `local-demo` principal, D2) is created.
    await testApp.db.update(programs).set({ status: 'archived' }).where(eq(programs.id, amendedProgramId))

    // Program 2: the same eligible attempt WITHOUT an amendment -> refused.
    const { programId: plainProgramId } = await insertProgram(testApp.db, {
      baselineDate,
      timezone: TZ,
      status: 'active',
      practiceTargetSeconds: 600,
    })
    const plainSlots = await insertSlotSet(testApp.db, plainProgramId)
    await seedSession(testApp.db, {
      programId: plainProgramId,
      kind: 'benchmark',
      slotId: plainSlots.baselineA,
      lifecycle: 'finalized',
      eligible: true,
      exclusionReasons: [],
    })

    const refusedRes = await postSession(app, {
      programId: plainProgramId,
      kind: 'benchmark',
      slotId: plainSlots.baselineA,
      replacementReason: 'Trying again',
    })
    expect(refusedRes.statusCode).toBe(422)
    expect((refusedRes.json() as ErrorBody).code).toBe('eligible_attempt_not_retaken')
  })

  it('B finalized with a NULL externalCount and excluded → report externalCount null, never 0', async () => {
    const { programId } = await insertBasicProgram(testApp)
    const slots = await insertSlotSet(testApp.db, programId)

    const { sessionId: bSessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineB,
      lifecycle: 'finalized',
      localDate: DAY_ZERO_DATE,
      startedAt: new Date(`${DAY_ZERO_DATE}T09:30:00.000Z`),
      endedAt: new Date(`${DAY_ZERO_DATE}T09:50:00.000Z`),
      targetSeconds: 1200,
      completeInterval: true,
      eligible: true,
      exclusionReasons: [],
      review: { episodeCount: 6, recallScore: 4, countMethod: 'event', externalCount: null },
    })

    const amendRes = await postAmendment(app, bSessionId, {
      reason: 'Excluding despite the recorded counts.',
      excludeFromReport: true,
    })
    expect(amendRes.statusCode).toBe(201)

    const body = await getReport(app, programId)
    const b = body.attempts.find((attempt) => attempt.phase === 'baseline' && attempt.label === 'B')
    expect(b?.eligible).toBe(false)
    expect(b?.excludedByAmendment).toBe(true)
    expect(b?.externalCount).toBeNull()
  })
})
