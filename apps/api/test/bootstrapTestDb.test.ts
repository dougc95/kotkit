import { describe, expect, it } from 'vitest'
import { bootstrapTestDb, maintenanceUrl, parseDatabaseName } from '../scripts/bootstrap-test-db.js'

describe('parseDatabaseName', () => {
  it('extracts attention_lab_test from the URL', () => {
    expect(parseDatabaseName('postgres://attention:devpassword@localhost:55432/attention_lab_test')).toBe(
      'attention_lab_test',
    )
  })
})

describe('maintenanceUrl', () => {
  it('swaps only the database segment and keeps host, port and credentials', () => {
    const result = maintenanceUrl('postgres://attention:devpassword@localhost:55432/attention_lab_test')
    const parsed = new URL(result)
    expect(parsed.pathname).toBe('/postgres')
    expect(parsed.hostname).toBe('localhost')
    expect(parsed.port).toBe('55432')
    expect(parsed.username).toBe('attention')
    expect(parsed.password).toBe('devpassword')
  })
})

describe('bootstrapTestDb refusals', () => {
  it('refuses when DATABASE_URL_TEST is undefined, naming the setting', async () => {
    await expect(bootstrapTestDb({})).rejects.toThrow('DATABASE_URL_TEST')
  })

  it('refuses when the test name equals the dev database name', async () => {
    const url = 'postgres://attention:devpassword@localhost:55432/attention_lab'
    await expect(
      bootstrapTestDb({ DATABASE_URL: url, DATABASE_URL_TEST: url }),
    ).rejects.toThrow('DATABASE_URL_TEST must name a different database from DATABASE_URL')
  })

  it('refuses when the name lacks the _test suffix', async () => {
    await expect(
      bootstrapTestDb({
        DATABASE_URL: 'postgres://attention:devpassword@localhost:55432/attention_lab',
        DATABASE_URL_TEST: 'postgres://attention:devpassword@localhost:55432/attention_lab_staging',
      }),
    ).rejects.toThrow('must end in "_test"')
  })
})
