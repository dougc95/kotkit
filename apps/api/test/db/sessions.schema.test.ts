/**
 * 3.3.2 — schema tests for focus_sessions, session_events, session_reviews,
 * session_amendments and agent_plans.
 *
 * Uses its own profile id `sessions-schema-test-user` (never `local-demo`)
 * so these tests stay independent of the principal seeding 3.2.3 adds later
 * (mirrors 3.3.1's programs.schema.test.ts convention).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, StringChunk, type SQL } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { randomUUID } from 'node:crypto'
import { DEFAULT_BAND_CEILINGS } from '@attention-lab/shared'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import {
  userProfiles,
  programs,
  protocolRevisions,
  benchmarkSlots,
  focusSessions,
  sessionEvents,
  sessionReviews,
  sessionAmendments,
  agentPlans,
  firstSwitchKindEnum,
} from '../../src/db/schema/index.js'
import { DEFAULT_PREFERENCES } from '../../src/preferences.js'

const PROFILE_ID = 'sessions-schema-test-user'

/** Flattens a `where` clause's query chunks back to plain text for assertion. */
function whereText(clause: SQL | undefined): string {
  if (!clause) return ''
  return clause.queryChunks
    .map((chunk) => (chunk instanceof StringChunk ? chunk.value.join(' ') : ''))
    .join(' ')
}

describe('sessions schema (unit, getTableConfig, no DB)', () => {
  it('(1) episode_count, external_count, unplanned_agent_checks, mind_wandering_count and recall_score are nullable with no default', () => {
    const columns = getTableConfig(sessionReviews).columns
    for (const name of [
      'episode_count',
      'external_count',
      'unplanned_agent_checks',
      'mind_wandering_count',
      'recall_score',
    ]) {
      const column = columns.find((c) => c.name === name)
      expect(column, `${name} column exists`).toBeDefined()
      expect(column?.notNull, `${name}.notNull`).toBe(false)
      expect(column?.hasDefault, `${name}.hasDefault`).toBe(false)
    }
  })

  it('(2) CHECK focus_sessions_benchmark_has_slot exists', () => {
    const config = getTableConfig(focusSessions)
    const check = config.checks.find((c) => c.name === 'focus_sessions_benchmark_has_slot')
    expect(check).toBeDefined()
  })

  it('(3) partial unique focus_sessions_one_active_per_user exists with a where mentioning running, paused and awaiting_review', () => {
    const config = getTableConfig(focusSessions)
    const index = config.indexes.find((i) => i.config.name === 'focus_sessions_one_active_per_user')
    expect(index).toBeDefined()
    expect(index?.config.unique).toBe(true)
    const columns = index?.config.columns.map((c) => (c as { name?: string }).name)
    expect(columns).toEqual(['user_id'])
    const text = whereText(index?.config.where)
    expect(text).toContain('running')
    expect(text).toContain('paused')
    expect(text).toContain('awaiting_review')
  })

  it('(4) session_events is unique on (session_id, client_event_id)', () => {
    const config = getTableConfig(sessionEvents)
    const unique = config.uniqueConstraints.find(
      (u) => u.columns.map((c) => c.name).sort().join(',') === 'client_event_id,session_id',
    )
    expect(unique).toBeDefined()
  })

  it("(5) agent_plans.review_checkpoint defaults to 'end_of_block'", () => {
    const column = getTableConfig(agentPlans).columns.find((c) => c.name === 'review_checkpoint')
    expect(column).toBeDefined()
    expect(column?.notNull).toBe(true)
    expect(column?.hasDefault).toBe(true)
    expect(column?.default).toBe('end_of_block')
  })

  it('(6) first_switch_kind enum values are exactly [none_capped, known, unknown] and focus_sessions.realm has no default', () => {
    expect(firstSwitchKindEnum.enumValues).toEqual(['none_capped', 'known', 'unknown'])
    const realmColumn = getTableConfig(focusSessions).columns.find((c) => c.name === 'realm')
    expect(realmColumn).toBeDefined()
    expect(realmColumn?.notNull).toBe(true)
    expect(realmColumn?.hasDefault).toBe(false)
  })

  it('(7) session_reviews.review_note and output_note are nullable text without default, and no child table has a realm column', () => {
    const reviewColumns = getTableConfig(sessionReviews).columns
    for (const name of ['review_note', 'output_note']) {
      const column = reviewColumns.find((c) => c.name === name)
      expect(column, `${name} column exists`).toBeDefined()
      expect(column?.notNull, `${name}.notNull`).toBe(false)
      expect(column?.hasDefault, `${name}.hasDefault`).toBe(false)
    }

    for (const table of [sessionEvents, sessionReviews, sessionAmendments, agentPlans]) {
      const names = getTableConfig(table).columns.map((c) => c.name)
      expect(names).not.toContain('realm')
    }
  })
})

