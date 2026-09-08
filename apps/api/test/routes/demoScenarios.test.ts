import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  DEMO_SCENARIO_NAMES,
  DEMO_SCENARIOS,
  addDays,
  localDateAt,
  type AnchoredReview,
  type ReportedCount,
} from '@attention-lab/shared'

import { programs } from '../../src/db/schema/programs.js'
import { focusSessions } from '../../src/db/schema/focusSessions.js'
import { sessionEvents } from '../../src/db/schema/sessionEvents.js'
import { agentPlans } from '../../src/db/schema/agentPlans.js'
import { mutationReceipts } from '../../src/db/schema/mutationReceipts.js'
import { assertDemoRealm, toReviewInsertValues } from '../../src/db/seed/loadScenario.js'
import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

// ---------------------------------------------------------------------------
// (1)-(3): unit, no DB.
// ---------------------------------------------------------------------------

describe('demo scenario fixtures and the loadScenario row mappers (unit)', () => {
  it('(1) DEMO_SCENARIO_NAMES has exactly the eight PRD §6 names and every name has a fixture', () => {
    expect(DEMO_SCENARIO_NAMES).toHaveLength(8)
    expect(new Set(Object.keys(DEMO_SCENARIOS))).toEqual(new Set(DEMO_SCENARIO_NAMES))
    for (const name of DEMO_SCENARIO_NAMES) {
      expect(DEMO_SCENARIOS[name]).toBeDefined()
      expect(DEMO_SCENARIOS[name].name).toBe(name)
    }
  })

  it("(2) the row mapper throws on a fixture row with realm 'pilot'", () => {
    expect(() => assertDemoRealm('pilot', 'test row')).toThrow()
    expect(() => assertDemoRealm('demo', 'test row')).not.toThrow()
  })

  it('(3) the row mapper maps a review with episode_count null to null and episode_count 0 to 0 (never coalesced)', () => {
    const baseReview = (episodeCount: ReportedCount): AnchoredReview => ({
      sessionKey: 'test-session',
      episodeCount,
      countMethod: null,
      firstSwitchKind: null,
      firstSwitchSeconds: null,
      firstSwitchMethod: null,
      externalCount: null,
      unplannedAgentChecks: null,
      mindWanderingCount: null,
      outputQuality: null,
      outputNote: null,
      reviewNote: null,
      materiallyDisrupted: null,
      disruptionNote: null,
      recallPoints: null,
      recallStartedAt: null,
      recallLockedAt: null,
      recallDelaySeconds: null,
      recallDurationSeconds: null,
      recallFlags: [],
      recallScores: null,
      recallScore: null,
      observedConditions: { deviceFormat: null, language: null, materialLevel: null, accommodations: [] },
      finalizedAt: null,
    })

    const nullMapped = toReviewInsertValues(baseReview(null), 'session-id')
    expect(nullMapped.episodeCount).toBeNull()

    const zeroMapped = toReviewInsertValues(baseReview(0), 'session-id')
    expect(zeroMapped.episodeCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// (4)-(14): integration, attention_lab_test.
// ---------------------------------------------------------------------------

async function loadScenarioViaRoute(app: FastifyInstance, name: string) {
  return app.inject({ method: 'POST', url: `/api/v1/demo/scenarios/${name}/load` })
}

describe('POST /demo/scenarios/{name}/load (integration, attention_lab_test)', () => {
  let testApp: TestApp
  let app: FastifyInstance

  beforeAll(async () => {
    testApp = await buildTestApp()
    app = testApp.app
  })

  afterAll(async () => {
    await testApp.close()
  })

  beforeEach(async () => {
    await testApp.truncateAll()
  })

  it('(4) unknown scenario name -> 404 not_found envelope', async () => {
    const res = await loadScenarioViaRoute(app, 'not-a-real-scenario')
    expect(res.statusCode).toBe(404)
    const body = res.json() as { code: string }
    expect(body.code).toBe('not_found')
  })

  it.each(DEMO_SCENARIO_NAMES)(
    '(5) load "%s" -> 200, every root row is local-demo/demo, every session is demo_clock',
    async (name) => {
      const res = await loadScenarioViaRoute(app, name)
      expect(res.statusCode).toBe(200)
      const body = res.json() as { programId: string | null }

      if (name === 'new-user') {
        expect(body.programId).toBeNull()
      } else {
        expect(body.programId).toMatch(UUID_PATTERN)
      }

      const [programsRow] = await app.sql<[{ count: number }]>`
        SELECT count(*)::int AS count FROM programs
        WHERE realm <> 'demo' OR user_id <> 'local-demo'`
      expect(programsRow!.count).toBe(0)

      const [sessionsRow] = await app.sql<[{ count: number }]>`
        SELECT count(*)::int AS count FROM focus_sessions
        WHERE realm <> 'demo' OR user_id <> 'local-demo'`
      expect(sessionsRow!.count).toBe(0)

      const [checkinsRow] = await app.sql<[{ count: number }]>`
        SELECT count(*)::int AS count FROM daily_checkins dc
        JOIN programs p ON p.id = dc.program_id
        WHERE dc.realm <> 'demo' OR p.user_id <> 'local-demo'`
      expect(checkinsRow!.count).toBe(0)

      const [timeSourceRow] = await app.sql<[{ count: number }]>`
        SELECT count(*)::int AS count FROM focus_sessions WHERE time_source <> 'demo_clock'`
      expect(timeSourceRow!.count).toBe(0)
    },
  )

  it('(6) comparable-change: 4 finalized eligible benchmark sessions', async () => {
    const res = await loadScenarioViaRoute(app, 'comparable-change')
    expect(res.statusCode).toBe(200)

    const rows = await app.db
      .select({ kind: focusSessions.kind, lifecycle: focusSessions.lifecycle, eligible: focusSessions.eligible })
      .from(focusSessions)

    expect(rows).toHaveLength(4)
    for (const row of rows) {
      expect(row.kind).toBe('benchmark')
      expect(row.lifecycle).toBe('finalized')
      expect(row.eligible).toBe(true)
    }
  })

  it('(7) missing-final: 2 baseline attempts and fewer than 2 eligible finals', async () => {
    const res = await loadScenarioViaRoute(app, 'missing-final')
    expect(res.statusCode).toBe(200)

    const [baselineRow] = await app.sql<[{ count: number }]>`
      SELECT count(*)::int AS count FROM focus_sessions fs
      JOIN benchmark_slots bs ON bs.id = fs.slot_id
      WHERE bs.phase = 'baseline'`
    expect(baselineRow!.count).toBe(2)

    const [eligibleFinalRow] = await app.sql<[{ count: number }]>`
      SELECT count(*)::int AS count FROM focus_sessions fs
      JOIN benchmark_slots bs ON bs.id = fs.slot_id
      WHERE bs.phase = 'final' AND fs.eligible = true`
    expect(eligibleFinalRow!.count).toBeLessThan(2)
  })

  it('(8) zero-baseline: baseline reviews store episode_count 0, not null', async () => {
    const res = await loadScenarioViaRoute(app, 'zero-baseline')
    expect(res.statusCode).toBe(200)

    const rows = await app.sql<{ episode_count: number | null }[]>`
      SELECT sr.episode_count FROM session_reviews sr
      JOIN focus_sessions fs ON fs.id = sr.session_id
      JOIN benchmark_slots bs ON bs.id = fs.slot_id
      WHERE bs.phase = 'baseline'`
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.episode_count).toBe(0)
    }
  })

  it('(9) timing-deviation: one running benchmark, started ~1080s before load, with an unresolved clock-gap event', async () => {
    const beforeLoadMs = Date.now()
    const res = await loadScenarioViaRoute(app, 'timing-deviation')
    expect(res.statusCode).toBe(200)

    const sessions = await app.db.select().from(focusSessions)
    expect(sessions).toHaveLength(1)
    const session = sessions[0]!
    expect(session.kind).toBe('benchmark')
    expect(session.lifecycle).toBe('running')
    expect(session.timerQuality).toBe('ok')
    expect(session.eligible).toBeNull()

    const expectedStartedAtMs = beforeLoadMs - 1080 * 1000
    expect(Math.abs(session.startedAt.getTime() - expectedStartedAtMs)).toBeLessThan(5000)

    const events = await app.db.select().from(sessionEvents)
    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.type).toBe('clock_gap')
    const details = event.details as { gapSeconds?: number; resolution?: string }
    expect(details.gapSeconds).toBe(300)
    expect('resolution' in details).toBe(false)
  })

  it('(10) recovery: one running practice session with an agent_plans row and zero session_events rows', async () => {
    const res = await loadScenarioViaRoute(app, 'recovery')
    expect(res.statusCode).toBe(200)

    const runningSessions = await app.db
      .select()
      .from(focusSessions)
      .where(eq(focusSessions.lifecycle, 'running'))
    expect(runningSessions).toHaveLength(1)
    const session = runningSessions[0]!
    expect(session.kind).toBe('practice')

    const plans = await app.db.select().from(agentPlans).where(eq(agentPlans.sessionId, session.id))
    expect(plans).toHaveLength(1)

    const events = await app.db.select().from(sessionEvents)
    expect(events).toHaveLength(0)
  })

  it('(11) loading mixed-result after comparable-change with no body -> 200, one program row, the old id gone', async () => {
    const first = await loadScenarioViaRoute(app, 'comparable-change')
    expect(first.statusCode).toBe(200)
    const firstProgramId = (first.json() as { programId: string }).programId

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/demo/scenarios/mixed-result/load',
    })
    expect(second.statusCode).toBe(200)
    const secondProgramId = (second.json() as { programId: string }).programId

    const rows = await app.db.select({ id: programs.id }).from(programs)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(secondProgramId)
    expect(rows[0]!.id).not.toBe(firstProgramId)
  })

  it('(12) new-user -> 200 { programId: null } and zero program rows for the principal', async () => {
    const res = await loadScenarioViaRoute(app, 'new-user')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ programId: null })

    const rows = await app.db.select({ id: programs.id }).from(programs)
    expect(rows).toHaveLength(0)
  })

  it('(13) a mutation_receipts row for the principal does not survive a load', async () => {
    await app.db.insert(mutationReceipts).values({
      userId: 'local-demo',
      idempotencyKey: randomUUID(),
      operation: 'test_op',
      requestHash: 'a'.repeat(64),
      resultRef: 'ref',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    })

    const res = await loadScenarioViaRoute(app, 'new-user')
    expect(res.statusCode).toBe(200)

    const [row] = await app.sql<[{ count: number }]>`
      SELECT count(*)::int AS count FROM mutation_receipts WHERE user_id = 'local-demo'`
    expect(row!.count).toBe(0)
  })

  it('(14) a prior demo-clock offset is zeroed by the load, and baseline_date anchors to real "today"', async () => {
    const setOffset = await app.inject({
      method: 'POST',
      url: '/api/v1/demo/clock',
      payload: { offsetSeconds: 1209600 },
    })
    expect(setOffset.statusCode).toBe(200)

    const loadRes = await loadScenarioViaRoute(app, 'working-day')
    expect(loadRes.statusCode).toBe(200)

    const meRes = await app.inject({ method: 'GET', url: '/api/v1/me' })
    expect((meRes.json() as { demoClockOffsetSeconds: number }).demoClockOffsetSeconds).toBe(0)

    const [program] = await app.db
      .select({ baselineDate: programs.baselineDate, timezone: programs.timezone })
      .from(programs)
    expect(program).toBeDefined()

    const scenario = DEMO_SCENARIOS['working-day']
    const expectedBaselineDate = addDays(localDateAt(new Date(), program!.timezone), -scenario.viewDay)
    expect(program!.baselineDate).toBe(expectedBaselineDate)
  })
})
