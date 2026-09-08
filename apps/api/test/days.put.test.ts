/**
 * `6.1.2` — Fastify inject integration tests for `PUT
 * /programs/{id}/days/{date}` against the real `attention_lab_test`
 * database, via `buildTestApp` (3.2.1) and the `putDay` helper
 * (`test/helpers/days.ts`, created by this task). Complements the
 * pure-function unit tests in `test/unit/checkin.write.test.ts`, which this
 * file never re-tests, and reuses `test/days.get.test.ts`'s read path
 * (`GET`) only to assert what a save actually persisted.
 */
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { addDays } from '@attention-lab/shared'

import { buildTestApp, type TestApp } from './helpers/buildTestApp.js'
import { insertOtherPrincipalProgram, insertProgram } from './helpers/programs.js'
import { putDay, type PutDayInput } from './helpers/days.js'
import { dailyCheckins, feedUsage, programs } from '../src/db/schema/index.js'

const UTC = 'UTC'
const BASELINE_DATE = '2026-09-06'

interface DayBody {
  checkin: {
    localDate: string
    sleepMinutes: number | null
    stress: number | null
    mindfulnessMinutes: number | null
    note: string | null
  }
  feed: Array<{
    device: string
    platform: string
    minutes: number
    shortVideoMinutes: number | null
    measurementScope: string
    source: string
    plannedWindow: boolean | null
  }>
  status: { status: string; missing: string[] }
  aggregates: Record<string, unknown>
  version: number
}

interface ErrorBody {
  code: string
  message: string
  fieldErrors?: Record<string, string>
  details?: Record<string, unknown>
}

type Body = DayBody & ErrorBody

interface Result {
  statusCode: number
  body: Body
  headers: Record<string, string | string[] | number | undefined>
}

