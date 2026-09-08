/**
 * 3.3.3 — schema tests for daily_checkins, feed_usage and mutation_receipts.
 *
 * Uses its own profile id `days-schema-test-user` (never `local-demo`) so
 * these tests stay independent of the principal seeding 3.2.3 adds later
 * (mirrors 3.3.1/3.3.2's convention).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { randomUUID } from 'node:crypto'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import {
  userProfiles,
  programs,
  dailyCheckins,
  feedUsage,
  mutationReceipts,
} from '../../src/db/schema/index.js'
import { DEFAULT_PREFERENCES } from '../../src/preferences.js'

const PROFILE_ID = 'days-schema-test-user'

function programValues() {
  return {
    userId: PROFILE_ID,
    realm: 'demo' as const,
    baselineDate: '2026-09-06',
    timezone: 'UTC',
    status: 'draft' as const,
    leisureAllowanceMin: 20,
  }
}

function checkinValues(programId: string, localDate = '2026-09-06') {
  return {
    programId,
    realm: 'demo' as const,
    localDate,
  }
}

function feedRowValues(checkinId: string, overrides: Partial<typeof feedUsage.$inferInsert> = {}) {
  return {
    checkinId,
    device: 'phone' as const,
    platform: 'all',
    minutes: 30,
    measurementScope: 'feed' as const,
    source: 'estimate' as const,
    ...overrides,
  }
}

function receiptValues(
  userId: string,
  idempotencyKey: string,
  overrides: Partial<typeof mutationReceipts.$inferInsert> = {},
) {
  const createdAt = new Date('2026-09-06T10:00:00Z')
  const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 3600 * 1000)
  return {
    userId,
    idempotencyKey,
    operation: 'programs.create',
    requestHash: 'a'.repeat(64),
    resultRef: randomUUID(),
    createdAt,
    expiresAt,
    ...overrides,
  }
}

describe('daily records schema (unit, getTableConfig, no DB)', () => {
  it('(1) sleep_minutes and short_video_minutes are nullable with no default', () => {
    const sleepColumn = getTableConfig(dailyCheckins).columns.find((c) => c.name === 'sleep_minutes')
    expect(sleepColumn, 'sleep_minutes column exists').toBeDefined()
    expect(sleepColumn?.notNull).toBe(false)
    expect(sleepColumn?.hasDefault).toBe(false)

    const shortVideoColumn = getTableConfig(feedUsage).columns.find(
      (c) => c.name === 'short_video_minutes',
    )
    expect(shortVideoColumn, 'short_video_minutes column exists').toBeDefined()
    expect(shortVideoColumn?.notNull).toBe(false)
    expect(shortVideoColumn?.hasDefault).toBe(false)
  })

  it('(2) feed_usage has the CHECK feed_usage_short_video_subset and the four-column unique', () => {
    const config = getTableConfig(feedUsage)
    const check = config.checks.find((c) => c.name === 'feed_usage_short_video_subset')
    expect(check).toBeDefined()

    const unique = config.uniqueConstraints.find(
      (u) =>
        u.columns
          .map((c) => c.name)
          .sort()
          .join(',') === ['checkin_id', 'device', 'measurement_scope', 'platform'].sort().join(','),
    )
    expect(unique).toBeDefined()
  })

  it('(3) mutation_receipts primary key is composite (user_id, idempotency_key)', () => {
    const config = getTableConfig(mutationReceipts)
    expect(config.primaryKeys).toHaveLength(1)
    const pk = config.primaryKeys[0]
    expect(pk?.columns.map((c) => c.name).sort()).toEqual(['idempotency_key', 'user_id'])
  })

  it('(4) daily_checkins.realm is NOT NULL with no default, the CHECK daily_checkins_stress_range exists and daily_checkins has no status column', () => {
    const config = getTableConfig(dailyCheckins)
    const realmColumn = config.columns.find((c) => c.name === 'realm')
    expect(realmColumn).toBeDefined()
    expect(realmColumn?.notNull).toBe(true)
    expect(realmColumn?.hasDefault).toBe(false)

    const check = config.checks.find((c) => c.name === 'daily_checkins_stress_range')
    expect(check).toBeDefined()

    const names = config.columns.map((c) => c.name)
    expect(names).not.toContain('status')
  })
})

describe('daily records schema (integration, attention_lab_test)', () => {
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

  async function insertProgram(): Promise<string> {
    const [program] = await testApp.db.insert(programs).values(programValues()).returning()
    return program!.id
  }

  async function insertCheckin(programId: string, localDate = '2026-09-06'): Promise<string> {
    const [checkin] = await testApp.db
      .insert(dailyCheckins)
      .values(checkinValues(programId, localDate))
      .returning()
    return checkin!.id
  }

  it('(5) two check-ins with the same (program_id, local_date) violate the unique constraint (23505)', async () => {
    await insertProfile()
    const programId = await insertProgram()
    await testApp.db.insert(dailyCheckins).values(checkinValues(programId))
    await expect(testApp.db.insert(dailyCheckins).values(checkinValues(programId))).rejects.toMatchObject({
      cause: { code: '23505', constraint_name: 'daily_checkins_program_local_date_unique' },
    })
  })

  it('(6) a feed row with minutes 30 and short_video_minutes 40 violates feed_usage_short_video_subset (23514)', async () => {
    await insertProfile()
    const programId = await insertProgram()
    const checkinId = await insertCheckin(programId)
    await expect(
      testApp.db.insert(feedUsage).values(feedRowValues(checkinId, { minutes: 30, shortVideoMinutes: 40 })),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint_name: 'feed_usage_short_video_subset' },
    })
  })

  it('(7) short_video_minutes omitted (NULL) is allowed', async () => {
    await insertProfile()
    const programId = await insertProgram()
    const checkinId = await insertCheckin(programId)
    const [row] = await testApp.db
      .insert(feedUsage)
      .values(feedRowValues(checkinId, { minutes: 30 }))
      .returning()
    expect(row?.shortVideoMinutes).toBeNull()
  })

  it('(8) short_video_minutes equal to minutes (30/30) is allowed', async () => {
    await insertProfile()
    const programId = await insertProgram()
    const checkinId = await insertCheckin(programId)
    const [row] = await testApp.db
      .insert(feedUsage)
      .values(feedRowValues(checkinId, { minutes: 30, shortVideoMinutes: 30 }))
      .returning()
    expect(row?.shortVideoMinutes).toBe(30)
  })

  it('(9) a duplicate (checkin, device, platform, scope) row violates the unique constraint (23505)', async () => {
    await insertProfile()
    const programId = await insertProgram()
    const checkinId = await insertCheckin(programId)
    await testApp.db.insert(feedUsage).values(feedRowValues(checkinId))
    await expect(testApp.db.insert(feedUsage).values(feedRowValues(checkinId))).rejects.toMatchObject({
      cause: { code: '23505', constraint_name: 'feed_usage_checkin_device_platform_scope_unique' },
    })
  })

  it('(10) the same device/platform once with scope feed and once with scope app_total are both allowed', async () => {
    await insertProfile()
    const programId = await insertProgram()
    const checkinId = await insertCheckin(programId)
    await testApp.db.insert(feedUsage).values(feedRowValues(checkinId, { measurementScope: 'feed' }))
    const [second] = await testApp.db
      .insert(feedUsage)
      .values(feedRowValues(checkinId, { measurementScope: 'app_total' }))
      .returning()
    expect(second?.measurementScope).toBe('app_total')
  })

  it('(11) an explicit zero feed row reads back 0 while an omitted sleep_minutes reads back null (zero and unknown stay distinct)', async () => {
    await insertProfile()
    const programId = await insertProgram()
    const [checkin] = await testApp.db.insert(dailyCheckins).values(checkinValues(programId)).returning()
    const checkinId = checkin!.id
    expect(checkin?.sleepMinutes).toBeNull()

    const [row] = await testApp.db
      .insert(feedUsage)
      .values(feedRowValues(checkinId, { minutes: 0 }))
      .returning()
    expect(row?.minutes).toBe(0)
  })

  it('(12) stress 11 violates daily_checkins_stress_range (23514) and stress NULL is allowed', async () => {
    await insertProfile()
    const programId = await insertProgram()
    await expect(
      testApp.db.insert(dailyCheckins).values({ ...checkinValues(programId), stress: 11 }),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint_name: 'daily_checkins_stress_range' },
    })
    const [row] = await testApp.db.insert(dailyCheckins).values(checkinValues(programId)).returning()
    expect(row?.stress).toBeNull()
  })

  it('(13) inserting the same (user_id, idempotency_key) twice violates the primary key (23505)', async () => {
    const key = randomUUID()
    await testApp.db.insert(mutationReceipts).values(receiptValues(PROFILE_ID, key))
    await expect(
      testApp.db.insert(mutationReceipts).values(receiptValues(PROFILE_ID, key)),
    ).rejects.toMatchObject({
      cause: { code: '23505', constraint_name: 'mutation_receipts_user_id_idempotency_key_pk' },
    })
  })

  it('(14) the same idempotency_key under a different user_id is allowed', async () => {
    const key = randomUUID()
    await testApp.db.insert(mutationReceipts).values(receiptValues(PROFILE_ID, key))
    const [row] = await testApp.db
      .insert(mutationReceipts)
      .values(receiptValues('other-user', key))
      .returning()
    expect(row?.userId).toBe('other-user')
  })
})
