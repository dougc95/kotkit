/**
 * Task 6.3.1 — integration tests for `GET /api/v1/programs/{id}/export`
 * (`format=csv`) against the real `attention_lab_test` database.
 *
 * `Date` (only) is faked per test (`vi.useFakeTimers({ toFake: ['Date'] })`)
 * so `exported_at` and every demo-scenario-derived date are stable across
 * runs without touching `setTimeout`/socket timers the real Postgres
 * connection depends on. Before the snapshot comparison, every UUID in the
 * body is replaced with `<uuid-N>` in first-seen order so the snapshot does
 * not depend on which ids the loader happened to generate.
 */
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'

import type { AppDatabase } from '../src/plugins/db.js'
import { benchmarkSlots } from '../src/db/schema/benchmarkSlots.js'
import { focusSessions } from '../src/db/schema/focusSessions.js'
import { sessionReviews } from '../src/db/schema/sessionReviews.js'
import { programs } from '../src/db/schema/programs.js'
import { EXPORT_DEMO_LABEL } from '../src/services/export/csv.js'
import { buildTestApp, type TestApp } from './helpers/buildTestApp.js'
import { insertOtherPrincipalProgram, insertProgram, insertSlotSet } from './helpers/programs.js'
import { seedSession } from './helpers/sessions.js'

const FIXED_NOW = '2026-09-20T12:00:00.000Z'

async function getExport(app: FastifyInstance, programId: string, format = 'csv') {
  return app.inject({ method: 'GET', url: `/api/v1/programs/${programId}/export?format=${format}` })
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

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** Replaces every UUID in `text` with `<uuid-N>`, numbered in first-seen order, so a snapshot never depends on generated ids. */
function normalizeUuids(text: string): string {
  const seen = new Map<string, string>()
  return text.replace(UUID_RE, (match) => {
    const key = match.toLowerCase()
    let placeholder = seen.get(key)
    if (placeholder === undefined) {
      placeholder = `<uuid-${seen.size + 1}>`
      seen.set(key, placeholder)
    }
    return placeholder
  })
}

// `protocol_revisions.created_at` (and `session_amendments.created_at`) are
// stamped by Postgres's own `defaultNow()`, never by the JS `Date` faked
// above — real wall-clock time, so it (and `exported_at`, which IS the
// faked `Date`) must both be normalized the same way UUIDs are, or the
// snapshot would drift on every real run.
const TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g

function normalizeTimestamps(text: string): string {
  const seen = new Map<string, string>()
  return text.replace(TIMESTAMP_RE, (match) => {
    let placeholder = seen.get(match)
    if (placeholder === undefined) {
      placeholder = `<timestamp-${seen.size + 1}>`
      seen.set(match, placeholder)
    }
    return placeholder
  })
}

/** The `attempts` section's header + data lines, from a full export CSV body. */
function attemptsLines(csv: string): string[] {
  const afterHeading = csv.split('# attempts\n')[1]
  if (afterHeading === undefined) throw new Error('attemptsLines: no "# attempts" section in CSV')
  return afterHeading.split('\n\n')[0]!.split('\n')
}

describe('GET /api/v1/programs/{id}/export?format=csv (integration, attention_lab_test)', () => {
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
    // Only `Date` is faked (never `setTimeout`/sockets, which the real
    // Postgres connection this suite runs against needs to keep working).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(FIXED_NOW))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('comparable-change scenario CSV matches the committed snapshot', async () => {
    const programId = await loadScenarioViaRoute(app, 'comparable-change')
    const res = await getExport(app, programId)
    expect(res.statusCode).toBe(200)
    expect(normalizeTimestamps(normalizeUuids(res.body))).toMatchSnapshot()
  })

  it("blank-count fixture (finalized benchmark + session_reviews with episode_count NULL and exclusion_reasons ['count_unknown']) → s cell empty and exclusion_reasons contains count_unknown", async () => {
    const { programId } = await insertProgram(db, {
      baselineDate: '2026-09-06',
      timezone: 'UTC',
      status: 'active',
      practiceTargetSeconds: 600,
    })
    const slots = await insertSlotSet(db, programId)
    await seedSession(db, {
      programId,
      kind: 'benchmark',
      slotId: slots.baselineA,
      lifecycle: 'finalized',
      localDate: '2026-09-06',
      startedAt: new Date('2026-09-06T09:00:00.000Z'),
      endedAt: new Date('2026-09-06T09:20:00.000Z'),
      targetSeconds: 1200,
      completeInterval: true,
      eligible: false,
      exclusionReasons: ['count_unknown'],
      review: { episodeCount: null },
    })

    const res = await getExport(app, programId)
    expect(res.statusCode).toBe(200)
    const [, dataLine] = attemptsLines(res.body)
    const cells = dataLine!.split(',')
    // attempts header: attempt_id,phase,label,local_date,realm,time_source,
    // s(6),s_method,t_state,t_seconds,t_method,recall_score,e,m,disruption,
    // device_format,language,material_level,accommodations,eligible,
    // exclusion_reasons(20),...
    expect(cells[6]).toBe('')
    expect(cells[20]).toContain('count_unknown')
  })

  it('first line is the demo label', async () => {
    const programId = await loadScenarioViaRoute(app, 'comparable-change')
    const res = await getExport(app, programId)
    expect(res.statusCode).toBe(200)
    expect((res.body as string).split('\n')[0]).toBe(`# ${EXPORT_DEMO_LABEL}`)
  })

  it('Cache-Control: no-store and Content-Type text/csv', async () => {
    const programId = await loadScenarioViaRoute(app, 'comparable-change')
    const res = await getExport(app, programId)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8')
  })

  it('format=xml → 400 malformed_request', async () => {
    const { programId } = await insertProgram(db, {
      baselineDate: '2026-09-06',
      timezone: 'UTC',
      status: 'draft',
      practiceTargetSeconds: 600,
    })
    const res = await getExport(app, programId, 'xml')
    expect(res.statusCode).toBe(400)
    const body = res.json() as { code: string }
    expect(body.code).toBe('malformed_request')
  })

  it("another principal's program → 404", async () => {
    const { programId } = await insertOtherPrincipalProgram(db)
    const res = await getExport(app, programId)
    expect(res.statusCode).toBe(404)
    const body = res.json() as { code: string }
    expect(body.code).toBe('not_found')
  })

  it('pilot row injected under the demo program → 422 realm_mismatch', async () => {
    const programId = await loadScenarioViaRoute(app, 'comparable-change')

    const [slotRow] = await db
      .select({ id: benchmarkSlots.id })
      .from(benchmarkSlots)
      .where(
        and(
          eq(benchmarkSlots.programId, programId),
          eq(benchmarkSlots.phase, 'baseline'),
          eq(benchmarkSlots.label, 'A'),
        ),
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
        localDate: '2026-09-06',
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

    const res = await getExport(app, programId)
    expect(res.statusCode).toBe(422)
    const body = res.json() as { code: string; message: string }
    expect(body.code).toBe('realm_mismatch')
    expect(body.message).toBe('Simulated and real results are never combined.')
  })
})
