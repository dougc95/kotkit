/**
 * 3.3.4 — review of the three committed migrations (0000, 0001, 0002) plus
 * `meta/_journal.json`, and a from-scratch apply/integrity check against a
 * real database.
 *
 * The unit describe block reads the migration SQL and journal as plain text
 * (no DB, no drizzle schema) so it also catches a defect introduced by
 * hand-editing a `.sql` file directly, not only one introduced through
 * schema.ts. The integration describe block drops both `public` (where every
 * table lives) and drizzle's own `drizzle` schema (where `__drizzle_migrations`
 * lives) so `migrate()` has no record of anything already applied and must
 * genuinely recreate every statement, not just find its journal in sync.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = resolve(here, '../../src/db/migrations')
const journalPath = resolve(migrationsFolder, 'meta/_journal.json')

const MIGRATION_FILES = [
  '0000_profiles_programs_slots.sql',
  '0001_sessions.sql',
  '0002_days_receipts.sql',
] as const

function readMigration(file: string): string {
  return readFileSync(resolve(migrationsFolder, file), 'utf8')
}

/** Extracts the raw body between `CREATE TABLE "<name>" (` and its closing `);`. */
function extractCreateTable(sqlText: string, tableName: string): string {
  const re = new RegExp(`CREATE TABLE "${tableName}" \\(([\\s\\S]*?)\\n\\);`)
  const match = sqlText.match(re)
  if (!match) throw new Error(`CREATE TABLE "${tableName}" not found in migration text`)
  return match[1]!
}

/** The declaration line for one quoted column name within a CREATE TABLE body. */
function columnLine(tableBody: string, columnName: string): string {
  const re = new RegExp(`"${columnName}"[^\\n]*`)
  const match = tableBody.match(re)
  if (!match) throw new Error(`column "${columnName}" not found`)
  return match[0]
}

describe('migrations review (unit, static text, no DB)', () => {
  it('(1) the journal lists exactly three entries in order 0000, 0001, 0002', () => {
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>
    }
    expect(journal.entries).toHaveLength(3)
    expect(journal.entries.map((e) => e.idx)).toEqual([0, 1, 2])
    expect(journal.entries.map((e) => e.tag)).toEqual([
      '0000_profiles_programs_slots',
      '0001_sessions',
      '0002_days_receipts',
    ])
  })

  it('(2) the SQL files together contain every named index/constraint from 3.3.1-3.3.3', () => {
    const combined = MIGRATION_FILES.map(readMigration).join('\n')
    for (const name of [
      'programs_one_open_per_user',
      'focus_sessions_one_active_per_user',
      'focus_sessions_benchmark_has_slot',
      'session_events_client_event_unique',
      'feed_usage_short_video_subset',
      'daily_checkins_stress_range',
    ]) {
      expect(combined, `expected ${name} to appear by name`).toContain(name)
    }
  })

  it("(3) no file contains 'DROP TABLE', 'DROP COLUMN' or 'ON DELETE'", () => {
    for (const file of MIGRATION_FILES) {
      const text = readMigration(file)
      for (const forbidden of ['DROP TABLE', 'DROP COLUMN', 'ON DELETE']) {
        expect(text, `${file} must not contain "${forbidden}"`).not.toContain(forbidden)
      }
    }
  })

  it('(4) the CREATE TABLE for session_reviews declares the five nullable counts and review_note without DEFAULT', () => {
    const combined = MIGRATION_FILES.map(readMigration).join('\n')
    const body = extractCreateTable(combined, 'session_reviews')
    for (const name of [
      'episode_count',
      'external_count',
      'unplanned_agent_checks',
      'mind_wandering_count',
      'recall_score',
      'review_note',
    ]) {
      const line = columnLine(body, name)
      expect(line, `${name} declaration: ${line}`).not.toContain('DEFAULT')
    }
  })
})

describe('migrations review (integration, attention_lab_test, from scratch)', () => {
  let testApp: TestApp
  let db: ReturnType<typeof drizzle>

  beforeAll(async () => {
    testApp = await buildTestApp()
    db = drizzle(testApp.sql)
    // Drop both schemas so `migrate()` finds no journal of what was already
    // applied (in `drizzle.__drizzle_migrations`) and no tables either —
    // otherwise it would see its own bookkeeping as already satisfied and
    // recreate nothing, defeating the point of a from-scratch apply test.
    await testApp.sql.unsafe('DROP SCHEMA public CASCADE')
    await testApp.sql.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE')
    await testApp.sql.unsafe('CREATE SCHEMA public')
  })

  afterAll(async () => {
    await testApp.close()
  })

  it('(5) migrate() applies all three files from scratch without error', async () => {
    await expect(migrate(db, { migrationsFolder })).resolves.toBeUndefined()
    const [row] = await testApp.sql<[{ reg: string | null }]>`SELECT to_regclass('public.programs') AS reg`
    expect(row?.reg).not.toBeNull()
  })

  it('(6) the five session_reviews count columns are nullable with no default', async () => {
    const rows = await testApp.sql<Array<{ column_name: string; is_nullable: string; column_default: string | null }>>`
      SELECT column_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'session_reviews'
        AND column_name IN ('episode_count', 'external_count', 'unplanned_agent_checks', 'mind_wandering_count', 'recall_score')
    `
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      expect(row.is_nullable, `${row.column_name}.is_nullable`).toBe('YES')
      expect(row.column_default, `${row.column_name}.column_default`).toBeNull()
    }
  })

  it('(7) programs_one_open_per_user and focus_sessions_one_active_per_user carry a WHERE predicate', async () => {
    const rows = await testApp.sql<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('programs_one_open_per_user', 'focus_sessions_one_active_per_user')
    `
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.indexdef, `${row.indexname}.indexdef`).toContain('WHERE')
    }
  })

  it('(8) pg_constraint contains the three named CHECKs', async () => {
    const rows = await testApp.sql<Array<{ conname: string }>>`
      SELECT conname
      FROM pg_constraint
      WHERE contype = 'c'
        AND conname IN ('focus_sessions_benchmark_has_slot', 'feed_usage_short_video_subset', 'daily_checkins_stress_range')
    `
    expect(rows.map((r) => r.conname).sort()).toEqual(
      ['daily_checkins_stress_range', 'feed_usage_short_video_subset', 'focus_sessions_benchmark_has_slot'].sort(),
    )
  })

  it('(9) exactly programs, focus_sessions and daily_checkins have a realm column of udt_name realm_enum', async () => {
    const rows = await testApp.sql<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'realm'
        AND udt_name = 'realm_enum'
    `
    expect(rows.map((r) => r.table_name).sort()).toEqual(['daily_checkins', 'focus_sessions', 'programs'].sort())
  })

  it('(10) running migrate() a second time is a no-op', async () => {
    const before = await testApp.sql<[{ count: number }]>`
      SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'
    `
    await expect(migrate(db, { migrationsFolder })).resolves.toBeUndefined()
    const after = await testApp.sql<[{ count: number }]>`
      SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'
    `
    expect(after[0]!.count).toBe(before[0]!.count)
  })
})
