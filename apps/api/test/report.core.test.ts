/**
 * Task 6.2.1 — integration tests for `GET /api/v1/programs/{id}/report`
 * against the real `attention_lab_test` database. Most cases build a precise
 * fixture directly (`insertProgram`/`insertSlotSet`/`seedSession`/
 * `seedAmendment`, task 4.1.1/5.1.3's own seed helpers); the three cases that
 * need a full PRD §6 comparison already encoded (`comparable-change`,
 * `missing-final`, `timing-deviation`, `working-day`) load the real demo
 * scenario via `POST /demo/scenarios/{name}/load` (3.5.4) exactly as the
 * task brief specifies.
 */
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { ReportResponseValue } from '@attention-lab/shared'

import type { AppDatabase } from '../src/plugins/db.js'
import { benchmarkSlots } from '../src/db/schema/benchmarkSlots.js'
import { focusSessions } from '../src/db/schema/focusSessions.js'
import { sessionReviews } from '../src/db/schema/sessionReviews.js'
import { programs } from '../src/db/schema/programs.js'
import { buildTestApp, type TestApp } from './helpers/buildTestApp.js'
import { insertOtherPrincipalProgram, insertProgram, insertSlotSet } from './helpers/programs.js'
import { seedAmendment, seedSession } from './helpers/sessions.js'

const TZ = 'UTC'
const BASELINE_DATE = '2026-01-01'
const DAY_ZERO_DATE = '2026-01-01'
const DAY_FOURTEEN_DATE = '2026-01-15'

async function insertBasicProgram(db: AppDatabase) {
  return insertProgram(db, {
    baselineDate: BASELINE_DATE,
    timezone: TZ,
    status: 'active',
    practiceTargetSeconds: 600,
  })
}

async function getReport(app: FastifyInstance, programId: string) {
  return app.inject({ method: 'GET', url: `/api/v1/programs/${programId}/report` })
}

async function loadScenarioViaRoute(app: FastifyInstance, name: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: `/api/v1/demo/scenarios/${name}/load` })
  expect(res.statusCode).toBe(200)
  const body = res.json() as { programId: string | null }
  if (body.programId === null) {
    throw new Error(`loadScenarioViaRoute: scenario "${name}" produced no program`)
  }
  return body.programId
}