describe('PUT /programs/{id}/days/{date} (integration, attention_lab_test)', () => {
  let testApp: TestApp

  async function put(programId: string, date: string, input: PutDayInput): Promise<Result> {
    const res = await putDay(testApp.app, programId, date, input)
    return { statusCode: res.statusCode, body: res.body as unknown as Body, headers: res.headers }
  }

  async function getDay(programId: string, date: string): Promise<Result> {
    const res = await testApp.app.inject({ method: 'GET', url: `/api/v1/programs/${programId}/days/${date}` })
    return { statusCode: res.statusCode, body: res.json(), headers: res.headers }
  }

  async function activeProgram(): Promise<string> {
    const { programId } = await insertProgram(testApp.db, {
      baselineDate: BASELINE_DATE,
      timezone: UTC,
      status: 'active',
      practiceTargetSeconds: 600,
    })
    return programId
  }

  async function checkinRows(programId: string) {
    return testApp.db.select().from(dailyCheckins).where(eq(dailyCheckins.programId, programId))
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

  it('(1) create: expectedVersion 0 + sleep + one phone "all" row -> 200, status complete, version 1, stress/mindfulness/note NULL', async () => {
    const programId = await activeProgram()

    const { statusCode, body } = await put(programId, BASELINE_DATE, {
      expectedVersion: 0,
      sleepMinutes: 420,
      feed: [{ device: 'phone', platform: 'all', minutes: 20, measurementScope: 'feed', source: 'estimate' }],
    })
    expect(statusCode).toBe(200)
    expect(body.status).toEqual({ status: 'complete', missing: [] })
    expect(body.version).toBe(1)

    const [row] = await checkinRows(programId)
    expect(row?.stress).toBeNull()
    expect(row?.mindfulnessMinutes).toBeNull()
    expect(row?.note).toBeNull()
  })

  it("(2) sleep only -> 200, status incomplete, missing ['feed']", async () => {
    const programId = await activeProgram()

    const { statusCode, body } = await put(programId, BASELINE_DATE, {
      expectedVersion: 0,
      sleepMinutes: 400,
      feed: [],
    })
    expect(statusCode).toBe(200)
    expect(body.status).toEqual({ status: 'incomplete', missing: ['feed'] })
  })

  it("(3) all blank: feed [] and no sleep -> 200, status incomplete, missing ['sleep','feed'], one daily_checkins row", async () => {
    const programId = await activeProgram()

    const { statusCode, body } = await put(programId, BASELINE_DATE, { expectedVersion: 0, feed: [] })
    expect(statusCode).toBe(200)
    expect(body.status).toEqual({ status: 'incomplete', missing: ['sleep', 'feed'] })

    expect(await checkinRows(programId)).toHaveLength(1)
  })

  it('(4) edit twice: PUT sleep (v0) then PUT sleep+feed (v1) on the same date -> exactly one daily_checkins row holding both, version 2', async () => {
    const programId = await activeProgram()

    await put(programId, BASELINE_DATE, { expectedVersion: 0, sleepMinutes: 400, feed: [] })
    const { statusCode, body } = await put(programId, BASELINE_DATE, {
      expectedVersion: 1,
      sleepMinutes: 400,
      feed: [{ device: 'desktop', platform: 'all', minutes: 15, measurementScope: 'feed', source: 'estimate' }],
    })
    expect(statusCode).toBe(200)
    expect(body.version).toBe(2)

    const rows = await checkinRows(programId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.sleepMinutes).toBe(400)

    const feedRows = await testApp.db.select().from(feedUsage).where(eq(feedUsage.checkinId, rows[0]!.id))
    expect(feedRows).toHaveLength(1)
  })

  it("(5) stale save: two PUTs with the same expectedVersion -> second is 409 stale_version whose details.current equals the first save's view, the row is unchanged and a GET returns the first save's values", async () => {
    const programId = await activeProgram()

    const first = await put(programId, BASELINE_DATE, { expectedVersion: 0, sleepMinutes: 400, feed: [] })
    expect(first.statusCode).toBe(200)

    const second = await put(programId, BASELINE_DATE, { expectedVersion: 0, sleepMinutes: 450, feed: [] })
    expect(second.statusCode).toBe(409)
    expect(second.body.code).toBe('stale_version')
    expect(second.body.details?.current).toEqual(first.body)

    const getResult = await getDay(programId, BASELINE_DATE)
    expect(getResult.body.checkin.sleepMinutes).toBe(400)
  })

  it('(6) first PUT with expectedVersion 1 and no row -> 409 stale_version with details.current.version 0 and no row written', async () => {
    const programId = await activeProgram()

    const { statusCode, body } = await put(programId, BASELINE_DATE, { expectedVersion: 1, feed: [] })
    expect(statusCode).toBe(409)
    expect(body.code).toBe('stale_version')
    expect((body.details?.current as { version: number } | undefined)?.version).toBe(0)

    expect(await checkinRows(programId)).toHaveLength(0)
  })

  it('(7) short-video 45 over 30 with a note -> 422 feed_subset_violation naming feed[0].shortVideoMinutes, zero feed_usage rows written, body does not contain the note text', async () => {
    const programId = await activeProgram()
    const noteText = 'a private note that must never appear in the error body'

    const { statusCode, body } = await put(programId, BASELINE_DATE, {
      expectedVersion: 0,
      note: noteText,
      feed: [
        {
          device: 'phone',
          platform: 'all',
          minutes: 30,
          shortVideoMinutes: 45,
          measurementScope: 'feed',
          source: 'estimate',
        },
      ],
    })
    expect(statusCode).toBe(422)
    expect(body.code).toBe('feed_subset_violation')
    expect(body.fieldErrors).toHaveProperty('feed[0].shortVideoMinutes')
    expect(JSON.stringify(body)).not.toContain(noteText)

    expect(await checkinRows(programId)).toHaveLength(0)
  })

  it("(8) phone 'all' + phone instagram feed rows -> 422 feed_platform_conflict, nothing written", async () => {
    const programId = await activeProgram()

    const { statusCode, body } = await put(programId, BASELINE_DATE, {
      expectedVersion: 0,
      feed: [
        { device: 'phone', platform: 'all', minutes: 20, measurementScope: 'feed', source: 'estimate' },
        { device: 'phone', platform: 'instagram', minutes: 10, measurementScope: 'feed', source: 'estimate' },
      ],
    })
    expect(statusCode).toBe(422)
    expect(body.code).toBe('feed_platform_conflict')

    expect(await checkinRows(programId)).toHaveLength(0)
  })

  it('(9) duplicate device/platform/scope -> 422 duplicate_feed_row, nothing written', async () => {
    const programId = await activeProgram()

    const { statusCode, body } = await put(programId, BASELINE_DATE, {
      expectedVersion: 0,
      feed: [
        { device: 'phone', platform: 'instagram', minutes: 10, measurementScope: 'feed', source: 'estimate' },
        { device: 'phone', platform: 'instagram', minutes: 10, measurementScope: 'feed', source: 'estimate' },
      ],
    })
    expect(statusCode).toBe(422)
    expect(body.code).toBe('duplicate_feed_row')

    expect(await checkinRows(programId)).toHaveLength(0)
  })

  it('(10) explicit zero: phone "all" minutes 0 -> feed_usage row with minutes 0 (not NULL, not dropped)', async () => {
    const programId = await activeProgram()

    const { statusCode } = await put(programId, BASELINE_DATE, {
      expectedVersion: 0,
      feed: [{ device: 'phone', platform: 'all', minutes: 0, measurementScope: 'feed', source: 'estimate' }],
    })
    expect(statusCode).toBe(200)

    const [checkin] = await checkinRows(programId)
    const feedRows = await testApp.db.select().from(feedUsage).where(eq(feedUsage.checkinId, checkin!.id))
    expect(feedRows).toHaveLength(1)
    expect(feedRows[0]?.minutes).toBe(0)
  })

  it('(11) source device_report persists on the row', async () => {
    const programId = await activeProgram()

    await put(programId, BASELINE_DATE, {
      expectedVersion: 0,
      feed: [{ device: 'phone', platform: 'browser', minutes: 12, measurementScope: 'feed', source: 'device_report' }],
    })

    const [checkin] = await checkinRows(programId)
    const feedRows = await testApp.db.select().from(feedUsage).where(eq(feedUsage.checkinId, checkin!.id))
    expect(feedRows[0]?.source).toBe('device_report')
  })

  it('(12) 55 feed minutes against leisure_allowance_min 20 -> 200 with no warning/blocking field', async () => {
    const programId = await activeProgram()

    const { statusCode, body } = await put(programId, BASELINE_DATE, {
      expectedVersion: 0,
      feed: [{ device: 'phone', platform: 'all', minutes: 55, measurementScope: 'feed', source: 'estimate' }],
    })
    expect(statusCode).toBe(200)
    expect(JSON.stringify(body)).not.toMatch(/warn|block/i)
  })

  it('(13) atomic replace: PUT 3 rows then PUT 1 row -> exactly 1 feed_usage row', async () => {
    const programId = await activeProgram()

    await put(programId, BASELINE_DATE, {
      expectedVersion: 0,
      feed: [
        { device: 'phone', platform: 'all', minutes: 10, measurementScope: 'feed', source: 'estimate' },
        { device: 'desktop', platform: 'all', minutes: 10, measurementScope: 'feed', source: 'estimate' },
        { device: 'tablet', platform: 'all', minutes: 10, measurementScope: 'feed', source: 'estimate' },
      ],
    })
    await put(programId, BASELINE_DATE, {
      expectedVersion: 1,
      feed: [{ device: 'phone', platform: 'all', minutes: 5, measurementScope: 'feed', source: 'estimate' }],
    })

    const [checkin] = await checkinRows(programId)
    const feedRows = await testApp.db.select().from(feedUsage).where(eq(feedUsage.checkinId, checkin!.id))
    expect(feedRows).toHaveLength(1)
  })

  it('(14) GET after a second PUT returns the incremented version and the replaced rows', async () => {
    const programId = await activeProgram()

    await put(programId, BASELINE_DATE, {
      expectedVersion: 0,
      feed: [{ device: 'phone', platform: 'all', minutes: 10, measurementScope: 'feed', source: 'estimate' }],
    })
    await put(programId, BASELINE_DATE, {
      expectedVersion: 1,
      feed: [{ device: 'desktop', platform: 'all', minutes: 25, measurementScope: 'feed', source: 'estimate' }],
    })

    const { body } = await getDay(programId, BASELINE_DATE)
    expect(body.version).toBe(2)
    expect(body.feed).toHaveLength(1)
    expect(body.feed[0]?.device).toBe('desktop')
  })

  it('(15) Day 10 saved with no Day 9 row -> 200', async () => {
    const programId = await activeProgram()
    const day10 = addDays(BASELINE_DATE, 10)

    const { statusCode } = await put(programId, day10, { expectedVersion: 0, feed: [] })
    expect(statusCode).toBe(200)
  })

  it('(16) date outside Days 0–14 -> 404 not_found and no row', async () => {
    const programId = await activeProgram()
    const before = addDays(BASELINE_DATE, -2)

    const { statusCode, body } = await put(programId, before, { expectedVersion: 0, feed: [] })
    expect(statusCode).toBe(404)
    expect(body.code).toBe('not_found')

    expect(await checkinRows(programId)).toHaveLength(0)
  })

  it("(17) :date '2026-9-1' -> 400 malformed_request and no row", async () => {
    const programId = await activeProgram()

    const res = await testApp.app.inject({
      method: 'PUT',
      url: `/api/v1/programs/${programId}/days/2026-9-1`,
      payload: { expectedVersion: 0, feed: [] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('malformed_request')

    expect(await checkinRows(programId)).toHaveLength(0)
  })

  it("(18) realm in body -> 400 with fieldErrors.realm and no row; stored daily_checkins.realm is 'demo'", async () => {
    const programId = await activeProgram()

    const res = await testApp.app.inject({
      method: 'PUT',
      url: `/api/v1/programs/${programId}/days/${BASELINE_DATE}`,
      payload: { expectedVersion: 0, feed: [], realm: 'pilot' },
    })
    expect(res.statusCode).toBe(400)
    const body = res.json() as Body
    expect(body.fieldErrors).toHaveProperty('realm')

    expect(await checkinRows(programId)).toHaveLength(0)

    await put(programId, BASELINE_DATE, { expectedVersion: 0, feed: [] })
    const [row] = await checkinRows(programId)
    expect(row?.realm).toBe('demo')
  })

  it("(19) program owned by 'other-principal' -> 404 with no program detail", async () => {
    const { programId } = await insertOtherPrincipalProgram(testApp.db)

    const { statusCode, body } = await put(programId, '2026-09-06', { expectedVersion: 0, feed: [] })
    expect(statusCode).toBe(404)
    expect(body.message).toBe('Not found')
    expect(JSON.stringify(body)).not.toContain('other-principal')
  })

  it("(20) program status set to 'completed' -> 409 program_terminal and no row", async () => {
    const programId = await activeProgram()
    await testApp.db.update(programs).set({ status: 'completed' }).where(eq(programs.id, programId))

    const { statusCode, body } = await put(programId, BASELINE_DATE, { expectedVersion: 0, feed: [] })
    expect(statusCode).toBe(409)
    expect(body.code).toBe('program_terminal')

    expect(await checkinRows(programId)).toHaveLength(0)
  })

  it('(21) Cache-Control: no-store present', async () => {
    const programId = await activeProgram()

    const res = await testApp.app.inject({
      method: 'PUT',
      url: `/api/v1/programs/${programId}/days/${BASELINE_DATE}`,
      payload: { expectedVersion: 0, feed: [] },
    })
    expect(res.headers['cache-control']).toBe('no-store')
  })
})
