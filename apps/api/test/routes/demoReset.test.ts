import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, getTableName, isTable } from 'drizzle-orm'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'

import * as schema from '../../src/db/schema/index.js'
import { userProfiles } from '../../src/db/schema/userProfiles.js'
import { programs } from '../../src/db/schema/programs.js'
import { protocolRevisions } from '../../src/db/schema/protocolRevisions.js'
import { benchmarkSlots } from '../../src/db/schema/benchmarkSlots.js'
import { focusSessions } from '../../src/db/schema/focusSessions.js'
import { sessionEvents } from '../../src/db/schema/sessionEvents.js'
import { sessionReviews } from '../../src/db/schema/sessionReviews.js'
import { sessionAmendments } from '../../src/db/schema/sessionAmendments.js'
import { agentPlans } from '../../src/db/schema/agentPlans.js'
import { dailyCheckins } from '../../src/db/schema/dailyCheckins.js'
import { feedUsage } from '../../src/db/schema/feedUsage.js'
import { mutationReceipts } from '../../src/db/schema/mutationReceipts.js'
import { DEFAULT_PREFERENCES } from '../../src/preferences.js'
import { USER_OWNED_TABLES } from '../../src/db/seed/deletePrincipalData.js'
import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'

// ---------------------------------------------------------------------------
// (1)-(2): unit, schema introspection only, no DB query.
// ---------------------------------------------------------------------------

describe('USER_OWNED_TABLES (unit, schema introspection)', () => {
  it('(1) every schema-barrel table except user_profiles appears exactly once in USER_OWNED_TABLES', () => {
    const allTableNames = (Object.values(schema) as unknown[])
      .filter(isTable)
      .map((table) => getTableName(table))
    const expected = allTableNames.filter((name) => name !== 'user_profiles').sort()

    const actualNames = USER_OWNED_TABLES.map((table) => getTableName(table))

    expect(actualNames.slice().sort()).toEqual(expected)
    expect(new Set(actualNames).size).toBe(actualNames.length)
  })

  it('(2) the order places each child table before every table it references, except the one FK cycle deletePrincipalData breaks by nulling programs.current_revision_id first', () => {
    const order: string[] = USER_OWNED_TABLES.map((table) => getTableName(table))
    const indexOf = (name: string): number => order.indexOf(name)

    interface Edge {
      from: string
      to: string
    }
    const edges: Edge[] = []
    for (const table of USER_OWNED_TABLES) {
      const from = getTableName(table)
      for (const fk of getTableConfig(table as PgTable).foreignKeys) {
        const to = getTableName(fk.reference().foreignTable)
        if (to === from) continue
        // A reference to a table outside USER_OWNED_TABLES (only
        // user_profiles, via userId columns) is never deleted, so it is
        // never part of this ordering.
        if (indexOf(to) === -1) continue
        edges.push({ from, to })
      }
    }
    expect(edges.length).toBeGreaterThan(0)

    const edgeKey = (e: Edge): string => `${e.from}->${e.to}`
    const edgeSet = new Set(edges.map(edgeKey))
    const isMutual = (e: Edge): boolean => edgeSet.has(`${e.to}->${e.from}`)

    const nonCyclic = edges.filter((e) => !isMutual(e))
    const cyclic = edges.filter(isMutual)

    // The schema's one circular FK pair: programs.current_revision_id ->
    // protocol_revisions.id and protocol_revisions.program_id -> programs.id.
    // deletePrincipalData nulls current_revision_id before deleting
    // protocol_revisions rows, so this pair is deliberately exempt from pure
    // "child before referenced" ordering — every other edge is not.
    expect(cyclic.map(edgeKey).sort()).toEqual(
      ['programs->protocol_revisions', 'protocol_revisions->programs'].sort(),
    )

    for (const edge of nonCyclic) {
      expect(indexOf(edge.from), `${edge.from} should be deleted before ${edge.to}`).toBeLessThan(
        indexOf(edge.to),
      )
    }
  })
})

// ---------------------------------------------------------------------------
// (3)-(9): integration, attention_lab_test.
// ---------------------------------------------------------------------------

const LOCAL_DEMO = 'local-demo'
const OTHER_USER = 'other-user'

