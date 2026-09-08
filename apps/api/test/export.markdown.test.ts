/**
 * Task 6.3.2 — integration tests for `GET /api/v1/programs/{id}/export`
 * (`format=markdown`) against the real `attention_lab_test` database.
 *
 * Mirrors `test/export.csv.test.ts` (6.3.1): `Date` (only) is faked per test
 * so `exported_at` and every demo-scenario-derived date are stable across
 * runs; before the snapshot comparison, every UUID in the body is replaced
 * with `<uuid-N>` (and every ISO timestamp with `<timestamp-N>`) in
 * first-seen order so the snapshot does not depend on generated ids or the
 * wall-clock `created_at` columns Postgres itself stamps.
 */
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppDatabase } from '../src/plugins/db.js'
import { EXPORT_DEMO_LABEL } from '../src/services/export/csv.js'
import { buildTestApp, type TestApp } from './helpers/buildTestApp.js'
import { insertProgram, insertSlotSet } from './helpers/programs.js'
import { seedSession } from './helpers/sessions.js'

const FIXED_NOW = '2026-09-20T12:00:00.000Z'

async function getExport(app: FastifyInstance, programId: string, format = 'markdown') {
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

/** The `## Attempts` section's body — up to (not including) the next `## ` heading. */
function attemptsSection(md: string): string {
  const afterHeading = md.split('## Attempts\n\n')[1]
  if (afterHeading === undefined) throw new Error('attemptsSection: no "## Attempts" section in Markdown')
  return afterHeading.split('\n\n## ')[0]!
}

const REQUIRED_ATTEMPT_COLUMNS = [
  'attempt_id',
  'phase',
  'label',
  'local_date',
  'realm',
  'time_source',
  's',
  's_method',
  't_state',
  't_seconds',
  't_method',
  'recall_score',
  'e',
  'm',
  'disruption',
  'device_format',
  'language',
  'material_level',
  'accommodations',
  'eligible',
  'exclusion_reasons',
  'protocol_revision',
  'recall_flags',
  'replacement_reason',
  'lifecycle',
]

describe('GET /api/v1/programs/{id}/export?format=markdown (integration, attention_lab_test)', () => {
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
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(FIXED_NOW))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('comparable-change scenario Markdown matches the committed snapshot', async () => {
    const programId = await loadScenarioViaRoute(app, 'comparable-change')
    const res = await getExport(app, programId)
    expect(res.statusCode).toBe(200)
    expect(normalizeTimestamps(normalizeUuids(res.body))).toMatchSnapshot()
  })

  it('blank-count fixture → S cell empty and exclusion column lists count_unknown', async () => {
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
    const section = attemptsSection(res.body as string)
    const dataLine = section
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .slice(2)[0]
    if (dataLine === undefined) throw new Error('expected an attempts data row')
    const cells = dataLine.split(' | ')
    expect(cells[6]).toBe('') // s
    expect(cells[20]).toContain('count_unknown') // exclusion_reasons
  })

  it('first line is the demo label', async () => {
    const programId = await loadScenarioViaRoute(app, 'comparable-change')
    const res = await getExport(app, programId)
    expect(res.statusCode).toBe(200)
    expect((res.body as string).split('\n')[0]).toBe(`# ${EXPORT_DEMO_LABEL}`)
  })

  it('Cache-Control: no-store and Content-Type text/markdown', async () => {
    const programId = await loadScenarioViaRoute(app, 'comparable-change')
    const res = await getExport(app, programId)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['content-type']).toBe('text/markdown; charset=utf-8')
  })

  it('attempts table header carries every required column name and the self-reported caption', async () => {
    const programId = await loadScenarioViaRoute(app, 'comparable-change')
    const res = await getExport(app, programId)
    expect(res.statusCode).toBe(200)
    const section = attemptsSection(res.body as string)
    expect(section).toContain('All counts are self-reported')
    for (const column of REQUIRED_ATTEMPT_COLUMNS) {
      expect(section).toContain(column)
    }
  })
})
