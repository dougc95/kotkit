/**
 * 5.1.3 — integration smoke tests for the session-level seed helpers
 * (`seedSession`, `seedReview`, `seedEvents`, `seedAmendment`,
 * `seedAgentPlan`, `withIdempotencyKey`) against the real
 * `attention_lab_test` database via `buildTestApp` (3.2.1). `buildTestApp`,
 * `truncateAll`, `insertProgram` and `insertSlotSet` are already
 * smoke-tested by 3.2.1 (`test/plugins/db.test.ts`) and 4.1.1
 * (`test/helpers/programs.test.ts`) respectively — this file only proves
 * the new session-helpers slice.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

import { buildTestApp, type TestApp } from './buildTestApp.js'
import { insertProgram, insertSlotSet } from './programs.js'
import {
  seedAgentPlan,
  seedAmendment,
  seedEvents,
  seedReview,
  seedSession,
  withIdempotencyKey,
} from './sessions.js'
import {
  agentPlans,
  focusSessions,
  sessionAmendments,
  sessionReviews,
} from '../../src/db/schema/index.js'

describe('session seed helpers (integration, attention_lab_test)', () => {
  let testApp: TestApp

  beforeAll(async () => {
    testApp = await buildTestApp()
  })

  afterAll(async () => {
    await testApp.close()
  })

  beforeEach(async () => {
    await testApp.truncateAll()
  })

  async function seedProgram() {
    return insertProgram(testApp.db, {
      baselineDate: '2026-09-06',
      timezone: 'UTC',
      status: 'baseline_ready',
      practiceTargetSeconds: 600,
    })
  }

  it('(1) seedSession defaults: realm demo, user_id local-demo, lifecycle running, version 1, paused_seconds 0, eligible NULL, exclusion_reasons empty array', async () => {
    const { programId } = await seedProgram()
    const { sessionId } = await seedSession(testApp.db, { programId })

    const [row] = await testApp.db.select().from(focusSessions).where(eq(focusSessions.id, sessionId))
    expect(row).toBeDefined()
    expect(row?.realm).toBe('demo')
    expect(row?.userId).toBe('local-demo')
    expect(row?.lifecycle).toBe('running')
    expect(row?.version).toBe(1)
    expect(row?.pausedSeconds).toBe(0)
    expect(row?.eligible).toBeNull()
    expect(row?.exclusionReasons).toEqual([])
  })

  it('(2) seedSession without review:false also creates a session_reviews row with episode_count SQL NULL (not 0) and observed_conditions all-null fields with accommodations []', async () => {
    const { programId } = await seedProgram()
    const { sessionId } = await seedSession(testApp.db, { programId })

    const [review] = await testApp.db
      .select()
      .from(sessionReviews)
      .where(eq(sessionReviews.sessionId, sessionId))
    expect(review).toBeDefined()
    expect(review?.episodeCount).toBeNull()
    expect(review?.observedConditions).toEqual({
      deviceFormat: null,
      language: null,
      materialLevel: null,
      accommodations: [],
    })
  })

  it('(3) seedReview overrides merge onto the all-null defaults', async () => {
    const { programId } = await seedProgram()
    const { sessionId } = await seedSession(testApp.db, { programId, review: false })

    await seedReview(testApp.db, sessionId, { episodeCount: 3, outputQuality: 'yes' })

    const [review] = await testApp.db
      .select()
      .from(sessionReviews)
      .where(eq(sessionReviews.sessionId, sessionId))
    expect(review).toBeDefined()
    expect(review?.episodeCount).toBe(3)
    expect(review?.outputQuality).toBe('yes')
    // Every other measurement column stays at its all-null default.
    expect(review?.externalCount).toBeNull()
    expect(review?.unplannedAgentChecks).toBeNull()
    expect(review?.mindWanderingCount).toBeNull()
    expect(review?.recallScore).toBeNull()
    expect(review?.recallFlags).toEqual([])
    expect(review?.version).toBe(1)
  })

  it('(4) seedEvents inserts rows with voided_at NULL and details preserved (alsoOffTask true survives the round trip)', async () => {
    const { programId } = await seedProgram()
    const { sessionId } = await seedSession(testApp.db, { programId })

    const inserted = await seedEvents(testApp.db, sessionId, [
      { type: 'agent_check', elapsedMs: 1000, details: { alsoOffTask: true } },
    ])
    expect(inserted).toHaveLength(1)

    const rows = await testApp.sql`select voided_at, details from session_events where session_id = ${sessionId}`
    expect(rows).toHaveLength(1)
    expect(rows[0]?.voided_at).toBeNull()
    expect(rows[0]?.details).toEqual({ alsoOffTask: true })
  })

  it('(5) seedAmendment inserts a row with exclude_from_report true and created_at set', async () => {
    const { programId } = await seedProgram()
    const { sessionId } = await seedSession(testApp.db, {
      programId,
      lifecycle: 'finalized',
    })

    const { amendmentId } = await seedAmendment(testApp.db, sessionId, {
      reason: 'Forgot to log an interruption',
      excludeFromReport: true,
    })

    const [row] = await testApp.db
      .select()
      .from(sessionAmendments)
      .where(eq(sessionAmendments.id, amendmentId))
    expect(row).toBeDefined()
    expect(row?.excludeFromReport).toBe(true)
    expect(row?.createdAt).toBeInstanceOf(Date)
  })

  it('(6) seedAgentPlan inserts a row with review_checkpoint end_of_block and version 1', async () => {
    const { programId } = await seedProgram()
    const { sessionId } = await seedSession(testApp.db, { programId })

    await seedAgentPlan(testApp.db, sessionId, { workstream: 'Write the report' })

    const [row] = await testApp.db.select().from(agentPlans).where(eq(agentPlans.sessionId, sessionId))
    expect(row).toBeDefined()
    expect(row?.reviewCheckpoint).toBe('end_of_block')
    expect(row?.version).toBe(1)
    expect(row?.workstream).toBe('Write the report')
  })

  it('(7) withIdempotencyKey returns a fresh UUID on each call', () => {
    const first = withIdempotencyKey()
    const second = withIdempotencyKey()
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    expect(first['idempotency-key']).toMatch(uuidPattern)
    expect(second['idempotency-key']).toMatch(uuidPattern)
    expect(first['idempotency-key']).not.toBe(second['idempotency-key'])
  })

  it('(8) seeding a second running session for the same principal throws on the 3.3 partial unique index (the harness never bypasses constraints)', async () => {
    const { programId } = await seedProgram()
    await seedSession(testApp.db, { programId, lifecycle: 'running' })

    await expect(seedSession(testApp.db, { programId, lifecycle: 'running' })).rejects.toMatchObject({
      cause: { code: '23505', constraint_name: 'focus_sessions_one_active_per_user' },
    })
  })

  it('(9) composing insertProgram (4.1.1, status baseline_ready) + insertSlotSet + seedSession with slotId set produces a benchmark session joined to its slot', async () => {
    const { programId } = await seedProgram()
    const slots = await insertSlotSet(testApp.db, programId)

    const { sessionId } = await seedSession(testApp.db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      targetSeconds: 1200,
    })

    const [row] = await testApp.db.select().from(focusSessions).where(eq(focusSessions.id, sessionId))
    expect(row).toBeDefined()
    expect(row?.kind).toBe('benchmark')
    expect(row?.slotId).toBe(slots.baselineA)
  })
})