/** Direct inserts (not via any route) covering every USER_OWNED_TABLES entry for `local-demo`. */
async function seedLocalDemoRows(app: FastifyInstance): Promise<void> {
  const db = app.db

  const [program] = await db
    .insert(programs)
    .values({
      userId: LOCAL_DEMO,
      realm: 'demo',
      baselineDate: '2026-09-06',
      timezone: 'UTC',
      status: 'draft',
      leisureAllowanceMin: 20,
    })
    .returning()

  const [revision] = await db
    .insert(protocolRevisions)
    .values({
      programId: program!.id,
      revision: 1,
      effectiveDay: 0,
      settings: { practiceTargetSeconds: 600, bandCeilings: [], leisureAllowanceMin: 20 },
      reason: 'initial plan',
    })
    .returning()

  // Exercises the circular FK: current_revision_id genuinely points at a
  // protocol_revisions row deletePrincipalData must still be able to remove.
  await db
    .update(programs)
    .set({ currentRevisionId: revision!.id })
    .where(eq(programs.id, program!.id))

  await db.insert(benchmarkSlots).values({
    programId: program!.id,
    phase: 'baseline',
    label: 'A',
    materialRef: 'Chapter 1',
    assignedLocalDate: '2026-09-06',
  })

  const [session] = await db
    .insert(focusSessions)
    .values({
      userId: LOCAL_DEMO,
      programId: program!.id,
      revisionId: revision!.id,
      realm: 'demo',
      kind: 'practice',
      lifecycle: 'finalized',
      targetSeconds: 1200,
      startedAt: new Date(),
      endedAt: new Date(),
      localDate: '2026-09-06',
      timeSource: 'measured',
    })
    .returning()

  await db.insert(sessionEvents).values({
    sessionId: session!.id,
    clientEventId: randomUUID(),
    type: 'off_task',
    occurredAt: new Date(),
    elapsedMs: 1000,
  })

  await db.insert(sessionReviews).values({
    sessionId: session!.id,
    observedConditions: { deviceFormat: null, language: null, materialLevel: null, accommodations: [] },
  })

  await db.insert(sessionAmendments).values({
    sessionId: session!.id,
    userId: LOCAL_DEMO,
    reason: 'test amendment',
    excludeFromReport: false,
  })

  await db.insert(agentPlans).values({ sessionId: session!.id })

  const [checkin] = await db
    .insert(dailyCheckins)
    .values({
      programId: program!.id,
      realm: 'demo',
      localDate: '2026-09-06',
      sleepMinutes: 420,
    })
    .returning()

  await db.insert(feedUsage).values({
    checkinId: checkin!.id,
    device: 'phone',
    platform: 'all',
    minutes: 30,
    measurementScope: 'feed',
    source: 'estimate',
  })

  await db.insert(mutationReceipts).values({
    userId: LOCAL_DEMO,
    idempotencyKey: randomUUID(),
    operation: 'test_op',
    requestHash: 'a'.repeat(64),
    resultRef: 'ref',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  })

  await db
    .update(userProfiles)
    .set({
      demoClockOffsetSeconds: 999,
      timezone: 'Europe/Madrid',
      preferences: { ...DEFAULT_PREFERENCES, endChime: true },
    })
    .where(eq(userProfiles.id, LOCAL_DEMO))
}

/** A profile, program, session and receipt for a second user_id, to prove reset is principal-scoped. */
async function seedOtherUserRows(app: FastifyInstance): Promise<void> {
  const db = app.db

  await db.insert(userProfiles).values({
    id: OTHER_USER,
    timezone: 'UTC',
    preferences: DEFAULT_PREFERENCES,
  })

  const [program] = await db
    .insert(programs)
    .values({
      userId: OTHER_USER,
      realm: 'demo',
      baselineDate: '2026-09-06',
      timezone: 'UTC',
      status: 'draft',
      leisureAllowanceMin: 20,
    })
    .returning()

  const [revision] = await db
    .insert(protocolRevisions)
    .values({
      programId: program!.id,
      revision: 1,
      effectiveDay: 0,
      settings: { practiceTargetSeconds: 600, bandCeilings: [], leisureAllowanceMin: 20 },
      reason: 'initial plan',
    })
    .returning()

  await db.insert(focusSessions).values({
    userId: OTHER_USER,
    programId: program!.id,
    revisionId: revision!.id,
    realm: 'demo',
    kind: 'practice',
    lifecycle: 'finalized',
    targetSeconds: 1200,
    startedAt: new Date(),
    endedAt: new Date(),
    localDate: '2026-09-06',
    timeSource: 'measured',
  })

  await db.insert(mutationReceipts).values({
    userId: OTHER_USER,
    idempotencyKey: randomUUID(),
    operation: 'test_op',
    requestHash: 'b'.repeat(64),
    resultRef: 'ref',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  })
}

