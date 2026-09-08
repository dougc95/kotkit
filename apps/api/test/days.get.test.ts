/**
 * `6.1.1` — Fastify inject integration tests for `GET
 * /programs/{id}/days/{date}` against the real `attention_lab_test`
 * database, via `buildTestApp` (3.2.1). `daily_checkins` and `feed_usage`
 * rows are seeded directly through `insertProgram`/`insertCheckin` (4.1.1) —
 * no `PUT` is needed for this GET-only task. Complements the pure-function
 * unit tests in `test/unit/checkinView.test.ts` (`buildCheckinView`), which
 * this file never re-tests.
 */
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { addDays, REALM_MISMATCH_MESSAGE } from '@attention-lab/shared'

import { buildTestApp, type TestApp } from './helpers/buildTestApp.js'
import { insertCheckin, insertOtherPrincipalProgram, insertProgram } from './helpers/programs.js'
import { dailyCheckins } from '../src/db/schema/index.js'

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
  aggregates: {
    unitLabel: string
    feedDeviceMinutes: number | null
    feedByDevice: { phone: number | null; desktop: number | null; tablet: number | null; unspecified: number | null }
    partial: boolean
    shortVideoDeviceMinutes: number | null
    appTotals: Array<{ device: string; platform: string; minutes: number }>
  }
  version: number
}

interface ErrorBody {
  code: string
  message: string
  details?: Record<string, unknown>
}

