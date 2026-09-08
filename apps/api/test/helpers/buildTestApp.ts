import pino from 'pino'
import type { FastifyInstance } from 'fastify'
import type { Sql } from 'postgres'
import { getTableName, isTable } from 'drizzle-orm'
import { buildApp } from '../../src/app.js'
import type { AppConfig } from '../../src/config.js'
import type { AppDatabase } from '../../src/plugins/db.js'
import * as schema from '../../src/db/schema/index.js'
import { ensurePrincipalProfile } from '../../src/plugins/identity.js'
import { captureLogs, type CapturedLogs } from './captureLogs.js'
import { resolveTestDatabaseUrl } from './testDb.js'

export interface TestApp {
  app: FastifyInstance
  db: AppDatabase
  sql: Sql
  logs: CapturedLogs
  /**
   * Truncates every table exported by the schema barrel, CASCADE, between
   * tests, then re-seeds the fixed `local-demo` principal row (3.2.3's
   * `ensurePrincipalProfile`) so a test that truncates never has to re-seed
   * the principal by hand.
   */
  truncateAll(): Promise<void>
  close(): Promise<void>
}

/**
 * The API test foundation (design.md D16): every later unit that needs a
 * real app wired to the real test database (4.1.1's program seed helpers,
 * 5.1.3's session seed helpers, and every plugin/route test after this one)
 * builds on this rather than re-creating it.
 */
export async function buildTestApp(overrides: Partial<AppConfig> = {}): Promise<TestApp> {
  const config: AppConfig = {
    identityMode: 'local-demo',
    host: '127.0.0.1',
    port: 0,
    databaseUrl: resolveTestDatabaseUrl(process.env),
    logLevel: 'info',
    ...overrides,
  }

  const logs = captureLogs()
  const loggerInstance = pino({ level: config.logLevel }, logs)

  const app = await buildApp(config, { loggerInstance })
  await app.ready()

  async function truncateAll(): Promise<void> {
    // Cast to `unknown[]` before filtering: the schema barrel exports pgEnum
    // objects alongside tables (3.3.1 on), and `Array<T>.filter(isTable)`
    // only narrows when its element type `T` is itself assignable to
    // `Table` — true for `unknown`, false for a union that also contains
    // non-table exports like `PgEnum`.
    const tableNames = (Object.values(schema) as unknown[])
      .filter(isTable)
      .map((table) => getTableName(table))

    if (tableNames.length > 0) {
      const identifiers = tableNames.map((name) => `"${name}"`).join(', ')
      await app.sql.unsafe(`TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE`)
    }

    // 3.2.3: truncation removes the local-demo user_profiles row along with
    // everything else, so every test that calls truncateAll() keeps a
    // principal to work with without re-seeding it by hand.
    await ensurePrincipalProfile(app.db)
  }

  async function close(): Promise<void> {
    await app.close()
  }

  return { app, db: app.db, sql: app.sql, logs, truncateAll, close }
}