/**
 * Row counts for one user_id, computed independently of `deletePrincipalData`
 * (a raw join per table, "checked per table via the parent join") so this is
 * a genuine check on stored data, not a restatement of the production code.
 */
async function ownedCounts(app: FastifyInstance, userId: string, realm: string): Promise<Record<string, number>> {
  const sql = app.sql

  const [feedUsageRow] = await sql<[{ count: number }]>`
    SELECT count(*)::int AS count FROM feed_usage fu
    JOIN daily_checkins dc ON dc.id = fu.checkin_id
    JOIN programs p ON p.id = dc.program_id
    WHERE p.user_id = ${userId} AND dc.realm = ${realm}`
  const [dailyCheckinsRow] = await sql<[{ count: number }]>`
    SELECT count(*)::int AS count FROM daily_checkins dc
    JOIN programs p ON p.id = dc.program_id
    WHERE p.user_id = ${userId} AND dc.realm = ${realm}`
  const [sessionEventsRow] = await sql<[{ count: number }]>`
    SELECT count(*)::int AS count FROM session_events se
    JOIN focus_sessions fs ON fs.id = se.session_id
    WHERE fs.user_id = ${userId} AND fs.realm = ${realm}`
  const [sessionReviewsRow] = await sql<[{ count: number }]>`
    SELECT count(*)::int AS count FROM session_reviews sr
    JOIN focus_sessions fs ON fs.id = sr.session_id
    WHERE fs.user_id = ${userId} AND fs.realm = ${realm}`
  const [sessionAmendmentsRow] = await sql<[{ count: number }]>`
    SELECT count(*)::int AS count FROM session_amendments sa
    JOIN focus_sessions fs ON fs.id = sa.session_id
    WHERE fs.user_id = ${userId} AND fs.realm = ${realm}`
  const [agentPlansRow] = await sql<[{ count: number }]>`
    SELECT count(*)::int AS count FROM agent_plans ap
    JOIN focus_sessions fs ON fs.id = ap.session_id
    WHERE fs.user_id = ${userId} AND fs.realm = ${realm}`
  const [focusSessionsRow] = await sql<[{ count: number }]>`
    SELECT count(*)::int AS count FROM focus_sessions
    WHERE user_id = ${userId} AND realm = ${realm}`
  const [benchmarkSlotsRow] = await sql<[{ count: number }]>`
    SELECT count(*)::int AS count FROM benchmark_slots bs
    JOIN programs p ON p.id = bs.program_id
    WHERE p.user_id = ${userId} AND p.realm = ${realm}`
  const [protocolRevisionsRow] = await sql<[{ count: number }]>`
    SELECT count(*)::int AS count FROM protocol_revisions pr
    JOIN programs p ON p.id = pr.program_id
    WHERE p.user_id = ${userId} AND p.realm = ${realm}`
  const [programsRow] = await sql<[{ count: number }]>`
    SELECT count(*)::int AS count FROM programs
    WHERE user_id = ${userId} AND realm = ${realm}`
  const [mutationReceiptsRow] = await sql<[{ count: number }]>`
    SELECT count(*)::int AS count FROM mutation_receipts
    WHERE user_id = ${userId}`

  return {
    feed_usage: feedUsageRow!.count,
    daily_checkins: dailyCheckinsRow!.count,
    session_events: sessionEventsRow!.count,
    session_reviews: sessionReviewsRow!.count,
    session_amendments: sessionAmendmentsRow!.count,
    agent_plans: agentPlansRow!.count,
    focus_sessions: focusSessionsRow!.count,
    benchmark_slots: benchmarkSlotsRow!.count,
    protocol_revisions: protocolRevisionsRow!.count,
    programs: programsRow!.count,
    mutation_receipts: mutationReceiptsRow!.count,
  }
}