describe('GET /programs/{id}/days/{date} (integration, attention_lab_test)', () => {
  let testApp: TestApp

  async function getDay(
    app: FastifyInstance,
    programId: string,
    date: string,
  ): Promise<{ statusCode: number; body: DayBody & ErrorBody; headers: Record<string, string | string[] | number | undefined> }> {
    const res = await app.inject({ method: 'GET', url: `/api/v1/programs/${programId}/days/${date}` })
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

  beforeAll(async () => {
    testApp = await buildTestApp()
  })

  beforeEach(async () => {
    await testApp.truncateAll()
  })

  afterAll(async () => {
    await testApp.close()
  })

  it("(1) date inside the window with no row -> 200 with the D22 empty shell (checkin all-null, feed [], status not_reported, missing ['sleep','feed'], version 0)", async () => {
    const programId = await activeProgram()

    const { statusCode, body } = await getDay(testApp.app, programId, BASELINE_DATE)
    expect(statusCode).toBe(200)
    expect(body.checkin).toEqual({
      localDate: BASELINE_DATE,
      sleepMinutes: null,
      stress: null,
      mindfulnessMinutes: null,
      note: null,
    })
    expect(body.feed).toEqual([])
    expect(body.status).toEqual({ status: 'not_reported', missing: ['sleep', 'feed'] })
    expect(body.version).toBe(0)
  })

  it('(2) desktop "all" 30 only -> feedByDevice.phone null and partial true', async () => {
    const programId = await activeProgram()
    await insertCheckin(testApp.db, {
      programId,
      localDate: BASELINE_DATE,
      sleepMinutes: 400,
      feed: [{ device: 'desktop', platform: 'all', minutes: 30, measurementScope: 'feed' }],
    })

    const { body } = await getDay(testApp.app, programId, BASELINE_DATE)
    expect(body.aggregates.feedByDevice.phone).toBeNull()
    expect(body.aggregates.partial).toBe(true)
  })

  it('(3) explicit zero phone "all" row -> feedByDevice.phone 0 and feedDeviceMinutes includes it', async () => {
    const programId = await activeProgram()
    await insertCheckin(testApp.db, {
      programId,
      localDate: BASELINE_DATE,
      feed: [{ device: 'phone', platform: 'all', minutes: 0, measurementScope: 'feed' }],
    })

    const { body } = await getDay(testApp.app, programId, BASELINE_DATE)
    expect(body.aggregates.feedByDevice.phone).toBe(0)
    expect(body.aggregates.feedDeviceMinutes).toBe(0)
  })

  it('(4) app_total 60 alongside feed 25 -> feedDeviceMinutes 25 and appTotals carries the 60', async () => {
    const programId = await activeProgram()
    await insertCheckin(testApp.db, {
      programId,
      localDate: BASELINE_DATE,
      feed: [
        { device: 'phone', platform: 'instagram', minutes: 60, measurementScope: 'app_total', source: 'device_report' },
        { device: 'phone', platform: 'instagram', minutes: 25, measurementScope: 'feed' },
      ],
    })

    const { body } = await getDay(testApp.app, programId, BASELINE_DATE)
    expect(body.aggregates.feedDeviceMinutes).toBe(25)
    expect(body.aggregates.appTotals).toEqual([
      expect.objectContaining({ device: 'phone', platform: 'instagram', minutes: 60 }),
    ])
  })

  it('(5) two devices 20+20 -> feedDeviceMinutes 40', async () => {
    const programId = await activeProgram()
    await insertCheckin(testApp.db, {
      programId,
      localDate: BASELINE_DATE,
      feed: [
        { device: 'phone', platform: 'all', minutes: 20, measurementScope: 'feed' },
        { device: 'desktop', platform: 'all', minutes: 20, measurementScope: 'feed' },
      ],
    })

    const { body } = await getDay(testApp.app, programId, BASELINE_DATE)
    expect(body.aggregates.feedDeviceMinutes).toBe(40)
  })

  it("(6) sleep only -> status incomplete, missing ['feed']", async () => {
    const programId = await activeProgram()
    await insertCheckin(testApp.db, { programId, localDate: BASELINE_DATE, sleepMinutes: 420 })

    const { body } = await getDay(testApp.app, programId, BASELINE_DATE)
    expect(body.status).toEqual({ status: 'incomplete', missing: ['feed'] })
  })

  it("(7) row with source device_report -> feed[0].source === 'device_report'", async () => {
    const programId = await activeProgram()
    await insertCheckin(testApp.db, {
      programId,
      localDate: BASELINE_DATE,
      feed: [{ device: 'phone', platform: 'browser', minutes: 15, measurementScope: 'feed', source: 'device_report' }],
    })

    const { body } = await getDay(testApp.app, programId, BASELINE_DATE)
    expect(body.feed[0]?.source).toBe('device_report')
  })

  it("(8) :date '2026-13-01' -> 400 malformed_request", async () => {
    const programId = await activeProgram()

    const { statusCode, body } = await getDay(testApp.app, programId, '2026-13-01')
    expect(statusCode).toBe(400)
    expect(body.code).toBe('malformed_request')
  })

  it('(9) date two days before baseline -> 404 not_found', async () => {
    const programId = await activeProgram()
    const before = addDays(BASELINE_DATE, -2)

    const { statusCode } = await getDay(testApp.app, programId, before)
    expect(statusCode).toBe(404)
  })

  it('(10) Cache-Control: no-store present', async () => {
    const programId = await activeProgram()

    const { headers } = await getDay(testApp.app, programId, BASELINE_DATE)
    expect(headers['cache-control']).toBe('no-store')
  })

  it("(11) programs row for user_id 'other-principal' -> 404 with message 'Not found' and no program detail", async () => {
    const { programId } = await insertOtherPrincipalProgram(testApp.db)

    const { statusCode, body } = await getDay(testApp.app, programId, '2026-09-06')
    expect(statusCode).toBe(404)
    expect(body.message).toBe('Not found')
    expect(JSON.stringify(body)).not.toContain('other-principal')
  })

  it('(12) daily_checkins row with realm "pilot" under the demo program -> 422 realm_mismatch with the fixed message and no realm value in the body', async () => {
    const programId = await activeProgram()
    const { checkinId } = await insertCheckin(testApp.db, {
      programId,
      localDate: BASELINE_DATE,
      sleepMinutes: 420,
    })
    await testApp.db.update(dailyCheckins).set({ realm: 'pilot' }).where(eq(dailyCheckins.id, checkinId))

    const { statusCode, body } = await getDay(testApp.app, programId, BASELINE_DATE)
    expect(statusCode).toBe(422)
    expect(body.code).toBe('realm_mismatch')
    expect(body.message).toBe(REALM_MISMATCH_MESSAGE)
    expect(JSON.stringify(body)).not.toMatch(/"realm"\s*:\s*"(demo|pilot)"/)
  })
})
