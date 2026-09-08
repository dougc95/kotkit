import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { bootstrapTestDb, maintenanceUrl, parseDatabaseName } from '../scripts/bootstrap-test-db.js'

const journalPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/db/migrations/meta/_journal.json',
)

function throwawayUrl(): string {
  const base = process.env.DATABASE_URL_TEST
  if (!base) throw new Error('DATABASE_URL_TEST must be set to run this integration test')
  const parsed = new URL(base)
  parsed.pathname = '/attention_lab_bootstrap_test'
  return parsed.toString()
}

const url = throwawayUrl()
const name = parseDatabaseName(url)

async function dropDatabase() {
  const client = postgres(maintenanceUrl(url), { max: 1, connect_timeout: 5 })
  try {
    await client.unsafe(`DROP DATABASE IF EXISTS "${name}"`)
  } finally {
    await client.end({ timeout: 5 })
  }
}

/**
 * DROP DATABASE of a database that does NOT exist (the pre-clean at the top
 * of the first `it`, before `attention_lab_bootstrap_test` has ever been
 * created) is a fast catalog-only check and returns immediately. DROP
 * DATABASE of one that DOES exist — as in `afterAll` below, after this
 * file's own tests have connected to it — needs an instance-wide exclusive
 * lock that can genuinely queue behind the rest of the apps/api suite's
 * (72+ files, fileParallelism: false) concurrent connection churn against
 * the separate `attention_lab_test` database; `pg_database` is a shared
 * catalog across every database in the cluster, so that contention is real
 * Postgres behavior, not a bug here. This was confirmed by instrumenting
 * the call under a full-suite run: the DROP statement itself was what
 * stalled, not connecting or ending the client.
 */
async function bestEffortDropDatabase(timeoutMs: number): Promise<void> {
  let timedOut = false
  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      timedOut = true
      resolve()
    }, timeoutMs).unref()
  })

  try {
    await Promise.race([dropDatabase(), timeout])
  } catch (err) {
    // A throwaway database failing to drop is housekeeping, not a test
    // failure — the next run's pre-clean (above) retries it, and cluster
    // lock contention easing by then is exactly what makes that retry work.
    console.warn(`[bootstrapTestDb integration] cleanup drop of ${name} failed, leaving it for the next run:`, err)
    return
  }
  if (timedOut) {
    console.warn(
      `[bootstrapTestDb integration] cleanup drop of ${name} did not finish within ${timeoutMs}ms (likely instance-wide DROP DATABASE lock contention under the full suite), leaving it for the next run's pre-clean`,
    )
  }
}

describe('bootstrapTestDb (integration)', () => {
  afterAll(async () => {
    await bestEffortDropDatabase(20_000)
  }, 25_000)

  it('first run creates attention_lab_bootstrap_test (pg_database row appears)', async () => {
    await dropDatabase()
    await bootstrapTestDb({ DATABASE_URL: process.env.DATABASE_URL, DATABASE_URL_TEST: url })

    const client = postgres(maintenanceUrl(url), { max: 1 })
    try {
      const rows = await client/*sql*/`select 1 from pg_database where datname = ${name}`
      expect(rows.length).toBe(1)
    } finally {
      await client.end()
    }
  })

  it('second run is idempotent and resolves without error', async () => {
    await expect(
      bootstrapTestDb({ DATABASE_URL: process.env.DATABASE_URL, DATABASE_URL_TEST: url }),
    ).resolves.toBeUndefined()
  })

  it.skipIf(!existsSync(journalPath))(
    'when meta/_journal.json exists, drizzle.__drizzle_migrations is present in the new database',
    async () => {
      const client = postgres(url, { max: 1 })
      try {
        const rows = await client/*sql*/`
          select 1 from information_schema.tables
          where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
        `
        expect(rows.length).toBe(1)
      } finally {
        await client.end()
      }
    },
  )
})
