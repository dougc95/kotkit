import { parseDatabaseName } from '../../scripts/bootstrap-test-db.js'

/**
 * The one place API tests learn which database to point at. Throws (rather
 * than falling back to `DATABASE_URL`) when `DATABASE_URL_TEST` is missing
 * or does not name a `_test` database, so a misconfigured `.env` can never
 * make a test suite truncate the real dev database (design.md D16; 3.2.1).
 */
export function resolveTestDatabaseUrl(env: Record<string, string | undefined>): string {
  const url = env.DATABASE_URL_TEST
  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST must be set (see .env.example) to run API tests against a real database',
    )
  }

  const name = parseDatabaseName(url)
  if (!name.endsWith('_test')) {
    throw new Error(
      `DATABASE_URL_TEST's database name must end in "_test" (got "${name}"); ` +
        'tests can never point at the dev database.',
    )
  }

  return url
}