describe('sessions schema (integration, attention_lab_test)', () => {
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

  async function insertProfile(): Promise<void> {
    await testApp.db.insert(userProfiles).values({
      id: PROFILE_ID,
      timezone: 'UTC',
      preferences: DEFAULT_PREFERENCES,
    })
  }

  async function insertProgramWithRevision(): Promise<{ programId: string; revisionId: string }> {
    const [program] = await testApp.db
      .insert(programs)
      .values({
        userId: PROFILE_ID,
        realm: 'demo',
        baselineDate: '2026-09-06',
        timezone: 'UTC',
        status: 'draft',
        leisureAllowanceMin: 20,
      })
      .returning()
    const programId = program!.id
    const [revision] = await testApp.db
      .insert(protocolRevisions)
      .values({
        programId,
        revision: 1,
        effectiveDay: 0,
        settings: {
          practiceTargetSeconds: 600,
          bandCeilings: DEFAULT_BAND_CEILINGS,
          leisureAllowanceMin: 20,
        },
        reason: 'initial plan',
      })
      .returning()
    const revisionId = revision!.id
    await testApp.db
      .update(programs)
      .set({ currentRevisionId: revisionId })
      .where(eq(programs.id, programId))
    return { programId, revisionId }
  }

  async function insertBaselineSlot(programId: string): Promise<string> {
    const [slot] = await testApp.db
      .insert(benchmarkSlots)
      .values({
        programId,
        phase: 'baseline',
        label: 'A',
        materialRef: 'Chapter 3',
        assignedLocalDate: '2026-09-06',
      })
      .returning()
    return slot!.id
  }

  function practiceSessionValues(
    programId: string,
    revisionId: string,
    lifecycle: 'running' | 'paused' | 'awaiting_review' | 'finalized' | 'abandoned',
  ) {
    return {
      userId: PROFILE_ID,
      programId,
      revisionId,
      realm: 'demo' as const,
      kind: 'practice' as const,
      lifecycle,
      targetSeconds: 600,
      startedAt: new Date('2026-09-06T10:00:00Z'),
      localDate: '2026-09-06',
      timeSource: 'measured' as const,
    }
  }

  it('(8) a running practice session for the user then a second running session violates focus_sessions_one_active_per_user (23505)', async () => {
    await insertProfile()
    const { programId, revisionId } = await insertProgramWithRevision()
    await testApp.db.insert(focusSessions).values(practiceSessionValues(programId, revisionId, 'running'))
    await expect(
      testApp.db.insert(focusSessions).values(practiceSessionValues(programId, revisionId, 'running')),
    ).rejects.toMatchObject({
      cause: { code: '23505', constraint_name: 'focus_sessions_one_active_per_user' },
    })
  })

  it('(9) a second session with lifecycle awaiting_review also violates the partial unique index (23505)', async () => {
    await insertProfile()
    const { programId, revisionId } = await insertProgramWithRevision()
    await testApp.db.insert(focusSessions).values(practiceSessionValues(programId, revisionId, 'running'))
    await expect(
      testApp.db
        .insert(focusSessions)
        .values(practiceSessionValues(programId, revisionId, 'awaiting_review')),
    ).rejects.toMatchObject({
      cause: { code: '23505', constraint_name: 'focus_sessions_one_active_per_user' },
    })
  })

  it('(10) a second session with lifecycle finalized alongside a running one is allowed', async () => {
    await insertProfile()
    const { programId, revisionId } = await insertProgramWithRevision()
    await testApp.db.insert(focusSessions).values(practiceSessionValues(programId, revisionId, 'running'))
    const [second] = await testApp.db
      .insert(focusSessions)
      .values(practiceSessionValues(programId, revisionId, 'finalized'))
      .returning()
    expect(second?.lifecycle).toBe('finalized')
  })

  it('(11) a benchmark session with slot_id NULL violates focus_sessions_benchmark_has_slot (23514)', async () => {
    await insertProfile()
    const { programId, revisionId } = await insertProgramWithRevision()
    await expect(
      testApp.db.insert(focusSessions).values({
        userId: PROFILE_ID,
        programId,
        revisionId,
        realm: 'demo',
        kind: 'benchmark',
        lifecycle: 'running',
        targetSeconds: 1200,
        startedAt: new Date('2026-09-06T10:00:00Z'),
        localDate: '2026-09-06',
        timeSource: 'measured',
      }),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint_name: 'focus_sessions_benchmark_has_slot' },
    })
  })

  it('(12) a practice session with a slot_id violates focus_sessions_benchmark_has_slot (23514)', async () => {
    await insertProfile()
    const { programId, revisionId } = await insertProgramWithRevision()
    const slotId = await insertBaselineSlot(programId)
    await expect(
      testApp.db.insert(focusSessions).values({
        ...practiceSessionValues(programId, revisionId, 'running'),
        slotId,
      }),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint_name: 'focus_sessions_benchmark_has_slot' },
    })
  })

  it('(13) inserting the same (session_id, client_event_id) twice violates the unique constraint (23505)', async () => {
    await insertProfile()
    const { programId, revisionId } = await insertProgramWithRevision()
    const [session] = await testApp.db
      .insert(focusSessions)
      .values(practiceSessionValues(programId, revisionId, 'running'))
      .returning()
    const sessionId = session!.id
    const clientEventId = randomUUID()
    await testApp.db.insert(sessionEvents).values({
      sessionId,
      clientEventId,
      type: 'off_task',
      occurredAt: new Date('2026-09-06T10:01:00Z'),
    })
    await expect(
      testApp.db.insert(sessionEvents).values({
        sessionId,
        clientEventId,
        type: 'off_task',
        occurredAt: new Date('2026-09-06T10:02:00Z'),
      }),
    ).rejects.toMatchObject({
      cause: { code: '23505', constraint_name: 'session_events_client_event_unique' },
    })
  })

  it('(14) INSERT ... ON CONFLICT (session_id, client_event_id) DO NOTHING reports 0 rows on the second insert', async () => {
    await insertProfile()
    const { programId, revisionId } = await insertProgramWithRevision()
    const [session] = await testApp.db
      .insert(focusSessions)
      .values(practiceSessionValues(programId, revisionId, 'running'))
      .returning()
    const sessionId = session!.id
    const clientEventId = randomUUID()
    const occurredAt = '2026-09-06T10:01:00Z'

    const first = await testApp.sql`
      insert into session_events (session_id, client_event_id, type, occurred_at)
      values (${sessionId}, ${clientEventId}, 'off_task', ${occurredAt}::timestamptz)
      on conflict (session_id, client_event_id) do nothing
    `
    expect(first.count).toBe(1)

    const second = await testApp.sql`
      insert into session_events (session_id, client_event_id, type, occurred_at)
      values (${sessionId}, ${clientEventId}, 'off_task', ${occurredAt}::timestamptz)
      on conflict (session_id, client_event_id) do nothing
    `
    expect(second.count).toBe(0)
  })

  it('(15) a review inserted with every count omitted reads back null for all five counts and review_note', async () => {
    await insertProfile()
    const { programId, revisionId } = await insertProgramWithRevision()
    const [session] = await testApp.db
      .insert(focusSessions)
      .values(practiceSessionValues(programId, revisionId, 'running'))
      .returning()
    const sessionId = session!.id
    const [review] = await testApp.db
      .insert(sessionReviews)
      .values({
        sessionId,
        observedConditions: {
          deviceFormat: null,
          language: null,
          materialLevel: null,
          accommodations: [],
        },
      })
      .returning()
    expect(review?.episodeCount).toBeNull()
    expect(review?.externalCount).toBeNull()
    expect(review?.unplannedAgentChecks).toBeNull()
    expect(review?.mindWanderingCount).toBeNull()
    expect(review?.recallScore).toBeNull()
    expect(review?.reviewNote).toBeNull()
  })

  it('(16) a review inserted with episode_count 0 reads back 0, distinct from null', async () => {
    await insertProfile()
    const { programId, revisionId } = await insertProgramWithRevision()
    const [session] = await testApp.db
      .insert(focusSessions)
      .values(practiceSessionValues(programId, revisionId, 'running'))
      .returning()
    const sessionId = session!.id
    const [review] = await testApp.db
      .insert(sessionReviews)
      .values({
        sessionId,
        episodeCount: 0,
        observedConditions: {
          deviceFormat: null,
          language: null,
          materialLevel: null,
          accommodations: [],
        },
      })
      .returning()
    expect(review?.episodeCount).toBe(0)
  })

  it('(17) exclusion_reasons defaults to an empty array and clock_gap_seconds omitted reads back null', async () => {
    await insertProfile()
    const { programId, revisionId } = await insertProgramWithRevision()
    const [session] = await testApp.db
      .insert(focusSessions)
      .values(practiceSessionValues(programId, revisionId, 'running'))
      .returning()
    expect(session?.exclusionReasons).toEqual([])
    expect(session?.clockGapSeconds).toBeNull()
  })
})
