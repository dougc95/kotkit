/**
 * Task 6.2.3 — integration tests for `GET /api/v1/programs/{id}/report`'s
 * `warnings[]` against the real `attention_lab_test` database. Every case
 * loads the real `comparable-change` demo scenario (3.5.4) — four eligible,
 * finalized benchmark attempts with matching observed conditions — then
 * mutates one attempt's `session_reviews.observed_conditions` directly
 * through Drizzle before re-fetching the report, mirroring how 6.2.2's own
 * `applyReportVariant` mutates `episode_count`/`recall_score` on the same
 * base scenario (D16: nothing here re-implements `loadScenario`/
 * `comparableChangeScenario`).
 */
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { ObservedConditionsValue, ReportResponseValue } from '@attention-lab/shared'

import type { AppDatabase } from '../src/plugins/db.js'
import { benchmarkSlots } from '../src/db/schema/benchmarkSlots.js'
import { focusSessions } from '../src/db/schema/focusSessions.js'
import { sessionReviews } from '../src/db/schema/sessionReviews.js'
import { buildTestApp, type TestApp } from './helpers/buildTestApp.js'

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

/** The `session_reviews` row id for the one benchmark attempt at `phase`:`label` under `programId`. */
async function findAttemptSessionId(
  db: AppDatabase,
  programId: string,
  phase: 'baseline' | 'final',
  label: 'A' | 'B',
): Promise<string> {
  const [row] = await db
    .select({ sessionId: focusSessions.id })
    .from(focusSessions)
    .innerJoin(benchmarkSlots, eq(benchmarkSlots.id, focusSessions.slotId))
    .where(
      and(
        eq(focusSessions.programId, programId),
        eq(focusSessions.kind, 'benchmark'),
        eq(benchmarkSlots.phase, phase),
        eq(benchmarkSlots.label, label),
      ),
    )
    .limit(1)
  if (!row) {
    throw new Error(`findAttemptSessionId: no ${phase}:${label} benchmark attempt for program ${programId}`)
  }
  return row.sessionId
}

async function setObservedConditions(
  db: AppDatabase,
  sessionId: string,
  conditions: ObservedConditionsValue,
): Promise<void> {
  await db.update(sessionReviews).set({ observedConditions: conditions }).where(eq(sessionReviews.sessionId, sessionId))
}

describe('GET /api/v1/programs/{id}/report warnings[] (integration, attention_lab_test)', () => {
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

  it('comparable-change scenario with final B observed_conditions.language changed via Drizzle → warnings names language for B and comparison is still present (2+2)', async () => {
    const programId = await loadScenarioViaRoute(app, 'comparable-change')
    const finalBSessionId = await findAttemptSessionId(db, programId, 'final', 'B')

    await setObservedConditions(db, finalBSessionId, {
      deviceFormat: 'laptop',
      language: 'es',
      materialLevel: 'intermediate',
      accommodations: [],
    })

    const res = await getReport(app, programId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as ReportResponseValue

    const languageWarning = body.warnings.find(
      (warning) => warning.label === 'B' && warning.field === 'language',
    )
    expect(languageWarning).toBeDefined()
    expect(languageWarning?.baseline).toBe('en')
    expect(languageWarning?.final).toBe('es')

    expect(body.comparison).toBeDefined()
    expect(body.samples).toEqual({ baselineEligible: 2, finalEligible: 2 })
  })

  it('accommodation increased_font_size added on final A → warning for A and eligible unchanged for every attempt', async () => {
    const programId = await loadScenarioViaRoute(app, 'comparable-change')
    const finalASessionId = await findAttemptSessionId(db, programId, 'final', 'A')

    await setObservedConditions(db, finalASessionId, {
      deviceFormat: 'laptop',
      language: 'en',
      materialLevel: 'intermediate',
      accommodations: ['increased_font_size'],
    })

    const res = await getReport(app, programId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as ReportResponseValue

    const accommodationsWarning = body.warnings.find(
      (warning) => warning.label === 'A' && warning.field === 'accommodations',
    )
    expect(accommodationsWarning).toBeDefined()
    expect(accommodationsWarning?.message).toContain('increased_font_size')

    expect(body.attempts).toHaveLength(4)
    for (const attempt of body.attempts) {
      expect(attempt.eligible).toBe(true)
    }
    expect(body.samples).toEqual({ baselineEligible: 2, finalEligible: 2 })
  })

  it('scenario without condition drift → warnings []', async () => {
    const programId = await loadScenarioViaRoute(app, 'comparable-change')

    const res = await getReport(app, programId)
    expect(res.statusCode).toBe(200)
    const body = res.json() as ReportResponseValue

    expect(body.warnings).toEqual([])
  })
})