describe('GET /api/v1/programs/{id}/report (integration, attention_lab_test)', () => {
  let testApp: TestApp
  let app: FastifyInstance
  let db: AppDatabase

  beforeAll(async () => {
    testApp = await buildTestApp()
    app = testApp.app
    db = testApp.db
  })

  afterAll(async () => {
    await testApp.close()
  })

  beforeEach(async () => {
    await testApp.truncateAll()
  })

  it('one eligible baseline: samples.baselineEligible === 1 and B is listed with its exclusionReasons', async () => {
    const { programId } = await insertBasicProgram(db)
    const slots = await insertSlotSet(db, programId)

    await seedSession(db, {
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
      review: { episodeCount: 4, recallScore: 4, countMethod: 'event' },
    })
    await seedSession(db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineB,
      lifecycle: 'finalized',
      localDate: DAY_ZERO_DATE,
      startedAt: new Date(`${DAY_ZERO_DATE}T09:30:00.000Z`),
      endedAt: new Date(`${DAY_ZERO_DATE}T09:50:00.000Z`),
      targetSeconds: 1200,
      completeInterval: false,
      eligible: false,
      exclusionReasons: ['count_unknown'],
      review: {},
    })

    const res = await getReport(app, programId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as ReportResponseValue
    expect(body.samples.baselineEligible).toBe(1)
    const b = body.attempts.find((attempt) => attempt.phase === 'baseline' && attempt.label === 'B')
    expect(b?.exclusionReasons).toEqual(['count_unknown'])
  })

  it('replaced slot lists both attempts with replacementReason and only the eligible one is the comparison candidate', async () => {
    const { programId } = await insertBasicProgram(db)
    const slots = await insertSlotSet(db, programId)

    await seedSession(db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      lifecycle: 'finalized',
      localDate: DAY_ZERO_DATE,
      startedAt: new Date(`${DAY_ZERO_DATE}T09:00:00.000Z`),
      endedAt: new Date(`${DAY_ZERO_DATE}T09:20:00.000Z`),
      targetSeconds: 1200,
      completeInterval: true,
      eligible: false,
      exclusionReasons: ['materially_disrupted'],
      review: { episodeCount: 5, recallScore: 4, countMethod: 'event' },
    })
    await seedSession(db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      lifecycle: 'finalized',
      localDate: DAY_ZERO_DATE,
      startedAt: new Date(`${DAY_ZERO_DATE}T10:00:00.000Z`),
      endedAt: new Date(`${DAY_ZERO_DATE}T10:20:00.000Z`),
      targetSeconds: 1200,
      completeInterval: true,
      eligible: true,
      exclusionReasons: [],
      replacementReason: 'Session was disrupted; retaken later the same day.',
      review: { episodeCount: 3, recallScore: 4, countMethod: 'event' },
    })

    const res = await getReport(app, programId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as ReportResponseValue
    const baselineA = body.attempts.filter((attempt) => attempt.phase === 'baseline' && attempt.label === 'A')
    expect(baselineA).toHaveLength(2)
    expect(
      baselineA.some((attempt) => attempt.eligible === false && attempt.replacementReason === null),
    ).toBe(true)
    expect(
      baselineA.some(
        (attempt) =>
          attempt.eligible === true &&
          attempt.replacementReason === 'Session was disrupted; retaken later the same day.',
      ),
    ).toBe(true)
    expect(body.samples.baselineEligible).toBe(1)
  })

  it('amendment-excluded baseline B keeps original S/recall, shows excluded_by_amendment and excludedByAmendment true', async () => {
    const { programId } = await insertBasicProgram(db)
    const slots = await insertSlotSet(db, programId)

    const { sessionId } = await seedSession(db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineB,
      lifecycle: 'finalized',
      localDate: DAY_ZERO_DATE,
      startedAt: new Date(`${DAY_ZERO_DATE}T09:00:00.000Z`),
      endedAt: new Date(`${DAY_ZERO_DATE}T09:20:00.000Z`),
      targetSeconds: 1200,
      completeInterval: true,
      eligible: true,
      exclusionReasons: [],
      review: { episodeCount: 6, recallScore: 4, countMethod: 'event' },
    })
    await seedAmendment(db, sessionId, {
      reason: 'Noise outside during this attempt; kept for context, excluded from the comparison.',
      excludeFromReport: true,
    })

    const res = await getReport(app, programId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as ReportResponseValue
    const b = body.attempts.find((attempt) => attempt.phase === 'baseline' && attempt.label === 'B')
    expect(b?.eligible).toBe(false)
    expect(b?.exclusionReasons).toContain('excluded_by_amendment')
    expect(b?.excludedByAmendment).toBe(true)
    expect(b?.episodeCount).toBe(6)
    expect(b?.recallScore).toBe(4)
  })

  it('capped T: two attempts none_capped and two known → T listed per attempt with distinct kinds and comparison.firstSwitchMeanSeconds is null', async () => {
    const { programId } = await insertBasicProgram(db)
    const slots = await insertSlotSet(db, programId)

    async function seedEligible(
      slotId: string,
      localDate: string,
      kind: 'none_capped' | 'known',
      seconds: number | null,
    ) {
      await seedSession(db, {
        programId,
        kind: 'benchmark',
        slotId,
        lifecycle: 'finalized',
        localDate,
        startedAt: new Date(`${localDate}T09:00:00.000Z`),
        endedAt: new Date(`${localDate}T09:20:00.000Z`),
        targetSeconds: 1200,
        completeInterval: true,
        eligible: true,
        exclusionReasons: [],
        review: {
          episodeCount: kind === 'none_capped' ? 0 : 2,
          recallScore: 4,
          countMethod: 'event',
          firstSwitchKind: kind,
          firstSwitchSeconds: kind === 'known' ? seconds : null,
          firstSwitchMethod: kind === 'known' ? 'event' : null,
        },
      })
    }

    await seedEligible(slots.baselineA, DAY_ZERO_DATE, 'none_capped', null)
    await seedEligible(slots.baselineB, DAY_ZERO_DATE, 'none_capped', null)
    await seedEligible(slots.finalA, DAY_FOURTEEN_DATE, 'known', 500)
    await seedEligible(slots.finalB, DAY_FOURTEEN_DATE, 'known', 600)

    const res = await getReport(app, programId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as ReportResponseValue
    expect(body.comparison).toBeDefined()
    expect(body.comparison?.firstSwitchMeanSeconds).toBeNull()
    const kinds = body.attempts.map((attempt) => attempt.firstSwitch?.kind)
    expect(kinds.filter((kind) => kind === 'none_capped')).toHaveLength(2)
    expect(kinds.filter((kind) => kind === 'known')).toHaveLength(2)
  })

  it('all four T known → firstSwitchMeanSeconds is a number', async () => {
    const { programId } = await insertBasicProgram(db)
    const slots = await insertSlotSet(db, programId)

    async function seedEligible(slotId: string, localDate: string, seconds: number) {
      await seedSession(db, {
        programId,
        kind: 'benchmark',
        slotId,
        lifecycle: 'finalized',
        localDate,
        startedAt: new Date(`${localDate}T09:00:00.000Z`),
        endedAt: new Date(`${localDate}T09:20:00.000Z`),
        targetSeconds: 1200,
        completeInterval: true,
        eligible: true,
        exclusionReasons: [],
        review: {
          episodeCount: 2,
          recallScore: 4,
          countMethod: 'event',
          firstSwitchKind: 'known',
          firstSwitchSeconds: seconds,
          firstSwitchMethod: 'event',
        },
      })
    }

    await seedEligible(slots.baselineA, DAY_ZERO_DATE, 400)
    await seedEligible(slots.baselineB, DAY_ZERO_DATE, 450)
    await seedEligible(slots.finalA, DAY_FOURTEEN_DATE, 500)
    await seedEligible(slots.finalB, DAY_FOURTEEN_DATE, 600)

    const res = await getReport(app, programId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as ReportResponseValue
    expect(typeof body.comparison?.firstSwitchMeanSeconds).toBe('number')
  })

  it("comparable-change: comparison present (2+2) with percentageReduction 40 and body realm 'demo'", async () => {
    const programId = await loadScenarioViaRoute(app, 'comparable-change')
    const res = await getReport(app, programId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as ReportResponseValue
    expect(body.realm).toBe('demo')
    expect(body.comparison?.percentageReduction).toBe(40)
  })

  it('missing-final: comparison absent and resultState insufficient_samples', async () => {
    const programId = await loadScenarioViaRoute(app, 'missing-final')
    const res = await getReport(app, programId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as ReportResponseValue
    expect(body.comparison).toBeUndefined()
    expect(body.resultState).toBe('insufficient_samples')
  })

  it("timing-deviation (D35): baseline A listed with lifecycle 'running', eligible false, exclusionReasons [], samples.baselineEligible 0, resultState baseline_pending", async () => {
    const programId = await loadScenarioViaRoute(app, 'timing-deviation')
    const res = await getReport(app, programId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as ReportResponseValue
    const a = body.attempts.find((attempt) => attempt.phase === 'baseline' && attempt.label === 'A')
    expect(a?.lifecycle).toBe('running')
    expect(a?.eligible).toBe(false)
    expect(a?.exclusionReasons).toEqual([])
    expect(body.samples.baselineEligible).toBe(0)
    expect(body.resultState).toBe('baseline_pending')
  })

  it('two protocol_revisions rows → revisions[] lists both with effectiveDay and reason', async () => {
    const programId = await loadScenarioViaRoute(app, 'working-day')
    const res = await getReport(app, programId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as ReportResponseValue
    expect(body.revisions).toHaveLength(2)
    expect(body.revisions.map((revision) => revision.effectiveDay).sort((a, b) => a - b)).toEqual([0, 4])
    for (const revision of body.revisions) {
      expect(revision.reason.length).toBeGreaterThan(0)
    }
  })

  it('mixed realm: a realm=\'pilot\' focus_sessions + session_reviews row inserted under the demo program → 422 realm_mismatch, message \'Simulated and real results are never combined.\', body has no attempts, samples or realm values', async () => {
    const programId = await loadScenarioViaRoute(app, 'comparable-change')

    const [slotRow] = await db
      .select({ id: benchmarkSlots.id })
      .from(benchmarkSlots)
      .where(
        and(eq(benchmarkSlots.programId, programId), eq(benchmarkSlots.phase, 'baseline'), eq(benchmarkSlots.label, 'A')),
      )
      .limit(1)
    if (!slotRow) throw new Error('expected a baseline A slot')

    const [programRow] = await db
      .select({ revisionId: programs.currentRevisionId })
      .from(programs)
      .where(eq(programs.id, programId))
      .limit(1)
    if (!programRow || programRow.revisionId === null) throw new Error('expected a current revision')

    const [pilotSession] = await db
      .insert(focusSessions)
      .values({
        userId: 'local-demo',
        programId,
        revisionId: programRow.revisionId,
        slotId: slotRow.id,
        realm: 'pilot',
        kind: 'benchmark',
        lifecycle: 'finalized',
        targetSeconds: 1200,
        startedAt: new Date(),
        endedAt: new Date(),
        localDate: DAY_ZERO_DATE,
        timeSource: 'measured',
        timerQuality: 'ok',
        completeInterval: true,
        eligible: true,
        exclusionReasons: [],
      })
      .returning()
    if (!pilotSession) throw new Error('expected an inserted focus_sessions row')

    await db.insert(sessionReviews).values({
      sessionId: pilotSession.id,
      observedConditions: { deviceFormat: null, language: null, materialLevel: null, accommodations: [] },
    })

    const res = await getReport(app, programId)
    expect(res.statusCode).toBe(422)
    const body = res.json() as { code: string; message: string; attempts?: unknown; samples?: unknown; realm?: unknown }
    expect(body.code).toBe('realm_mismatch')
    expect(body.message).toBe('Simulated and real results are never combined.')
    expect(body.attempts).toBeUndefined()
    expect(body.samples).toBeUndefined()
    expect(body.realm).toBeUndefined()
  })

  it("another principal's program → 404", async () => {
    const { programId } = await insertOtherPrincipalProgram(db)
    const res = await getReport(app, programId)
    expect(res.statusCode).toBe(404)
    const body = res.json() as { code: string }
    expect(body.code).toBe('not_found')
  })

  it('Cache-Control: no-store', async () => {
    const programId = await loadScenarioViaRoute(app, 'comparable-change')
    const res = await getReport(app, programId)
    expect(res.headers['cache-control']).toBe('no-store')
  })
})