const ZERO_COUNTS: Record<string, number> = {
  feed_usage: 0,
  daily_checkins: 0,
  session_events: 0,
  session_reviews: 0,
  session_amendments: 0,
  agent_plans: 0,
  focus_sessions: 0,
  benchmark_slots: 0,
  protocol_revisions: 0,
  programs: 0,
  mutation_receipts: 0,
}

describe('POST /demo/reset (integration, attention_lab_test)', () => {
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

  it('(3) POST /api/v1/demo/reset -> 204', async () => {
    await seedLocalDemoRows(app)

    const res = await app.inject({ method: 'POST', url: '/api/v1/demo/reset' })

    expect(res.statusCode).toBe(204)
    expect(res.body).toBe('')
  })

  it('(4) every user-owned table has 0 rows for local-demo after reset', async () => {
    await seedLocalDemoRows(app)
    const before = await ownedCounts(app, LOCAL_DEMO, 'demo')
    for (const [table, count] of Object.entries(before)) {
      expect(count, `${table} should have a seeded row before reset`).toBeGreaterThan(0)
    }

    const res = await app.inject({ method: 'POST', url: '/api/v1/demo/reset' })
    expect(res.statusCode).toBe(204)

    const after = await ownedCounts(app, LOCAL_DEMO, 'demo')
    expect(after).toEqual(ZERO_COUNTS)
  })

  it('(5) mutation_receipts has 0 rows for local-demo after reset', async () => {
    await seedLocalDemoRows(app)

    const res = await app.inject({ method: 'POST', url: '/api/v1/demo/reset' })
    expect(res.statusCode).toBe(204)

    const [row] = await app.sql<[{ count: number }]>`
      SELECT count(*)::int AS count FROM mutation_receipts WHERE user_id = ${LOCAL_DEMO}`
    expect(row!.count).toBe(0)
  })

  it('(6) the user_profiles row survives with offset 0, timezone Europe/Madrid and endChime true', async () => {
    await seedLocalDemoRows(app)

    const res = await app.inject({ method: 'POST', url: '/api/v1/demo/reset' })
    expect(res.statusCode).toBe(204)

    const [profile] = await app.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.id, LOCAL_DEMO))
      .limit(1)

    expect(profile).toBeDefined()
    expect(profile!.demoClockOffsetSeconds).toBe(0)
    expect(profile!.timezone).toBe('Europe/Madrid')
    expect((profile!.preferences as { endChime: boolean }).endChime).toBe(true)
  })

  it('(7) other-user rows are untouched by a reset of local-demo', async () => {
    await seedLocalDemoRows(app)
    await seedOtherUserRows(app)

    const otherBefore = await ownedCounts(app, OTHER_USER, 'demo')
    const [profileBefore] = await app.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.id, OTHER_USER))
      .limit(1)
    expect(profileBefore).toBeDefined()

    const res = await app.inject({ method: 'POST', url: '/api/v1/demo/reset' })
    expect(res.statusCode).toBe(204)

    const otherAfter = await ownedCounts(app, OTHER_USER, 'demo')
    expect(otherAfter).toEqual(otherBefore)
    // The seed only touches programs, focus_sessions and mutation_receipts
    // for other-user; those three are non-zero and must stay exactly so.
    expect(otherAfter.programs).toBe(1)
    expect(otherAfter.focus_sessions).toBe(1)
    expect(otherAfter.mutation_receipts).toBe(1)

    const [profileAfter] = await app.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.id, OTHER_USER))
      .limit(1)
    expect(profileAfter).toEqual(profileBefore)
  })

  it('(8) a second reset on an already-empty state -> 204', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/v1/demo/reset' })
    expect(first.statusCode).toBe(204)

    const second = await app.inject({ method: 'POST', url: '/api/v1/demo/reset' })
    expect(second.statusCode).toBe(204)
  })

  it('(9) GET /me still 200 after reset', async () => {
    await seedLocalDemoRows(app)
    const resetRes = await app.inject({ method: 'POST', url: '/api/v1/demo/reset' })
    expect(resetRes.statusCode).toBe(204)

    const meRes = await app.inject({ method: 'GET', url: '/api/v1/me' })
    expect(meRes.statusCode).toBe(200)
    expect((meRes.json() as { principalId: string }).principalId).toBe(LOCAL_DEMO)
  })
})
